import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'kg-bootstrap-from-projects.js');

function makeFixture({ decisions = 1, setDate = '2026-05-07' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-bootstrap-from-projects-'));
  const home = path.join(dir, 'home');
  const project = path.join(dir, 'project');
  const cycleDir = path.join(project, '.pHive', 'cycle-state');
  fs.mkdirSync(path.join(home, '.claude', 'hive'), { recursive: true });
  fs.mkdirSync(cycleDir, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'hive', 'kg.sqlite'), '');
  fs.writeFileSync(path.join(dir, 'projects.yaml'), [
    'projects:',
    `  - path: ${project}`,
    '    name: fixture-project',
    '',
  ].join('\n'));

  const lines = ['epic_id: fixture-epic', 'decisions:'];
  for (let i = 0; i < decisions; i++) {
    lines.push(`  - decision: fixture decision ${i}`);
    lines.push(`    set: ${setDate}`);
  }
  fs.writeFileSync(path.join(cycleDir, 'fixture.yaml'), `${lines.join('\n')}\n`);
  return { dir, home, registry: path.join(dir, 'projects.yaml') };
}

function makeMockBetterSqlite3(dir) {
  const moduleDir = path.join(dir, 'node_modules', 'better-sqlite3');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'index.js'), `
    module.exports = class Database {
      prepare(sql) {
        if (sql.includes('idx_unique_triple')) return { get: () => ({ ok: 1 }) };
        if (sql.includes('COUNT(*)')) return { get: () => ({ cnt: 0 }) };
        return { run: () => ({ changes: 1 }) };
      }
      transaction(fn) { return () => fn(); }
      pragma() { return []; }
      close() {}
    };
  `);
  return path.join(dir, 'node_modules');
}

function runBootstrap(fixture, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: fixture.home,
      HIVE_PROJECTS_REGISTRY: fixture.registry,
      ...env,
    },
    encoding: 'utf8',
  });
}

test('--since accepts valid dates and filters older decisions', () => {
  const fixture = makeFixture({ decisions: 1, setDate: '2026-05-07' });
  const result = runBootstrap(fixture, ['--since', '2026-05-08']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Since:\s+2026-05-08/);
  assert.match(result.stdout, /WOULD INSERT 0 triples \(1 skipped pre---since\) -- DRY RUN/);
});

test('--since rejects invalid date format clearly', () => {
  const fixture = makeFixture();
  const result = runBootstrap(fixture, ['--since', '2026-5-8']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid --since '2026-5-8'\. Expected YYYY-MM-DD/);
});

test('default --since is 2026-04-28', () => {
  const fixture = makeFixture({ decisions: 1, setDate: '2026-04-27' });
  const result = runBootstrap(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Since:\s+2026-04-28/);
  assert.match(result.stdout, /WOULD INSERT 0 triples \(1 skipped pre---since\) -- DRY RUN/);
});

test('dry-run output includes projected insert count and skipped count', () => {
  const fixture = makeFixture({ decisions: 2, setDate: '2026-05-07' });
  const result = runBootstrap(fixture, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WOULD INSERT 2 triples \(0 skipped pre---since\) -- DRY RUN/);
  assert.match(result.stdout, /Mode:\s+dry-run/);
});

test('--apply without --yes-large-import refuses projected imports above 10k', () => {
  const fixture = makeFixture({ decisions: 10001, setDate: '2026-05-07' });
  const result = runBootstrap(fixture, ['--apply']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /above BOOTSTRAP_LARGE_IMPORT_THRESHOLD=10000/);
});

test('--apply with --yes-large-import succeeds for projected imports above 10k', () => {
  const fixture = makeFixture({ decisions: 10001, setDate: '2026-05-07' });
  const nodePath = makeMockBetterSqlite3(fixture.dir);
  const result = runBootstrap(fixture, ['--apply', '--yes-large-import'], { NODE_PATH: nodePath });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Mode:\s+apply/);
  assert.match(result.stdout, /Triples inserted:\s+10001/);
});

test('--apply succeeds without --yes-large-import below 10k', () => {
  const fixture = makeFixture({ decisions: 2, setDate: '2026-05-07' });
  const nodePath = makeMockBetterSqlite3(fixture.dir);
  const result = runBootstrap(fixture, ['--apply'], { NODE_PATH: nodePath });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Triples inserted:\s+2/);
});
