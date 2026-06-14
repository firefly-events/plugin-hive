import assert from 'node:assert/strict';
import test from 'node:test';

import { readSquadEvaluation } from '../index.mjs';

const SERVER = 'https://multica.test';
const TOKEN = 'tok_abc123';
const WORKSPACE = 'ws-1';
const ISSUE_ID = 'issue-uuid-1';

function makeOptions() {
  return { serverUrl: SERVER, token: TOKEN, workspaceId: WORKSPACE };
}

function makeEntry(overrides = {}) {
  return {
    type: 'activity',
    action: 'squad_leader_evaluated',
    actor_type: 'agent',
    actor_id: 'agent-uuid-1',
    created_at: '2026-06-14T10:00:00Z',
    details: { outcome: 'action', reason: 'Story meets all acceptance criteria.' },
    ...overrides,
  };
}

// --- happy path ---

test('happy path: returns evaluation from most-recent squad_leader_evaluated entry', async (t) => {
  const older = makeEntry({ created_at: '2026-06-13T08:00:00Z', details: { outcome: 'no_action', reason: 'too early' } });
  const newer = makeEntry({ created_at: '2026-06-14T10:00:00Z', details: { outcome: 'action', reason: 'done' } });

  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ entries: [older, newer] }),
  });

  const result = await readSquadEvaluation(ISSUE_ID, makeOptions());
  assert.deepEqual(result, {
    evaluation: {
      actor_type: 'agent',
      actor_id: 'agent-uuid-1',
      outcome: 'action',
      reason: 'done',
      created_at: '2026-06-14T10:00:00Z',
    },
  });
});

test('happy path: works when timeline returns bare array', async (t) => {
  const entry = makeEntry();
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify([entry]),
  });

  const result = await readSquadEvaluation(ISSUE_ID, makeOptions());
  assert.equal(result.evaluation?.outcome, 'action');
});

// --- no-eval path ---

test('no-eval: returns { evaluation: null } when timeline is empty', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ entries: [] }),
  });

  const result = await readSquadEvaluation(ISSUE_ID, makeOptions());
  assert.deepEqual(result, { evaluation: null });
});

test('no-eval: returns { evaluation: null } when no squad_leader_evaluated entries present', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ entries: [
      { type: 'comment', action: null, actor_type: 'member', actor_id: 'u1', created_at: '2026-06-14T10:00:00Z', details: {} },
    ] }),
  });

  const result = await readSquadEvaluation(ISSUE_ID, makeOptions());
  assert.deepEqual(result, { evaluation: null });
});

// --- auth failure ---

test('auth failure: HTTP 401 is rethrown as AUTH_FAILURE with multica-init hint', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 401,
    text: async () => JSON.stringify({ message: 'Unauthorized' }),
  });

  await assert.rejects(
    () => readSquadEvaluation(ISSUE_ID, makeOptions()),
    (err) => {
      assert.equal(err?.code, 'AUTH_FAILURE');
      assert.match(err?.hint ?? '', /multica-init/);
      return true;
    },
  );
});

test('auth failure: HTTP 403 is rethrown as AUTH_FAILURE with multica-init hint', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 403,
    text: async () => JSON.stringify({ message: 'Forbidden' }),
  });

  await assert.rejects(
    () => readSquadEvaluation(ISSUE_ID, makeOptions()),
    (err) => {
      assert.equal(err?.code, 'AUTH_FAILURE');
      assert.match(err?.hint ?? '', /multica-init/);
      return true;
    },
  );
});

// --- transport errors ---

test('transport error: network failure propagates as TRANSPORT error', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

  await assert.rejects(
    () => readSquadEvaluation(ISSUE_ID, makeOptions()),
    (err) => {
      assert.equal(err?.code, 'TRANSPORT');
      return true;
    },
  );
});

// --- read-only guard ---

test('does not mutate state: result contains no status field', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ entries: [makeEntry()] }),
  });

  const result = await readSquadEvaluation(ISSUE_ID, makeOptions());
  assert.ok(!('status' in result), 'result must not include a status field');
  assert.ok(!('was_updated' in result), 'result must not include a was_updated field');
});
