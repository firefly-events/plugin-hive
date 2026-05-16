#!/usr/bin/env node
/**
 * REGISTRY-DRIVEN BOOTSTRAP: Seed kg.sqlite from multiple Hive-enabled projects.
 *
 * Reads ~/.claude/hive/projects.yaml (or HIVE_PROJECTS_REGISTRY override),
 * walks each registered project's .pHive/cycle-state/, and invokes
 * kg-import-cycle-state.js against each so the global KG starts seeded with
 * multi-project decision history.
 *
 * Per-project source_epic is namespaced as `{project_name}/{epic_id}` to
 * prevent idx_unique_triple collisions when two projects share an epic name.
 *
 * Default mode: --dry-run (preview only). Pass --apply to actually write.
 * Idempotent — safe to re-run; relies on INSERT OR IGNORE + idx_unique_triple
 * in kg-import-cycle-state.js.
 *
 * Usage:
 *   node scripts/kg-bootstrap-from-projects.js              # dry-run preview
 *   node scripts/kg-bootstrap-from-projects.js --apply      # actually import
 *   node scripts/kg-bootstrap-from-projects.js --since 2026-04-28
 *   HIVE_PROJECTS_REGISTRY=/tmp/test.yaml node scripts/kg-bootstrap-from-projects.js
 *
 * Registry schema documented at hive/references/system-config.md.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

let yaml;
let usingFallbackYaml = false;
try {
  yaml = require('js-yaml');
} catch {
  usingFallbackYaml = true;
  console.warn(
    'WARN: js-yaml not installed — using minimal fallback parser for the project registry. ' +
    'Install js-yaml for full YAML coverage. (See hive/references/system-config.md.)'
  );
  yaml = { load: parseRegistryFallback };
}

const DEFAULT_REGISTRY_PATH = path.join(os.homedir(), '.claude', 'hive', 'projects.yaml');
const REGISTRY_PATH = process.env.HIVE_PROJECTS_REGISTRY || DEFAULT_REGISTRY_PATH;
const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const IMPORT_SCRIPT = path.join(__dirname, 'kg-import-cycle-state.js');
const DEFAULT_SINCE = '2026-04-28';
const LARGE_IMPORT_THRESHOLD = parsePositiveIntEnv('BOOTSTRAP_LARGE_IMPORT_THRESHOLD', 10000);
const SOFT_WARN_THRESHOLD = parsePositiveIntEnv('BOOTSTRAP_SOFT_WARN_THRESHOLD', 1000);
const YES_LARGE_IMPORT = process.argv.includes('--yes-large-import');

function argvValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i === process.argv.length - 1) return null;
  return process.argv[i + 1];
}

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseSinceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error(`Error: Invalid --since '${value}'. Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    console.error(`Error: Invalid --since '${value}'. Expected a real YYYY-MM-DD date.`);
    process.exit(1);
  }
  return value;
}

const SINCE = parseSinceDate(argvValue('--since') || DEFAULT_SINCE);

/**
 * Minimal fallback YAML parser for the projects registry.
 * Schema is intentionally narrow:
 *
 *   projects:
 *     - path: /abs/path
 *       name: short-name
 *
 * Returns { projects: [{ path, name }, ...] } or { projects: [] } on parse trouble.
 */
