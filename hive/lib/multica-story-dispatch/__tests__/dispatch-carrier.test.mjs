import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { __resetCache, dispatchStoryToPersonas } from '../index.mjs';

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

function story() {
  return {
    id: 'mpt-story',
    epic: 'mpt',
    description: 'Plan the Multica phase.',
    acceptance_criteria: ['dispatches each persona'],
    files_to_modify: [{ file: 'hive/lib/example.mjs', change: 'add helper' }],
  };
}

test.beforeEach(() => {
  __resetCache();
});

test('dispatchStoryToPersonas fans out existing persona issues to concrete agents', async () => {
  const calls = [];
  const agents = [
    { id: 'agent-researcher', name: 'researcher', provider: 'codex' },
    { id: 'agent-tester', name: 'tester', provider: 'claude' },
  ];
  const issueState = {
    'issue-researcher': { description: 'old', status: 'backlog' },
    'issue-tester': { description: 'old', status: 'backlog' },
  };

  const { serverUrl, close } = await startMockServer((req, res, body) => {
    calls.push({ method: req.method, url: req.url, body });

    if (req.method === 'GET' && req.url === '/api/agents?workspace_id=workspace-1') {
      sendJson(res, 200, { agents });
      return;
    }

    const match = req.url.match(/^\/api\/issues\/([^?]+)\?workspace_id=workspace-1$/);
    if (!match) {
      sendJson(res, 500, { error: `unexpected request: ${req.method} ${req.url}` });
      return;
    }

    const issueId = decodeURIComponent(match[1]);
    const issue = issueState[issueId];
    assert.ok(issue, `unexpected issue ${issueId}`);

    if (req.method === 'GET') {
      sendJson(res, 200, { id: issueId, ...issue });
      return;
    }

    if (req.method === 'PUT') {
      Object.assign(issue, body);
      sendJson(res, 200, { id: issueId, ...issue });
      return;
    }

    sendJson(res, 500, { error: `unexpected method: ${req.method}` });
  });

  try {
    const result = await dispatchStoryToPersonas(
      serverUrl,
      'mul_test',
      'workspace-1',
      story(),
      [
        { persona: 'researcher', issueUuid: 'issue-researcher' },
        { persona: 'tester', issueUuid: 'issue-tester' },
      ],
      {
        agents,
        agentBackends: { researcher: 'codex', tester: 'claude' },
        integrationBranch: 'feat/mpt',
      },
    );

    assert.equal(result.carrier, 'per-persona-fan-out');
    assert.deepEqual(
      result.dispatches.map((dispatch) => ({
        persona: dispatch.persona,
        issue_uuid: dispatch.issue_uuid,
        agent_uuid: dispatch.agent_uuid,
        was_updated: dispatch.was_updated,
        was_moved: dispatch.was_moved,
      })),
      [
        {
          persona: 'researcher',
          issue_uuid: 'issue-researcher',
          agent_uuid: 'agent-researcher',
          was_updated: true,
          was_moved: true,
        },
        {
          persona: 'tester',
          issue_uuid: 'issue-tester',
          agent_uuid: 'agent-tester',
          was_updated: true,
          was_moved: true,
        },
      ],
    );

    const assignmentBodies = calls
      .filter((call) => call.method === 'PUT' && call.body?.assignee_type === 'agent')
      .map((call) => call.body);
    assert.deepEqual(assignmentBodies, [
      { assignee_type: 'agent', assignee_id: 'agent-researcher' },
      { assignee_type: 'agent', assignee_id: 'agent-tester' },
    ]);
    assert.equal(calls.filter((call) => call.url === '/api/agents?workspace_id=workspace-1').length, 1);
  } finally {
    await close();
  }
});

test('dispatchStoryToPersonas renders persona briefs with backend-split mapping', async () => {
  const descriptions = new Map();
  const agents = [
    { id: 'agent-researcher', name: 'researcher', provider: 'codex' },
    { id: 'agent-tester', name: 'tester', provider: 'claude' },
    { id: 'agent-reviewer', name: 'reviewer', provider: 'claude' },
  ];

  const { serverUrl, close } = await startMockServer((req, res, body) => {
    if (req.method === 'GET' && req.url === '/api/agents?workspace_id=workspace-1') {
      sendJson(res, 200, agents);
      return;
    }

    const match = req.url.match(/^\/api\/issues\/([^?]+)\?workspace_id=workspace-1$/);
    if (!match) {
      sendJson(res, 500, { error: `unexpected request: ${req.method} ${req.url}` });
      return;
    }

    const issueId = decodeURIComponent(match[1]);
    if (req.method === 'GET') {
      sendJson(res, 200, { id: issueId, description: 'old', status: 'in_progress' });
      return;
    }

    if (req.method === 'PUT') {
      if (body.description) descriptions.set(issueId, body.description);
      sendJson(res, 200, { id: issueId, ...body });
      return;
    }

    sendJson(res, 500, { error: `unexpected method: ${req.method}` });
  });

  try {
    await dispatchStoryToPersonas(
      serverUrl,
      'mul_test',
      'workspace-1',
      story(),
      {
        researcher: 'issue-researcher',
        tester: 'issue-tester',
        reviewer: 'issue-reviewer',
      },
      {
        agents,
        agentBackends: { researcher: 'codex', tester: 'claude', reviewer: 'codex' },
      },
    );

    assert.doesNotMatch(descriptions.get('issue-researcher'), /\/codex:rescue/);
    assert.doesNotMatch(descriptions.get('issue-tester'), /\/codex:rescue/);
    assert.match(descriptions.get('issue-reviewer'), /^## Use \/codex:rescue/m);
  } finally {
    await close();
  }
});
