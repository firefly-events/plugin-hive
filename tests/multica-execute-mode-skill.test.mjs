import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __resetCache,
  dispatchStoryToAgent,
  ensureIssueBriefMatches,
  moveOutOfBacklogIfNeeded,
  resolveAgentUuidByName,
  serializeStoryBrief,
} from '../hive/lib/multica-story-dispatch/index.mjs';

const TOKEN = 'mul_test';
const WORKSPACE_ID = 'workspace-1';
const WORKSPACE_SLUG = 'plugin-hive';
const EPIC = 'multica-execute-routing';

test.beforeEach(() => {
  __resetCache();
});

async function startMockMultica({
  agents = [{ id: 'agent-developer-1', name: 'developer' }],
  issues = [],
  terminalByIssueUuid = {},
} = {}) {
  const calls = [];
  let nextIssue = 1;
  const issueMap = new Map();

  for (const issue of issues) {
    issueMap.set(issue.id, {
      identifier: `PLU-${nextIssue++}`,
      title: 'Existing issue',
      description: '',
      status: 'todo',
      labels: [],
      ...issue,
    });
  }

  function listIssues(identifier) {
    const all = [...issueMap.values()];
    return identifier ? all.filter((issue) => issue.identifier === identifier) : all;
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
      const url = new URL(req.url, 'http://127.0.0.1');
      calls.push({ method: req.method, path: url.pathname, search: url.search, body });

      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        sendJson(res, 401, { error: 'bad token' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/workspaces') {
        sendJson(res, 200, [{ id: WORKSPACE_ID, slug: WORKSPACE_SLUG }]);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/agents') {
        sendJson(res, 200, agents);
        return;
      }

      if (url.searchParams.get('workspace_id') !== WORKSPACE_ID) {
        sendJson(res, 400, { error: 'workspace_id required' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/issues') {
        sendJson(res, 200, listIssues(url.searchParams.get('identifier')));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/issues') {
        const number = nextIssue++;
        const issue = {
          id: `issue-${number}`,
          identifier: `PLU-${number}`,
          title: body.title,
          description: body.description ?? '',
          status: body.status ?? 'todo',
          labels: body.labels ?? [],
          parent_issue_id: body.parent_issue_id ?? null,
        };
        issueMap.set(issue.id, issue);
        sendJson(res, 201, issue);
        return;
      }

      const issueMatch = url.pathname.match(/^\/api\/issues\/([^/]+)$/);
      if (issueMatch) {
        const issueUuid = decodeURIComponent(issueMatch[1]);
        const issue = issueMap.get(issueUuid);
        if (!issue) {
          sendJson(res, 404, { error: 'issue not found' });
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 200, issue);
          return;
        }
        if (req.method === 'PUT') {
          Object.assign(issue, body);
          sendJson(res, 200, issue);
          return;
        }
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
        const issueUuid = decodeURIComponent(url.pathname.split('/').pop());
        sendJson(res, 200, terminalByIssueUuid[issueUuid] ?? { status: 'completed' });
        return;
      }

      sendJson(res, 500, { error: `unexpected ${req.method} ${req.url}` });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    calls,
    issues: issueMap,
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function createTempHiveState() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'hive-multica-execute-'));
}

function story(overrides = {}) {
  return {
    id: 'story-1',
    title: 'Implement Multica dispatch',
    description: 'Dispatch one Hive story to a Multica developer agent.',
    acceptance_criteria: ['assigns the issue', 'writes an episode marker'],
    depends_on: [],
    ...overrides,
  };
}

function parseTrackerId(trackerId) {
  const match = String(trackerId ?? '').match(/^([^/\s]+)\/([A-Z][A-Z0-9_]*-\d+)$/);
  if (!match) throw new Error(`invalid tracker_id: ${trackerId}`);
  return { workspaceSlug: match[1], identifier: match[2] };
}

async function httpJson(serverUrl, token, apiPath, { method = 'GET', body } = {}) {
  const response = await fetch(`${serverUrl}${apiPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (response.status >= 200 && response.status < 300) return parsed;
  const error = new Error(parsed?.error ?? parsed?.message ?? `HTTP ${response.status}`);
  error.code = `HTTP_${response.status}`;
  throw error;
}

async function resolveWorkspaceId({ serverUrl, token, workspaceSlug }) {
  const body = await httpJson(serverUrl, token, '/api/workspaces');
  const workspaces = Array.isArray(body) ? body : body?.workspaces ?? body?.data ?? [];
  const match = workspaces.find((workspace) => workspace?.slug === workspaceSlug);
  if (!match?.id) throw new Error(`workspace not found: ${workspaceSlug}`);
  return String(match.id);
}

async function getStoryViaAdapterShim({ serverUrl, token, workspaceId, trackerId }) {
  const { identifier } = parseTrackerId(trackerId);
  const list = await httpJson(
    serverUrl,
    token,
    `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}&identifier=${encodeURIComponent(identifier)}`,
  );
  const issue = (Array.isArray(list) ? list : list?.issues ?? list?.data ?? []).find(
    (candidate) => candidate?.identifier === identifier,
  );
  if (!issue?.id) throw new Error(`issue not found for ${trackerId}`);
  const full = await httpJson(
    serverUrl,
    token,
    `/api/issues/${encodeURIComponent(issue.id)}?workspace_id=${encodeURIComponent(workspaceId)}`,
  );
  return {
    id: trackerId,
    issueUuid: String(full.id),
    identifier: String(full.identifier),
    title: full.title,
    body: full.description ?? '',
    status: full.status ?? '',
  };
}

async function createStoryViaAdapterShim({ serverUrl, token, workspaceId, workspaceSlug, storySpec }) {
  const created = await httpJson(
    serverUrl,
    token,
    `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      body: {
        title: storySpec.title,
        description: '<brief placeholder — will be filled at step 3>',
        status: 'todo',
        labels: [],
        parent_issue_id: null,
      },
    },
  );
  return {
    id: `${workspaceSlug}/${created.identifier}`,
    issueUuid: String(created.id),
    identifier: String(created.identifier),
  };
}

