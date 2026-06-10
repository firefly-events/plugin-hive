#!/usr/bin/env node
/**
 * KG density verification — epic-merge + 30 days check.
 *
 * Queries kg.sqlite for the last N days (default 30):
 *   - density: triples/day over the window
 *   - distinct firing predicates
 *   - distinct source_agents
 *
 * If ALL thresholds are met (>=6/day, >=5 predicates, >=3 source_agents),
 * opens a DRAFT PR via `gh pr create` bumping hive.config.yaml
 * `kg_signal: 0.4` -> `kg_signal: 0.8`. The maintainer reviews + merges;
 * this script never lands the weight change itself.
 *
 * If thresholds are NOT met, prints the gap per metric and exits 1.
 *
 * Idempotent: if an open PR already exists for the bump branch, exits 0
 * without creating a second one.
 *
 * Usage:
 *   node scripts/kg-density-verification.mjs \
 *     [--db-path PATH] [--config PATH] [--window-days N] [--now ISO] [--dry-run]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const THRESHOLDS = {
  density: 6,        // triples/day
  predicates: 5,     // distinct firing predicates
  sourceAgents: 3,   // distinct source_agents
};

const BUMP_BRANCH = 'kg/signal-bump-0.8';
const OLD_VALUE = 0.4;
const NEW_VALUE = 0.8;

function parseArgs(argv) {
  const args = {
    dbPath: path.join(os.homedir(), '.claude', 'hive', 'kg.sqlite'),
    config: 'hive.config.yaml',
    windowDays: 30,
    now: new Date().toISOString(),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--db-path': args.dbPath = argv[++i]; break;
      case '--config': args.config = argv[++i]; break;
      case '--window-days': args.windowDays = Number(argv[++i]); break;
      case '--now': args.now = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return args;
}

// Shell out to python3 sqlite3 (same pattern as scripts/kg-import-cycle-state.js)
// so the script works without node_modules installed.
function queryMetrics(dbPath, cutoffIso) {
  const py = [
    'import sqlite3, sys, json',
    'conn = sqlite3.connect(sys.argv[1])',
    'cutoff = sys.argv[2]',
    'row = conn.execute(',
    '    "SELECT COUNT(*), COUNT(DISTINCT predicate), "',
    '    "COUNT(DISTINCT source_agent) FROM triples "',
    '    "WHERE valid_from >= ? AND source_agent IS NOT NULL", (cutoff,)).fetchone()',
    'total = conn.execute("SELECT COUNT(*) FROM triples WHERE valid_from >= ?", (cutoff,)).fetchone()[0]',
    'print(json.dumps({"triples": total, "predicates": row[1], "source_agents": row[2]}))',
    'conn.close()',
  ].join('\n');
  const result = spawnSync('python3', ['-c', py, dbPath, cutoffIso], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`sqlite query failed: ${result.stderr}`);
    process.exit(2);
  }
  return JSON.parse(result.stdout);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.status !== 0) {
    console.error(`${cmd} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    process.exit(2);
  }
  return result.stdout.trim();
}

function existingOpenPr() {
  const out = run('gh', ['pr', 'list', '--head', BUMP_BRANCH, '--state', 'open', '--json', 'number']);
  const prs = JSON.parse(out || '[]');
  return prs.length > 0 ? prs[0].number : null;
}

function bumpConfig(configPath) {
  const content = fs.readFileSync(configPath, 'utf8');
  const pattern = /^(\s*kg_signal:\s*)0\.4(\s*#.*)?$/m;
  if (!pattern.test(content)) {
    console.error(`kg_signal: ${OLD_VALUE} not found in ${configPath} — already bumped or config changed.`);
    process.exit(2);
  }
  const updated = content.replace(
    pattern,
    `$1${NEW_VALUE}         # promoted after density verification`,
  );
  fs.writeFileSync(configPath, updated);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.dbPath)) {
    console.error(`No kg database found at ${args.dbPath}`);
    process.exit(1);
  }

  const cutoff = new Date(new Date(args.now).getTime() - args.windowDays * 86400_000).toISOString();
  const metrics = queryMetrics(args.dbPath, cutoff);
  const density = metrics.triples / args.windowDays;

  const checks = [
    { name: 'density', actual: density, target: THRESHOLDS.density, unit: '/day', fmt: (v) => v.toFixed(1) },
    { name: 'predicates', actual: metrics.predicates, target: THRESHOLDS.predicates, unit: '', fmt: String },
    { name: 'source_agents', actual: metrics.source_agents, target: THRESHOLDS.sourceAgents, unit: '', fmt: String },
  ];

  const failures = checks.filter((c) => c.actual < c.target);
  for (const c of checks) {
    const status = c.actual >= c.target ? 'PASS' : 'FAIL';
    console.log(`${status} ${c.name}=${c.fmt(c.actual)}${c.unit}, target=${c.fmt(c.target)}${c.unit}`);
  }

  if (failures.length > 0) {
    const gaps = failures
      .map((c) => `${c.name}=${c.fmt(c.actual)}${c.unit}, target=${c.fmt(c.target)}${c.unit}`)
      .join('; ');
    console.log(`Thresholds not met: ${gaps}`);
    process.exit(1);
  }

  console.log('All thresholds met.');

  const openPr = existingOpenPr();
  if (openPr !== null) {
    console.log(`Open PR #${openPr} already exists for branch ${BUMP_BRANCH} — nothing to do.`);
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`Dry-run: would open draft PR on branch ${BUMP_BRANCH} bumping kg_signal ${OLD_VALUE} -> ${NEW_VALUE}.`);
    process.exit(0);
  }

  const previousBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  run('git', ['checkout', '-B', BUMP_BRANCH]);
  try {
    bumpConfig(args.config);
    run('git', ['add', args.config]);
    run('git', ['commit', '-m', `chore(meta-optimize): bump kg_signal ${OLD_VALUE} -> ${NEW_VALUE} after density verification`]);
    run('git', ['push', '--force-with-lease', 'origin', `HEAD:${BUMP_BRANCH}`]);
    const body = [
      'KG density verification passed — promoting `kg_signal` weight per repair-activation plan.',
      '',
      `- density: ${density.toFixed(1)}/day (target ${THRESHOLDS.density}/day)`,
      `- distinct firing predicates: ${metrics.predicates} (target ${THRESHOLDS.predicates})`,
      `- distinct source_agents: ${metrics.source_agents} (target ${THRESHOLDS.sourceAgents})`,
      '',
      `Window: last ${args.windowDays} days ending ${args.now}.`,
      '',
      'Generated by `scripts/kg-density-verification.mjs`. Review and merge to activate;',
      'meta-optimize step-02c picks up the new weight on the next ceremony run.',
    ].join('\n');
    const prUrl = run('gh', [
      'pr', 'create', '--draft',
      '--head', BUMP_BRANCH,
      '--title', `chore: bump kg_signal ${OLD_VALUE} -> ${NEW_VALUE} (density verified)`,
      '--body', body,
    ]);
    console.log(`Draft PR opened: ${prUrl}`);
  } finally {
    run('git', ['checkout', previousBranch]);
  }
}

main();
