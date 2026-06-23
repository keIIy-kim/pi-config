#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const skillsRoot = resolve(here, '..');
const configPath = resolve(here, 'categories.json');
const fix = process.argv.includes('--fix');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const skills = loadSkills();
const byName = new Map();
const errors = [];
const warnings = [];

for (const skill of skills) {
  if (byName.has(skill.name)) errors.push(`duplicate skill name: ${skill.name} (${byName.get(skill.name).rel}, ${skill.rel})`);
  byName.set(skill.name, skill);
}

const externalSkills = new Set(config.externalSkills ?? []);
for (const name of externalSkills) {
  if (byName.has(name)) warnings.push(`externalSkills entry is local and can be removed: ${name}`);
}

const categorySkillNames = new Set();
const categoryIds = new Set();
for (const category of config.categories ?? []) {
  if (!category.id) errors.push('category missing id');
  if (categoryIds.has(category.id)) errors.push(`duplicate category id: ${category.id}`);
  categoryIds.add(category.id);
  for (const name of category.skills ?? []) {
    categorySkillNames.add(name);
    if (!byName.has(name) && !externalSkills.has(name)) errors.push(`category ${category.id} references missing skill: ${name}`);
  }
}

for (const skill of skills) {
  if (!categorySkillNames.has(skill.name)) warnings.push(`uncategorized skill: ${skill.name} (${skill.rel})`);
}

const manualOnly = new Set(config.manualOnly ?? []);
for (const name of manualOnly) {
  const skill = byName.get(name);
  if (!skill) {
    errors.push(`manualOnly references missing skill: ${name}`);
    continue;
  }
  if (!skill.disableModelInvocation) {
    warnings.push(`manualOnly missing disable-model-invocation: ${name} (${skill.rel})`);
    if (fix) setFrontmatterField(skill.path, 'disable-model-invocation', 'true');
  }
}

for (const skill of skills) {
  if (skill.disableModelInvocation && !manualOnly.has(skill.name)) {
    warnings.push(`disable-model-invocation true but not in manualOnly: ${skill.name} (${skill.rel})`);
  }
}

console.log(`skills: ${skills.length}`);
console.log(`categories: ${(config.categories ?? []).length}`);
console.log(`manualOnly: ${manualOnly.size}`);
console.log(`externalSkills: ${externalSkills.size}`);
if (warnings.length) {
  console.log('\nwarnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}
if (errors.length) {
  console.log('\nerrors:');
  for (const error of errors) console.log(`- ${error}`);
  process.exit(1);
}
if (fix) console.log('\nfix applied');
if (!warnings.length) console.log('\nOK');

function loadSkills() {
  const find = spawnSync('/usr/bin/find', [skillsRoot, '-path', `${skillsRoot}/_helper`, '-prune', '-o', '-name', 'SKILL.md', '-type', 'f', '-print'], {
    encoding: 'utf8',
  });
  if (find.status !== 0) throw new Error(find.stderr || 'find failed');
  return find.stdout.trim().split('\n').filter(Boolean).map(parseSkill);
}

function parseSkill(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`missing frontmatter: ${path}`);
  const frontmatter = match[1];
  const name = readScalar(frontmatter, 'name');
  if (!name) throw new Error(`missing name: ${path}`);
  return {
    path,
    rel: relative(skillsRoot, path),
    name,
    disableModelInvocation: readScalar(frontmatter, 'disable-model-invocation') === 'true',
  };
}

function readScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function setFrontmatterField(path, key, value) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`missing frontmatter: ${path}`);
  const full = match[0];
  const frontmatter = match[1];
  const line = `${key}: ${value}`;
  const nextFrontmatter = new RegExp(`^${escapeRegExp(key)}:.*$`, 'm').test(frontmatter)
    ? frontmatter.replace(new RegExp(`^${escapeRegExp(key)}:.*$`, 'm'), line)
    : `${frontmatter.trimEnd()}\n${line}`;
  writeFileSync(path, text.replace(full, `---\n${nextFrontmatter}\n---\n`));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
