import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'kg-import-cycle-state.js');

function makeTempFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-import-cycle-state-'));
  const home = path.join(dir, 'home');
  const cycleDir = path.join(dir, 'cycle-state');
  fs.mkdirSync(path.join(home, '.claude', 'hive'), { recursive: true });
  fs.mkdirSync(cycleDir, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'hive', 'kg.sqlite'), '');
  return { dir, home, cycleDir };
}

function runImport(fixture, args = []) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--dry-run',
    '--cycle-state-dir', fixture.cycleDir,
    ...args,
  ], {
    cwd: ROOT,
    env: { ...process.env, HOME: fixture.home },
    encoding: 'utf8',
  });
}

test('legacy format with set uses set value for valid_from and is skipped by newer --since', () => {
  const fixture = makeTempFixture();
  fs.writeFileSync(path.join(fixture.cycleDir, 'legacy.yaml'), [
    'epic_id: legacy-epic',
    'decisions:',
    '  - decision: legacy set decision',
    '    set: 2026-05-07',
    '',
  ].join('\n'));
  fs.utimesSync(path.join(fixture.cycleDir, 'legacy.yaml'), new Date('2026-05-20T00:00:00.000Z'), new Date('2026-05-20T00:00:00.000Z'));

  const result = runImport(fixture, ['--since', '2026-05-08']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WOULD INSERT 0 triples \(1 skipped pre---since\) -- DRY RUN/);
  assert.doesNotMatch(result.stdout, /legacy set decision/);
});

test('legacy format without set falls back to file mtime', () => {
  const fixture = makeTempFixture();
  const file = path.join(fixture.cycleDir, 'legacy.yaml');
  fs.writeFileSync(file, [
    'epic_id: legacy-epic',
    'decisions:',
    '  - decision: legacy fallback decision',
    '',
  ].join('\n'));
  fs.utimesSync(file, new Date('2026-05-20T00:00:00.000Z'), new Date('2026-05-20T00:00:00.000Z'));

  const result = runImport(fixture, ['--since', '2026-05-08']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /legacy fallback decision/);
  assert.match(result.stdout, /WOULD INSERT 1 triples \(0 skipped pre---since\) -- DRY RUN/);
});

test('canonical and v2 formats keep existing timestamp behavior', () => {
  const fixture = makeTempFixture();
  fs.writeFileSync(path.join(fixture.cycleDir, 'mixed.yaml'), [
    'epic_id: mixed-epic',
    'decisions:',
    '  - key: canonical-key',
    '    value: canonical-value',
    '    timestamp: 2026-05-07',
    '  - id: v2-decision',
    '    value: v2-value',
    '    captured_at: 2026-05-09',
    '',
  ].join('\n'));

  const result = runImport(fixture, ['--since', '2026-05-08']);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /canonical-key:canonical-value/);
  assert.match(result.stdout, /v2-value/);
  assert.match(result.stdout, /WOULD INSERT 1 triples \(1 skipped pre---since\) -- DRY RUN/);
});
