import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

interface SelectionTarget {
  source: string;
  component: string;
  tag: string;
  className: string;
  text: string;
  url: string;
  rect?: { x: number; y: number; width: number; height: number };
  attributes?: Record<string, string>;
  styles?: Record<string, string>;
  selectedAt: string;
}

interface ReferenceHit {
  path: string;
  line: number;
  text: string;
}

interface ReferenceCacheEntry {
  references: ReferenceHit[];
  cachedAt: number;
}

interface RuntimeState {
  projectDir?: string;
  serverProcess?: ChildProcess;
  bridge?: Server;
  bridgePort?: number;
  token?: string;
  url?: string;
  target?: SelectionTarget;
  references?: ReferenceHit[];
  referencesPending?: boolean;
  referencesRequestId?: number;
  focusApp?: string;
  referenceCache?: Map<string, ReferenceCacheEntry>;
  referenceWorker?: ChildProcess;
  referenceWorkerBuffer?: string;
  referenceWorkerRequests?: Map<number, { requestId: number; projectDir?: string; target?: SelectionTarget }>;
}

interface DesignCommandArgs {
  projectArg: string;
  fePort?: number;
  bePort?: number;
  focusApp?: string;
}

const state: RuntimeState = {};
const extensionDir = dirname(fileURLToPath(import.meta.url));
const pluginPath = join(extensionDir, 'vite-plugin.mjs');
const referenceWorkerPath = join(extensionDir, 'reference-worker.cjs');

function localFileUrl(path: string) {
  return pathToFileURL(path).href;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function readEnvFile(path: string) {
  if (!existsSync(path)) return {} as Record<string, string>;
  const entries: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

function parseDesignArgs(args: string): DesignCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const projectParts: string[] = [];
  let fePort: number | undefined;
  let bePort: number | undefined;
  let focusApp: string | undefined = 'Ghostty';

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--port' || token === '-p' || token === '--fe-port') {
      fePort = Number(tokens[++i]);
      continue;
    }
    if (token.startsWith('--port=') || token.startsWith('--fe-port=')) {
      fePort = Number(token.split('=')[1]);
      continue;
    }
    if (token === '--backend-port' || token === '--be-port' || token === '--be') {
      bePort = Number(tokens[++i]);
      continue;
    }
    if (token.startsWith('--backend-port=') || token.startsWith('--be-port=') || token.startsWith('--be=')) {
      bePort = Number(token.split('=')[1]);
      continue;
    }
    if (token === '--focus') {
      const next = tokens[i + 1];
      focusApp = next && !next.startsWith('-') ? tokens[++i] : 'Ghostty';
      continue;
    }
    if (token.startsWith('--focus=')) {
      focusApp = token.slice('--focus='.length) || 'Ghostty';
      continue;
    }
    if (/^\d+$/.test(token)) {
      if (fePort === undefined) fePort = Number(token);
      else if (bePort === undefined) bePort = Number(token);
      continue;
    }
    projectParts.push(token);
  }

  if (fePort !== undefined && (!Number.isInteger(fePort) || fePort <= 0)) throw new Error('Invalid frontend port.');
  if (bePort !== undefined && (!Number.isInteger(bePort) || bePort <= 0)) throw new Error('Invalid backend port.');
  return { projectArg: projectParts.join(' '), fePort, bePort, focusApp };
}

function resolveProjectDir(cwd: string, projectArg: string) {
  const input = projectArg.trim();
  const aliases: Record<string, string> = {
    app: 'frontend/app',
    linkpie: 'frontend/linkpie',
    deskpie: 'frontend/deskpie',
  };
  const candidate = aliases[input] ?? input;
  if (!candidate) return findViteReactProject(cwd) ?? cwd;
  if (/^https?:\/\//.test(candidate)) return findViteReactProject(cwd) ?? cwd;
  return resolve(cwd, candidate);
}

function findViteReactProject(cwd: string) {
  const candidates = [cwd, join(cwd, 'frontend/app'), join(cwd, 'frontend/linkpie'), join(cwd, 'frontend/deskpie')];
  return candidates.find((dir) => existsSync(join(dir, 'package.json')) && isViteReactProject(dir));
}

function isViteReactProject(dir: string) {
  try {
    const pkg = readJson(join(dir, 'package.json')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const hasVite = Boolean(deps.vite) || Boolean(pkg.scripts?.dev?.includes('vite'));
    const hasReact = Boolean(deps.react) && Boolean(deps['react-dom']);
    return hasVite && hasReact;
  } catch {
    return false;
  }
}

function findViteConfig(projectDir: string) {
  for (const name of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    const config = join(projectDir, name);
    if (existsSync(config)) return config;
  }
  return undefined;
}

async function getFreePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function sendCors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolveBody, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 200_000) req.destroy(new Error('Request body too large'));
    });
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

