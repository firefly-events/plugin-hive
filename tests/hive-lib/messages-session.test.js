/**
 * Contract tests for hive/lib/messages-session.js
 *
 * Story s5-a2-messages-session-loop. TDD: written RED before implementation.
 * Run: node tests/hive-lib/messages-session.test.js
 *
 * Five cases:
 *   a) request shape — system + tools + messages forwarded to client.messages.create
 *   b) tool_use ↔ tool_result append cycle
 *   c) end_turn primary terminator
 *   d) per-turn / per-story budget secondary terminators
 *   e) credential-propagation guard — ANTHROPIC_API_KEY=test-sentinel never
 *      appears in any captured arg outside buildClient() construction.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', '..', 'hive', 'lib', 'messages-session.js');

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

/**
 * Build a fake Anthropic client whose .messages.create returns scripted
 * responses in order, recording every call's args.
 */
function makeRecordingClient(scriptedResponses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    messages: {
      async create(args) {
        calls.push(args);
        const next = scriptedResponses[i++];
        if (!next) {
          throw new Error(`fake client: no scripted response at index ${i - 1}`);
        }
        return next;
      },
    },
  };
}

/** Recursively scan a value for a substring; report first path that contains it. */
function findSubstring(value, needle, pathStr = '$') {
  if (value == null) return null;
  if (typeof value === 'string') {
    return value.includes(needle) ? pathStr : null;
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let idx = 0; idx < value.length; idx++) {
      const hit = findSubstring(value[idx], needle, `${pathStr}[${idx}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const hit = findSubstring(value[key], needle, `${pathStr}.${key}`);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Case (a): request shape
// ---------------------------------------------------------------------------
test('case a — system + tools + messages forwarded verbatim to client.messages.create', async () => {
  const { runMessagesSession, __setClientFactoryForTesting } = loadModule();
  const client = makeRecordingClient([
    {
      id: 'msg_01',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  ]);
  __setClientFactoryForTesting(() => client);

  const system = '# Researcher\nYou are precise.';
  const tools = [{ name: 'Read', description: 'r', input_schema: { type: 'object', properties: {} } }];
  const messages = [{ role: 'user', content: 'Find X.' }];

  const result = await runMessagesSession({ system, tools, messages, budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 } });

  assert.equal(client.calls.length, 1, 'one API call');
  const sent = client.calls[0];
  assert.equal(sent.system, system, 'system forwarded verbatim');
  assert.deepEqual(sent.tools, tools, 'tools forwarded verbatim');
  assert.deepEqual(sent.messages, messages, 'messages forwarded verbatim');
  assert.ok(typeof sent.model === 'string' && sent.model.length > 0, 'model populated');
  assert.ok(typeof sent.max_tokens === 'number' && sent.max_tokens > 0, 'max_tokens populated');

  assert.equal(result.stopReason, 'end_turn');
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 5 });
});

// ---------------------------------------------------------------------------
// Case (b): tool_use ↔ tool_result append cycle
// ---------------------------------------------------------------------------
test('case b — tool_use dispatched to handler, tool_result appended, loop continues', async () => {
  const { runMessagesSession, __setClientFactoryForTesting } = loadModule();
  const turn1Assistant = {
    id: 'msg_a',
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: 'searching' },
      { type: 'tool_use', id: 'toolu_01', name: 'Grep', input: { pattern: 'foo' } },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  const turn2Assistant = {
    id: 'msg_b',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'found it' }],
    usage: { input_tokens: 12, output_tokens: 4 },
  };
  const client = makeRecordingClient([turn1Assistant, turn2Assistant]);
  __setClientFactoryForTesting(() => client);

  const handlerCalls = [];
  const toolHandler = async (block) => {
    handlerCalls.push(block);
    return 'hive/lib/messages-session.js:42:  match';
  };

  const result = await runMessagesSession({
    system: 'sys',
    tools: [{ name: 'Grep', description: 'g', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: 'find foo' }],
    toolHandler,
    budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
  });

  assert.equal(client.calls.length, 2, 'two API calls (one tool-use cycle)');
  assert.equal(handlerCalls.length, 1, 'tool handler invoked once');
  assert.equal(handlerCalls[0].id, 'toolu_01');
  assert.equal(handlerCalls[0].name, 'Grep');

  // Turn-2 request must have appended assistant message + tool_result user message
  const turn2 = client.calls[1];
  assert.equal(turn2.messages.length, 3, 'messages: original user + assistant + tool_result user');
  assert.equal(turn2.messages[1].role, 'assistant', 'assistant message appended verbatim');
  assert.deepEqual(turn2.messages[1].content, turn1Assistant.content, 'assistant content matches turn-1 verbatim');
  assert.equal(turn2.messages[2].role, 'user');
  const toolResultBlock = turn2.messages[2].content[0];
  assert.equal(toolResultBlock.type, 'tool_result');
  assert.equal(toolResultBlock.tool_use_id, 'toolu_01', 'tool_use_id matches');
  assert.equal(toolResultBlock.content, 'hive/lib/messages-session.js:42:  match');

  assert.equal(result.stopReason, 'end_turn');
});

// ---------------------------------------------------------------------------
// Case (c): end_turn primary terminator
// ---------------------------------------------------------------------------
test('case c — end_turn terminates loop and returns final messages + usage', async () => {
  const { runMessagesSession, __setClientFactoryForTesting } = loadModule();
  const finalAssistant = {
    id: 'msg_z',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'done' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  const client = makeRecordingClient([finalAssistant]);
  __setClientFactoryForTesting(() => client);

  const result = await runMessagesSession({
    system: 'sys',
    tools: [],
    messages: [{ role: 'user', content: 'go' }],
    budget: { max_tool_iterations: 25, story_token_limit: 1_000_000 },
  });

  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.messages.length, 2, 'original user + final assistant');
  assert.equal(result.messages[1].role, 'assistant');
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 50 });
});

// ---------------------------------------------------------------------------
// Case (d): per-turn AND per-story budget secondary terminators
// ---------------------------------------------------------------------------
test('case d1 — per-turn budget exhaustion (max_tool_iterations) terminates with stopReason: budget', async () => {
  const { runMessagesSession, __setClientFactoryForTesting } = loadModule();
  // Endlessly emit tool_use — forces the per-turn iteration counter to fire.
  const toolUseResp = (i) => ({
    id: `msg_${i}`,
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'Read', input: {} }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const client = makeRecordingClient([toolUseResp(1), toolUseResp(2), toolUseResp(3), toolUseResp(4)]);
  __setClientFactoryForTesting(() => client);

  const result = await runMessagesSession({
    system: 'sys',
    tools: [{ name: 'Read', description: 'r', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: 'go' }],
    toolHandler: async () => 'ok',
    budget: { max_tool_iterations: 2, story_token_limit: 1_000_000 },
  });

  assert.equal(result.stopReason, 'budget');
  assert.ok(result.terminationReason && /turn|iteration/.test(result.terminationReason), `terminationReason mentions turn/iteration: ${result.terminationReason}`);
  assert.ok(client.calls.length <= 3, `bounded by max_tool_iterations: ${client.calls.length}`);
});

test('case d2 — per-story token budget exhaustion terminates with stopReason: budget', async () => {
  const { runMessagesSession, __setClientFactoryForTesting } = loadModule();
  const toolUseResp = (i) => ({
    id: `msg_${i}`,
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'Read', input: {} }],
    usage: { input_tokens: 60, output_tokens: 60 }, // 120/turn → trips at turn 2 with limit 200
  });
  const client = makeRecordingClient([toolUseResp(1), toolUseResp(2), toolUseResp(3), toolUseResp(4)]);
  __setClientFactoryForTesting(() => client);

  const result = await runMessagesSession({
    system: 'sys',
    tools: [{ name: 'Read', description: 'r', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: 'go' }],
    toolHandler: async () => 'ok',
    budget: { max_tool_iterations: 100, story_token_limit: 200 },
  });

  assert.equal(result.stopReason, 'budget');
  assert.ok(result.terminationReason && /story|token/.test(result.terminationReason), `terminationReason mentions story/token: ${result.terminationReason}`);
});

// ---------------------------------------------------------------------------
// Case (e): credential-propagation guard
// ---------------------------------------------------------------------------
test('case e — ANTHROPIC_API_KEY=test-sentinel never appears outside buildClient()', async () => {
  const SENTINEL = 'test-sentinel-xyz-canary-9876';
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = SENTINEL;
  try {
    const { runMessagesSession, __setClientFactoryForTesting, __resetClientFactoryForTesting } = loadModule();

    // Reset to the production factory so we exercise the real buildClient
    // path; but override it with a recording client whose buildClient stub
    // ALSO records what arg it received. The factory IS the buildClient
    // construction site — the sentinel may appear inside the factory call,
    // and only there.
    const factoryCalls = [];
    const recordingClient = (() => {
      const c = makeRecordingClient([
        {
          id: 'msg_z',
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'toolu_e', name: 'Read', input: { file_path: '/tmp/x' } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        {
          id: 'msg_y',
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]);
      return c;
    })();
    __setClientFactoryForTesting(() => {
      // Capture the env-read site: only this closure may see the sentinel.
      factoryCalls.push({ apiKey: process.env.ANTHROPIC_API_KEY });
      return recordingClient;
    });

    const handlerCalls = [];
    await runMessagesSession({
      system: 'sys',
      tools: [{ name: 'Read', description: 'r', input_schema: { type: 'object', properties: {} } }],
      messages: [{ role: 'user', content: 'go' }],
      toolHandler: async (block) => {
        handlerCalls.push(block);
        return 'ok';
      },
      budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
    });

    // The factory MUST have been called (proving credential pickup is centralized there)
    assert.ok(factoryCalls.length >= 1, 'factory invoked at least once');

    // Now scan every captured arg outside the factory site:
    //   - every .messages.create arg (system, tools, messages)
    //   - every tool handler invocation arg
    for (let i = 0; i < recordingClient.calls.length; i++) {
      const hit = findSubstring(recordingClient.calls[i], SENTINEL, `client.calls[${i}]`);
      assert.equal(hit, null, `sentinel must NOT appear in client.messages.create args, found at: ${hit}`);
    }
    for (let i = 0; i < handlerCalls.length; i++) {
      const hit = findSubstring(handlerCalls[i], SENTINEL, `handlerCalls[${i}]`);
      assert.equal(hit, null, `sentinel must NOT appear in tool handler args, found at: ${hit}`);
    }
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

// ---------------------------------------------------------------------------
// Case (f): clean error when SDK / client unavailable (AC #5)
// ---------------------------------------------------------------------------
test('case f — runMessagesSession throws MessagesApiUnavailable when client init fails', async () => {
  const { runMessagesSession, __setClientFactoryForTesting } = loadModule();
  __setClientFactoryForTesting(() => {
    throw new Error('@anthropic-ai/sdk not available — run: npm install @anthropic-ai/sdk');
  });

  await assert.rejects(
    () => runMessagesSession({
      system: 'sys',
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      budget: { max_tool_iterations: 5, story_token_limit: 1_000_000 },
    }),
    (err) => {
      assert.equal(err.code, 'MessagesApiUnavailable', `expected code MessagesApiUnavailable, got ${err.code}`);
      return true;
    },
  );
});
