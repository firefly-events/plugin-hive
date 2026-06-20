import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));

// write-state is local-only; strip all Multica creds to prove NO_CONFIG membership.
const NO_CREDS_ENV = {
  ...process.env,
  MULTICA_SERVER_URL: '',
  MULTICA_TOKEN: '',
  MULTICA_WORKSPACE_ID: '',
};

function run(argv, env = NO_CREDS_ENV) {
  const res = spawnSync('node', [CLI, ...argv], { encoding: 'utf8', env });
  return res;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-write-state-test-'));
}

function cycleStatePath(dir, epic = 'test-epic') {
  return path.join(dir, '.pHive', 'cycle-state', `${epic}.yaml`);
}

// ── Top-level field patches ───────────────────────────────────────────────────

test('write-state: sets top-level in_flight_story_id and echoes rollup', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);
  const patch = JSON.stringify({ in_flight_story_id: 'some-story', current_phase: 'dispatched_impl' });

  const res = run(['write-state', '--epic', 'test-epic', '--cycle-state', file, '--patch', patch]);
  assert.equal(res.status, 0, res.stderr);

  const out = JSON.parse(res.stdout);
  assert.equal(out.epic, 'test-epic');
  assert.equal(out.in_flight_story_id, 'some-story');
  assert.equal(out.current_phase, 'dispatched_impl');
  // Unset fields default to null
  assert.equal(out.gate_state, null);
  assert.equal(out.in_flight_task_id, null);
  assert.equal(out.dispatched_at, null);
  assert.deepEqual(out.stories, []);
});

test('write-state: sets multiple top-level fields (gate_state, dispatched_at, in_flight_task_id)', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);
  const patch = JSON.stringify({
    gate_state: 'pre_approved',
    in_flight_task_id: 'task-abc',
    dispatched_at: '2026-01-01T00:00:00Z',
  });

  const res = run(['write-state', '--epic', 'my-epic', '--cycle-state', file, '--patch', patch]);
  assert.equal(res.status, 0, res.stderr);

  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'pre_approved');
  assert.equal(out.in_flight_task_id, 'task-abc');
  assert.equal(out.dispatched_at, '2026-01-01T00:00:00Z');
});

// ── Per-story field patches ───────────────────────────────────────────────────

test('write-state: patches per-story fields without touching other stories', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);

  // Seed with two stories via first write
  const seed = JSON.stringify({
    stories: {
      's1': { phase_position: 'done', attempt: 1, verdict: 'passed' },
      's2': { phase_position: 'pending', attempt: 1, verdict: null },
    },
  });
  const r1 = run(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', seed]);
  assert.equal(r1.status, 0, r1.stderr);

  // Now patch only s2
  const patch = JSON.stringify({
    stories: { 's2': { phase_position: 'dispatched_impl', attempt: 2 } },
  });
  const r2 = run(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', patch]);
  assert.equal(r2.status, 0, r2.stderr);

  const out = JSON.parse(r2.stdout);
  const s1 = out.stories.find((s) => s.story_id === 's1');
  const s2 = out.stories.find((s) => s.story_id === 's2');

  // s1 unchanged
  assert.equal(s1.phase_position, 'done');
  assert.equal(s1.attempt, 1);
  assert.equal(s1.verdict, 'passed');

  // s2 updated
  assert.equal(s2.phase_position, 'dispatched_impl');
  assert.equal(s2.attempt, 2);
});

// ── Absence-tolerant (file does not exist) ────────────────────────────────────

test('write-state: creates cycle-state from scratch when file absent', () => {
  const file = path.join(os.tmpdir(), 'hermes-no-exist-' + Date.now(), 'nonexistent-epic.yaml');
  const patch = JSON.stringify({ gate_state: 'pre_approved' });

  const res = run(['write-state', '--epic', 'new-epic', '--cycle-state', file, '--patch', patch]);
  assert.equal(res.status, 0, res.stderr);

  const out = JSON.parse(res.stdout);
  assert.equal(out.gate_state, 'pre_approved');
  assert.equal(out.epic, 'new-epic');
  assert.ok(fs.existsSync(file), 'cycle-state file should have been created');
});

// ── No Multica creds required ─────────────────────────────────────────────────

test('write-state: succeeds with no Multica credentials in environment', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);
  const patch = JSON.stringify({ current_phase: 'dispatched_review' });

  const res = run(
    ['write-state', '--epic', 'local-epic', '--cycle-state', file, '--patch', patch],
    { ...process.env, MULTICA_SERVER_URL: '', MULTICA_TOKEN: '', MULTICA_WORKSPACE_ID: '' },
  );
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.current_phase, 'dispatched_review');
});

// ── Error cases ───────────────────────────────────────────────────────────────

test('write-state: missing --epic → MISSING_ARG', () => {
  const res = run(['write-state', '--patch', '{}']);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'MISSING_ARG');
  assert.match(err.message, /--epic/);
});

test('write-state: missing --patch → MISSING_ARG', () => {
  const res = run(['write-state', '--epic', 'my-epic']);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'MISSING_ARG');
  assert.match(err.message, /--patch/);
});

test('write-state: malformed JSON → INVALID_ARG', () => {
  const res = run(['write-state', '--epic', 'my-epic', '--patch', '{not json}']);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'INVALID_ARG');
});

test('write-state: JSON array patch → INVALID_ARG', () => {
  const res = run(['write-state', '--epic', 'my-epic', '--patch', '[1,2,3]']);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'INVALID_ARG');
});

test('write-state: stories as an array → INVALID_ARG, no partial write', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);
  const res = run(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', '{"stories":["x"]}']);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'INVALID_ARG');
  assert.match(err.message, /stories/);
  assert.ok(!fs.existsSync(file), 'no partial write should have occurred');
});

test('write-state: per-story patch that is not an object → INVALID_ARG, no partial write', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);
  const res = run(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', '{"stories":{"s1":"oops"}}']);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'INVALID_ARG');
  assert.match(err.message, /stories\.s1/);
  assert.ok(!fs.existsSync(file), 'no partial write should have occurred');
});

test('write-state: unknown top-level patch key → INVALID_ARG, no partial write', () => {
  const dir = tmpDir();
  const file = cycleStatePath(dir);
  const patch = JSON.stringify({ unknown_field: 'x', gate_state: 'pre_approved' });

  const res = run(['write-state', '--epic', 'ep', '--cycle-state', file, '--patch', patch]);
  assert.equal(res.status, 1);
  const err = JSON.parse(res.stderr);
  assert.equal(err.code, 'INVALID_ARG');
  assert.match(err.message, /unknown_field/);
  // No partial write: file should not exist
  assert.ok(!fs.existsSync(file), 'no partial write should have occurred');
});

// ── Help / listing ────────────────────────────────────────────────────────────

test('unknown command lists write-state alongside existing subcommands', () => {
  const res = run(['bogus-cmd-xyz'], {
    ...process.env,
    MULTICA_SERVER_URL: 'http://127.0.0.1:1',
    MULTICA_TOKEN: 'x',
    MULTICA_WORKSPACE_ID: 'x',
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /write-state/);
  assert.match(res.stderr, /epic-status/);
  assert.match(res.stderr, /comment/);
});
