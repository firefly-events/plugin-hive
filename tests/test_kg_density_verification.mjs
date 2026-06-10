import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'kg-density-verification.mjs');
const NOW = '2026-06-10T00:00:00Z';

const CONFIG_FIXTURE = `meta_optimize:
  signal_weights:
    metrics: 1.0
    kg_signal: 0.4         # demoted pending KG repair
    backlog: 0.2
`;

// Build a fixture kg.sqlite via python3 (same pattern as scripts/tests/kg-stats.test.mjs).
// triplesPerDay rows/day over 30 days ending at NOW, cycling through the given
// predicates and agents so distinct counts equal the array lengths.
function makeFixtureDb(dir, { triplesPerDay, predicates, agents }) {
  const dbPath = path.join(dir, 'kg.sqlite');
  const spec = JSON.stringify({ triplesPerDay, predicates, agents, now: NOW });
  const py = `
import sqlite3, sys, json
from datetime import datetime, timedelta, timezone
spec = json.loads(sys.argv[2])
conn = sqlite3.connect(sys.argv[1])
conn.executescript('''
CREATE TABLE triples (
  subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
  valid_from TEXT NOT NULL, valid_until TEXT, source_epic TEXT, source_agent TEXT
);
CREATE TABLE predicates (predicate TEXT PRIMARY KEY);
''')
now = datetime.fromisoformat(spec['now'].replace('Z', '+00:00'))
i = 0
for day in range(30):
    for n in range(spec['triplesPerDay']):
        ts = (now - timedelta(days=day, hours=1 + n % 20)).strftime('%Y-%m-%dT%H:%M:%SZ')
        conn.execute('INSERT INTO triples VALUES (?,?,?,?,NULL,?,?)', (
            f'story-{i}', spec['predicates'][i % len(spec['predicates'])], f'obj-{i}',
            ts, 'epic-kg', spec['agents'][i % len(spec['agents'])]))
        i += 1
conn.commit()
conn.close()
`;
  const result = spawnSync('python3', ['-c', py, dbPath, spec], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return dbPath;
}

// Stub gh + git on PATH: every invocation appends its argv to stub.log.
// gh pr list prints $GH_PR_LIST_OUTPUT (default []); git rev-parse prints a branch name.
function makeStubBin(dir) {
  const binDir = path.join(dir, 'bin');
  const logPath = path.join(dir, 'stub.log');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'gh'), `#!/bin/sh
echo "gh $@" >> "${logPath}"
case "$1 $2" in
  "pr list") echo "\${GH_PR_LIST_OUTPUT:-[]}" ;;
  "pr create") echo "https://github.com/example/repo/pull/99" ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'git'), `#!/bin/sh
echo "git $@" >> "${logPath}"
if [ "$1" = "rev-parse" ]; then echo "feat/kg-repair-activation"; fi
`, { mode: 0o755 });
  return { binDir, logPath };
}

function runScript(dir, dbPath, env = {}) {
  const configPath = path.join(dir, 'hive.config.yaml');
  fs.writeFileSync(configPath, CONFIG_FIXTURE);
  const { binDir, logPath } = makeStubBin(dir);
  const result = spawnSync(process.execPath, [
    SCRIPT, '--db-path', dbPath, '--config', configPath, '--now', NOW,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env },
  });
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  return { result, log, configPath };
}

test('thresholds not met: prints gap, exits 1, no PR opened', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-density-'));
  // 2/day density, 2 predicates, 2 agents — all three below target
  const dbPath = makeFixtureDb(dir, {
    triplesPerDay: 2,
    predicates: ['decided', 'tested'],
    agents: ['architect', 'tester'],
  });
  const { result, log } = runScript(dir, dbPath);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /density=2\.0\/day, target=6\.0\/day/);
  assert.match(result.stdout, /Thresholds not met/);
  assert.doesNotMatch(log, /gh pr create/);
});

test('thresholds met: opens draft PR with kg_signal bump', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-density-'));
  // 7/day, 6 predicates, 4 agents — all above target
  const dbPath = makeFixtureDb(dir, {
    triplesPerDay: 7,
    predicates: ['decided', 'tested', 'implemented', 'validated', 'phase_started', 'phase_complete'],
    agents: ['architect', 'tester', 'developer', 'planner'],
  });
  const { result, log, configPath } = runScript(dir, dbPath);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /All thresholds met/);
  assert.match(result.stdout, /Draft PR opened: https:\/\/github\.com\/example\/repo\/pull\/99/);
  assert.match(log, /gh pr create --draft/);
  assert.match(log, /git push/);
  // config on the bump branch has the new value (stub git never switches branches,
  // so the edit lands in the fixture file)
  assert.match(fs.readFileSync(configPath, 'utf8'), /kg_signal: 0\.8/);
  // restores the original branch afterwards
  assert.match(log, /git checkout feat\/kg-repair-activation/);
});

test('idempotent: existing open PR on bump branch means no second PR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-density-'));
  const dbPath = makeFixtureDb(dir, {
    triplesPerDay: 7,
    predicates: ['decided', 'tested', 'implemented', 'validated', 'phase_started', 'phase_complete'],
    agents: ['architect', 'tester', 'developer', 'planner'],
  });
  const { result, log } = runScript(dir, dbPath, {
    GH_PR_LIST_OUTPUT: '[{"number": 42}]',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Open PR #42 already exists/);
  assert.doesNotMatch(log, /gh pr create/);
  assert.doesNotMatch(log, /git checkout/);
});

test('missing database exits 1 with clear message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-density-'));
  const { result } = runScript(dir, path.join(dir, 'absent.sqlite'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No kg database found/);
});