async function pollTaskUntilTerminalStub({
  terminalByStoryId = {},
  storyId,
  issueUuid,
  onStateTransition,
}) {
  onStateTransition?.('queued', 'running');
  onStateTransition?.('running', terminalByStoryId[storyId]?.status ?? 'completed');
  return {
    issueUuid,
    status: 'completed',
    completed_at: new Date('2026-05-21T00:00:00.000Z').toISOString(),
    messages: [],
    ...(terminalByStoryId[storyId] ?? {}),
  };
}

async function writeMulticaRunEpisodeStub({
  hiveStateDir,
  epicHandle,
  storyId,
  issueUuid,
  identifier,
  terminal,
}) {
  const dir = path.join(hiveStateDir, 'episodes', epicHandle, storyId);
  await fs.mkdir(dir, { recursive: true });
  const markerPath = path.join(dir, 'multica-run.yaml');
  const messagesPath = path.join(dir, 'multica-run.messages.jsonl');
  const status = terminal.status === 'completed' ? 'passed' : terminal.status;
  const notes = terminal.error || terminal.notes || '';
  const marker = [
    `story_id: ${storyId}`,
    `status: ${status}`,
    `issue_uuid: ${issueUuid}`,
    `identifier: ${identifier}`,
    notes ? `notes: ${JSON.stringify(notes)}` : 'notes: ""',
    '',
  ].join('\n');
  await fs.writeFile(markerPath, marker, 'utf8');
  await fs.writeFile(
    messagesPath,
    (terminal.messages ?? []).map((message) => JSON.stringify(message)).join('\n'),
    'utf8',
  );
  return { markerPath, messagesPath, status, notes };
}

