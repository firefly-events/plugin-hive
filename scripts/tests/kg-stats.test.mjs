import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');

const FIXTURE_SQL = `
CREATE TABLE IF NOT EXISTS triples (
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL REFERENCES predicates(predicate),
  object TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  source_epic TEXT,
  source_agent TEXT
);
CREATE TABLE IF NOT EXISTS predicates (predicate TEXT PRIMARY KEY);
INSERT OR IGNORE INTO predicates VALUES
  ('decided'), ('superseded'), ('assigned_to'), ('blocked_by'), ('depends_on'),
  ('phase_started'), ('phase_complete'), ('phase_failed'), ('phase_blocked');
INSERT INTO triples VALUES
  ('story-a', 'decided', 'use sqlite', '2026-06-01T10:00:00Z', NULL, 'epic-1', 'architect'),
  ('story-a', 'decided', 'use python', '2026-06-02T10:00:00Z', NULL, 'epic-1', 'architect'),
  ('story-b', 'assigned_to', 'developer', '2026-06-03T10:00:00Z', NULL, 'epic-2', 'planner'),
  ('story-c', 'phase_started', 'build', '2020-01-01T00:00:00Z', NULL, 'epic-old', 'runner');
`;

function makeFixtureDb(dir) {
  const dbPath = path.join(dir, 'kg.sqlite');
  const sqlPath = path.join(dir, 'fixture.sql');
  fs.writeFileSync(sqlPath, FIXTURE_SQL);
  const result = spawnSync(
    'python3',
    ['-c', [
      'import sqlite3, sys',
      'conn = sqlite3.connect(sys.argv[1])',
      'conn.executescript(open(sys.argv[2]).read())',
      'conn.commit()',
      'conn.close()',
    ].join('\n'), dbPath, sqlPath],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return dbPath;
}

function runStats(args = []) {
  return spawnSync('python3', ['-m', 'hive.lib.kg_stats', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('missing db exits 0 with one-line soft-fail message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-stats-'));
  const missing = path.join(dir, 'absent.sqlite');
  const result = runStats(['--db-path', missing]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`no kg database found at ${missing}`));
});

test('table output includes totals, breakdowns, tuples, last write, density', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-stats-'));
  const dbPath = makeFixtureDb(dir);
  const result = runStats(['--db-path', dbPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total triples:\s+4/);
  assert.match(result.stdout, /Last write:\s+2026-06-03T10:00:00Z/);
  assert.match(result.stdout, /Distinct \(agent, predicate\) tuples: 3/);
  assert.match(result.stdout, /Trailing 30-day density:/);
  assert.match(result.stdout, /BY PREDICATE/);
  assert.match(result.stdout, /decided\s+2/);
  assert.match(result.stdout, /BY SOURCE AGENT/);
  assert.match(result.stdout, /architect\s+2/);
  assert.match(result.stdout, /BY SOURCE EPIC/);
  assert.match(result.stdout, /epic-1\s+2/);
});

test('zombie predicates listed under DECLARED-BUT-NEVER-WRITTEN', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-stats-'));
  const dbPath = makeFixtureDb(dir);
  const result = runStats(['--db-path', dbPath]);

  assert.equal(result.status, 0, result.stderr);
  const section = result.stdout.split('DECLARED-BUT-NEVER-WRITTEN')[1];
  assert.ok(section, 'missing DECLARED-BUT-NEVER-WRITTEN section');
  for (const zombie of ['superseded', 'blocked_by', 'depends_on', 'phase_complete', 'phase_failed', 'phase_blocked']) {
    assert.match(section, new RegExp(zombie));
  }
  assert.doesNotMatch(section, /\bdecided\b/);
});

test('--json emits machine-readable stats with no table formatting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-stats-'));
  const dbPath = makeFixtureDb(dir);
  const result = runStats(['--db-path', dbPath, '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /BY PREDICATE/);
  const stats = JSON.parse(result.stdout);
  assert.equal(stats.total_triples, 4);
  assert.equal(stats.by_predicate.decided, 2);
  assert.equal(stats.by_predicate.assigned_to, 1);
  assert.equal(stats.by_source_agent.architect, 2);
  assert.equal(stats.by_source_epic['epic-1'], 2);
  assert.equal(stats.last_write, '2026-06-03T10:00:00Z');
  assert.equal(stats.distinct_agent_predicate_tuples, 3);
  assert.equal(typeof stats.trailing_30d.triple_count, 'number');
  assert.equal(typeof stats.trailing_30d.per_day, 'number');
  assert.ok(stats.trailing_30d.since);
  assert.ok(stats.zombie_predicates.includes('superseded'));
  assert.ok(!stats.zombie_predicates.includes('decided'));
});

test('HIVE_KG_SQLITE_PATH env var overrides default location', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-stats-'));
  const dbPath = makeFixtureDb(dir);
  const result = spawnSync('python3', ['-m', 'hive.lib.kg_stats', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HIVE_KG_SQLITE_PATH: dbPath },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).total_triples, 4);
});