let referenceRequestSeq = 0;
let referenceWorkerSeq = 0;
const maxReferenceCacheEntries = 200;

function referenceCacheKey(projectDir: string | undefined, target: SelectionTarget | undefined) {
  if (!projectDir || !target?.component || !target.source) return undefined;
  const sourcePath = target.source.split(':')[0];
  return `${resolve(projectDir, sourcePath)}|${target.component}|${target.tag}`;
}

function getReferenceCache(projectDir: string | undefined, target: SelectionTarget | undefined) {
  const key = referenceCacheKey(projectDir, target);
  if (!key) return undefined;
  return state.referenceCache?.get(key);
}

function setReferenceCache(projectDir: string | undefined, target: SelectionTarget | undefined, references: ReferenceHit[]) {
  const key = referenceCacheKey(projectDir, target);
  if (!key) return;
  state.referenceCache ??= new Map();
  state.referenceCache.set(key, { references, cachedAt: Date.now() });
  if (state.referenceCache.size <= maxReferenceCacheEntries) return;
  const oldest = [...state.referenceCache.entries()].sort((left, right) => left[1].cachedAt - right[1].cachedAt)[0];
  if (oldest) state.referenceCache.delete(oldest[0]);
}

function handleReferenceWorkerLine(line: string) {
  if (!line.trim()) return;
  const result = JSON.parse(line) as { id?: number; references?: ReferenceHit[] };
  const id = result.id;
  if (id === undefined) return;
  const request = state.referenceWorkerRequests?.get(id);
  if (!request) return;
  state.referenceWorkerRequests?.delete(id);
  if (state.referencesRequestId !== request.requestId) return;
  state.references = Array.isArray(result.references) ? result.references : [];
  setReferenceCache(request.projectDir, request.target, state.references);
  state.referencesPending = false;
}

function resetReferenceWorker() {
  for (const request of state.referenceWorkerRequests?.values() ?? []) {
    if (state.referencesRequestId === request.requestId) {
      state.references = [];
      state.referencesPending = false;
    }
  }
  state.referenceWorkerRequests?.clear();
  state.referenceWorkerBuffer = '';
  state.referenceWorker = undefined;
}

function ensureReferenceWorker() {
  if (state.referenceWorker && !state.referenceWorker.killed) return state.referenceWorker;
  state.referenceWorkerRequests ??= new Map();
  state.referenceWorkerBuffer = '';
  const worker = spawn(process.execPath, [referenceWorkerPath, '--daemon'], { stdio: ['pipe', 'pipe', 'ignore'] });
  worker.stdout?.on('data', (chunk) => {
    state.referenceWorkerBuffer = (state.referenceWorkerBuffer ?? '') + chunk.toString();
    const lines = state.referenceWorkerBuffer.split('\n');
    state.referenceWorkerBuffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        handleReferenceWorkerLine(line);
      } catch {
        // Ignore malformed worker output and keep the daemon alive.
      }
    }
  });
  worker.once('exit', resetReferenceWorker);
  worker.once('error', resetReferenceWorker);
  state.referenceWorker = worker;
  return worker;
}

function scheduleReferenceRefresh(projectDir: string | undefined, target: SelectionTarget | undefined) {
  const requestId = ++referenceRequestSeq;
  const cached = getReferenceCache(projectDir, target);
  state.referencesRequestId = requestId;
  state.referencesPending = !cached;
  state.references = cached ? cached.references : [];
  if (cached) return { pending: false, cached: true, references: cached.references };
  const worker = ensureReferenceWorker();
  const id = ++referenceWorkerSeq;
  state.referenceWorkerRequests ??= new Map();
  state.referenceWorkerRequests.set(id, { requestId, projectDir, target });
  worker.stdin?.write(`${JSON.stringify({ id, projectDir, target })}\n`);
  return { pending: true, cached: false, references: [] };
}

