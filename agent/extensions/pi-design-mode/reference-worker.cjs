const { createRequire } = require('node:module');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { dirname, join, relative, resolve, sep } = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline');

const contexts = new Map();

function frontendSearchRoot(projectDir) {
  const parent = dirname(projectDir);
  const base = projectDir.split(sep).at(-1) || '';
  if (['app', 'deskpie', 'linkpie'].includes(base) && existsSync(join(parent, 'package.json'))) return parent;
  return projectDir;
}

function requireTypeScript(projectDir, searchRoot) {
  try { return createRequire(join(projectDir, 'package.json'))('typescript'); } catch {}
  try { return require('typescript'); } catch {}
  const pnpmDir = join(searchRoot, 'node_modules', '.pnpm');
  const entry = existsSync(pnpmDir) ? readdirSync(pnpmDir).find((name) => /^typescript@/.test(name)) : undefined;
  if (entry) return require(join(pnpmDir, entry, 'node_modules', 'typescript'));
  throw new Error('typescript package not found');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function getContext(projectDir) {
  const searchRoot = frontendSearchRoot(projectDir);
  const cached = contexts.get(searchRoot);
  if (cached) return cached;

  const ts = requireTypeScript(projectDir, searchRoot);
  const files = ['app', 'deskpie', 'linkpie']
    .map((service) => join(searchRoot, service, 'src'))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => walk(dir));
  const versions = new Map(files.map((file) => [file, '0']));
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
    baseUrl: searchRoot,
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
    getScriptVersion: (fileName) => versions.get(fileName) || '0',
    getScriptSnapshot: (fileName) => existsSync(fileName) ? ts.ScriptSnapshot.fromString(readFileSync(fileName, 'utf8')) : undefined,
    getCurrentDirectory: () => searchRoot,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: host.fileExists,
    readFile: host.readFile,
    readDirectory: host.readDirectory,
    directoryExists: host.directoryExists,
    getDirectories: host.getDirectories,
    realpath: host.realpath,
  };
  const context = {
    searchRoot,
    ts,
    files,
    service: ts.createLanguageService(serviceHost, ts.createDocumentRegistry()),
  };
  contexts.set(searchRoot, context);
  return context;
}

function targetPosition(ts, source, targetAbs, component, targetSource) {
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
  if (position >= 0) return position;

  const [, lineText, colText] = targetSource.match(/:(\d+):(\d+)$/) || [];
  const line = Math.max(1, Number(lineText || 1));
  const col = Math.max(1, Number(colText || 1));
  const sourceLines = source.split(/\n/);
  const starts = sourceLines.reduce((acc, _currentLine, index) => {
    if (index === 0) acc.push(0);
    else acc.push(acc[index - 1] + sourceLines[index - 1].length + 1);
    return acc;
  }, []);
  const lineStart = starts[line - 1] || 0;
  const rawPosition = lineStart + col - 1;
  const lineSource = sourceLines[line - 1] || '';
  const lineOffset = lineSource.indexOf(component, Math.max(0, col - 2));
  if (lineOffset >= 0) return lineStart + lineOffset;
  if (source[rawPosition] === '<') return rawPosition + 1;
  return rawPosition;
}

function findTypeScriptReferences(projectDir, target) {
  if (!projectDir || !target?.component || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(target.component)) return [];
  const { searchRoot, ts, files, service } = getContext(projectDir);
  const sourcePath = target.source.split(':')[0];
  const targetAbs = resolve(projectDir, sourcePath);
  const component = target.component;
  if (!existsSync(targetAbs)) return [];
  if (!files.includes(targetAbs)) files.push(targetAbs);
  const source = readFileSync(targetAbs, 'utf8');
  const position = targetPosition(ts, source, targetAbs, component, target.source);
  const groups = service.findReferences(targetAbs, position) || [];
  const seen = new Set();
  const hits = [];
  for (const group of groups) {
    for (const ref of group.references || []) {
      if (ref.isDefinition) continue;
      const fileName = ref.fileName;
      if (!fileName.startsWith(searchRoot)) continue;
      const text = readFileSync(fileName, 'utf8');
      const lc = ts.getLineAndCharacterOfPosition(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true), ref.textSpan.start);
      const lineText = text.split(/\r?\n/)[lc.line]?.trim() || '';
      if (/^import\b/.test(lineText)) continue;
      if (/^export\s*\{/.test(lineText)) continue;
      if (lineText.includes('</')) continue;
      const rel = relative(searchRoot, fileName).split(sep).join('/');
      const key = rel + ':' + (lc.line + 1) + ':' + ref.textSpan.start;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path: rel, line: lc.line + 1, text: lineText });
    }
  }
  return hits;
}

function findRipgrepReferences(projectDir, target) {
  if (!projectDir || !target?.component || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(target.component)) return [];
  const searchRoot = frontendSearchRoot(projectDir);
  const targetPath = target.source.split(':')[0];
  const targetAbs = resolve(projectDir, targetPath);
  const targetRelFromSearchRoot = relative(searchRoot, targetAbs).split(sep).join('/');
  const result = spawnSync('rg', [
    '--line-number', '--no-heading', '--color', 'never',
    '--glob', '!node_modules/**', '--glob', '!dist/**', '--glob', '!build/**',
    '--glob', '*.{ts,tsx,js,jsx}', `\\b${target.component}\\b`, searchRoot,
  ], { encoding: 'utf8', maxBuffer: 5_000_000, timeout: 10_000 });
  if (result.status !== 0 && !result.stdout) return [];
  const hits = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(.*?):(\d+):(.*)$/);
    if (!match) continue;
    const rel = relative(searchRoot, match[1]).split(sep).join('/');
    const text = match[3].trim();
    if (rel === targetRelFromSearchRoot && text.includes(`function ${target.component}`)) continue;
    if (rel === targetRelFromSearchRoot && text.includes(`const ${target.component}`)) continue;
    hits.push({ path: rel, line: Number(match[2]), text });
  }
  return hits;
}

function run(payload) {
  const startedAt = Date.now();
  try {
    const tsRefs = findTypeScriptReferences(payload.projectDir, payload.target);
    const references = tsRefs.length ? tsRefs : findRipgrepReferences(payload.projectDir, payload.target);
    return { ok: true, references, engine: tsRefs.length ? 'typescript' : 'ripgrep', durationMs: Date.now() - startedAt };
  } catch (error) {
    try {
      const references = findRipgrepReferences(payload.projectDir, payload.target);
      return { ok: true, references, engine: 'ripgrep', durationMs: Date.now() - startedAt, error: error && error.message };
    } catch (fallbackError) {
      return { ok: false, references: [], durationMs: Date.now() - startedAt, error: fallbackError && fallbackError.message };
    }
  }
}

if (process.argv[2] === '--daemon') {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      process.stdout.write(JSON.stringify({ id: message.id, ...run(message) }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, references: [], error: error && error.message }) + '\n');
    }
  });
} else {
  const payload = JSON.parse(process.argv[2] || '{}');
  process.stdout.write(JSON.stringify(run(payload)));
}
