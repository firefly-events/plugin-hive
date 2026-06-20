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
