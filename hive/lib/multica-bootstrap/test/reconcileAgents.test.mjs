import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAgentsWithDeps } from '../index.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-test-1';
const TOKEN = 'test-token';
const SERVER_URL = 'http://fake-server';

// Returns a fake loadAgentsConfigFn that ignores the path and returns the given agents
function makeLoadAgentsConfigFn(agents) {
  return async () => ({ agents });
}

// Build a fake httpJsonFn from fixture data
function makeHttpJsonFn({ existingAgents = [], calls = [] } = {}) {
  return async function fakeHttpJson(serverUrl, apiPath, { method = 'GET', body } = {}) {
    calls.push({ method, apiPath, body });

    if (method === 'GET' && apiPath.startsWith('/api/runtimes')) {
      return [{ id: 'rt-1', provider: 'claude' }];
    }

    if (method === 'GET' && apiPath.startsWith('/api/agents')) {
      return existingAgents;
    }

    if (method === 'POST' && apiPath.startsWith('/api/agents')) {
      return { id: 'new-id', name: body?.name };
    }

    if (method === 'PUT' && apiPath.startsWith('/api/agents/')) {
      const matched = existingAgents.find((a) => apiPath.includes(encodeURIComponent(a.id)));
      return { id: matched?.id ?? 'unknown-id', name: body?.name };
    }

    throw new Error(`Unhandled fake request: ${method} ${apiPath}`);
  };
}

// Minimal agent fixture for desired agents (no id — those come from the server)
function desiredAgent(name, model = 'claude-3-haiku') {
  return { name, model, provider: 'claude' };
}

// Minimal agent fixture for existing agents (has id — already on server)
function existingAgent(name, model = 'claude-3-haiku', id = null) {
  return { name, model, provider: 'claude', runtime_id: 'rt-1', id: id ?? `id-${name}` };
}

// ---------------------------------------------------------------------------
// Scenario 1: Cold bootstrap — empty server, 3 desired agents → all created
// ---------------------------------------------------------------------------

test('cold bootstrap — creates all desired agents', async () => {
  const calls = [];
  const httpJsonFn = makeHttpJsonFn({ existingAgents: [], calls });
  const loadAgentsConfigFn = makeLoadAgentsConfigFn([
    desiredAgent('agent-alpha'),
    desiredAgent('agent-beta'),
    desiredAgent('agent-gamma'),
  ]);

  const result = await reconcileAgentsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadAgentsConfigFn,
  });

  assert.equal(result.created.length, 3, 'should create 3 agents');
  assert.equal(result.patched.length, 0, 'should patch 0 agents');
  assert.equal(result.skipped.length, 0, 'should skip 0 agents');
  assert.equal(result.removed.length, 0, 'should have 0 removed agents');
  assert.deepEqual(result.created.sort(), ['agent-alpha', 'agent-beta', 'agent-gamma']);

  const postCalls = calls.filter((c) => c.method === 'POST' && c.apiPath.startsWith('/api/agents'));
  assert.equal(postCalls.length, 3, 'should make 3 POST calls');
});

// ---------------------------------------------------------------------------
// Scenario 2: Warm bootstrap — 1 existing match, 3 desired → 2 created, 1 skipped
// ---------------------------------------------------------------------------

test('warm bootstrap — creates only missing personas', async () => {
  const calls = [];
  const existing = [existingAgent('agent-alpha')];
  const httpJsonFn = makeHttpJsonFn({ existingAgents: existing, calls });
  const loadAgentsConfigFn = makeLoadAgentsConfigFn([
    desiredAgent('agent-alpha'),
    desiredAgent('agent-beta'),
    desiredAgent('agent-gamma'),
  ]);

  const result = await reconcileAgentsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadAgentsConfigFn,
  });

  assert.equal(result.created.length, 2, 'should create 2 agents');
  assert.equal(result.skipped.length, 1, 'should skip 1 agent');
  assert.equal(result.patched.length, 0, 'should patch 0 agents');
  assert.equal(result.removed.length, 0, 'should have 0 removed');
  assert.ok(result.created.includes('agent-beta'), 'agent-beta should be created');
  assert.ok(result.created.includes('agent-gamma'), 'agent-gamma should be created');
  assert.ok(result.skipped.includes('agent-alpha'), 'agent-alpha should be skipped');
});

// ---------------------------------------------------------------------------
// Scenario 3: Drift — existing agent has old model, desired has new model → 1 patched
// ---------------------------------------------------------------------------

test('drift — updates agent with changed model without delete+create', async () => {
  const calls = [];
  const existing = [existingAgent('agent-alpha', 'claude-3-haiku')];
  const httpJsonFn = makeHttpJsonFn({ existingAgents: existing, calls });
  // Same agent name but different model = drift
  const loadAgentsConfigFn = makeLoadAgentsConfigFn([
    desiredAgent('agent-alpha', 'claude-3-5-sonnet'),
  ]);

  const result = await reconcileAgentsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadAgentsConfigFn,
  });

  assert.equal(result.created.length, 0, 'should create 0 agents');
  assert.equal(result.patched.length, 1, 'should patch 1 agent');
  assert.equal(result.skipped.length, 0, 'should skip 0 agents');
  assert.equal(result.removed.length, 0, 'should have 0 removed');
  assert.ok(result.patched.includes('agent-alpha'), 'agent-alpha should be patched');

  // Confirm it was a PUT (update), not a DELETE+POST
  const putCalls = calls.filter((c) => c.method === 'PUT');
  const deleteCalls = calls.filter((c) => c.method === 'DELETE');
  assert.equal(putCalls.length, 1, 'should make 1 PUT call for the drift update');
  assert.equal(deleteCalls.length, 0, 'should make 0 DELETE calls');
});

// ---------------------------------------------------------------------------
// Scenario 4: Removed persona — server has 2 agents, agents.yaml has only 1
//             → 1 removed entry, console.warn fires, agent NOT deleted
// ---------------------------------------------------------------------------

test('removed persona — warns but does NOT delete; removed array returned', async () => {
  const calls = [];
  const existing = [
    existingAgent('agent-alpha'),
    existingAgent('agent-orphan'),
  ];
  const httpJsonFn = makeHttpJsonFn({ existingAgents: existing, calls });
  // Only alpha in agents.yaml; orphan is stale
  const loadAgentsConfigFn = makeLoadAgentsConfigFn([
    desiredAgent('agent-alpha'),
  ]);

  const warnMessages = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnMessages.push(args.join(' '));

  try {
    const result = await reconcileAgentsWithDeps({
      serverUrl: SERVER_URL,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      consent: true,
      httpJsonFn,
      loadAgentsConfigFn,
    });

    assert.equal(result.removed.length, 1, 'should have 1 removed agent');
    assert.ok(result.removed.includes('agent-orphan'), 'agent-orphan should be in removed');

    // Confirm warn was called with expected format
    const orphanWarn = warnMessages.find((m) => m.includes('agent-orphan'));
    assert.ok(orphanWarn, 'console.warn should mention agent-orphan');
    assert.ok(
      orphanWarn.includes('skipping deletion for safety'),
      'warn message should include "skipping deletion for safety"'
    );

    // Confirm no DELETE call was made
    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'should make 0 DELETE calls — removed agents are never deleted');

    // alpha should be skipped (no drift) or patched
    assert.ok(
      result.skipped.includes('agent-alpha') || result.patched.includes('agent-alpha'),
      'agent-alpha should be skipped or patched'
    );
  } finally {
    console.warn = originalWarn;
  }
});
