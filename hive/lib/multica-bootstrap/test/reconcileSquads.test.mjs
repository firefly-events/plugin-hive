import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSquadsWithDeps } from '../index.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-test-1';
const TOKEN = 'test-token';
const SERVER_URL = 'http://fake-server';

function makeLoadSquadsConfigFn(squads) {
  return async () => ({ squads });
}

function agent(name, id = `agent-id-${name}`) {
  return { id, name };
}

function squad(name, leaderId, id = `squad-id-${name}`, description = '') {
  return { id, name, leader_id: leaderId, description };
}

function membership(memberId, role = 'member', squadId = 'irrelevant') {
  return { id: `mem-${memberId}`, member_id: memberId, member_type: 'agent', role, squad_id: squadId };
}

function desiredSquad(name, leader, members = [], description = '') {
  return { name, leader, members, description };
}

/**
 * Build a fake httpJsonFn from fixture data.
 * membersBySquadId: Map<squadId, membership[]>
 */
function makeHttpJsonFn({ existingAgents = [], existingSquads = [], membersBySquadId = new Map(), calls = [] } = {}) {
  return async function fakeHttpJson(serverUrl, apiPath, { method = 'GET', body } = {}) {
    calls.push({ method, apiPath, body });

    if (method === 'GET' && apiPath.startsWith('/api/agents')) {
      return existingAgents;
    }

    if (method === 'GET' && apiPath.startsWith('/api/squads') && !apiPath.includes('/members') && !apiPath.match(/\/squads\/[^?]+\//)) {
      return existingSquads;
    }

    if (method === 'GET' && apiPath.includes('/members')) {
      const squadIdMatch = apiPath.match(/\/api\/squads\/([^/]+)\/members/);
      const squadId = squadIdMatch ? decodeURIComponent(squadIdMatch[1]) : null;
      return membersBySquadId.get(squadId) ?? [];
    }

    if (method === 'POST' && /\/api\/squads\?/.test(apiPath)) {
      return { id: `created-squad-${body?.name}`, name: body?.name };
    }

    if (method === 'PUT' && apiPath.includes('/api/squads/')) {
      return { id: 'updated-id', name: body?.name };
    }

    if (method === 'POST' && apiPath.includes('/members')) {
      return { id: 'new-membership-id' };
    }

    if (method === 'DELETE' && apiPath.includes('/members/')) {
      return null;
    }

    throw new Error(`Unhandled fake request: ${method} ${apiPath}`);
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: Cold path — empty workspace + 3-squad yaml → 3 squads created + members added
// ---------------------------------------------------------------------------

test('cold bootstrap — creates all desired squads and members', async () => {
  const calls = [];
  const agents = [
    agent('researcher'),
    agent('architect'),
    agent('tpm'),
    agent('developer'),
    agent('reviewer'),
  ];
  const httpJsonFn = makeHttpJsonFn({ existingAgents: agents, calls });
  const loadSquadsConfigFn = makeLoadSquadsConfigFn([
    desiredSquad('planning-team', 'tpm', ['researcher', 'architect', 'tpm']),
    desiredSquad('dev-team', 'reviewer', ['developer', 'reviewer']),
    desiredSquad('small-team', 'tpm', ['tpm']),
  ]);

  const result = await reconcileSquadsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSquadsConfigFn,
  });

  assert.equal(result.created.length, 3, 'should create 3 squads');
  assert.equal(result.patched.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.removed.length, 0);
  assert.deepEqual(result.created.sort(), ['dev-team', 'planning-team', 'small-team']);

  // planning-team has 2 non-leader members (researcher, architect)
  // dev-team has 1 non-leader member (developer)
  // small-team has 0 non-leader members (only tpm who is leader)
  assert.equal(result.membersAdded.length, 3, 'should add 3 non-leader members total');

  const postSquadCalls = calls.filter((c) => c.method === 'POST' && /\/api\/squads\?/.test(c.apiPath));
  assert.equal(postSquadCalls.length, 3, '3 POST squad calls');
});

// ---------------------------------------------------------------------------
// Scenario 2: Warm path — 1 squad exists with stale members → only member deltas applied
// ---------------------------------------------------------------------------

test('warm bootstrap — reconciles member deltas without touching squad metadata', async () => {
  const calls = [];
  const agents = [
    agent('alpha', 'id-alpha'),
    agent('beta', 'id-beta'),
    agent('gamma', 'id-gamma'),
    agent('leader', 'id-leader'),
  ];
  const existingSquadObj = squad('my-squad', 'id-leader', 'squad-abc');
  const existingMembers = [
    membership('id-leader', 'leader', 'squad-abc'),  // leader membership
    membership('id-alpha', 'member', 'squad-abc'),   // alpha stays
    membership('id-beta', 'member', 'squad-abc'),    // beta gets removed
  ];
  const membersBySquadId = new Map([['squad-abc', existingMembers]]);

  const httpJsonFn = makeHttpJsonFn({
    existingAgents: agents,
    existingSquads: [existingSquadObj],
    membersBySquadId,
    calls,
  });
  // Desired: alpha stays, gamma added, beta removed
  const loadSquadsConfigFn = makeLoadSquadsConfigFn([
    desiredSquad('my-squad', 'leader', ['alpha', 'gamma', 'leader']),
  ]);

  const result = await reconcileSquadsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSquadsConfigFn,
  });

  assert.equal(result.created.length, 0);
  assert.equal(result.skipped.length, 1, 'squad metadata unchanged → skipped');
  assert.equal(result.patched.length, 0);
  assert.ok(result.membersAdded.includes('my-squad:gamma'), 'gamma should be added');
  assert.ok(result.membersRemoved.includes('my-squad:beta'), 'beta should be removed');
  assert.equal(result.membersAdded.length, 1);
  assert.equal(result.membersRemoved.length, 1);

  const putCalls = calls.filter((c) => c.method === 'PUT');
  assert.equal(putCalls.length, 0, 'no PUT — metadata unchanged');
});

