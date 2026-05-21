import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDispatchLoop } from '../../hive/lib/plan-phase-d/dispatch-loop.mjs';

class MockDispatch {
  constructor(responses = []) {
    this.invocations = [];
    this.responses = responses;
  }

  async invoke(method, params) {
    this.invocations.push({ method, params });
    return this.responses.shift() ?? {
      ok: true,
      result: {
        id: `plugin-hive/PLU-${this.invocations.length}`,
        url: `https://multica.test/plugin-hive/issues/${this.invocations.length}`,
      },
    };
  }
}

function stories(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `story-${i + 1}`,
    title: `Story ${i + 1}`,
    description: `Body ${i + 1}`,
    labels: ['hive:story'],
    parent_id: null,
  }));
}

test('AC1 adapter multica publishes three stories and writes tracker fields', async () => {
  const input = stories(3);
  const dispatch = new MockDispatch();

  const result = await runDispatchLoop({
    stories: input,
    dispatch,
    config: { adapter: 'multica' },
  });

  assert.equal(result.ok, true);
  assert.equal(dispatch.invocations.length, 3);
  assert.deepEqual(dispatch.invocations.map((i) => i.method), [
    'createStory',
    'createStory',
    'createStory',
  ]);
  assert.deepEqual(input.map((s) => s.tracker_id), [
    'plugin-hive/PLU-1',
    'plugin-hive/PLU-2',
    'plugin-hive/PLU-3',
  ]);
  assert.deepEqual(input.map((s) => s.tracker_url), [
    'https://multica.test/plugin-hive/issues/1',
    'https://multica.test/plugin-hive/issues/2',
    'https://multica.test/plugin-hive/issues/3',
  ]);
});

test('AC2 adapter github does not invoke a multica-specific path', async () => {
  let multicaInvoked = false;
  const dispatch = new MockDispatch([
    { ok: true, result: { id: 'owner/repo#1', url: 'https://github.test/owner/repo/issues/1' } },
  ]);
  dispatch.invokeMultica = async () => {
    multicaInvoked = true;
  };

  await runDispatchLoop({
    stories: stories(1),
    dispatch,
    config: { adapter: 'github' },
  });

  assert.equal(dispatch.invocations.length, 1);
  assert.equal(dispatch.invocations[0].method, 'createStory');
  assert.equal(multicaInvoked, false);
});

test('AC3 adapter null leaves stories local-only with no dispatch invocations', async () => {
  const input = stories(2);
  const dispatch = new MockDispatch();

  const result = await runDispatchLoop({
    stories: input,
    dispatch,
    config: { adapter: null },
  });

  assert.equal(result.ok, true);
  assert.equal(dispatch.invocations.length, 0);
  assert.deepEqual(input.map((s) => s.tracker_id), [undefined, undefined]);
  assert.deepEqual(input.map((s) => s.tracker_url), [undefined, undefined]);
});

test('AC4 RATE_LIMIT waits per retry_after_ms, retries, and continues', async () => {
  const input = stories(2);
  const dispatch = new MockDispatch([
    {
      ok: false,
      recoverable: true,
      code: 'RATE_LIMIT',
      message: 'slow down',
      retry_after_ms: 25,
    },
    {
      ok: false,
      recoverable: true,
      code: 'RATE_LIMIT',
      message: 'still slow',
      retry_after_ms: 50,
    },
    {
      ok: true,
      result: { id: 'plugin-hive/PLU-1', url: 'https://multica.test/plugin-hive/issues/1' },
    },
  ]);
  const waits = [];
  const rateLimitEvents = [];

  const result = await runDispatchLoop({
    stories: input,
    dispatch,
    config: { adapter: 'multica' },
    onRateLimit: (ms) => rateLimitEvents.push(ms),
    sleep: async (ms) => waits.push(ms),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(waits, [25, 50]);
  assert.deepEqual(rateLimitEvents, [25, 50]);
  assert.equal(dispatch.invocations.length, 4);
  assert.equal(input[0].tracker_id, 'plugin-hive/PLU-1');
  assert.equal(input[1].tracker_id, 'plugin-hive/PLU-4');
});

test('AC5 AUTH_FAILURE mentions /hive:multica-init and aborts without later tracker state', async () => {
  const input = stories(3);
  const authMessages = [];
  const dispatch = new MockDispatch([
    {
      ok: true,
      result: { id: 'plugin-hive/PLU-1', url: 'https://multica.test/plugin-hive/issues/1' },
    },
    {
      ok: false,
      recoverable: false,
      code: 'AUTH_FAILURE',
      message: 'No Multica credentials',
    },
  ]);

  const result = await runDispatchLoop({
    stories: input,
    dispatch,
    config: { adapter: 'multica' },
    onAuthFailure: (message) => authMessages.push(message),
  });

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.code, 'AUTH_FAILURE');
  assert.match(result.message, /\/hive:multica-init/);
  assert.match(authMessages[0], /\/hive:multica-init/);
  assert.equal(dispatch.invocations.length, 2);
  assert.equal(input[0].tracker_id, 'plugin-hive/PLU-1');
  assert.equal(input[1].tracker_id, undefined);
  assert.equal(input[2].tracker_id, undefined);
});
