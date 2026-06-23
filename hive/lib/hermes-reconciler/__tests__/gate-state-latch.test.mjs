/**
 * gate-state-latch.test.mjs
 *
 * Tests for the h-03 gate_state latch contract:
 *   - gate_state null → tick refuses to advance ("not approved")
 *   - gate_state pre_approved → tick may proceed
 *   - gate_state review_awaiting_human → tick is halted
 *   - gate_state finalized → tick is halted
 *   - epic_of_record persists and is echoed in rollup
 *   - write-state gate_state validation rejects unknown values
 *   - human approval transition: null → pre_approved via write-state
 *   - halt transition: pre_approved → review_awaiting_human via write-state
 *   - human continue: review_awaiting_human → pre_approved via write-state
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readHermesReconcilerState,
  writeHermesReconcilerState,
  VALID_GATE_STATES,
} from '../state.mjs';

const CLI = fileURLToPath(new URL('../../multica-story-dispatch/cli.mjs', import.meta.url));

const NO_CREDS_ENV = {
  ...process.env,
  MULTICA_SERVER_URL: '',
  MULTICA_TOKEN: '',
  MULTICA_WORKSPACE_ID: '',
};

function runCli(argv, env = NO_CREDS_ENV) {
  return spawnSync('node', [CLI, ...argv], { encoding: 'utf8', env });
}

function tmpFile(name = 'test-epic') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h03-gate-latch-'));
  return path.join(dir, '.pHive', 'cycle-state', `${name}.yaml`);
}

// ── VALID_GATE_STATES export ──────────────────────────────────────────────────

test('VALID_GATE_STATES contains exactly the expected string values', () => {
  assert.ok(VALID_GATE_STATES.has('pre_approved'));
  assert.ok(VALID_GATE_STATES.has('review_awaiting_human'));
  assert.ok(VALID_GATE_STATES.has('finalized'));
  // null is NOT a member; it is the JS literal absence value
  assert.ok(!VALID_GATE_STATES.has(null));
  assert.ok(!VALID_GATE_STATES.has(''));
  assert.ok(!VALID_GATE_STATES.has('unknown'));
});

// ── state.mjs: epic_of_record default ────────────────────────────────────────

test('readHermesReconcilerState returns epic_of_record: null when absent', () => {
  const file = tmpFile();
  const state = readHermesReconcilerState(file);
  assert.equal(state.epic_of_record, null);
});

test('writeHermesReconcilerState persists epic_of_record', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { epic_of_record: 'hermes-orchestrator-skills' });
  const state = readHermesReconcilerState(file);
  assert.equal(state.epic_of_record, 'hermes-orchestrator-skills');
});

// ── state.mjs: gate_state default ────────────────────────────────────────────

test('readHermesReconcilerState returns gate_state: null (not approved) when file absent', () => {
  const file = tmpFile();
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, null);
});

// ── Gate latch semantics via state.mjs ───────────────────────────────────────

test('gate latch: null gate_state → tick should refuse to advance', () => {
  const file = tmpFile();
  const state = readHermesReconcilerState(file);
  // Contract: any tick must check this before advancing.
  assert.notEqual(state.gate_state, 'pre_approved');
});

test('gate latch: pre_approved → tick may proceed', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { gate_state: 'pre_approved' });
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
});

test('gate latch: review_awaiting_human → tick should halt (not pre_approved)', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { gate_state: 'review_awaiting_human' });
  const state = readHermesReconcilerState(file);
  assert.notEqual(state.gate_state, 'pre_approved');
  assert.equal(state.gate_state, 'review_awaiting_human');
});

test('gate latch: finalized → tick should halt (not pre_approved)', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { gate_state: 'finalized' });
  const state = readHermesReconcilerState(file);
  assert.notEqual(state.gate_state, 'pre_approved');
  assert.equal(state.gate_state, 'finalized');
});

// ── Gate state transitions ────────────────────────────────────────────────────

test('transition: null → pre_approved (human approval)', () => {
  const file = tmpFile();
  // Initial state: gate_state is null
  assert.equal(readHermesReconcilerState(file).gate_state, null);
  // Human sets pre_approved + epic_of_record
  writeHermesReconcilerState(file, { gate_state: 'pre_approved', epic_of_record: 'my-epic' });
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
  assert.equal(state.epic_of_record, 'my-epic');
});

test('transition: pre_approved → review_awaiting_human (reconciler halt)', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { gate_state: 'pre_approved' });
  // Reconciler transitions on review_terminal non-passed verdict
  writeHermesReconcilerState(file, { gate_state: 'review_awaiting_human' });
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'review_awaiting_human');
});

test('transition: review_awaiting_human → pre_approved (human continues)', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { gate_state: 'review_awaiting_human' });
  // Human reviews verdict and continues
  writeHermesReconcilerState(file, { gate_state: 'pre_approved' });
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
});

test('transition: pre_approved → finalized (Branch 4)', () => {
  const file = tmpFile();
  writeHermesReconcilerState(file, { gate_state: 'pre_approved' });
  writeHermesReconcilerState(file, { gate_state: 'finalized' });
  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'finalized');
});

// ── cli write-state: gate_state validation ────────────────────────────────────

test('cli write-state: invalid gate_state value → INVALID_ARG', () => {
  const file = tmpFile();
  const patch = JSON.stringify({ gate_state: 'auto_approved' });
  const res = runCli(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', patch]);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'INVALID_ARG');
  assert.match(err.message, /gate_state/);
  assert.ok(!fs.existsSync(file), 'no partial write on validation failure');
});

test('cli write-state: gate_state null is valid (clears the latch)', () => {
  const file = tmpFile();
  // First set pre_approved
  const r1 = runCli(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', JSON.stringify({ gate_state: 'pre_approved' })]);
  assert.equal(r1.status, 0, r1.stderr);
  // Then clear with null
  const r2 = runCli(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', JSON.stringify({ gate_state: null })]);
  assert.equal(r2.status, 0, r2.stderr);
  const out = JSON.parse(r2.stdout);
  assert.equal(out.gate_state, null);
});

test('cli write-state: gate_state pre_approved is valid', () => {
  const file = tmpFile();
  const res = runCli(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', JSON.stringify({ gate_state: 'pre_approved' })]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'pre_approved');
});

test('cli write-state: gate_state review_awaiting_human is valid', () => {
  const file = tmpFile();
  const res = runCli(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', JSON.stringify({ gate_state: 'review_awaiting_human' })]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'review_awaiting_human');
});

test('cli write-state: gate_state finalized is valid', () => {
  const file = tmpFile();
  const res = runCli(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', JSON.stringify({ gate_state: 'finalized' })]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'finalized');
});

// ── cli write-state: epic_of_record ──────────────────────────────────────────

test('cli write-state: sets epic_of_record and echoes it in rollup', () => {
  const file = tmpFile();
  const patch = JSON.stringify({ gate_state: 'pre_approved', epic_of_record: 'hermes-orchestrator-skills' });
  const res = runCli(['write-state', '--epic', 'hermes-orchestrator-skills', '--cycle-state', file, '--patch', patch]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'pre_approved');
  assert.equal(out.epic_of_record, 'hermes-orchestrator-skills');
});

// ── cli epic-status: epic_of_record in rollup ────────────────────────────────

test('cli epic-status: includes epic_of_record in rollup output', () => {
  const file = tmpFile('my-epic');
  // Write epic_of_record via write-state first
  writeHermesReconcilerState(file, { gate_state: 'pre_approved', epic_of_record: 'my-epic' });
  const res = runCli(['epic-status', '--epic', 'my-epic', '--cycle-state', file]);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'pre_approved');
  assert.equal(out.epic_of_record, 'my-epic');
});

// ── Multiple epics: epic_of_record disambiguates ──────────────────────────────

test('epic_of_record disambiguates when multiple epics have cycle-state files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h03-multi-epic-'));
  const csDir = path.join(dir, '.pHive', 'cycle-state');
  fs.mkdirSync(csDir, { recursive: true });

  const epicA = path.join(csDir, 'epic-a.yaml');
  const epicB = path.join(csDir, 'epic-b.yaml');

  writeHermesReconcilerState(epicA, { gate_state: 'pre_approved', epic_of_record: 'epic-a' });
  writeHermesReconcilerState(epicB, { gate_state: 'pre_approved', epic_of_record: 'epic-b' });

  const stateA = readHermesReconcilerState(epicA);
  const stateB = readHermesReconcilerState(epicB);

  // Each hermes_reconciler block unambiguously names its epic
  assert.equal(stateA.epic_of_record, 'epic-a');
  assert.equal(stateB.epic_of_record, 'epic-b');

  // A tick targeting epic-a rejects epic-b's state (epic_of_record mismatch)
  assert.notEqual(stateB.epic_of_record, 'epic-a');
});
