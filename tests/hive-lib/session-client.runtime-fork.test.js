/**
 * Exhaustive runtime fork coverage for session-client.js substrate dispatch.
 *
 * Story s8-a4-substrate-flag-default-flip. Covers the four substrate/adapter
 * states plus the derived cloud_mode helper and precedence logging.
 *
 * Run: node tests/hive-lib/session-client.runtime-fork.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SDK_NAME = '@anthropic-ai/sdk';

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

function makeTempFile(name, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-client-runtime-fork-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, value, 'utf8');
  return file;
}

function withPatchedConsole(method, fn) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => {
    calls.push(args.map((arg) => String(arg)).join(' '));
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => {
      console[method] = original;
    });
}

async function withEnv(tempEnv, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(tempEnv)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function makeMessagesClient(recordedCalls) {
  return {
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
  };
}

async function runSessionWithMessagesStub(sessionClient, recordedCalls, overrides) {
  const messagesSession = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'messages-session.js'));
  messagesSession.__setClientFactoryForTesting(() => makeMessagesClient(recordedCalls));
  try {
    return await sessionClient.runSession({
      system: 'sys',
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
      ...overrides,
    });
  } finally {
    messagesSession.__resetClientFactoryForTesting();
  }
}

test('case a — default config resolves to messages substrate and routes to messages-session', async () => {
  const restore = stubAnthropicSdk();
  try {
    await withEnv({ ANTHROPIC_API_KEY: 'test-key', HIVE_EXECUTION_SUBSTRATE: undefined }, async () => {
      const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));
      const recordedCalls = [];
      const result = await runSessionWithMessagesStub(sessionClient, recordedCalls, {});

      assert.equal(recordedCalls.length, 1, 'default substrate should route through messages.create');
      assert.equal(result.stopReason, 'end_turn');
    });
  } finally {
    restore();
  }
});

test('case b — sessions-cloud with cloud-adapter.enabled=true routes to the Sessions-API path', async () => {
  const restore = stubAnthropicSdk();
  const projectConfigPath = makeTempFile('hive.config.yaml', JSON.stringify({
    execution: { substrate: 'sessions-cloud' },
    'cloud-adapter': { enabled: true },
  }));

  try {
    await withEnv({ ANTHROPIC_API_KEY: 'test-key', HIVE_EXECUTION_SUBSTRATE: undefined }, async () => {
      const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));
      await assert.rejects(
        () => sessionClient.runSession({
          system: 'sys',
          tools: [],
          messages: [{ role: 'user', content: 'go' }],
          budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
          projectConfigPath,
        }),
        (err) => {
          const message = String(err && err.message || '');
          assert.match(message, /cloud|bootstrap|agent_id|environment_id|sessions/i);
          return true;
        },
      );
    });
  } finally {
    restore();
  }
});

test('case c — sessions-cloud with cloud-adapter.enabled=false fails fast with a capability error', async () => {
  const restore = stubAnthropicSdk();
  const projectConfigPath = makeTempFile('hive.config.yaml', JSON.stringify({
    execution: { substrate: 'sessions-cloud' },
    'cloud-adapter': { enabled: false },
  }));

  try {
    await withEnv({ ANTHROPIC_API_KEY: 'test-key', HIVE_EXECUTION_SUBSTRATE: undefined }, async () => {
      const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));
      await assert.rejects(
        () => sessionClient.runSession({
          system: 'sys',
          tools: [],
          messages: [{ role: 'user', content: 'go' }],
          budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
          projectConfigPath,
        }),
        (err) => {
          assert.equal(err.code, 'CapabilityError');
          assert.match(String(err.message), /cloud-adapter\.enabled|enable.*cloud.*adapter/i);
          return true;
        },
      );
    });
  } finally {
    restore();
  }
});

test('case d — messages with leftover cloud-adapter.enabled=true warns and still routes to messages', async () => {
  const restore = stubAnthropicSdk();
  const projectConfigPath = makeTempFile('hive.config.yaml', JSON.stringify({
    execution: { substrate: 'messages' },
    'cloud-adapter': { enabled: true },
  }));

  try {
    await withEnv({ ANTHROPIC_API_KEY: 'test-key', HIVE_EXECUTION_SUBSTRATE: undefined }, async () => {
      const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));
      const recordedCalls = [];

      await withPatchedConsole('warn', async (warnCalls) => {
        const result = await runSessionWithMessagesStub(sessionClient, recordedCalls, { projectConfigPath });
        assert.equal(recordedCalls.length, 1, 'messages route should still execute');
        assert.equal(result.stopReason, 'end_turn');
        assert.equal(warnCalls.length, 1, 'leftover cloud adapter flag should warn once');
        assert.match(warnCalls[0], /cloud-adapter\.enabled|ignored|messages/i);
      });
    });
  } finally {
    restore();
  }
});

test('case e — runtime-mode.getCloudMode is derived from execution.substrate only', () => {
  const runtimeMode = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'runtime-mode.js'));

  assert.equal(runtimeMode.getCloudMode({
    execution: { substrate: 'sessions-cloud' },
    'cloud-adapter': { enabled: false },
    cloud_mode: false,
  }), true);

  assert.equal(runtimeMode.getCloudMode({
    execution: { substrate: 'messages' },
    'cloud-adapter': { enabled: true },
    cloud_mode: true,
  }), false);
});

test('case f — env substrate overrides project config and logs only structured resolution metadata', async () => {
  const restore = stubAnthropicSdk();
  const projectConfigPath = makeTempFile('hive.config.yaml', JSON.stringify({
    execution: { substrate: 'sessions-cloud' },
    'cloud-adapter': { enabled: true },
  }));

  try {
    await withEnv({
      ANTHROPIC_API_KEY: 'test-key',
      HIVE_EXECUTION_SUBSTRATE: 'messages',
    }, async () => {
      const sessionClient = freshRequire(path.join(REPO_ROOT, 'hive', 'lib', 'session-client.js'));
      const recordedCalls = [];

      await withPatchedConsole('info', async (infoCalls) => {
        const result = await runSessionWithMessagesStub(sessionClient, recordedCalls, { projectConfigPath });
        assert.equal(recordedCalls.length, 1, 'env override should force messages route');
        assert.equal(result.stopReason, 'end_turn');

        const line = infoCalls.find((entry) => entry.includes('substrate.resolved_from=env'));
        assert.ok(line, `expected startup precedence log, got: ${infoCalls.join('\n')}`);
        assert.match(line, /substrate\.resolved_from=env/);
        assert.match(line, /substrate\.conflict=true/);
        assert.doesNotMatch(line, /\bsessions-cloud\b/);
        assert.doesNotMatch(line, /\bmessages\b/);
      });
    });
  } finally {
    restore();
  }
});
