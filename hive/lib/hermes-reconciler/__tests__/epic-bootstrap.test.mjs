/**
 * epic-bootstrap.test.mjs
 *
 * Tests for hpr-4 epic approval bootstrap:
 *   - Happy path: writes pre_approved + epic_of_record when human confirms
 *   - Confirm gate: no write without explicit "yes" confirmation
 *   - Invalid/empty epic handle: errors with no state write
 *   - Non-reachability: reconcile-tick does not import epic-bootstrap
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readHermesReconcilerState } from '../state.mjs';

const BOOTSTRAP = fileURLToPath(new URL('../epic-bootstrap.mjs', import.meta.url));

function tmpCycleStatePath(name = 'test-epic') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpr4-bootstrap-'));
  return path.join(dir, '.pHive', 'cycle-state', `${name}.yaml`);
}

function runBootstrap(argv, { input = '' } = {}) {
  return spawnSync('node', [BOOTSTRAP, ...argv], { encoding: 'utf8', input });
}

// ── Happy path ────────────────────────────────────────────────────────────────

test('happy path: writes gate_state=pre_approved + epic_of_record when confirmed', () => {
  const file = tmpCycleStatePath('my-epic');
  const res = runBootstrap(
    ['--epic', 'my-epic', '--cycle-state', file],
    { input: 'yes\n' },
  );
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);

  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
  assert.equal(state.epic_of_record, 'my-epic');
});

test('--yes flag: skips prompt and writes state', () => {
  const file = tmpCycleStatePath('auto-epic');
  const res = runBootstrap(['--epic', 'auto-epic', '--cycle-state', file, '--yes']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);

  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
  assert.equal(state.epic_of_record, 'auto-epic');
});

test('echo: stdout includes resolved epic_of_record and cycle-state path before write', () => {
  const file = tmpCycleStatePath('echo-epic');
  const res = runBootstrap(
    ['--epic', 'echo-epic', '--cycle-state', file],
    { input: 'yes\n' },
  );
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /echo-epic/);
  assert.match(res.stdout, /gate_state=pre_approved/);
  assert.match(res.stdout, /epic_of_record=echo-epic/);
});

// ── Confirm gate ──────────────────────────────────────────────────────────────

test('confirm gate: no write when answer is "no"', () => {
  const file = tmpCycleStatePath('no-epic');
  const res = runBootstrap(
    ['--epic', 'no-epic', '--cycle-state', file],
    { input: 'no\n' },
  );
  assert.notEqual(res.status, 0, 'expected non-zero exit when aborted');
  assert.ok(!fs.existsSync(file), 'cycle-state must not be written on abort');
});

test('confirm gate: no write when answer is empty string', () => {
  const file = tmpCycleStatePath('empty-ans-epic');
  const res = runBootstrap(
    ['--epic', 'empty-ans-epic', '--cycle-state', file],
    { input: '\n' },
  );
  assert.notEqual(res.status, 0);
  assert.ok(!fs.existsSync(file));
});

test('confirm gate: "YES" is also accepted (case-insensitive match)', () => {
  const file = tmpCycleStatePath('case-epic');
  const res = runBootstrap(
    ['--epic', 'case-epic', '--cycle-state', file],
    { input: 'YES\n' },
  );
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
});

// ── Invalid / missing epic handle ─────────────────────────────────────────────

test('missing --epic: exits with error, no write', () => {
  const file = tmpCycleStatePath('unused');
  const res = runBootstrap(['--cycle-state', file], { input: 'yes\n' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--epic/);
  assert.ok(!fs.existsSync(file));
});

test('empty string epic handle: exits with error, no write', () => {
  const file = tmpCycleStatePath('unused2');
  // Pass --epic with an empty value; the next arg is also a flag so parser sees it as true
  // Instead test the empty string case via the resolvable path: pass whitespace
  const res = runBootstrap(['--epic', '   ', '--cycle-state', file], { input: 'yes\n' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /non-empty/);
  assert.ok(!fs.existsSync(file));
});

// ── Dry run ───────────────────────────────────────────────────────────────────

test('--dry-run: echoes plan and exits without writing state', () => {
  const file = tmpCycleStatePath('dry-epic');
  const res = runBootstrap(['--epic', 'dry-epic', '--cycle-state', file, '--dry-run']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /DRY RUN/i);
  assert.ok(!fs.existsSync(file), 'dry run must not write cycle-state');
});

// ── Non-reachability from reconcile-tick surface ──────────────────────────────

test('epic-bootstrap is not imported by the reconcile-tick surface (slack-notify-await.mjs)', () => {
  // Read the slack-notify-await.mjs import list — the tick surface module.
  // epic-bootstrap must not appear as an import there.
  const tickSurface = new URL('../slack-notify-await.mjs', import.meta.url);
  const content = fs.readFileSync(fileURLToPath(tickSurface), 'utf8');
  assert.ok(
    !content.includes('epic-bootstrap'),
    'slack-notify-await.mjs (tick surface) must not import epic-bootstrap',
  );
});

test('epic-bootstrap is not imported by state.mjs', () => {
  const statePath = new URL('../state.mjs', import.meta.url);
  const content = fs.readFileSync(fileURLToPath(statePath), 'utf8');
  assert.ok(
    !content.includes('epic-bootstrap'),
    'state.mjs must not import epic-bootstrap',
  );
});
