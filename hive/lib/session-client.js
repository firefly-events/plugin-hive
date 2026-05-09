/**
 * Session Client
 *
 * HTTPS client for the Anthropic Managed Agents API:
 *   POST /v1/sessions                  — create session
 *   POST /v1/sessions/{id}/events      — send events
 *   SSE  /v1/sessions/{id}/events      — stream events (via @anthropic-ai/sdk)
 *
 * All requests include the required managed-agents-2026-04-01 beta header.
 */

'use strict';

let Anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk');
} catch {
  throw new Error('@anthropic-ai/sdk not available — run: npm install @anthropic-ai/sdk');
}

const REQUIRED_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

/**
 * Build an Anthropic SDK client instance.
 * @returns {Object} Anthropic SDK client
 */
function buildClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY not set');
    err.code = 'AUTH_MISSING';
    throw err;
  }
  return new Anthropic({ apiKey, defaultHeaders: REQUIRED_HEADERS });
}

/**
 * Create a new Managed Agent session.
 * @param {string} agentId - pre-registered agent ID
 * @param {string} environmentId - environment ID
 * @returns {Promise<string>} session_id
 */
async function createSession(agentId, environmentId) {
  const client = buildClient();
  let response;
  try {
    response = await client.beta.sessions.create({
      agent: agentId,
      environment_id: environmentId,
    });
  } catch (err) {
    err.code = classifyError(err);
    throw err;
  }
  if (!response || !response.id) {
    const err = new Error(`createSession: unexpected response shape — ${JSON.stringify(response)}`);
    err.code = 'API_5XX';
    throw err;
  }
  return response.id;
}

/**
 * Send one or more events to an existing session.
 * @param {string} sessionId
 * @param {Array<Object>} events - array of event objects (user.message, user.custom_tool_result, etc.)
 * @returns {Promise<void>}
 */
async function sendEvents(sessionId, events) {
  const client = buildClient();
  try {
    await client.beta.sessions.events.send(sessionId, { events });
  } catch (err) {
    err.code = classifyError(err);
    throw err;
  }
}

/**
 * Stream SSE events from a session.
 * Returns an async iterable that yields raw SSE event objects.
 * @param {string} sessionId
 * @returns {AsyncIterable<Object>}
 */
async function* streamEvents(sessionId) {
  const client = buildClient();
  let stream;
  try {
    stream = await client.beta.sessions.events.stream(sessionId);
  } catch (err) {
    err.code = classifyError(err);
    throw err;
  }
  for await (const event of stream) {
    yield event;
  }
}

/**
 * Classify an Anthropic SDK error into one of the defined error codes.
 * @param {Error} err
 * @returns {string} error code
 */
function classifyError(err) {
  const status = err.status || (err.response && err.response.status);
  const msg = (err.message || '').toLowerCase();

  if (status === 401 || msg.includes('auth') || msg.includes('api key')) return 'AUTH_INVALID';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 413 || msg.includes('context') || msg.includes('too long')) return 'CONTEXT_OVERFLOW';
  if (msg.includes('content') && msg.includes('filter')) return 'CONTENT_FILTER';
  if (status >= 500) return 'API_5XX';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) return 'NETWORK';
  return 'API_5XX';
}

/**
 * Register a Hive session row in the registry, stamping the Claude Code
 * harness session id (process.env.CLAUDE_CODE_SESSION_ID) onto the row's
 * `cc_session_id` correlation column when present.
 *
 * Env-var pickup is centralized HERE — upstream of substrate selection in
 * runSession() — so the same correlation behavior holds regardless of
 * whether the caller subsequently drives the legacy Sessions-API path or
 * the Messages-API substrate. Per binding decision
 * `claude-code-session-id-precedence`, the Hive `sessionId` argument
 * remains canonical for KG triples; cc_session_id sits alongside as
 * correlation only.
 *
 * Empty-string env var is treated as unset (no key written) so YAML stays
 * clean. Existing registry rows without the column remain valid.
 *
 * @param {string} sessionId - canonical Hive session id (KG-canonical)
 * @param {Object} fields - any subset of the session entry schema
 * @param {string} [registryPath] - override default path (for testing)
 * @returns {Promise<void>}
 */
async function registerSession(sessionId, fields, registryPath) {
  const { upsert } = require('./session-registry');
  const ccId = process.env.CLAUDE_CODE_SESSION_ID;
  const stamped = (typeof ccId === 'string' && ccId.length > 0)
    ? { ...fields, cc_session_id: ccId }
    : { ...fields };
  await upsert(sessionId, stamped, registryPath);
}

/**
 * Delegation entry point — routes by execution.substrate.
 *
 * substrate: 'messages'        → hive/lib/messages-session.js (S5/A2)
 * substrate: 'sessions-cloud'  → cloud bootstrap (deferred to S8/A4 + Hive Cloud epic)
 *
 * Default substrate is NOT flipped here; that ships in S8 / A4. Until then
 * this entry point is reachable only when a caller explicitly requests
 * substrate: 'messages' (e.g. the test harness).
 *
 * @param {Object} opts
 * @param {string} opts.substrate
 * @param {string} opts.system
 * @param {Array<Object>} opts.tools
 * @param {Array<Object>} opts.messages
 * @param {Function} [opts.toolHandler]
 * @param {Object} [opts.budget]
 * @returns {Promise<{messages, stopReason, usage, terminationReason?}>}
 */
async function runSession(opts) {
  const substrate = opts && opts.substrate;
  if (substrate === 'messages') {
    const { runMessagesSession } = require('./messages-session');
    return runMessagesSession(opts);
  }
  if (substrate === 'sessions-cloud') {
    const err = new Error(
      'sessions-cloud substrate not yet implemented — cloud bootstrap (agent_id + environment_id provisioning) ' +
      'is deferred to the Hive Cloud epic. See hive/references/session-system-prompt-spec.md §7 cloud adapter footnote.',
    );
    err.code = 'SubstrateNotImplemented';
    throw err;
  }
  const err = new Error(`unsupported execution.substrate: ${substrate}`);
  err.code = 'UnknownSubstrate';
  throw err;
}

module.exports = { createSession, sendEvents, streamEvents, classifyError, runSession, registerSession };
