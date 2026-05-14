#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_REGISTRY_PATH = path.join(os.homedir(), '.claude', 'hive', 'projects.yaml');
const REGISTRY_PATH = process.env.HIVE_PROJECTS_REGISTRY || DEFAULT_REGISTRY_PATH;

function usage() {
  return [
    'Usage: node skills/hive/skills/register-project/register-project.mjs <absolute-project-path> [--name <registry-name>]',
    '',
    'Quote paths containing spaces.',
    'Example: node skills/hive/skills/register-project/register-project.mjs "/Users/don/Documents/GitHub/Nail Tech Assitant" --name nail-tech-assistant'
  ].join('\n');
}

function fail(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function parseArgs(argv) {
  const args = [...argv];
  let targetPath = null;
  let name = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--name') {
      const value = args[++i];
      if (!value) fail('--name requires a registry name.');
      name = value.trim();
      continue;
    }
    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length).trim();
      continue;
    }
    if (arg.startsWith('-')) {
      fail(`unknown option '${arg}'.\n\n${usage()}`);
    }
    if (targetPath) {
      fail(`unexpected extra argument '${arg}'. Quote paths containing spaces.\n\n${usage()}`);
    }
    targetPath = arg;
  }

  if (!targetPath) fail(`missing absolute project path.\n\n${usage()}`);
  return { targetPath, name };
}

function slugFromBasename(canonicalPath) {
  return path.basename(canonicalPath)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateName(name) {
  if (!name) fail('registry name is empty. Pass --name <registry-name>.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(`registry name '${name}' is invalid. Use lowercase letters, numbers, and hyphens.`);
  }
}

function validateProject(targetPath) {
  if (!path.isAbsolute(targetPath)) {
    fail(`project path must be absolute: ${targetPath}`);
  }
  if (!fs.existsSync(targetPath)) {
    fail(`project path does not exist: ${targetPath}`);
  }
  if (!fs.statSync(targetPath).isDirectory()) {
    fail(`project path is not a directory: ${targetPath}`);
  }

  const canonicalPath = fs.realpathSync(targetPath);
  const hiveDir = path.join(canonicalPath, '.pHive');
  if (!fs.existsSync(hiveDir) || !fs.statSync(hiveDir).isDirectory()) {
    fail(`project path lacks required .pHive/ directory: ${canonicalPath}`);
  }

  const cycleStateDir = path.join(hiveDir, 'cycle-state');
  if (!fs.existsSync(cycleStateDir) || !fs.statSync(cycleStateDir).isDirectory()) {
    warn(`.pHive/cycle-state/ is missing or empty for ${canonicalPath}; proceeding.`);
  } else {
    const entries = fs.readdirSync(cycleStateDir).filter((entry) => !entry.startsWith('.'));
    if (entries.length === 0) {
      warn(`.pHive/cycle-state/ is empty for ${canonicalPath}; proceeding.`);
    }
  }

  return canonicalPath;
}

function unquoteYamlScalar(value) {
  const trimmed = String(value || '').trim();
  const single = trimmed.match(/^'(.*)'$/);
  if (single) return single[1].replace(/''/g, "'");
  const double = trimmed.match(/^"(.*)"$/);
  if (double) {
    return double[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseRegistry(content) {
  const projects = [];
  const lines = content.split('\n');
  let inProjects = false;
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^projects:\s*$/.test(line)) {
      inProjects = true;
      continue;
    }
    if (inProjects && /^\s*-\s+/.test(line)) {
      if (current) projects.push(current);
      current = {};
      const rest = line.replace(/^\s*-\s+/, '').trim();
      const match = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (match) current[match[1]] = unquoteYamlScalar(match[2]);
      continue;
    }
    if (inProjects && current && /^\s+[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (match) current[match[1]] = unquoteYamlScalar(match[2]);
      continue;
    }
    if (/^\S/.test(line) && !/^projects:/.test(line)) {
      if (current) projects.push(current);
      current = null;
      inProjects = false;
    }
  }
  if (current) projects.push(current);
  return { projects };
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function serializeRegistry(projects) {
  const lines = ['projects:'];
  for (const project of projects) {
    lines.push(`  - name: ${yamlQuote(project.name)}`);
    lines.push(`    path: ${yamlQuote(project.path)}`);
    if (project.registered_at) {
      lines.push(`    registered_at: ${yamlQuote(project.registered_at)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function canonicalPathForExisting(entry) {
  const candidate = entry.canonical_path || entry.path;
  if (!candidate) return null;
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return [];
  }
  let parsed;
  try {
    parsed = parseRegistry(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (error) {
    fail(`failed to parse ${REGISTRY_PATH}: ${error.message}`);
  }
  if (!parsed || !Array.isArray(parsed.projects)) {
    fail(`${REGISTRY_PATH} has no projects[] array.`);
  }
  return parsed.projects.filter((entry) => entry && typeof entry === 'object');
}

function assertNoDuplicates(projects, nextEntry) {
  const seenNames = new Map();
  const seenPaths = new Map();

  for (const entry of projects) {
    const entryName = entry.name && String(entry.name).trim();
    const entryPath = canonicalPathForExisting(entry);
    if (!entryName || !entryPath) continue;

    if (!seenNames.has(entryName)) seenNames.set(entryName, entry);
    if (!seenPaths.has(entryPath)) seenPaths.set(entryPath, entry);
  }

  if (seenNames.has(nextEntry.name)) {
    const first = seenNames.get(nextEntry.name);
    fail(
      `duplicate registry name '${nextEntry.name}' - keeping first occurrence at path ${first.path}. ` +
      'Duplicate names collapse two projects into the same source_epic namespace.'
    );
  }

  if (seenPaths.has(nextEntry.path)) {
    const first = seenPaths.get(nextEntry.path);
    fail(
      `duplicate registry path '${nextEntry.path}' (resolves to same dir as entry '${first.name}') - ` +
      `refusing later duplicate '${nextEntry.name}'. Duplicate canonical paths import the same project twice.`
    );
  }
}

function writeRegistry(projects) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, serializeRegistry(projects), 'utf8');
}

function main() {
  const { targetPath, name: requestedName } = parseArgs(process.argv.slice(2));
  const canonicalPath = validateProject(targetPath);
  const name = requestedName || slugFromBasename(canonicalPath);
  validateName(name);

  const projects = loadRegistry();
  const entry = {
    name,
    path: canonicalPath,
    registered_at: new Date().toISOString()
  };

  assertNoDuplicates(projects, entry);
  writeRegistry([...projects, entry]);

  console.log('Registered project:');
  console.log(`  name:          ${entry.name}`);
  console.log(`  path:          ${entry.path}`);
  console.log(`  registered_at: ${entry.registered_at}`);
  console.log(`  registry:      ${REGISTRY_PATH}`);
  console.log('');
  console.log('Next step:');
  console.log('  node scripts/kg-bootstrap-from-projects.js --dry-run');
}

main();