function parseRegistryFallback(content) {
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
    if (inProjects && /^\s*- /.test(line)) {
      if (current) projects.push(current);
      current = {};
      const rest = line.replace(/^\s*- /, '').trim();
      const m = rest.match(/^(\w+)\s*:\s*(.*)$/);
      if (m) current[m[1]] = m[2].replace(/^["']|["']$/g, '');
    } else if (inProjects && current && /^\s+\w+\s*:/.test(line)) {
      const m = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
      if (m) current[m[1]] = m[2].replace(/^["']|["']$/g, '');
    } else if (/^\w/.test(line) && !/^projects:/.test(line)) {
      // top-level key other than projects → exit projects block
      if (current) { projects.push(current); current = null; }
      inProjects = false;
    }
  }
  if (current) projects.push(current);
  return { projects };
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`Error: project registry not found at ${REGISTRY_PATH}`);
    console.error('');
    console.error('Create one with the schema documented in hive/references/system-config.md:');
    console.error('  projects:');
    console.error('    - path: /Users/you/Documents/your-project');
    console.error('      name: your-project');
    console.error('');
    console.error('Or set HIVE_PROJECTS_REGISTRY=<path> to point at a custom location.');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (e) {
    console.error(`Error: failed to parse ${REGISTRY_PATH}: ${e.message}`);
    process.exit(1);
  }

  if (!parsed || !Array.isArray(parsed.projects)) {
    console.error(`Error: ${REGISTRY_PATH} has no projects[] array. See hive/references/system-config.md.`);
    process.exit(1);
  }

  // Normalize and validate entries; drop malformed ones with a logged note.
  // Also reject duplicate names and duplicate canonical paths — both inflate
  // KG signal in different ways:
  //   - Duplicate `name` collapses two projects into the same source_epic
  //     namespace, silently losing one project's triples to INSERT OR IGNORE.
  //   - Duplicate canonical `path` imports the same project twice under two
  //     namespaces, double-counting the same decision history.
  const normalized = [];
  const seenNames = new Map();   // name -> first index
  const seenPaths = new Map();   // canonical path -> first index
  for (const entry of parsed.projects) {
    if (!entry || typeof entry !== 'object') continue;
    const projPath = entry.path && String(entry.path).trim();
    const name = entry.name && String(entry.name).trim();
    if (!projPath || !name) {
      console.warn(`  WARN: registry entry missing path or name — ${JSON.stringify(entry).substring(0, 80)}`);
      continue;
    }
    const canonicalPath = path.resolve(projPath);
    if (seenNames.has(name)) {
      console.warn(`  WARN: duplicate registry name '${name}' — keeping first occurrence (entry #${seenNames.get(name) + 1}); dropping later duplicate at path ${projPath}`);
      continue;
    }
    if (seenPaths.has(canonicalPath)) {
      console.warn(`  WARN: duplicate registry path '${canonicalPath}' (resolves to same dir as entry '${normalized[seenPaths.get(canonicalPath)].name}') — keeping first occurrence; dropping later duplicate '${name}'`);
      continue;
    }
    seenNames.set(name, normalized.length);
    seenPaths.set(canonicalPath, normalized.length);
    normalized.push({ path: projPath, name });
  }
  return normalized;
}

function describeStatus(project) {
  if (!fs.existsSync(project.path)) {
    return { ok: false, reason: 'path_missing' };
  }
  if (!fs.statSync(project.path).isDirectory()) {
    return { ok: false, reason: 'not_a_directory' };
  }
  const cycleDir = path.join(project.path, '.pHive', 'cycle-state');
  if (!fs.existsSync(cycleDir) || !fs.statSync(cycleDir).isDirectory()) {
    return { ok: false, reason: 'no_cycle_state_dir' };
  }
  const yamls = fs.readdirSync(cycleDir).filter(f => f.endsWith('.yaml'));
  if (yamls.length === 0) {
    return { ok: false, reason: 'empty_cycle_state' };
  }
  return { ok: true, cycleDir, yamlCount: yamls.length };
}

function parseDryRunSummary(output) {
  const m = output.match(/WOULD INSERT (\d+) triples \((\d+) skipped pre---since\) -- DRY RUN/);
  if (!m) return null;
  return {
    triples: m ? Number.parseInt(m[1], 10) : 0,
    skippedSince: m ? Number.parseInt(m[2], 10) : 0
  };
}

function runImportForProject(project, status, options = {}) {
  const args = [
    IMPORT_SCRIPT,
    '--cycle-state-dir', status.cycleDir,
    '--source-epic-prefix', project.name,
    '--since', SINCE
  ];
  if (options.dryRun || DRY_RUN) args.push('--dry-run');
  if (options.summaryOnly) args.push('--summary-only');

  // We surface the child's stdio inline so per-project plans / summaries are
  // visible to the user. spawnSync with stdio: 'inherit' keeps ordering tidy.
  // Use process.execPath so the child runs under the SAME Node binary as the
  // parent — version managers (nvm, fnm) and custom installs do not always
  // resolve `node` from PATH to the same interpreter.
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return {
    exitCode: result.status,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function promptLargeImport(projectedTriples) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  fs.writeSync(
    process.stdout.fd,
    `Projected import is ${projectedTriples} triples, above threshold ${LARGE_IMPORT_THRESHOLD}. Continue? [y/N] `
  );
  const buf = Buffer.alloc(16);
  const n = fs.readSync(process.stdin.fd, buf, 0, buf.length, null);
  return /^y(es)?$/i.test(buf.toString('utf8', 0, n).trim());
}

function main() {
  console.log('=== KG Bootstrap From Projects ===');
  console.log(`Registry:    ${REGISTRY_PATH}${REGISTRY_PATH === DEFAULT_REGISTRY_PATH ? '' : ' (HIVE_PROJECTS_REGISTRY override)'}`);
  console.log(`Mode:        ${DRY_RUN ? 'dry-run (default — pass --apply to write)' : 'apply (writing to kg.sqlite)'}`);
  console.log(`Since:       ${SINCE}`);
  if (usingFallbackYaml) console.log('YAML parser: fallback (install js-yaml for full coverage)');
  console.log('');

  const projects = loadRegistry();
  if (projects.length === 0) {
    console.error('Error: registry has no usable project entries.');
    process.exit(1);
  }

  const summary = {
    registered: projects.length,
    eligible: 0,
    skipped: 0,
    succeeded: 0,
    failed: 0,
    projectedTriples: 0,
    skippedSince: 0,
    skipReasons: {}
  };
  const eligible = [];

  for (const project of projects) {
    console.log(`--- ${project.name} (${project.path}) ---`);
    const status = describeStatus(project);
    if (!status.ok) {
      console.log(`  SKIP: ${status.reason}`);
      summary.skipped++;
      summary.skipReasons[status.reason] = (summary.skipReasons[status.reason] || 0) + 1;
      console.log('');
      continue;
    }
    summary.eligible++;
    console.log(`  cycle-state dir: ${status.cycleDir}`);
    console.log(`  yaml files:      ${status.yamlCount}`);
    const result = runImportForProject(project, status, {
      dryRun: true,
      summaryOnly: APPLY,
      capture: true
    });
    const projected = parseDryRunSummary(result.stdout);
    if (result.exitCode === 0) {
      if (!projected) {
        summary.failed++;
        console.warn(`  WARN: import for ${project.name} did not emit a dry-run projection summary`);
        console.log('');
        continue;
      }
      summary.projectedTriples += projected.triples;
      summary.skippedSince += projected.skippedSince;
      summary.succeeded++;
      eligible.push({ project, status });
    } else {
      summary.failed++;
      console.warn(`  WARN: import for ${project.name} exited with code ${result.exitCode}${result.error ? ' (' + result.error + ')' : ''}`);
    }
    console.log('');
  }

  if (summary.projectedTriples >= SOFT_WARN_THRESHOLD && summary.projectedTriples <= LARGE_IMPORT_THRESHOLD) {
    console.warn(
      `WARN: projected import is ${summary.projectedTriples} triples; review --dry-run output before --apply if this is unexpected.`
    );
  }

  if (APPLY && summary.failed === 0) {
    if (summary.projectedTriples > LARGE_IMPORT_THRESHOLD && !YES_LARGE_IMPORT && !promptLargeImport(summary.projectedTriples)) {
      console.error(
        `Error: projected import is ${summary.projectedTriples} triples, above BOOTSTRAP_LARGE_IMPORT_THRESHOLD=${LARGE_IMPORT_THRESHOLD}. ` +
        'Re-run with --yes-large-import to confirm.'
      );
      process.exit(1);
    }

    summary.succeeded = 0;
    summary.failed = 0;
    for (const { project, status } of eligible) {
      console.log(`--- applying ${project.name} ---`);
      const result = runImportForProject(project, status);
      if (result.exitCode === 0) {
        summary.succeeded++;
      } else {
        summary.failed++;
        console.warn(`  WARN: import for ${project.name} exited with code ${result.exitCode}${result.error ? ' (' + result.error + ')' : ''}`);
      }
      console.log('');
    }
  }

  console.log('=== Aggregate Summary ===');
  console.log(`Mode:           ${DRY_RUN ? 'dry-run' : 'apply'}`);
  console.log(`Since:          ${SINCE}`);
  console.log(`Registered:     ${summary.registered}`);
  console.log(`Eligible:       ${summary.eligible}`);
  console.log(`Skipped:        ${summary.skipped}`);
  for (const [reason, count] of Object.entries(summary.skipReasons)) {
    console.log(`  - ${reason}: ${count}`);
  }
  console.log(`Projected:      ${summary.projectedTriples}`);
  console.log(`Skipped pre---since: ${summary.skippedSince}`);
  console.log(`Succeeded:      ${summary.succeeded}`);
  console.log(`Failed:         ${summary.failed}`);
  if (DRY_RUN) {
    console.log(`WOULD INSERT ${summary.projectedTriples} triples (${summary.skippedSince} skipped pre---since) -- DRY RUN`);
  } else {
    console.log(`Projected before apply: ${summary.projectedTriples} triples (${summary.skippedSince} skipped pre---since)`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log('Dry-run only. Re-run with --apply to write triples to ~/.claude/hive/kg.sqlite.');
  }

  // Non-zero exit if any per-project import failed; preserves CI signal.
  process.exit(summary.failed > 0 ? 2 : 0);
}

main();
