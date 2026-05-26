/**
 * Integration tests for skills/triage/run.mjs --json output.
 *
 * Covers each sub-command's --json envelope + state-machine invariant
 * (write-count assertion: --json branches add NO writes beyond non-json).
 *
 * Run: bun test tests/skills/triage-json.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'skills', 'triage', 'run.mjs');

// Each test gets its own tmp queue dir via HIVE_TRIAGE_QUEUE_DIR. The runner
// honors that env var when set, so writes never touch the real repo queue.
function mkQueueDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'triage-json-'));
}

function run(args, queueDir) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HIVE_TRIAGE_QUEUE_DIR: queueDir },
  });
}

function queuePath(queueDir) {
  return path.join(queueDir, 'queue.yaml');
}

function cleanQueue(queueDir) {
  try { rmSync(queueDir, { recursive: true, force: true }); } catch { /* ok */ }
}

function queueMtime(queueDir) {
  const qp = queuePath(queueDir);
  return existsSync(qp) ? statSync(qp).mtimeMs : 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('--list --json on empty queue returns valid envelope', () => {
  const qd = mkQueueDir();
  try {
    const result = run(['--list', '--json'], qd);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'list');
    assert.equal(parsed.count, 0);
    assert.ok(Array.isArray(parsed.items));
  } finally {
    cleanQueue(qd);
  }
});

test('create with --json returns new entry id envelope', () => {
  const qd = mkQueueDir();
  try {
    const result = run(['Login drops session at 401', '--json'], qd);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'create');
    assert.equal(parsed.state, 'inbox');
    assert.match(parsed.id, /^t-\d+$/);
  } finally {
    cleanQueue(qd);
  }
});

test('inspect by id with --json returns full entry detail', () => {
  const qd = mkQueueDir();
  try {
    const create = run(['Test bug', '--json'], qd);
    const created = JSON.parse(create.stdout);
    const id = created.id;

    const inspect = run([id, '--json'], qd);
    assert.equal(inspect.status, 0, `inspect exit non-zero\nstderr: ${inspect.stderr}`);
    const parsed = JSON.parse(inspect.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'get');
    assert.equal(parsed.item.id, id);
    assert.equal(parsed.item.state, 'inbox');
    assert.equal(parsed.item.title, 'Test bug');
  } finally {
    cleanQueue(qd);
  }
});

test('--advance with --json returns state transition envelope', () => {
  const qd = mkQueueDir();
  try {
    const create = run(['Advance test bug', '--json'], qd);
    const { id } = JSON.parse(create.stdout);

    const advance = run([id, '--advance', 'clarified', '--kind', 'bug', '--json'], qd);
    assert.equal(advance.status, 0, `advance exit non-zero\nstderr: ${advance.stderr}`);
    const parsed = JSON.parse(advance.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'advance');
    assert.equal(parsed.id, id);
    assert.equal(parsed.previous_state, 'inbox');
    assert.equal(parsed.new_state, 'clarified');
  } finally {
    cleanQueue(qd);
  }
});

test('--close with --json returns terminal envelope', () => {
  const qd = mkQueueDir();
  try {
    const create = run(['Close test bug', '--json'], qd);
    const { id } = JSON.parse(create.stdout);

    const closed = run([id, '--close', '--reason', 'duplicate of #1', '--json'], qd);
    assert.equal(closed.status, 0, `close exit non-zero\nstderr: ${closed.stderr}`);
    const parsed = JSON.parse(closed.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'close');
    assert.equal(parsed.id, id);
    assert.equal(parsed.new_state, 'closed');
    assert.equal(parsed.reason, 'duplicate of #1');
  } finally {
    cleanQueue(qd);
  }
});

test('--hand-off with --json returns hand-off envelope', () => {
  const qd = mkQueueDir();
  try {
    const create = run(['Hand-off test bug', '--json'], qd);
    const { id } = JSON.parse(create.stdout);
    run([id, '--advance', 'clarified', '--kind', 'bug', '--json'], qd);
    run([id, '--advance', 'prioritized', '--priority', 'p2', '--severity', 'moderate', '--json'], qd);

    const handoff = run([id, '--hand-off', '--json'], qd);
    assert.equal(handoff.status, 0, `hand-off exit non-zero\nstderr: ${handoff.stderr}`);
    const parsed = JSON.parse(handoff.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'hand-off');
    assert.equal(parsed.id, id);
    assert.equal(parsed.new_state, 'plan-ready');
  } finally {
    cleanQueue(qd);
  }
});

test('unknown flag exits non-zero with usage in stderr', () => {
  const qd = mkQueueDir();
  try {
    const result = run(['--bogus-flag'], qd);
    assert.notEqual(result.status, 0, 'expected non-zero exit for unknown flag');
    assert.ok(
      result.stderr.includes('unknown flag') || result.stderr.includes('Usage'),
      `expected usage in stderr, got: ${result.stderr}`,
    );
  } finally {
    cleanQueue(qd);
  }
});

test('--list (non-json) emits human-readable output', () => {
  const qd = mkQueueDir();
  try {
    run(['Human-readable list test bug', '--json'], qd);
    const result = run(['--list'], qd);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    // Non-json output should NOT be valid JSON
    let isJson = true;
    try { JSON.parse(result.stdout); } catch { isJson = false; }
    assert.equal(isJson, false, '--list without --json unexpectedly produced JSON');
  } finally {
    cleanQueue(qd);
  }
});

test('--json branch does not introduce extra writes vs non-json', () => {
  const qdA = mkQueueDir();
  const qdB = mkQueueDir();
  try {
    // Create with non-json, count writes
    const before1 = queueMtime(qdA);
    run(['Write-count test plain'], qdA);
    const after1 = queueMtime(qdA);
    const plainWrites = after1 !== before1 ? 1 : 0;

    // Create with --json, count writes (fresh dir — no cross-contamination)
    const before2 = queueMtime(qdB);
    run(['Write-count test json', '--json'], qdB);
    const after2 = queueMtime(qdB);
    const jsonWrites = after2 !== before2 ? 1 : 0;

    assert.equal(jsonWrites, plainWrites, '--json branch produced different write count than non-json');
  } finally {
    cleanQueue(qdA);
    cleanQueue(qdB);
  }
});

test('mutually exclusive sub-commands rejected (e.g. --advance + --close)', () => {
  const qd = mkQueueDir();
  try {
    const create = run(['Mutex test', '--json'], qd);
    const { id } = JSON.parse(create.stdout);

    const result = run([id, '--advance', 'clarified', '--close'], qd);
    assert.notEqual(result.status, 0, 'expected non-zero exit for conflicting sub-commands');
    assert.ok(
      result.stderr.includes('mutually exclusive'),
      `expected mutex error in stderr, got: ${result.stderr}`,
    );
  } finally {
    cleanQueue(qd);
  }
});
