import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAutopilotsWithDeps } from '../index.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-test-ap-1';
const TOKEN = 'test-token';
const SERVER_URL = 'http://fake-server';

function makeLoadAutopilotsConfigFn(autopilots) {
  return async () => ({ autopilots });
}

function agent(name, id = `agent-id-${name}`) {
  return { id, name };
}

function serverAutopilot(title, agentId, id = `ap-id-${title}`, opts = {}) {
  return {
    id,
    title,
    description: opts.description ?? '',
    agent_id: agentId,
    mode: opts.mode ?? 'run_only',
    priority: opts.priority ?? 'none',
    status: opts.status ?? 'active',
  };
}

function serverTrigger(kind, opts = {}) {
  const base = { id: `trig-${kind}-${opts.label ?? opts.cron ?? 'x'}`, kind };
  if (kind === 'schedule') {
    return { ...base, cron: opts.cron ?? '0 9 * * 1-5', timezone: opts.timezone ?? 'America/New_York', label: opts.label ?? '' };
  }
  return { ...base, label: opts.label ?? '', webhook_url: opts.webhook_url };
}

function desiredAutopilot(name, title, agentName, opts = {}) {
  return {
    name,
    title,
    agent: agentName,
    description: opts.description ?? '',
    mode: opts.mode ?? 'run_only',
    priority: opts.priority ?? 'none',
    status: opts.status ?? 'active',
    triggers: opts.triggers ?? [],
  };
}

/**
 * Build a fake httpJsonFn from fixture data.
 * triggersByAutopilotId: Map<autopilotId, trigger[]>
 */
function makeHttpJsonFn({
  existingAgents = [],
  existingAutopilots = [],
  triggersByAutopilotId = new Map(),
  calls = [],
} = {}) {
  return async function fakeHttpJson(serverUrl, apiPath, { method = 'GET', body } = {}) {
    calls.push({ method, apiPath, body });

    if (method === 'GET' && /\/api\/agents/.test(apiPath)) {
      return existingAgents;
    }

    // List autopilots
    if (method === 'GET' && /\/api\/autopilots\?/.test(apiPath)) {
      return existingAutopilots;
    }

    // List triggers for an autopilot
    if (method === 'GET' && /\/api\/autopilots\/[^/]+\/triggers/.test(apiPath)) {
      const match = apiPath.match(/\/api\/autopilots\/([^/]+)\/triggers/);
      const apId = match ? decodeURIComponent(match[1]) : null;
      return triggersByAutopilotId.get(apId) ?? [];
    }

    // Create autopilot
    if (method === 'POST' && /\/api\/autopilots\?/.test(apiPath)) {
      return { id: `created-ap-${body?.title}`, title: body?.title };
    }

    // Update autopilot
    if (method === 'PUT' && /\/api\/autopilots\/[^/]+\?/.test(apiPath) && !/\/triggers\//.test(apiPath)) {
      return { id: 'updated-ap-id', title: body?.title };
    }

    // Add trigger
    if (method === 'POST' && /\/api\/autopilots\/[^/]+\/triggers/.test(apiPath)) {
      const webhookUrl = body?.kind === 'webhook' ? `https://fake-server/webhooks/${body?.label ?? 'hook'}` : undefined;
      return { id: `new-trig-${body?.kind}`, kind: body?.kind, webhook_url: webhookUrl };
    }

    // Update trigger
    if (method === 'PUT' && /\/api\/autopilots\/[^/]+\/triggers\//.test(apiPath)) {
      return { id: 'updated-trig-id', kind: body?.kind };
    }

    // Delete trigger
    if (method === 'DELETE' && /\/api\/autopilots\/[^/]+\/triggers\//.test(apiPath)) {
      return null;
    }

    throw new Error(`Unhandled fake request: ${method} ${apiPath}`);
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: Cold path — empty workspace + 2-autopilot yaml → 2 autopilots created
// ---------------------------------------------------------------------------

test('cold bootstrap — creates all desired autopilots and triggers, captures webhook URL', async () => {
  const calls = [];
  const agents = [agent('orchestrator'), agent('developer')];

  const httpJsonFn = makeHttpJsonFn({ existingAgents: agents, calls });
  const loadAutopilotsConfigFn = makeLoadAutopilotsConfigFn([
    desiredAutopilot('daily-standup', 'Daily Standup', 'orchestrator', {
      description: 'Run the standup skill',
      triggers: [
        { kind: 'schedule', cron: '0 9 * * 1-5', timezone: 'America/New_York', label: 'weekday-mornings' },
        { kind: 'webhook', label: 'manual-trigger' },
      ],
    }),
    desiredAutopilot('nightly-build', 'Nightly Build', 'developer', {
      description: 'Run nightly build',
      triggers: [],
    }),
  ]);

  const result = await reconcileAutopilotsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadAutopilotsConfigFn,
  });

  assert.equal(result.created.length, 2, 'should create 2 autopilots');
  assert.equal(result.patched.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.removed.length, 0);
  assert.deepEqual(result.created.sort(), ['daily-standup', 'nightly-build']);

  // daily-standup has a schedule + webhook trigger
  assert.equal(result.triggersAdded.length, 2, 'should add 2 triggers for daily-standup');
  assert.ok(result.triggersAdded.some((t) => t.includes('schedule::')), 'schedule trigger added');
  assert.ok(result.triggersAdded.some((t) => t.includes('webhook::')), 'webhook trigger added');

  // Webhook URL should be captured
  assert.ok(result.webhookUrlsCaptured['daily-standup'], 'webhook URL captured for daily-standup');

  const postApCalls = calls.filter((c) => c.method === 'POST' && /\/api\/autopilots\?/.test(c.apiPath));
  assert.equal(postApCalls.length, 2, '2 POST autopilot calls');
});

