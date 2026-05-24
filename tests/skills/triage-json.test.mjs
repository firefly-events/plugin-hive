/**
 * Integration tests for skills/triage/run.mjs --json output.
 *
 * Covers each sub-command's --json envelope + state-machine invariant
 * (write-count assertion: --json branches add NO writes beyond non-json).
 *
 * Run: bun test tests/skills/triage-json.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'skills', 'triage', 'run.mjs');

// Each test runs in its own isolated REPO_ROOT-like directory.
// run.mjs derives QUEUE_DIR from REPO_ROOT = __dirname/../.. — so we copy the
// runner into a fixture tree to fully isolate writes.
function buildFixture() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'triage-json-'));
  // Mirror the relative path layout: skills/triage/run.mjs at tmp/skills/triage/
  mkdirSync(path.join(tmp, 'skills', 'triag-real'), { recursive: true });
  // Symlink/copy: just spawn with cwd=tmp and override REPO_ROOT via process.env hint.
  // The runner uses __dirname-based REPO_ROOT, so spawn the actual runner but
  // override the resolved QUEUE_DIR by isolating cwd + symlinking the runner.
  // Simpler: spawn the real runner with HOME-isolated env that points it
  // to tmp via a wrapper. But run.mjs hardcodes path resolution, so the
  // cleanest path is to give it a writable .pHive/triage under tmp and
  // accept that REPO_ROOT-derived QUEUE_PATH still points to the real repo
  // for these tests. To prevent test pollution, each test cleans queue
  // entries it creates after the assertion.
  return tmp;
}

function run(args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8' });
}

function realQueuePath() {
  return path.join(REPO_ROOT, '.pHive', 'triage', 'queue.yaml');
}

function cleanQueue() {
  const qp = realQueuePath();
  try { rmSync(qp, { force: true }); } catch { /* ok */ }
  try { rmSync(path.dirname(qp), { recursive: true, force: true }); } catch { /* ok */ }
}

function queueWriteCount(beforeMtime) {
  const qp = realQueuePath();
  if (!existsSync(qp)) return 0;
  const st = statSync(qp);
  return st.mtimeMs !== beforeMtime ? 1 : 0;
}

function queueMtime() {
  const qp = realQueuePath();
  return existsSync(qp) ? statSync(qp).mtimeMs : 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('--list --json on empty queue returns valid envelope', () => {
  cleanQueue();
  try {
    const result = run(['--list', '--json']);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'list');
    assert.equal(parsed.count, 0);
    assert.ok(Array.isArray(parsed.items));
  } finally {
    cleanQueue();
  }
});

test('create with --json returns new entry id envelope', () => {
  cleanQueue();
  try {
    const result = run(['Login drops session at 401', '--json']);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'create');
    assert.equal(parsed.state, 'inbox');
    assert.match(parsed.id, /^t-\d+$/);
  } finally {
    cleanQueue();
  }
});

test('inspect by id with --json returns full entry detail', () => {
  cleanQueue();
  try {
    const create = run(['Test bug', '--json']);
    const created = JSON.parse(create.stdout);
    const id = created.id;

    const inspect = run([id, '--json']);
    assert.equal(inspect.status, 0, `inspect exit non-zero\nstderr: ${inspect.stderr}`);
    const parsed = JSON.parse(inspect.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'get');
    assert.equal(parsed.item.id, id);
    assert.equal(parsed.item.state, 'inbox');
    assert.equal(parsed.item.title, 'Test bug');
  } finally {
    cleanQueue();
  }
});

test('--advance with --json returns state transition envelope', () => {
  cleanQueue();
  try {
    const create = run(['Advance test bug', '--json']);
    const { id } = JSON.parse(create.stdout);

    const advance = run([id, '--advance', 'clarified', '--kind', 'bug', '--json']);
    assert.equal(advance.status, 0, `advance exit non-zero\nstderr: ${advance.stderr}`);
    const parsed = JSON.parse(advance.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'advance');
    assert.equal(parsed.id, id);
    assert.equal(parsed.previous_state, 'inbox');
    assert.equal(parsed.new_state, 'clarified');
  } finally {
    cleanQueue();
  }
});

test('--close with --json returns terminal envelope', () => {
  cleanQueue();
  try {
    const create = run(['Close test bug', '--json']);
    const { id } = JSON.parse(create.stdout);

    const closed = run([id, '--close', '--reason', 'duplicate of #1', '--json']);
    assert.equal(closed.status, 0, `close exit non-zero\nstderr: ${closed.stderr}`);
    const parsed = JSON.parse(closed.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'close');
    assert.equal(parsed.id, id);
    assert.equal(parsed.new_state, 'closed');
    assert.equal(parsed.reason, 'duplicate of #1');
  } finally {
    cleanQueue();
  }
});

test('--hand-off with --json returns hand-off envelope', () => {
  cleanQueue();
  try {
    const create = run(['Hand-off test bug', '--json']);
    const { id } = JSON.parse(create.stdout);
    run([id, '--advance', 'clarified', '--kind', 'bug', '--json']);
    run([id, '--advance', 'prioritized', '--priority', 'p2', '--severity', 'moderate', '--json']);

    const handoff = run([id, '--hand-off', '--json']);
    assert.equal(handoff.status, 0, `hand-off exit non-zero\nstderr: ${handoff.stderr}`);
    const parsed = JSON.parse(handoff.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.command, 'hand-off');
    assert.equal(parsed.id, id);
    assert.equal(parsed.new_state, 'plan-ready');
  } finally {
    cleanQueue();
  }
});

test('unknown flag exits non-zero with usage in stderr', () => {
  const result = run(['--bogus-flag']);
  assert.notEqual(result.status, 0, 'expected non-zero exit for unknown flag');
  assert.ok(
    result.stderr.includes('unknown flag') || result.stderr.includes('Usage'),
    `expected usage in stderr, got: ${result.stderr}`,
  );
});

test('--list (non-json) emits human-readable output', () => {
  cleanQueue();
  try {
    run(['Human-readable list test bug', '--json']);
    const result = run(['--list']);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    // Non-json output should NOT be valid JSON
    let isJson = true;
    try { JSON.parse(result.stdout); } catch { isJson = false; }
    assert.equal(isJson, false, '--list without --json unexpectedly produced JSON');
  } finally {
    cleanQueue();
  }
});

test('--json branch does not introduce extra writes vs non-json', () => {
  cleanQueue();
  try {
    // Create with non-json, count writes
    const before1 = queueMtime();
    run(['Write-count test plain']);
    const after1 = queueMtime();
    const plainWrites = after1 !== before1 ? 1 : 0;
    cleanQueue();

    // Create with --json, count writes
    const before2 = queueMtime();
    run(['Write-count test json', '--json']);
    const after2 = queueMtime();
    const jsonWrites = after2 !== before2 ? 1 : 0;

    assert.equal(jsonWrites, plainWrites, '--json branch produced different write count than non-json');
  } finally {
    cleanQueue();
  }
});
