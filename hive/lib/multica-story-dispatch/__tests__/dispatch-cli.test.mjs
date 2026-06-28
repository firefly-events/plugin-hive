import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const ISSUE_UUID = '11111111-2222-3333-4444-555555555555';

async function startMockServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
      try {
        await handler(req, res, body);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function runCli(argv, serverUrl) {
  const env = {
    ...process.env,
    MULTICA_SERVER_URL: serverUrl,
    MULTICA_TOKEN: 'test-token',
    MULTICA_WORKSPACE_ID: 'test-ws',
  };
  return execFileAsync('node', [CLI, ...argv], { env });
}

test('dispatch: freshly assigned issue returns {status, issue_id, task_id}', async () => {
  let getCount = 0;
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}`) {
      if (req.method === 'GET') {
        getCount++;
        // First GET (already-dispatched check) returns todo. Second GET (moveOutOfBacklog) returns todo too.
        sendJson(res, 200, { id: ISSUE_UUID, status: 'todo', assignee_id: null });
        return;
      }
      if (req.method === 'PUT') {
        sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress', assignee_type: 'agent', assignee_id: 'agent-dev-uuid' });
        return;
      }
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 200, { task: { id: 'task-abc-123', status: 'running', started_at: '2026-01-01T00:00:00Z' } });
      return;
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [] });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    const { stdout } = await runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'dispatched');
    assert.equal(result.issue_id, ISSUE_UUID);
    assert.equal(result.task_id, 'task-abc-123');
  } finally {
    await close();
  }
});

test('dispatch: already_dispatched idempotent call returns {status, issue_id, task_id}', async () => {
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}` && req.method === 'GET') {
      sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress', assignee_id: 'agent-dev-uuid', assignee_type: 'agent' });
      return;
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 200, { task: { id: 'task-existing-456', status: 'running', started_at: '2026-01-01T00:00:00Z' } });
      return;
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [] });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    const { stdout } = await runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'already_dispatched');
    assert.equal(result.issue_id, ISSUE_UUID);
    assert.equal(result.task_id, 'task-existing-456');
  } finally {
    await close();
  }
});

test('dispatch: task_id is null when active-task returns no task', async () => {
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}`) {
      if (req.method === 'GET') {
        sendJson(res, 200, { id: ISSUE_UUID, status: 'todo', assignee_id: null });
        return;
      }
      if (req.method === 'PUT') {
        sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress' });
        return;
      }
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 200, {});
      return;
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [] });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    const { stdout } = await runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'dispatched');
    assert.equal(result.issue_id, ISSUE_UUID);
    assert.equal(result.task_id, null);
  } finally {
    await close();
  }
});

test('dispatch: task_id is null when status lookup throws (best-effort)', async () => {
  let dispatchDone = false;
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}`) {
      if (req.method === 'GET') {
        sendJson(res, 200, { id: ISSUE_UUID, status: 'todo', assignee_id: null });
        return;
      }
      if (req.method === 'PUT') {
        dispatchDone = true;
        sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress' });
        return;
      }
    }

    // active-task and task-runs return 500 to simulate lookup failure
    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 500, { error: 'transient error' });
      return;
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 500, { error: 'transient error' });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    const { stdout } = await runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'dispatched');
    assert.equal(result.task_id, null, 'task_id must be null when status lookup fails (best-effort)');
    assert.ok(dispatchDone, 'dispatch PUT must still have been called');
  } finally {
    await close();
  }
});

test('dispatch: in_progress issue assigned to a DIFFERENT agent reassigns (not already_dispatched)', async () => {
  let putCalled = false;
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}`) {
      if (req.method === 'GET') {
        // Already in_progress, but assigned to a DIFFERENT agent than requested.
        sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress', assignee_id: 'agent-OTHER-uuid', assignee_type: 'agent' });
        return;
      }
      if (req.method === 'PUT') {
        putCalled = true;
        sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress', assignee_type: 'agent', assignee_id: 'agent-dev-uuid' });
        return;
      }
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 200, { task: { id: 'task-reassigned-789', status: 'running', started_at: '2026-01-01T00:00:00Z' } });
      return;
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [] });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    const { stdout } = await runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'dispatched', 'different assignee must reassign, not no-op');
    assert.equal(result.task_id, 'task-reassigned-789');
    assert.ok(putCalled, 'reassignment PUT must have been issued');
  } finally {
    await close();
  }
});

test('dispatch: spent issue (terminal task) without --rerun fails STALE_TERMINAL_TASK', async () => {
  let putCalled = false;
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}`) {
      if (req.method === 'GET') {
        // Not in_progress — a done issue whose run already finished.
        sendJson(res, 200, { id: ISSUE_UUID, status: 'done', assignee_type: 'agent', assignee_id: 'agent-dev-uuid' });
        return;
      }
      if (req.method === 'PUT') {
        putCalled = true; // must NOT happen
        sendJson(res, 200, { id: ISSUE_UUID });
        return;
      }
    }

    // The latest task is terminal → re-dispatch would no-op.
    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 200, {});
      return;
    }
    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [{ id: 'task-old-terminal', status: 'completed', completed_at: '2026-01-01T00:00:00Z' }] });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    await assert.rejects(
      runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl),
      (err) => {
        assert.equal(err.code, 1);
        const parsed = JSON.parse(err.stderr);
        assert.equal(parsed.code, 'STALE_TERMINAL_TASK');
        assert.match(parsed.message, /--rerun/);
        return true;
      },
    );
    assert.equal(putCalled, false, 'no assignment PUT may fire when the guard trips');
  } finally {
    await close();
  }
});