async function startBridge(pi: ExtensionAPI, ctx: ExtensionCommandContext, token: string, requestedPort?: number) {
  const port = requestedPort ?? (await getFreePort());
  const bridge = createServer(async (req, res) => {
    sendCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.searchParams.get('token') !== token) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pending: Boolean(state.referencesPending), hasTarget: Boolean(state.target) }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/select') {
      try {
        const payload = JSON.parse(await readBody(req)) as Omit<SelectionTarget, 'selectedAt'>;
        state.target = { ...payload, selectedAt: new Date().toISOString() };
        const references = scheduleReferenceRefresh(state.projectDir, state.target);
        updateUi(ctx);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...references }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(error instanceof Error ? error.message : 'Bad request');
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/references') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pending: Boolean(state.referencesPending), references: state.references ?? [] }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/open') {
      try {
        const body = JSON.parse(await readBody(req)) as { path?: string; line?: number };
        openReference(state.projectDir, body.path, body.line);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(error instanceof Error ? error.message : 'Bad request');
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/open-source') {
      try {
        const body = JSON.parse(await readBody(req)) as { source?: string };
        openSource(state.projectDir, body.source);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(error instanceof Error ? error.message : 'Bad request');
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/ask') {
      try {
        const body = JSON.parse(await readBody(req)) as { question?: string; target?: Omit<SelectionTarget, 'selectedAt'> };
        if (body.target) {
          state.target = { ...body.target, selectedAt: new Date().toISOString() };
          scheduleReferenceRefresh(state.projectDir, state.target);
          updateUi(ctx);
        }
        const question = body.question?.trim();
        if (!question) throw new Error('Question is required.');
        const message = state.target
          ? `${formatTarget(state.target)}\n\nUse this selected UI element as the primary context for the user request. If editing, inspect the source file before changing it.\n\n${question}`
          : question;
        try {
          pi.sendUserMessage(message);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('Agent is already processing')) throw error;
          pi.sendUserMessage(message, { deliverAs: 'steer' });
        }
        focusTerminalApp();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(error instanceof Error ? error.message : 'Bad request');
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
  await new Promise<void>((resolveListen, reject) => {
    bridge.once('error', reject);
    bridge.listen(port, '127.0.0.1', () => resolveListen());
  });
  state.bridge = bridge;
  state.bridgePort = port;
  return port;
}

function createTempViteConfig(projectDir: string, bridgeUrl: string, token: string) {
  const viteConfig = findViteConfig(projectDir);
  if (!viteConfig) throw new Error(`vite.config.* not found in ${projectDir}`);
  const tempDir = mkdtempSync(join(tmpdir(), 'pi-design-mode-'));
  const configPath = join(tempDir, 'vite.config.mjs');
  writeFileSync(
    configPath,
    `import userConfig from ${JSON.stringify(localFileUrl(viteConfig))};\n` +
      `import { piDesignModePlugin } from ${JSON.stringify(localFileUrl(pluginPath))};\n` +
      `export default async function piDesignConfig(env) {\n` +
      `  const base = typeof userConfig === 'function' ? await userConfig(env) : userConfig;\n` +
      `  return { ...(base ?? {}), plugins: [...((base && base.plugins) || []), piDesignModePlugin(${JSON.stringify({ projectRoot: projectDir, bridgeUrl, token })})] };\n` +
      `}\n`,
    'utf8',
  );
  return configPath;
}

function packageManager(projectDir: string) {
  if (existsSync(join(projectDir, '..', 'pnpm-lock.yaml')) || existsSync(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function startVite(projectDir: string, configPath: string, ports: { fePort?: number; bePort?: number }) {
  const pm = packageManager(projectDir);
  const args = pm === 'pnpm' ? ['exec', 'vite', '--config', configPath] : pm === 'yarn' ? ['vite', '--config', configPath] : ['exec', 'vite', '--', '--config', configPath];
  const env = { ...process.env, FORCE_COLOR: '1' };
  if (ports.fePort) env.FE_PORT = String(ports.fePort);
  if (ports.bePort) env.BE_PORT = String(ports.bePort);
  const child = spawn(pm, args, { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], env });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[pi-design:vite] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[pi-design:vite] ${chunk}`));
  state.serverProcess = child;
  return child;
}

function waitForViteUrl(child: ChildProcess) {
  return new Promise<string>((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Vite dev server URL')), 30_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/);
      if (match) {
        clearTimeout(timeout);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        resolveUrl(match[0]);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Vite exited before ready (${code ?? 'signal'})`));
    });
  });
}

