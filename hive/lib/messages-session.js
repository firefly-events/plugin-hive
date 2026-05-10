/**
 * Messages-API session loop
 *
 * Caller-side session loop wrapping client.messages.create. Per
 * hive/references/session-system-prompt-spec.md §1, the orchestrator owns
 * conversation state, dispatches tool calls locally, and decides when the
 * agent is done. There is no server-side agent runtime in the default path.
 *
 * Public surface:
 *   runMessagesSession({ system, tools, messages, toolHandler, budget, model, max_tokens })
 *     → { messages, stopReason, usage, terminationReason? }
 *
 * Termination:
 *   - end_turn       → stopReason: 'end_turn'
 *   - per-turn cap   → stopReason: 'budget',  terminationReason: 'turn_budget'
 *   - per-story cap  → stopReason: 'budget',  terminationReason: 'story_budget'
 *
 * Credential isolation:
 *   ANTHROPIC_API_KEY is read in exactly one place — buildClient() — and
 *   never threaded through system / tools / messages / handler args.
 *   See AC #8 (security:plan-audit minor closure).
 *
 * Wave 3 boundaries:
 *   - prior_knowledge_block composition lives in S6 / A3, not here.
 *   - cc_session_id correlation lives in S7 / A6, not here.
 *   - session-turn-builder gating lives in S9 / A5, not here.
 */

'use strict';

const REQUIRED_HEADERS = {
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
};

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Lazy-load the Anthropic SDK and construct a client.
 * THIS IS THE ONLY SITE THAT READS process.env.ANTHROPIC_API_KEY.
 * Wrap any failure in MessagesApiUnavailable so callers get a clean error.
 */
function buildClient() {
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (err) {
    const wrapped = new Error('@anthropic-ai/sdk not available — run: npm install @anthropic-ai/sdk');
    wrapped.code = 'MessagesApiUnavailable';
    wrapped.cause = err;
    throw wrapped;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY not set');
    err.code = 'MessagesApiUnavailable';
    throw err;
  }
  return new Anthropic({ apiKey, defaultHeaders: REQUIRED_HEADERS });
}

let _clientFactory = buildClient;

/** Test seam: inject a fake client factory. Production code never calls this. */
function __setClientFactoryForTesting(fn) {
  _clientFactory = fn;
}

/** Test seam: restore the production client factory. */
function __resetClientFactoryForTesting() {
  _clientFactory = buildClient;
}

/**
 * Run a Messages-API session loop.
 *
 * @param {Object} opts
 * @param {string} opts.system - composed system prompt (persona + prior knowledge + KG context)
 * @param {Array<Object>} opts.tools - tool schemas in Messages-API form
 * @param {Array<Object>} opts.messages - conversation history (mutated by append)
 * @param {Function} [opts.toolHandler] - async (block) => string|object — required when tools are present
 * @param {Object} [opts.budget]
 * @param {number} [opts.budget.max_tool_iterations=25] - per-turn cap on tool-use cycles
 * @param {number} [opts.budget.story_token_limit=Infinity] - cumulative input+output token cap
 * @param {string} [opts.model]
 * @param {number} [opts.max_tokens]
 * @returns {Promise<{messages, stopReason, usage, terminationReason?}>}
 */
async function runMessagesSession({ system, tools, messages, toolHandler, budget, model, max_tokens }) {
  let client;
  try {
    client = _clientFactory();
  } catch (err) {
    if (err && err.code === 'MessagesApiUnavailable') throw err;
    const wrapped = new Error(`Messages API client unavailable: ${err && err.message ? err.message : err}`);
    wrapped.code = 'MessagesApiUnavailable';
    wrapped.cause = err;
    throw wrapped;
  }

  const maxIterations = (budget && Number.isFinite(budget.max_tool_iterations)) ? budget.max_tool_iterations : 25;
  const storyTokenLimit = (budget && Number.isFinite(budget.story_token_limit)) ? budget.story_token_limit : Infinity;

  const conversation = messages.slice(); // do not mutate caller's array
  const usage = { input_tokens: 0, output_tokens: 0 };
  let iterations = 0;
  let lastUsage = null;

  while (true) {
    if (iterations >= maxIterations) {
      return { messages: conversation, stopReason: 'budget', usage, terminationReason: 'turn_budget' };
    }

    const response = await client.messages.create({
      model: model || DEFAULT_MODEL,
      max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
      system,
      tools,
      messages: conversation.slice(),
    });

    if (response.usage) {
      usage.input_tokens += (response.usage.input_tokens || 0);
      usage.output_tokens += (response.usage.output_tokens || 0);
      lastUsage = response.usage;
    }

    if (response.stop_reason === 'end_turn') {
      conversation.push({ role: 'assistant', content: response.content });
      return {
        messages: conversation,
        stopReason: 'end_turn',
        usage,
        lastTurnUsage: lastUsage,
      };
    }

    if (response.stop_reason === 'tool_use') {
      // tool_use cycle: append assistant verbatim, dispatch every tool_use,
      // append a single user message with one tool_result per tool_use.
      conversation.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((b) => b && b.type === 'tool_use');
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (typeof toolHandler !== 'function') {
          const err = new Error(`toolHandler missing — model emitted tool_use ${block.name}`);
          err.code = 'NoToolHandler';
          throw err;
        }
        const result = await toolHandler(block);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      conversation.push({ role: 'user', content: toolResults });

      iterations += 1;

      if (usage.input_tokens + usage.output_tokens >= storyTokenLimit) {
        return { messages: conversation, stopReason: 'budget', usage, terminationReason: 'story_budget' };
      }
      continue;
    }

    if (response.stop_reason === 'max_tokens') {
      conversation.push({ role: 'assistant', content: response.content });
      return { messages: conversation, stopReason: 'max_tokens', usage, terminationReason: 'response_max_tokens' };
    }

    if (response.stop_reason === 'stop_sequence') {
      conversation.push({ role: 'assistant', content: response.content });
      return { messages: conversation, stopReason: 'stop_sequence', usage, terminationReason: 'stop_sequence' };
    }

    if (response.stop_reason === 'pause_turn') {
      conversation.push({ role: 'assistant', content: response.content });
      return { messages: conversation, stopReason: 'pause_turn', usage, terminationReason: 'pause_turn' };
    }

    if (response.stop_reason === 'refusal') {
      conversation.push({ role: 'assistant', content: response.content });
      return { messages: conversation, stopReason: 'refusal', usage, terminationReason: 'refusal' };
    }

    if (response.stop_reason === 'model_context_window_exceeded') {
      conversation.push({ role: 'assistant', content: response.content });
      return {
        messages: conversation,
        stopReason: 'model_context_window_exceeded',
        usage,
        terminationReason: 'model_context_window_exceeded',
      };
    }

    {
      const err = new Error(`unexpected stop_reason: ${response.stop_reason}`);
      err.code = 'UnexpectedStopReason';
      err.stop_reason = response.stop_reason;
      throw err;
    }
  }
}

module.exports = {
  runMessagesSession,
  buildClient,
  __setClientFactoryForTesting,
  __resetClientFactoryForTesting,
};