async function executeModeMulticaDriver({
  serverUrl,
  token = TOKEN,
  workspaceSlug = WORKSPACE_SLUG,
  hiveStateDir,
  epicHandle = EPIC,
  unblocked_stories = [],
  appends_map = {},
  hive_config = {},
  terminalByStoryId = {},
  stderr = () => {},
}) {
  const dispatched = [];
  const completed = [];
  const failed = [];
  const episodes = [];

  const workspaceId = await resolveWorkspaceId({ serverUrl, token, workspaceSlug });
  let developerAgentUuid;
  try {
    developerAgentUuid = await resolveAgentUuidByName(
      serverUrl,
      token,
      workspaceId,
      'developer',
    );
  } catch (error) {
    if (error?.code === 'BOOTSTRAP_REQUIRED') {
      const wrapped = new Error(
        'ERROR: Multica execution mode requires bootstrapped agents.\n' +
          '       Run /hive:multica-init to create them, then retry.\n' +
          `       (developer agent missing in workspace ${workspaceSlug})`,
      );
      wrapped.code = 'BOOTSTRAP_REQUIRED';
      throw wrapped;
    }
    throw error;
  }

  const pollIntervalMs =
    (hive_config.execution?.multica?.poll_interval_seconds ?? 5) * 1000;
  const maxWallClockMs =
    (hive_config.execution?.multica?.story_timeout_seconds ?? 1800) * 1000;
  const messagesCaptureMax =
    hive_config.execution?.multica?.messages_capture_max ?? 200;

  await Promise.all(
    unblocked_stories.map(async (storySpec) => {
      const storyId = storySpec.id;
      try {
        let issue;
        let trackerId = storySpec.tracker_id;
        if (trackerId) {
          issue = await getStoryViaAdapterShim({
            serverUrl,
            token,
            workspaceId,
            trackerId,
          });
        } else {
          issue = await createStoryViaAdapterShim({
            serverUrl,
            token,
            workspaceId,
            workspaceSlug,
            storySpec,
          });
          trackerId = issue.id;
        }

        await moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issue.issueUuid);
        await ensureIssueBriefMatches(
          serverUrl,
          token,
          workspaceId,
          issue.issueUuid,
          serializeStoryBrief({ ...storySpec, tracker_id: trackerId }),
        );
        await dispatchStoryToAgent(
          serverUrl,
          token,
          workspaceId,
          issue.issueUuid,
          developerAgentUuid,
        );

        const dispatchRecord = {
          story_id: storyId,
          tracker_id: trackerId,
          issueUuid: issue.issueUuid,
          identifier: issue.identifier,
          dispatch_started_at: new Date('2026-05-21T00:00:00.000Z').toISOString(),
        };
        dispatched.push(dispatchRecord);

        stderr(
          `[multica:${storyId}] s4 episode-marker-sync not yet implemented — would poll here`,
        );
        const terminal = await pollTaskUntilTerminalStub({
          serverUrl,
          token,
          workspaceId,
          issueUuid: issue.issueUuid,
          storyId,
          maxWallClockMs,
          pollIntervalMs,
          messagesCaptureMax,
          terminalByStoryId,
          onStateTransition(prev, next) {
            stderr(`[multica:${storyId}] ${prev} → ${next}`);
          },
        });
        const episode = await writeMulticaRunEpisodeStub({
          hiveStateDir,
          epicHandle,
          storyId,
          issueUuid: issue.issueUuid,
          identifier: issue.identifier,
          terminal,
        });
        episodes.push({ story_id: storyId, ...episode });

        const terminalRecord = {
          story_id: storyId,
          issueUuid: issue.issueUuid,
          identifier: issue.identifier,
          status: episode.status,
          notes: episode.notes,
        };
        if (episode.status === 'passed') completed.push(terminalRecord);
        else failed.push(terminalRecord);
      } catch (error) {
        const episode = await writeMulticaRunEpisodeStub({
          hiveStateDir,
          epicHandle,
          storyId,
          issueUuid: 'unknown',
          identifier: 'unknown',
          terminal: { status: 'failed', error: error?.message ?? String(error) },
        });
        episodes.push({ story_id: storyId, ...episode });
        failed.push({
          story_id: storyId,
          issueUuid: 'unknown',
          identifier: 'unknown',
          status: 'failed',
          notes: episode.notes,
        });
      }
    }),
  );

  for (const [storyId, agentNames] of Object.entries(appends_map)) {
    stderr(
      `[info] sidecar injection deferred to v2 multi-agent contract: ${storyId} → ${agentNames.join(', ')}`,
    );
  }

  return { dispatched, completed, failed, episodes };
}