function openBrowser(url: string) {
  if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

function focusTerminalApp() {
  if (!state.focusApp || process.platform !== 'darwin') return;
  spawn('osascript', ['-e', `tell application ${JSON.stringify(state.focusApp)} to activate`], { stdio: 'ignore', detached: true }).unref();
}

function frontendSearchRoot(projectDir: string) {
  const parent = dirname(projectDir);
  if (['app', 'deskpie', 'linkpie'].includes(projectDir.split(sep).at(-1) ?? '') && existsSync(join(parent, 'package.json'))) return parent;
  return projectDir;
}

function findReferences(projectDir: string | undefined, target: SelectionTarget | undefined): ReferenceHit[] {
  const result = spawnSync(process.execPath, [referenceWorkerPath, JSON.stringify({ projectDir, target })], {
    encoding: 'utf8',
    maxBuffer: 10_000_000,
    timeout: 20_000,
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout) as { references?: ReferenceHit[] };
    return Array.isArray(parsed.references) ? parsed.references : [];
  } catch {
    return [];
  }
}

function findTypeScriptReferences(projectDir: string | undefined, target: SelectionTarget | undefined): ReferenceHit[] {
  if (!projectDir || !target?.component || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(target.component)) return [];
  const searchRoot = frontendSearchRoot(projectDir);
  const payload = JSON.stringify({ projectDir, searchRoot, target });
  const script = String.raw`
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const payload = JSON.parse(process.argv[1]);
function requireTypeScript() {
  try {
    return createRequire(path.join(payload.projectDir, 'package.json'))('typescript');
  } catch {}
  try {
    return require('typescript');
  } catch {}
  const pnpmDir = path.join(payload.searchRoot, 'node_modules', '.pnpm');
  const entry = fs.existsSync(pnpmDir) ? fs.readdirSync(pnpmDir).find((name) => /^typescript@/.test(name)) : undefined;
  if (entry) return require(path.join(pnpmDir, entry, 'node_modules', 'typescript'));
  throw new Error('typescript package not found');
}
const ts = requireTypeScript();
const sourcePath = payload.target.source.split(':')[0];
const targetAbs = path.resolve(payload.projectDir, sourcePath);
const component = payload.target.component;
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}
const files = ['app', 'deskpie', 'linkpie']
  .map((service) => path.join(payload.searchRoot, service, 'src'))
  .filter((dir) => fs.existsSync(dir))
  .flatMap((dir) => walk(dir));
if (!files.includes(targetAbs) && fs.existsSync(targetAbs)) files.push(targetAbs);
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: 'react',
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  baseUrl: payload.searchRoot,
  paths: {
    '#app': ['app/src/main.tsx'],
    '#app/*': ['app/src/*'],
    '@deck/app': ['app/src/main.tsx'],
    '@deck/app/*': ['app/src/*'],
    '@deskpie/*': ['deskpie/src/*'],
    '@linkpie/*': ['linkpie/src/*'],
    '#service-config': ['deskpie/src/service-config.tsx', 'linkpie/src/service-config.tsx', 'app/src/service-config.tsx'],
    '#service-standalone-routes': ['app/src/service-standalone-routes.tsx'],
    '#service-console-page-loaders': ['app/src/service-console-page-loaders.tsx'],
  },
};
const host = ts.createCompilerHost(options, true);
const serviceHost = {
  getScriptFileNames: () => files,
  getScriptVersion: () => '0',
  getScriptSnapshot: (fileName) => {
    if (!fs.existsSync(fileName)) return undefined;
    return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
  },
  getCurrentDirectory: () => payload.searchRoot,
  getCompilationSettings: () => options,
  getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
  fileExists: host.fileExists,
  readFile: host.readFile,
  readDirectory: host.readDirectory,
  directoryExists: host.directoryExists,
  getDirectories: host.getDirectories,
  realpath: host.realpath,
};
const service = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());
const source = fs.readFileSync(targetAbs, 'utf8');
const sourceFile = ts.createSourceFile(targetAbs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let position = -1;
function visit(node) {
  if (position >= 0) return;
  const name = node.name;
  if (name && ts.isIdentifier(name) && name.text === component) {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isVariableDeclaration(node)) {
      position = name.getStart(sourceFile);
      return;
    }
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
if (position < 0) {
  const [, lineText, colText] = payload.target.source.match(/:(\d+):(\d+)$/) || [];
  const line = Math.max(1, Number(lineText || 1));
  const col = Math.max(1, Number(colText || 1));
  const sourceLines = source.split(/\n/);
  const starts = sourceLines.reduce((acc, currentLine, index) => {
    if (index === 0) acc.push(0);
    else acc.push(acc[index - 1] + sourceLines[index - 1].length + 1);
    return acc;
  }, []);
  const lineStart = starts[line - 1] || 0;
  const rawPosition = lineStart + col - 1;
  const lineSource = sourceLines[line - 1] || '';
  const lineOffset = lineSource.indexOf(component, Math.max(0, col - 2));
  if (lineOffset >= 0) position = lineStart + lineOffset;
  else if (source[rawPosition] === '<') position = rawPosition + 1;
  else position = rawPosition;
}
const groups = service.findReferences(targetAbs, position) || [];
const seen = new Set();
const hits = [];
for (const group of groups) {
  for (const ref of group.references || []) {
    if (ref.isDefinition) continue;
    const fileName = ref.fileName;
    if (!fileName.startsWith(payload.searchRoot)) continue;
    const text = fs.readFileSync(fileName, 'utf8');
    const lc = ts.getLineAndCharacterOfPosition(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true), ref.textSpan.start);
    const lineText = text.split(/\r?\n/)[lc.line]?.trim() || '';
    if (/^import\b/.test(lineText)) continue;
    if (/^export\s*\{/.test(lineText)) continue;
    if (lineText.includes('</')) continue;
    const rel = path.relative(payload.searchRoot, fileName).split(path.sep).join('/');
    const key = rel + ':' + (lc.line + 1) + ':' + ref.textSpan.start;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ path: rel, line: lc.line + 1, text: lineText });
  }
}
process.stdout.write(JSON.stringify(hits));
`;
  const result = spawnSync(process.execPath, ['-e', script, payload], { encoding: 'utf8', maxBuffer: 10_000_000, timeout: 15_000 });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    return JSON.parse(result.stdout) as ReferenceHit[];
  } catch {
    return [];
  }
}