// ---------------------------------------------------------------------------
// Scenario 3: Drift — leader changed → update without recreating squad
// ---------------------------------------------------------------------------

test('drift — updates squad leader without delete+create', async () => {
  const calls = [];
  const agents = [
    agent('old-leader', 'id-old-leader'),
    agent('new-leader', 'id-new-leader'),
    agent('member-a', 'id-member-a'),
  ];
  const existingSquadObj = squad('elite-squad', 'id-old-leader', 'squad-xyz');
  const existingMembers = [
    membership('id-old-leader', 'leader', 'squad-xyz'),
    membership('id-member-a', 'member', 'squad-xyz'),
  ];
  const membersBySquadId = new Map([['squad-xyz', existingMembers]]);

  const httpJsonFn = makeHttpJsonFn({
    existingAgents: agents,
    existingSquads: [existingSquadObj],
    membersBySquadId,
    calls,
  });
  const loadSquadsConfigFn = makeLoadSquadsConfigFn([
    desiredSquad('elite-squad', 'new-leader', ['member-a', 'new-leader']),
  ]);

  const result = await reconcileSquadsWithDeps({
    serverUrl: SERVER_URL,
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    consent: true,
    httpJsonFn,
    loadSquadsConfigFn,
  });

  assert.equal(result.created.length, 0, 'no new squads');
  assert.equal(result.patched.length, 1, 'squad patched due to leader drift');
  assert.ok(result.patched.includes('elite-squad'));

  const putCalls = calls.filter((c) => c.method === 'PUT');
  const deleteCalls = calls.filter((c) => c.method === 'DELETE');
  assert.equal(putCalls.length, 1, '1 PUT for leader update');
  assert.equal(deleteCalls.length, 0, 'no DELETE — squad not recreated');

  const putBody = putCalls[0].body;
  assert.equal(putBody.leader_id, 'id-new-leader', 'PUT uses new leader id');
});

// ---------------------------------------------------------------------------
// Scenario 4: Removed squad — in Multica but not in yaml → warn, not deleted
// ---------------------------------------------------------------------------

test('removed squad — warns but does NOT delete; removed array returned', async () => {
  const calls = [];
  const agents = [agent('leader-a', 'id-leader-a'), agent('leader-b', 'id-leader-b')];
  const orphanSquad = squad('orphan-squad', 'id-leader-b', 'squad-orphan');
  const keepSquad = squad('keep-squad', 'id-leader-a', 'squad-keep');
  const keepMembers = [membership('id-leader-a', 'leader', 'squad-keep')];
  const membersBySquadId = new Map([['squad-keep', keepMembers]]);

  const httpJsonFn = makeHttpJsonFn({
    existingAgents: agents,
    existingSquads: [keepSquad, orphanSquad],
    membersBySquadId,
    calls,
  });
  // Only keep-squad in desired yaml — orphan-squad is stale
  const loadSquadsConfigFn = makeLoadSquadsConfigFn([
    desiredSquad('keep-squad', 'leader-a', ['leader-a']),
  ]);

  const warnMessages = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnMessages.push(args.join(' '));

  try {
    const result = await reconcileSquadsWithDeps({
      serverUrl: SERVER_URL,
      token: TOKEN,
      workspaceId: WORKSPACE_ID,
      consent: true,
      httpJsonFn,
      loadSquadsConfigFn,
    });

    assert.equal(result.removed.length, 1, '1 removed squad reported');
    assert.ok(result.removed.includes('orphan-squad'), 'orphan-squad in removed list');

    const orphanWarn = warnMessages.find((m) => m.includes('orphan-squad'));
    assert.ok(orphanWarn, 'console.warn mentions orphan-squad');
    assert.ok(orphanWarn.includes('skipping deletion for safety'), 'warn includes safety message');

    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'no DELETE calls — orphan squad not deleted');
  } finally {
    console.warn = originalWarn;
  }
});