// ---------------------------------------------------------------------------
// Scenario 2: Warm path — 1 autopilot exists and matches yaml → skipped; 2nd → created
// ---------------------------------------------------------------------------

test('warm bootstrap — skips unchanged autopilot, creates missing one', async () => {
  const calls = [];
  const agents = [agent('orchestrator', 'agent-orch'), agent('developer', 'agent-dev')];

  const existingAp = serverAutopilot('Daily Standup', 'agent-orch', 'ap-existing', { description: 'Run the standup skill' });
  const triggersByAutopilotId = new Map([['ap-existing', []]]);

  const httpJsonFn = makeHttpJsonFn({
    existingAgents: agents,
    existingAutopilots: [existingAp],
    triggersByAutopilotId,
    calls,
  });
  const loadAutopilotsConfigFn = makeLoadAutopilotsConfigFn([
    desiredAutopilot('daily-standup', 'Daily Standup', 'orchestrator', {
      description: 'Run the standup skill',
      triggers: [],
    }),
    desiredAutopilot('nightly-build', 'Nightly Build', 'developer', {
      description: 'Run nightly build',
      triggers: [],
    }),
  ]);

  const result = await reconcileAutopilotsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadAutopilotsConfigFn,
  });

  assert.equal(result.created.length, 1, '1 new autopilot created');
  assert.ok(result.created.includes('nightly-build'), 'nightly-build created');
  assert.equal(result.skipped.length, 1, '1 autopilot skipped');
  assert.ok(result.skipped.includes('daily-standup'), 'daily-standup skipped');
  assert.equal(result.patched.length, 0, 'no patched autopilots');

  const putCalls = calls.filter((c) => c.method === 'PUT' && !/\/triggers\//.test(c.apiPath));
  assert.equal(putCalls.length, 0, 'no PUT — metadata unchanged');
});

// ---------------------------------------------------------------------------
// Scenario 3: Drift — autopilot exists but description changed → PUT update
// ---------------------------------------------------------------------------

test('drift — updates autopilot description without delete+recreate', async () => {
  const calls = [];
  const agents = [agent('orchestrator', 'agent-orch')];

  const existingAp = serverAutopilot('Daily Standup', 'agent-orch', 'ap-drift', {
    description: 'Old description',
  });
  const triggersByAutopilotId = new Map([['ap-drift', []]]);

  const httpJsonFn = makeHttpJsonFn({
    existingAgents: agents,
    existingAutopilots: [existingAp],
    triggersByAutopilotId,
    calls,
  });
  const loadAutopilotsConfigFn = makeLoadAutopilotsConfigFn([
    desiredAutopilot('daily-standup', 'Daily Standup', 'orchestrator', {
      description: 'New description — updated',
      triggers: [],
    }),
  ]);

  const result = await reconcileAutopilotsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadAutopilotsConfigFn,
  });

  assert.equal(result.created.length, 0, 'no new autopilots');
  assert.equal(result.patched.length, 1, '1 autopilot patched due to drift');
  assert.ok(result.patched.includes('daily-standup'), 'daily-standup patched');

  const putCalls = calls.filter((c) => c.method === 'PUT' && !/\/triggers\//.test(c.apiPath));
  assert.equal(putCalls.length, 1, '1 PUT for metadata update');

  const deleteCalls = calls.filter((c) => c.method === 'DELETE');
  assert.equal(deleteCalls.length, 0, 'no DELETE — autopilot not recreated');
});

// ---------------------------------------------------------------------------
// Scenario 4: Orphan — autopilot in Multica not in yaml → console.warn, not deleted
// ---------------------------------------------------------------------------

test('orphan autopilot — warns but does NOT delete; removed array returned', async () => {
  const calls = [];
  const agents = [agent('orchestrator', 'agent-orch')];

  const orphanAp = serverAutopilot('Orphan Routine', 'agent-orch', 'ap-orphan');
  const keepAp = serverAutopilot('Daily Standup', 'agent-orch', 'ap-keep');
  const triggersByAutopilotId = new Map([
    ['ap-orphan', []],
    ['ap-keep', []],
  ]);

  const httpJsonFn = makeHttpJsonFn({
    existingAgents: agents,
    existingAutopilots: [keepAp, orphanAp],
    triggersByAutopilotId,
    calls,
  });
  // Only daily-standup in desired yaml — orphan-routine is stale
  const loadAutopilotsConfigFn = makeLoadAutopilotsConfigFn([
    desiredAutopilot('daily-standup', 'Daily Standup', 'orchestrator', {
      description: '',
      triggers: [],
    }),
  ]);

  const warnMessages = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnMessages.push(args.join(' '));

  try {
    const result = await reconcileAutopilotsWithDeps({
      serverUrl: SERVER_URL,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      consent: true,
      httpJsonFn,
      loadAutopilotsConfigFn,
    });

    assert.equal(result.removed.length, 1, '1 orphan autopilot reported');
    assert.ok(result.removed.includes('Orphan Routine'), 'Orphan Routine in removed list');

    const orphanWarn = warnMessages.find((m) => m.includes('Orphan Routine'));
    assert.ok(orphanWarn, 'console.warn mentions Orphan Routine');
    assert.ok(orphanWarn.includes('skipping deletion for safety'), 'warn includes safety message');

    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'no DELETE calls — orphan autopilot not deleted');
  } finally {
    console.warn = originalWarn;
  }
});