function findRipgrepReferences(projectDir: string | undefined, target: SelectionTarget | undefined): ReferenceHit[] {
  if (!projectDir || !target?.component || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(target.component)) return [];
  const searchRoot = frontendSearchRoot(projectDir);
  const targetPath = target.source.split(':')[0];
  const targetAbs = resolve(projectDir, targetPath);
  const targetRelFromSearchRoot = relative(searchRoot, targetAbs).replaceAll(sep, '/');
  const result = spawnSync(
    'rg',
    [
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '--glob',
      '!node_modules/**',
      '--glob',
      '!dist/**',
      '--glob',
      '!build/**',
      '--glob',
      '*.{ts,tsx,js,jsx}',
      `\\b${target.component}\\b`,
      searchRoot,
    ],
    { encoding: 'utf8', maxBuffer: 5_000_000 },
  );
  if (result.status !== 0 && !result.stdout) return [];
  const hits: ReferenceHit[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(.*?):(\d+):(.*)$/);
    if (!match) continue;
    const rel = relative(searchRoot, match[1]).replaceAll(sep, '/');
    const text = match[3].trim();
    if (rel === targetRelFromSearchRoot && text.includes(`function ${target.component}`)) continue;
    if (rel === targetRelFromSearchRoot && text.includes(`const ${target.component}`)) continue;
    hits.push({ path: rel, line: Number(match[2]), text });
  }
  return hits;
}