test('AC1: one story dispatches to agent and writes passed episode', async () => {
  const hiveStateDir = await createTempHiveState();
  const mock = await startMockMultica({
    issues: [{ id: 'issue-1', identifier: 'PLU-1', status: 'todo' }],
  });
  try {
    const result = await executeModeMulticaDriver({
      serverUrl: mock.serverUrl,
      hiveStateDir,
      unblocked_stories: [story({ tracker_id: 'plugin-hive/PLU-1' })],
    });

    const assignmentPuts = mock.calls.filter(
      (call) => call.method === 'PUT' && call.body?.assignee_type === 'agent',
    );
    assert.equal(assignmentPuts.length, 1);
    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0].status, 'passed');
    const marker = await fs.readFile(result.episodes[0].markerPath, 'utf8');
    assert.match(marker, /^status: passed$/m);
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC2: empty agents list throws BOOTSTRAP_REQUIRED with init hint', async () => {
  const hiveStateDir = await createTempHiveState();
  const mock = await startMockMultica({ agents: [] });
  try {
    await assert.rejects(
      () =>
        executeModeMulticaDriver({
          serverUrl: mock.serverUrl,
          hiveStateDir,
          unblocked_stories: [story()],
        }),
      (error) =>
        error.code === 'BOOTSTRAP_REQUIRED' &&
        error.message.includes('/hive:multica-init'),
    );
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC3: missing tracker_id creates one Multica issue', async () => {
  const hiveStateDir = await createTempHiveState();
  const mock = await startMockMultica();
  try {
    const result = await executeModeMulticaDriver({
      serverUrl: mock.serverUrl,
      hiveStateDir,
      unblocked_stories: [story({ tracker_id: null })],
    });

    const creates = mock.calls.filter(
      (call) => call.method === 'POST' && call.path === '/api/issues',
    );
    assert.equal(creates.length, 1);
    assert.equal(result.dispatched[0].tracker_id, 'plugin-hive/PLU-1');
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC4: backlog issue moves to todo before assignment PUT', async () => {
  const hiveStateDir = await createTempHiveState();
  const mock = await startMockMultica({
    issues: [{ id: 'issue-1', identifier: 'PLU-1', status: 'backlog' }],
  });
  try {
    await executeModeMulticaDriver({
      serverUrl: mock.serverUrl,
      hiveStateDir,
      unblocked_stories: [story({ tracker_id: 'plugin-hive/PLU-1' })],
    });

    const statusPutIndex = mock.calls.findIndex(
      (call) => call.method === 'PUT' && call.body?.status === 'todo',
    );
    const assignmentPutIndex = mock.calls.findIndex(
      (call) => call.method === 'PUT' && call.body?.assignee_type === 'agent',
    );
    assert.notEqual(statusPutIndex, -1);
    assert.notEqual(assignmentPutIndex, -1);
    assert.ok(statusPutIndex < assignmentPutIndex);
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC5: three depth-0 stories all dispatch and terminate before return', async () => {
  const hiveStateDir = await createTempHiveState();
  const mock = await startMockMultica({
    issues: [
      { id: 'issue-1', identifier: 'PLU-1' },
      { id: 'issue-2', identifier: 'PLU-2' },
      { id: 'issue-3', identifier: 'PLU-3' },
    ],
  });
  try {
    const result = await executeModeMulticaDriver({
      serverUrl: mock.serverUrl,
      hiveStateDir,
      unblocked_stories: [
        story({ id: 'story-1', tracker_id: 'plugin-hive/PLU-1' }),
        story({ id: 'story-2', tracker_id: 'plugin-hive/PLU-2' }),
        story({ id: 'story-3', tracker_id: 'plugin-hive/PLU-3' }),
      ],
    });

    const assignmentPuts = mock.calls.filter(
      (call) => call.method === 'PUT' && call.body?.assignee_type === 'agent',
    );
    assert.equal(assignmentPuts.length, 3);
    assert.equal(result.episodes.length, 3);
    assert.equal(result.completed.length, 3);
    for (const episode of result.episodes) {
      const marker = await fs.readFile(episode.markerPath, 'utf8');
      assert.match(marker, /^status: passed$/m);
    }
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test('AC6: appends_map logs sidecar deferral and does not add dispatches', async () => {
  const hiveStateDir = await createTempHiveState();
  const logs = [];
  const mock = await startMockMultica({
    issues: [{ id: 'issue-1', identifier: 'PLU-1' }],
  });
  try {
    await executeModeMulticaDriver({
      serverUrl: mock.serverUrl,
      hiveStateDir,
      unblocked_stories: [story({ tracker_id: 'plugin-hive/PLU-1' })],
      appends_map: { 'story-1': ['security-reviewer', 'perf-reviewer'] },
      stderr: (line) => logs.push(line),
    });

    const assignmentPuts = mock.calls.filter(
      (call) => call.method === 'PUT' && call.body?.assignee_type === 'agent',
    );
    assert.equal(assignmentPuts.length, 1);
    assert.equal(
      logs.filter((line) => line.includes('sidecar injection deferred')).length,
      1,
    );
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});

test("AC7: failed terminal writes failed episode with Multica error notes", async () => {
  const hiveStateDir = await createTempHiveState();
  const mock = await startMockMultica({
    issues: [{ id: 'issue-1', identifier: 'PLU-1' }],
  });
  try {
    const result = await executeModeMulticaDriver({
      serverUrl: mock.serverUrl,
      hiveStateDir,
      unblocked_stories: [story({ tracker_id: 'plugin-hive/PLU-1' })],
      terminalByStoryId: { 'story-1': { status: 'failed', error: 'OOM' } },
    });

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].status, 'failed');
    assert.match(result.failed[0].notes, /OOM/);
    const marker = await fs.readFile(result.episodes[0].markerPath, 'utf8');
    assert.match(marker, /^status: failed$/m);
    assert.match(marker, /OOM/);
  } finally {
    await mock.close();
    await fs.rm(hiveStateDir, { recursive: true, force: true });
  }
});
