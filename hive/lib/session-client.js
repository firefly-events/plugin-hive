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
    await client.beta.sessions.events.create(sessionId, { events });
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

module.exports = { createSession, sendEvents, streamEvents, classifyError };
