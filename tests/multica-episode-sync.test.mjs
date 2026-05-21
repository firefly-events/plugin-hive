import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  pollTaskUntilTerminal,
  writeMulticaRunEpisode,
} from '../hive/lib/multica-story-dispatch/episode-sync.mjs';

const TOKEN = 'mul_test';
const WORKSPACE_ID = 'workspace-1';
const ISSUE_UUID = 'issue-1';

async function startMockMultica({
  activeSequence = [],
  runsSequence = [],
  messagesByTaskId = {},
  failActiveFirst = 0,
} = {}) {
  const calls = [];
  let activeCalls = 0;
  let runsCalls = 0;
  let remainingActiveFailures = failActiveFirst;

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push({ method: req.method, path: url.pathname, search: url.search });

    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      sendJson(res, 401, { error: 'bad token' });
      return;
    }
    if (url.searchParams.get('workspace_id') !== WORKSPACE_ID) {
      sendJson(res, 400, { error: 'workspace_id required' });
      return;
    }

    if (
      req.method === 'GET' &&
      url.pathname === `/api/issues/${ISSUE_UUID}/active-task`
    ) {
      activeCalls += 1;
      if (remainingActiveFailures > 0) {
        remainingActiveFailures -= 1;
        sendJson(res, 503, { error: 'temporary mul_secret outage' });
        return;
      }
      const index = Math.min(activeCalls - 1 - failActiveFirst, activeSequence.length - 1);
      sendJson(res, 200, activeSequence[index] ?? null);
      return;
    }

    if (
      req.method === 'GET' &&
      url.pathname === `/api/issues/${ISSUE_UUID}/task-runs`
    ) {
      runsCalls += 1;
      const index = Math.min(runsCalls - 1, runsSequence.length - 1);
      sendJson(res, 200, runsSequence[index] ?? { task_runs: [] });
      return;
    }

    const messagesMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/messages$/);
    if (req.method === 'GET' && messagesMatch) {
      sendJson(res, 200, { messages: messagesByTaskId[decodeURIComponent(messagesMatch[1])] ?? [] });
      return;
    }

    if (
      req.method === 'POST' &&
      url.pathname === `/api/issues/${ISSUE_UUID}/tasks/task-1/cancel`
    ) {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 500, { error: `unexpected ${req.method} ${req.url}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    calls,
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function task(status, overrides = {}) {
  return {
    id: 'task-1',
    status,
    started_at: '2026-05-21T00:00:00.000Z',
    completed_at: status === 'completed' || status === 'failed' ? '2026-05-21T00:00:01.000Z' : null,
    ...overrides,
  };
}

async function tempHiveState() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'hive-multica-episode-'));
}

function parseMarker(raw) {
  const out = { artifacts: [], multica: {} };
  let section = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line === 'artifacts:') {
      section = 'artifacts';
      continue;
    }
    if (line === 'multica:') {
      section = 'multica';
      continue;
    }
    if (section === 'artifacts' && line.startsWith('  - ')) {
      out.artifacts.push(JSON.parse(line.slice(4)));
      continue;
    }
    const match = line.match(/^( {2})?([^:]+): (.*)$/);
    assert.ok(match, `parseable marker line: ${line}`);
    const [, indent, key, rawValue] = match;
    const value =
      rawValue === 'null'
        ? null
        : rawValue.match(/^\d+$/)
          ? Number(rawValue)
          : rawValue.startsWith('"')
            ? JSON.parse(rawValue)
            : rawValue;
    if (indent && section === 'multica') out.multica[key] = value;
    else {
      section = null;
      out[key] = value;
    }
  }
  return out;
}

test('AC1: pollTaskUntilTerminal polls running twice then completed', async () => {
  const mock = await startMockMultica({
    activeSequence: [task('running'), task('running'), task('completed')],
    messagesByTaskId: { 'task-1': [{ role: 'assistant', content: 'done' }] },
  });
  try {
    const result = await pollTaskUntilTerminal({
      serverUrl: mock.serverUrl,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      issueUuid: ISSUE_UUID,
      storyId: 'story-1',
      pollIntervalMs: 1,
      maxWallClockMs: 500,
    });
    assert.equal(result.status, 'completed');
    assert.equal(mock.calls.filter((call) => call.path.endsWith('/active-task')).length, 3);
    assert.deepEqual(result.messages, [{ role: 'assistant', content: 'done' }]);
  } finally {
    await mock.close();
  }
});

test("AC2: pollTaskUntilTerminal returns failed task notes and messages", async () => {
  const mock = await startMockMultica({
    activeSequence: [task('failed', { error: 'OOM' })],
    runsSequence: [{ task_runs: [task('failed', { error: 'OOM' })] }],
    messagesByTaskId: { 'task-1': [{ level: 'error', content: 'OOM' }] },
  });
  try {
    const result = await pollTaskUntilTerminal({
      serverUrl: mock.serverUrl,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      issueUuid: ISSUE_UUID,
      storyId: 'story-1',
      pollIntervalMs: 1,
      maxWallClockMs: 500,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.notes, 'OOM');
    assert.deepEqual(result.messages, [{ level: 'error', content: 'OOM' }]);
  } finally {
    await mock.close();
  }
});

test('AC3: pollTaskUntilTerminal times out and cancels active task', async () => {
  const mock = await startMockMultica({ activeSequence: [task('running')] });
  try {
    const result = await pollTaskUntilTerminal({
      serverUrl: mock.serverUrl,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      issueUuid: ISSUE_UUID,
      storyId: 'story-1',
      pollIntervalMs: 10,
      maxWallClockMs: 50,
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.notes, 'timeout after 0.05s');
    assert.equal(
      mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/cancel')).length,
      1,
    );
  } finally {
    await mock.close();
  }
});

test('AC4: onStateTransition fires for queued to running to completed', async () => {
  const transitions = [];
  const mock = await startMockMultica({
    activeSequence: [task('queued'), task('running'), task('completed')],
  });
  try {
    await pollTaskUntilTerminal({
      serverUrl: mock.serverUrl,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      issueUuid: ISSUE_UUID,
      storyId: 'story-1',
      pollIntervalMs: 1,
      maxWallClockMs: 500,
      onStateTransition: (prev, next) => transitions.push([prev, next]),
    });
    assert.deepEqual(transitions, [
      ['queued', 'running'],
      ['running', 'completed'],
    ]);
  } finally {
    await mock.close();
  }
});

test('AC5: writeMulticaRunEpisode writes parseable marker and messages sidecar', async () => {
  const hiveStateDir = await tempHiveState();
  try {
    const result = await writeMulticaRunEpisode({
      hiveStateDir,
      epicHandle: 'epic-1',
      storyId: 'story-1',
      issueUuid: ISSUE_UUID,
      identifier: 'plugin-hive/PLU-42',
      terminal: {
        status: 'completed',
        notes: 'all good',
        messages: [{ role: 'assistant', content: 'done' }],
        task_id: 'task-1',
        agent_id: 'agent-1',
        agent_name: 'developer',
        work_dir: '/tmp/work',
        attempts: 2,
        started_at: '2026-05-21T00:00:00.000Z',
        completed_at: '2026-05-21T00:01:00.000Z',
      },
    });
    assert.equal(result.status, 'passed');
    const marker = parseMarker(await fs.readFile(result.markerPath, 'utf8'));
    assert.equal(marker.step, 'multica-run');
    assert.equal(marker.story, 'story-1');
    assert.equal(marker.epic, 'epic-1');
    assert.equal(marker.agent, 'developer');
    assert.equal(marker.status, 'passed');
    assert.equal(marker.started_at, '2026-05-21T00:00:00.000Z');
    assert.equal(marker.completed_at, '2026-05-21T00:01:00.000Z');
    assert.equal(marker.multica.issue_id, 'plugin-hive/PLU-42');
    assert.equal(marker.multica.issue_uuid, ISSUE_UUID);
    assert.equal(marker.multica.task_id, 'task-1');
    assert.equal(marker.multica.agent_id, 'agent-1');
    assert.equal(marker.multica.work_dir, '/tmp/work');
    assert.equal(marker.multica.attempts, 2);
    assert.equal(marker.notes, 'all good');
    const sidecar = await fs.readFile(result.messagesPath, 'utf8');
    assert.match(sidecar, /"content":"done"/);
  } finally {
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC6: writeMulticaRunEpisode truncates messages to last N with note indicator', async () => {
  const hiveStateDir = await tempHiveState();
  try {
    const messages = Array.from({ length: 250 }, (_, index) => ({ index }));
    const result = await writeMulticaRunEpisode({
      hiveStateDir,
      epicHandle: 'epic-1',
      storyId: 'story-1',
      issueUuid: ISSUE_UUID,
      identifier: 'plugin-hive/PLU-42',
      messagesCaptureMax: 200,
      terminal: { status: 'completed', notes: 'done', messages },
    });
    const lines = (await fs.readFile(result.messagesPath, 'utf8')).trim().split(/\r?\n/);
    assert.equal(lines.length, 200);
    assert.equal(JSON.parse(lines[0]).index, 50);
    assert.equal(JSON.parse(lines.at(-1)).index, 249);
    assert.match(result.notes, /truncated to 200 of 250/);
    assert.match(await fs.readFile(result.markerPath, 'utf8'), /truncated to 200 of 250/);
  } finally {
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC7: pollTaskUntilTerminal tolerates two transient failures and throws on three', async () => {
  const recovers = await startMockMultica({
    failActiveFirst: 2,
    activeSequence: [task('completed')],
  });
  try {
    const result = await pollTaskUntilTerminal({
      serverUrl: recovers.serverUrl,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      issueUuid: ISSUE_UUID,
      storyId: 'story-1',
      pollIntervalMs: 1,
      maxWallClockMs: 500,
    });
    assert.equal(result.status, 'completed');
  } finally {
    await recovers.close();
  }

  const fails = await startMockMultica({
    failActiveFirst: 3,
    activeSequence: [task('completed')],
  });
  try {
    await assert.rejects(
      () =>
        pollTaskUntilTerminal({
          serverUrl: fails.serverUrl,
          token: TOKEN,
          workspaceId: WORKSPACE_ID,
          issueUuid: ISSUE_UUID,
          storyId: 'story-1',
          pollIntervalMs: 1,
          maxWallClockMs: 500,
        }),
      (error) => error.code === 'TRANSPORT' && !error.message.includes(TOKEN),
    );
  } finally {
    await fails.close();
  }
});