test('dispatch: in_progress + same assignee but terminal latest task is NOT already_dispatched', async () => {
  // The guard must run before the idempotency short-circuit: a finished run can leave
  // the issue in_progress with the same assignee, and that must not report success.
  let putCalled = false;
  const { serverUrl, close } = await startMockServer((req, res) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }
    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}` && req.method === 'GET') {
      sendJson(res, 200, { id: ISSUE_UUID, status: 'in_progress', assignee_type: 'agent', assignee_id: 'agent-dev-uuid' });
      return;
    }
    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      sendJson(res, 200, { task: { id: 'task-done-1', status: 'completed', started_at: '2026-01-01T00:00:00Z' } });
      return;
    }
    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [] });
      return;
    }
    if (req.method === 'PUT') { putCalled = true; sendJson(res, 200, { id: ISSUE_UUID }); return; }
    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    await assert.rejects(
      runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer'], serverUrl),
      (err) => {
        assert.equal(err.code, 1);
        assert.equal(JSON.parse(err.stderr).code, 'STALE_TERMINAL_TASK');
        return true;
      },
    );
    assert.equal(putCalled, false, 'must not no-op as already_dispatched when the latest task is terminal');
  } finally {
    await close();
  }
});

test('dispatch: spent issue with --rerun resets and reports redispatched with a fresh task_id', async () => {
  let resetSeen = false;
  let assignSeen = false;
  let activeTaskCalls = 0;
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    const ws = 'workspace_id=test-ws';

    if (req.method === 'GET' && req.url === `/api/agents?${ws}`) {
      sendJson(res, 200, { agents: [{ id: 'agent-dev-uuid', name: 'developer' }] });
      return;
    }

    if (req.url === `/api/issues/${ISSUE_UUID}?${ws}`) {
      if (req.method === 'GET') {
        sendJson(res, 200, { id: ISSUE_UUID, status: 'done', assignee_type: 'agent', assignee_id: 'agent-dev-uuid' });
        return;
      }
      if (req.method === 'PUT') {
        if (body && body.assignee_id === null && body.status === 'todo') resetSeen = true;
        else if (body && body.assignee_id === 'agent-dev-uuid') assignSeen = true;
        sendJson(res, 200, { id: ISSUE_UUID });
        return;
      }
    }

    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/active-task?${ws}`) {
      activeTaskCalls++;
      // First read (guard) → stale terminal. After reset+assign → a fresh running task.
      if (activeTaskCalls === 1) {
        sendJson(res, 200, { task: { id: 'task-old-terminal', status: 'completed', started_at: '2026-01-01T00:00:00Z' } });
      } else {
        sendJson(res, 200, { task: { id: 'task-fresh-999', status: 'running', started_at: '2026-02-02T00:00:00Z' } });
      }
      return;
    }
    if (req.method === 'GET' && req.url === `/api/issues/${ISSUE_UUID}/task-runs?${ws}`) {
      sendJson(res, 200, { task_runs: [] });
      return;
    }

    sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` });
  });

  try {
    const { stdout } = await runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer', '--rerun'], serverUrl);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'redispatched');
    assert.equal(result.issue_id, ISSUE_UUID);
    assert.equal(result.task_id, 'task-fresh-999', 'must report the fresh task, not the stale terminal one');
    assert.ok(resetSeen, 'a reset PUT (assignee cleared + status todo) must fire');
    assert.ok(assignSeen, 'an assignment PUT must fire after reset');
  } finally {
    await close();
  }
});

test('dispatch: --agent and --squad together → INVALID_ARG (mutually exclusive)', async () => {
  await assert.rejects(
    runCli(['dispatch', '--issue', ISSUE_UUID, '--agent', 'developer', '--squad', 'planning'], 'http://127.0.0.1:1'),
    (err) => {
      assert.equal(err.code, 1);
      const parsed = JSON.parse(err.stderr);
      assert.equal(parsed.code, 'INVALID_ARG');
      assert.match(parsed.message, /mutually exclusive/);
      return true;
    },
  );
});
