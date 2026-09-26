import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { __resetCache, dispatchStoryToPersonas, resolvePersonaBackend, serializeStoryBrief } from '../index.mjs';

// ── resolvePersonaBackend ──────────────────────────────────────────────────

test('resolvePersonaBackend: multica:opencode resolves as-is', () => {
  assert.equal(resolvePersonaBackend('dev', { dev: 'multica:opencode' }), 'multica:opencode');
});

test('resolvePersonaBackend: opencode alias expands to multica:opencode', () => {
  assert.equal(resolvePersonaBackend('dev', { dev: 'opencode' }), 'multica:opencode');
});

test('resolvePersonaBackend: multica:gemini resolves as-is', () => {
  assert.equal(resolvePersonaBackend('researcher', { researcher: 'multica:gemini' }), 'multica:gemini');
});

test('resolvePersonaBackend: absent persona falls back to claude', () => {
  assert.equal(resolvePersonaBackend('unknown', { dev: 'multica:opencode' }), 'claude');
});

test('resolvePersonaBackend: null agentBackends falls back to claude', () => {
  assert.equal(resolvePersonaBackend('dev', null), 'claude');
});

test('resolvePersonaBackend: claude passes through unchanged', () => {
  assert.equal(resolvePersonaBackend('dev', { dev: 'claude' }), 'claude');
});

test('resolvePersonaBackend: codex passes through unchanged', () => {
  assert.equal(resolvePersonaBackend('reviewer', { reviewer: 'codex' }), 'codex');
});

test('resolvePersonaBackend: unknown value falls back to claude', () => {
  assert.equal(resolvePersonaBackend('dev', { dev: 'llama' }), 'claude');
});

// ── brief: multica:* never emits /codex:rescue ─────────────────────────────

function story() {
  return { id: 's1', epic: 'e1', description: 'Ship the opencode backend.' };
}

test('brief for multica:opencode backend omits /codex:rescue', () => {
  const brief = serializeStoryBrief(story(), {
    dispatchingPersona: 'developer',
    agents: [{ name: 'developer', provider: 'claude' }],
    agentBackends: { developer: 'multica:opencode' },
  });
  assert.doesNotMatch(brief, /\/codex:rescue/);
});

test('brief for opencode alias omits /codex:rescue', () => {
  const brief = serializeStoryBrief(story(), {
    dispatchingPersona: 'developer',
    agents: [{ name: 'developer', provider: 'claude' }],
    agentBackends: { developer: 'opencode' },
  });
  assert.doesNotMatch(brief, /\/codex:rescue/);
});

test('brief for multica:gemini backend omits /codex:rescue', () => {
  const brief = serializeStoryBrief(story(), {
    dispatchingPersona: 'researcher',
    agents: [{ name: 'researcher', provider: 'claude' }],
    agentBackends: { researcher: 'multica:gemini' },
  });
  assert.doesNotMatch(brief, /\/codex:rescue/);
});

// ── dispatch: multica:* routes through Multica issue-assign (no cmux) ─────

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

test.beforeEach(() => {
  __resetCache();
});

test('multica:opencode backend dispatches via Multica issue-assign, not cmux', async () => {
  const agents = [{ id: 'agent-developer', name: 'developer', provider: 'claude' }];
  const issueState = { 'issue-developer': { description: 'old', status: 'backlog' } };
  const calls = [];

  const { serverUrl, close } = await startMockServer((req, res, body) => {
    calls.push({ method: req.method, url: req.url, body });

    if (req.method === 'GET' && req.url === '/api/agents?workspace_id=ws-1') {
      sendJson(res, 200, { agents });
      return;
    }

    const match = req.url.match(/^\/api\/issues\/([^?]+)\?workspace_id=ws-1$/);
    if (!match) { sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` }); return; }

    const issueId = decodeURIComponent(match[1]);
    const issue = issueState[issueId] ?? {};
    if (req.method === 'GET') { sendJson(res, 200, { id: issueId, ...issue }); return; }
    if (req.method === 'PUT') {
      Object.assign(issue, body);
      sendJson(res, 200, { id: issueId, ...issue });
      return;
    }
    sendJson(res, 500, { error: `unexpected method: ${req.method}` });
  });

  try {
    const result = await dispatchStoryToPersonas(
      serverUrl, 'mul_test', 'ws-1', story(),
      [{ persona: 'developer', issueUuid: 'issue-developer' }],
      { agents, agentBackends: { developer: 'multica:opencode' } },
    );

    assert.equal(result.carrier, 'per-persona-fan-out');
    assert.equal(result.dispatches.length, 1);
    assert.equal(result.dispatches[0].persona, 'developer');
    assert.equal(result.dispatches[0].agent_uuid, 'agent-developer');

    // Dispatch must go via Multica issue-assign PUT (no cmux, no Messages-API call)
    const assignmentCalls = calls.filter(
      (c) => c.method === 'PUT' && c.body?.assignee_type === 'agent',
    );
    assert.equal(assignmentCalls.length, 1);
    assert.equal(assignmentCalls[0].body.assignee_id, 'agent-developer');
  } finally {
    await close();
  }
});

test('opencode alias dispatches identically to multica:opencode', async () => {
  const agents = [{ id: 'agent-developer', name: 'developer', provider: 'claude' }];
  const issueState = { 'issue-developer': { description: 'old', status: 'todo' } };

  const { serverUrl, close } = await startMockServer((req, res, body) => {
    if (req.method === 'GET' && req.url === '/api/agents?workspace_id=ws-2') {
      sendJson(res, 200, { agents }); return;
    }
    const match = req.url.match(/^\/api\/issues\/([^?]+)\?workspace_id=ws-2$/);
    if (!match) { sendJson(res, 500, { error: `unexpected: ${req.method} ${req.url}` }); return; }
    const issueId = decodeURIComponent(match[1]);
    const issue = issueState[issueId] ?? {};
    if (req.method === 'GET') { sendJson(res, 200, { id: issueId, ...issue }); return; }
    if (req.method === 'PUT') {
      Object.assign(issue, body);
      sendJson(res, 200, { id: issueId, ...issue }); return;
    }
    sendJson(res, 500, { error: `unexpected method: ${req.method}` });
  });

  try {
    const result = await dispatchStoryToPersonas(
      serverUrl, 'mul_test', 'ws-2', story(),
      [{ persona: 'developer', issueUuid: 'issue-developer' }],
      { agents, agentBackends: { developer: 'opencode' } },
    );

    assert.equal(result.carrier, 'per-persona-fan-out');
    assert.equal(result.dispatches[0].agent_uuid, 'agent-developer');
  } finally {
    await close();
  }
});