function truncateLine(line: string, max = 110) {
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function focusApp(appName: string) {
  if (process.platform !== 'darwin') return;
  spawn('osascript', ['-e', `tell application ${JSON.stringify(appName)} to activate`], { stdio: 'ignore', detached: true }).unref();
}

function openEditorAt(absolutePath: string, line = 1) {
  const target = `${absolutePath}:${Math.max(1, Math.floor(line || 1))}`;
  const code = spawn('code', ['-g', target], { stdio: 'ignore', detached: true });
  code.on('error', () => {
    if (process.platform === 'darwin') spawn('open', [`vscode://file/${target}`], { stdio: 'ignore', detached: true }).unref();
  });
  code.unref();
  setTimeout(() => focusApp('Visual Studio Code'), 250);
}

function assertWithinSearchRoot(projectDir: string, absolutePath: string) {
  const searchRoot = frontendSearchRoot(projectDir);
  const relativePath = relative(searchRoot, absolutePath);
  if (relativePath.startsWith('..') || relativePath === '' || resolve(searchRoot, relativePath) !== absolutePath) throw new Error('Path is outside frontend root.');
}

function openReference(projectDir: string | undefined, referencePath: string | undefined, line = 1) {
  if (!projectDir || !referencePath) throw new Error('Reference path is required.');
  const searchRoot = frontendSearchRoot(projectDir);
  const absolutePath = resolve(searchRoot, referencePath);
  assertWithinSearchRoot(projectDir, absolutePath);
  openEditorAt(absolutePath, line);
}

function openSource(projectDir: string | undefined, source: string | undefined) {
  if (!projectDir || !source) throw new Error('Source is required.');
  const [sourcePath, lineText] = source.split(':');
  const absolutePath = resolve(projectDir, sourcePath);
  assertWithinSearchRoot(projectDir, absolutePath);
  openEditorAt(absolutePath, Number(lineText || 1));
}

function formatReferences(references: ReferenceHit[] | undefined) {
  if (!references?.length) return ['References: 0'];
  return [`References: ${references.length}`, ...references.slice(0, 8).map((hit) => `→ ${hit.path}:${hit.line} ${hit.text}`)];
}

function formatStyleSummary(styles: Record<string, string> | undefined) {
  if (!styles) return undefined;
  return [
    styles.display ? `display=${styles.display}` : undefined,
    styles.width && styles.height ? `size=${styles.width}×${styles.height}` : undefined,
    styles.color ? `color=${styles.color}` : undefined,
    styles.backgroundColor ? `bg=${styles.backgroundColor}` : undefined,
    styles.borderRadius ? `radius=${styles.borderRadius}` : undefined,
  ].filter(Boolean).join(' · ');
}

function formatTargetLines(target: SelectionTarget, references = state.references) {
  return [
    `Selected element:`,
    `- component: ${target.component || '(unknown)'}`,
    `- element: <${target.tag || 'unknown'}>`,
    `- source: ${target.source || '(unknown)'}`,
    target.className ? `- className: ${target.className}` : undefined,
    target.text ? `- text: ${target.text}` : undefined,
    target.attributes && Object.keys(target.attributes).length ? `- attributes: ${JSON.stringify(target.attributes)}` : undefined,
    formatStyleSummary(target.styles) ? `- computedStyle: ${formatStyleSummary(target.styles)}` : undefined,
    `- url: ${target.url}`,
    '',
    ...formatReferences(references),
  ]
    .filter((line): line is string => line !== undefined)
    .map((line) => truncateLine(line));
}

function formatTarget(target: SelectionTarget, references = state.references) {
  return formatTargetLines(target, references).join('\n');
}

function updateUi(ctx: ExtensionCommandContext) {
  if (state.url) ctx.ui.setStatus('pi-design-mode', `Design · ${state.url}`);
  ctx.ui.setWidget('pi-design-mode', undefined);
}

function cleanup(ctx?: ExtensionCommandContext) {
  state.serverProcess?.kill('SIGTERM');
  state.bridge?.close();
  state.serverProcess = undefined;
  state.bridge = undefined;
  state.bridgePort = undefined;
  state.token = undefined;
  state.url = undefined;
  state.target = undefined;
  state.references = undefined;
  state.referencesPending = undefined;
  state.referencesRequestId = undefined;
  state.referenceCache = undefined;
  state.referenceWorker?.kill('SIGTERM');
  state.referenceWorker = undefined;
  state.referenceWorkerBuffer = undefined;
  state.referenceWorkerRequests = undefined;
  state.focusApp = undefined;
  if (ctx) {
    ctx.ui.setStatus('pi-design-mode', undefined);
    ctx.ui.setWidget('pi-design-mode', undefined);
  }
}

function suffixPorts(suffix: string) {
  return {
    fePort: Number(`40${suffix}`),
    bePort: Number(`80${suffix}`),
    bridgePort: Number(`90${suffix}`),
    token: `deck-dev-${suffix}`,
  };
}

function projectDirFromDevState(cwd: string, suffix: string) {
  const env = readEnvFile(join(cwd, '.dev-state', `${suffix}.env`));
  const service = env.SERVICE || 'app';
  const candidate = join(cwd, 'frontend', service);
  return existsSync(join(candidate, 'package.json')) ? candidate : undefined;
}

function designHelpText() {
  return [
    'Pi Design Mode',
    '',
    'Deck default flow:',
    '1. ./scripts/dev up -s deskpie -p 14',
    '2. /design-connect 14',
    '3. Browser에서 element 클릭 → Ask box에 질문 → Pi/Ghostty로 복귀',
    '',
    'Manual managed flow:',
    '- /design app --port 4012 --be 8012',
    '- /design deskpie --port 4014 --be 8014',
    '',
    'Commands:',
    '- /design-help',
    '- /design-connect <suffix>  (예: /design-connect 14)',
    '- /design <app|linkpie|deskpie> [--port N] [--be N]',
    '- /design-clear',
    '- /design-exit',
  ].join('\n');
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('design-help', {
    description: 'Show Pi Design Mode usage.',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget('pi-design-help', designHelpText().split('\n'), { placement: 'belowEditor' });
      ctx.ui.notify('Design Mode help shown.', 'info');
    },
  });

  pi.registerCommand('design-connect', {
    description: 'Connect Pi to a Deck design dev server. Usage: /design-connect 14',
    handler: async (args, ctx) => {
      cleanup(ctx);
      const suffix = args.trim() || '11';
      if (!/^\d{2}$/.test(suffix)) {
        ctx.ui.notify('Usage: /design-connect <two-digit suffix>, e.g. /design-connect 14', 'error');
        return;
      }
      const ports = suffixPorts(suffix);
      state.token = ports.token;
      state.projectDir = projectDirFromDevState(ctx.cwd, suffix);
      state.focusApp = 'Ghostty';
      state.url = `https://localhost:${ports.fePort}`;
      await startBridge(pi, ctx, ports.token, ports.bridgePort);
      updateUi(ctx);
      ctx.ui.notify(`Design bridge connected: ${state.url} (bridge ${ports.bridgePort})`, 'info');
    },
  });

  pi.registerCommand('design', {
    description: 'Start Pi Design Mode for a Vite React project. Usage: /design, /design app, /design frontend/app',
    handler: async (args, ctx) => {
      cleanup(ctx);
      let parsed: DesignCommandArgs;
      try {
        parsed = parseDesignArgs(args);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Invalid /design arguments.', 'error');
        return;
      }
      const projectDir = resolveProjectDir(ctx.cwd, parsed.projectArg);
      if (!isViteReactProject(projectDir)) {
        ctx.ui.notify(`Unsupported project: ${projectDir}. pi-design-mode v1 requires Vite + React.`, 'error');
        return;
      }
      const token = randomBytes(24).toString('hex');
      state.projectDir = projectDir;
      state.token = token;
      state.focusApp = parsed.focusApp;
      const bridgePort = await startBridge(pi, ctx, token);
      const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
      const configPath = createTempViteConfig(projectDir, bridgeUrl, token);
      const child = startVite(projectDir, configPath, parsed);
      const url = await waitForViteUrl(child);
      state.url = url;
      updateUi(ctx);
      openBrowser(url);
      ctx.ui.notify(`Pi Design Mode started: ${url}`, 'info');
    },
  });

  pi.registerCommand('design-clear', {
    description: 'Clear current Design Mode selection.',
    handler: async (_args, ctx) => {
      state.target = undefined;
      state.references = undefined;
      updateUi(ctx);
      ctx.ui.notify('Design selection cleared.', 'info');
    },
  });

  pi.registerCommand('design-exit', {
    description: 'Stop Pi Design Mode and close the managed Vite server.',
    handler: async (_args, ctx) => {
      cleanup(ctx);
      ctx.ui.notify('Pi Design Mode stopped.', 'info');
    },
  });

  pi.on('session_shutdown', async () => {
    cleanup();
  });
}
