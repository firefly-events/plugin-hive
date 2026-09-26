import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));

// Dummy creds so commands NOT in NO_CONFIG pass requireConfig and reach their
// own arg validation before any network call. epic-status ignores these.
const DUMMY_ENV = {
  ...process.env,
  MULTICA_SERVER_URL: 'http://127.0.0.1:1',
  MULTICA_TOKEN: 'test-token',
  MULTICA_WORKSPACE_ID: 'test-ws',
};

function run(argv, env = DUMMY_ENV) {
  const res = spawnSync('node', [CLI, ...argv], { encoding: 'utf8', env });
  return res;
}

function writeCycleState(reconciler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-cli-test-'));
  const file = path.join(dir, 'epic.yaml');
  const lines = ['epic_id: demo-epic', 'hermes_reconciler:'];
  for (const [k, v] of Object.entries(reconciler)) {
    if (k === 'stories') continue;
    lines.push(`  ${k}: ${v === null ? 'null' : v}`);
  }
  lines.push('  stories:');
  for (const [sid, s] of Object.entries(reconciler.stories || {})) {
    lines.push(`    ${sid}:`);
    for (const [k, v] of Object.entries(s)) {
      lines.push(`      ${k}: ${v === null ? 'null' : typeof v === 'string' ? `"${v}"` : v}`);
    }
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

test('epic-status: rolls up per-story phase_position/attempt/verdict + epic phase', () => {
  const file = writeCycleState({
    gate_state: 'pre_approved',
    in_flight_story_id: 's2',
    in_flight_task_id: 'task-xyz',
    current_phase: 'dispatched_impl',
    stories: {
      s1: { phase_position: 'done', attempt: 1, verdict: 'passed' },
      s2: { phase_position: 'dispatched_impl', attempt: 2, verdict: null },
    },
  });

  const res = run(['epic-status', '--epic', 'demo-epic', '--cycle-state', file], process.env);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);

  assert.equal(out.epic, 'demo-epic');
  assert.equal(out.gate_state, 'pre_approved');
  assert.equal(out.current_phase, 'dispatched_impl');
  assert.equal(out.in_flight_story_id, 's2');
  assert.equal(out.in_flight_task_id, 'task-xyz');
  assert.equal(out.stories.length, 2);

  const s1 = out.stories.find((s) => s.story_id === 's1');
  assert.deepEqual(s1, { story_id: 's1', phase_position: 'done', attempt: 1, verdict: 'passed' });
  const s2 = out.stories.find((s) => s.story_id === 's2');
  assert.equal(s2.phase_position, 'dispatched_impl');
  assert.equal(s2.attempt, 2);
  assert.equal(s2.verdict, null);
});

test('epic-status: missing cycle-state file → safe defaults, empty stories (no creds needed)', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-hermes', 'nope.yaml');
  // Pass an env with NO Multica creds to prove epic-status is local-only.
  const res = run(['epic-status', '--epic', 'ghost', '--cycle-state', missing], {
    ...process.env,
    MULTICA_SERVER_URL: '',
    MULTICA_TOKEN: '',
    MULTICA_WORKSPACE_ID: '',
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.epic, 'ghost');
  assert.equal(out.gate_state, null);
  assert.deepEqual(out.stories, []);
});

test('epic-status: missing --epic → MISSING_ARG', () => {
  const res = run(['epic-status'], process.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /MISSING_ARG/);
  assert.match(res.stderr, /--epic/);
});

test('comment: missing --issue → MISSING_ARG (before any network call)', () => {
  const res = run(['comment', '--body', 'hello']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /MISSING_ARG/);
  assert.match(res.stderr, /--issue/);
});

test('comment: missing --body → MISSING_ARG', () => {
  const res = run(['comment', '--issue', '11111111-2222-3333-4444-555555555555']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /MISSING_ARG/);
  assert.match(res.stderr, /--body/);
});

test('comment: non-UUID --issue → INVALID_ARG', () => {
  const res = run(['comment', '--issue', 'not-a-uuid', '--body', 'x']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /INVALID_ARG/);
});

// Uses async spawn (NOT spawnSync) so the in-process capture server's event
// loop stays free to accept the child cli's connection.
function runAsync(argv, env) {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI, ...argv], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('comment: POST URL carries workspace_id (server requires workspace scoping)', async () => {
  const http = await import('node:http');
  let captured = null;
  const server = http.createServer((req, res) => {
    captured = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'comment-123' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await runAsync(
      ['comment', '--issue', '11111111-2222-3333-4444-555555555555', '--body', 'hello'],
      {
        ...process.env,
        MULTICA_SERVER_URL: `http://127.0.0.1:${port}`,
        MULTICA_TOKEN: 'test-token',
        MULTICA_WORKSPACE_ID: 'ws-abc',
      },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(captured, /\/api\/issues\/11111111-2222-3333-4444-555555555555\/comments\?/);
    assert.match(captured, /workspace_id=ws-abc/);
    assert.deepEqual(JSON.parse(res.stdout), { comment_id: 'comment-123' });
  } finally {
    server.close();
  }
});

test('unknown command lists the two new subcommands', () => {
  const res = run(['bogus-cmd']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /epic-status\|comment/);
});
