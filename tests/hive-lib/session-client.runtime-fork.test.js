/**
 * Delegation test for session-client.js runtime fork.
 *
 * Story s5-a2-messages-session-loop. Scope: ONE delegation test only —
 * full coverage of the substrate-fork ships at S8 / A4.
 *
 * Asserts: when execution.substrate === 'messages', session-client's
 * delegation entry point routes to messages-session.runMessagesSession()
 * instead of touching the Sessions-API path.
 *
 * Run: node tests/hive-lib/session-client.runtime-fork.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SDK_NAME = '@anthropic-ai/sdk';

/**
 * The real session-client.js does `require('@anthropic-ai/sdk')` at module
 * load time and throws if absent (line 14-19 in session-client.js). The SDK
 * is not installed in this repo's test environment, so we stub the resolver
 * to hand back a no-op constructor before any require triggers it.
 */
function stubAnthropicSdk() {
  const origResolve = Module._resolveFilename;
  const origLoad = Module._load;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === SDK_NAME) return SDK_NAME;
    return origResolve.call(this, request, parent, ...rest);
  };
  Module._load = function (request, parent, ...rest) {
    if (request === SDK_NAME) {
      return function FakeAnthropic() { return { beta: { sessions: {} } }; };
    }
    return origLoad.call(this, request, parent, ...rest);
  };
  return () => {
    Module._resolveFilename = origResolve;
    Module._load = origLoad;
  };
}

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

test('delegation — execution.substrate "messages" routes to messages-session.runMessagesSession', async () => {
  const restore = stubAnthropicSdk();
  try {
    // Make ANTHROPIC_API_KEY present so the legacy Sessions-API path would
    // not bail on AUTH_MISSING — that way if delegation accidentally falls
    // through, we'd see a different error than what we assert.
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';

    try {
      const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));

      assert.equal(typeof sessionClient.runSession, 'function',
        'session-client must export runSession (delegation entry point)');

      // Inject recording into messages-session via its testing seam so we
      // can confirm the delegation actually called runMessagesSession.
      const messagesSession = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'messages-session.js'));
      const recordedCalls = [];
      messagesSession.__setClientFactoryForTesting(() => ({
        messages: {
          async create(args) {
            recordedCalls.push(args);
            return {
              id: 'msg_x',
              role: 'assistant',
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: 'ok' }],
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      }));

      const result = await sessionClient.runSession({
        substrate: 'messages',
        system: 'sys',
        tools: [],
        messages: [{ role: 'user', content: 'go' }],
        budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
      });

      assert.equal(recordedCalls.length, 1, 'delegation called messages.create exactly once');
      assert.equal(result.stopReason, 'end_turn');
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  } finally {
    restore();
  }
});

test('delegation — non-messages substrate is a no-op stub today (sessions-cloud path is S8 territory)', async () => {
  const restore = stubAnthropicSdk();
  try {
    const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));
    // Either runSession exists and rejects with a clear "not yet implemented"
    // for non-messages substrate, OR sessions-cloud falls through to a
    // recognizable error. Either way: it must NOT silently succeed.
    await assert.rejects(
      () => sessionClient.runSession({
        substrate: 'sessions-cloud',
        system: 'sys',
        tools: [],
        messages: [{ role: 'user', content: 'go' }],
        budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
      }),
      (err) => {
        // Accepts either a "not implemented" sentinel or an unknown-substrate sentinel.
        const msg = String(err && err.message || '');
        assert.ok(
          /not.{0,5}implemented|sessions-cloud|unsupported|S8|substrate/i.test(msg),
          `expected substrate-related error, got: ${msg}`,
        );
        return true;
      },
    );
  } finally {
    restore();
  }
});
