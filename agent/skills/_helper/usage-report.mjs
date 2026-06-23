#!/usr/bin/env node
import { readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const usagePath = resolve(here, 'usage.jsonl');
const defaultMaxMb = 5;
const defaultKeep = 10;

const options = parseArgs(process.argv.slice(2));
const events = [
  ...readUsageEvents(),
  ...(options.sessions ? readSessionEvents(resolve(homedir(), '.pi/agent/sessions')) : []),
];

console.log(formatReport(events));

if (options.cleanup) {
  const cleanup = rotateUsageLogIfNeeded(options.maxMb * 1024 * 1024, options.keep);
  console.log('\n## Cleanup');
  console.log(`- ${cleanup.message}`);
  console.log(`- max active log: ${formatBytes(cleanup.maxBytes)}`);
  console.log(`- rotated files kept: ${cleanup.keep}`);
}

function parseArgs(args) {
  const getValue = (name, fallback) => {
    const prefixed = args.find((arg) => arg.startsWith(`--${name}=`));
    if (!prefixed) return fallback;
    const value = Number(prefixed.slice(name.length + 3));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  return {
    sessions: !args.includes('--no-sessions'),
    cleanup: !args.includes('--no-cleanup'),
    maxMb: getValue('max-mb', positiveEnvNumber('PI_SKILL_USAGE_MAX_MB', defaultMaxMb)),
    keep: Math.max(1, Math.floor(getValue('keep', positiveEnvNumber('PI_SKILL_USAGE_KEEP', defaultKeep)))),
  };
}

function positiveEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readUsageEvents() {
  return listUsageFiles().flatMap((file) => readJsonl(resolve(here, file))).flatMap((event) => normalizeUsageEvent(event, 'usage-log'));
}

function listUsageFiles() {
  try {
    return readdirSync(here)
      .filter((file) => file === 'usage.jsonl' || /^usage\.jsonl\.\d+$/.test(file))
      .sort((a, b) => usageFileRank(a) - usageFileRank(b));
  } catch {
    return [];
  }
}

function usageFileRank(file) {
  if (file === 'usage.jsonl') return 0;
  const match = file.match(/\.(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function readSessionEvents(root) {
  return listJsonlFiles(root).flatMap((file) => readJsonl(file).flatMap((entry) => sessionEntryToEvents(entry, file)));
}

function listJsonlFiles(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listJsonlFiles(path);
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
  });
}

function readJsonl(file) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Advisory logs can contain a partial final line.
    }
  }
  return rows;
}

function normalizeUsageEvent(event, sourceFile) {
  if (!event || !Array.isArray(event.skills) || !event.type || !event.ts) return [];
  return [{
    ts: event.ts,
    type: event.type,
    source: event.source ?? sourceFile,
    skills: event.skills,
  }];
}

function sessionEntryToEvents(entry, file) {
  const message = entry?.message;
  if (!message) return [];
  const ts = entry.timestamp ?? entry.createdAt ?? timestampFromSessionFile(file) ?? new Date(0).toISOString();

  if (message.role === 'assistant') {
    return (message.content ?? []).flatMap((content) => {
      const path = content?.type === 'toolCall' && content.name === 'read' ? content.arguments?.path : undefined;
      const skill = skillNameFromPath(path);
      return skill ? [{ ts, type: 'session-auto-read', source: 'session', skills: [skill] }] : [];
    });
  }

  if (message.role === 'user') {
    const text = (message.content ?? [])
      .filter((content) => content?.type === 'text')
      .map((content) => content.text ?? '')
      .join('\n');
    const skills = [];
    for (const match of text.matchAll(/<skill name="([^"]+)"/g)) {
      for (const skill of match[1].split('+')) if (skill) skills.push(skill);
    }
    return skills.length > 0 ? [{ ts, type: 'session-expanded', source: 'session', skills }] : [];
  }

  return [];
}

function timestampFromSessionFile(file) {
  const match = file.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
  return match ? match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z') : undefined;
}

function skillNameFromPath(path) {
  if (typeof path !== 'string' || !path.endsWith('/SKILL.md')) return null;
  const parts = path.split('/').filter(Boolean);
  return parts.at(-2) ?? null;
}

function formatReport(events) {
  const explicit = events.filter((event) => event.type === 'explicit' || event.type === 'session-expanded');
  const auto = events.filter((event) => event.type === 'auto-read' || event.type === 'session-auto-read');
  const allSkills = new Set(events.flatMap((event) => event.skills));
  return [
    '# Skill Usage Report',
    '',
    `- events: ${events.length}`,
    `- explicit/expanded calls: ${explicit.length}`,
    `- model auto reads: ${auto.length}`,
    `- distinct skills: ${allSkills.size}`,
    `- window: ${formatWindow(events)}`,
    '',
    '## Top user-called skills',
    ...formatTop(explicit),
    '',
    '## Top model-used skills',
    ...formatTop(auto),
    '',
    '## Recent events',
    ...formatRecent(events),
  ].join('\n');
}

function formatWindow(events) {
  const timestamps = events.map((event) => Date.parse(event.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!timestamps.length) return 'none';
  return `${new Date(timestamps[0]).toISOString()} → ${new Date(timestamps.at(-1)).toISOString()}`;
}

function formatTop(events) {
  const counts = new Map();
  for (const event of events) for (const skill of event.skills) counts.set(skill, (counts.get(skill) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  return top.length ? top.map(([skill, count]) => `- ${skill}: ${count}`) : ['- none'];
}

function formatRecent(events) {
  const recent = [...events]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 20)
    .map((event) => `- ${event.ts} ${event.type}: ${event.skills.join(', ')}`);
  return recent.length ? recent : ['- none'];
}

function rotateUsageLogIfNeeded(maxBytes, keep) {
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(usagePath).size;
  } catch {
    return { rotated: false, maxBytes, keep, sizeBytes, message: 'no active log' };
  }

  if (sizeBytes <= maxBytes) {
    return { rotated: false, maxBytes, keep, sizeBytes, message: `active log ${formatBytes(sizeBytes)} ≤ ${formatBytes(maxBytes)}` };
  }

  rmSync(`${usagePath}.${keep}`, { force: true });
  for (let index = keep - 1; index >= 1; index -= 1) {
    try {
      renameSync(`${usagePath}.${index}`, `${usagePath}.${index + 1}`);
    } catch {
      // Missing older rotations are fine.
    }
  }
  renameSync(usagePath, `${usagePath}.1`);
  return { rotated: true, maxBytes, keep, sizeBytes, message: `rotated ${formatBytes(sizeBytes)} log; keeping ${keep} files` };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
