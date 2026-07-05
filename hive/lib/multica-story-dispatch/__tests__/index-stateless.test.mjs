/**
 * Stateless MCP compat tests for the REST+Bearer wire (index.mjs httpJson).
 *
 * PLU-542 (epic mcp-stateless-behavior, cutover 2026-07-28): asserts the
 * outbound request never carries an Mcp-Session-Id (or other affinity)
 * header, and asserts resolution succeeds unchanged even when the response
 * carries Set-Cookie / Mcp-Session-Id — proving the client is
 * stateless-tolerant, not just that it omits affinity headers itself.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAgentUuidByName, __resetCache } from '../index.mjs';

const SERVER = 'https://multica.test';
const TOKEN = 'tok_abc123';
const WORKSPACE = 'ws-1';

test('outbound REST request carries no Mcp-Session-Id or affinity header', async (t) => {
  __resetCache();
  let capturedHeaders = null;

  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return {
      status: 200,
      text: async () => JSON.stringify({ agents: [{ id: 'agent-1', name: 'developer' }] }),
    };
  };

  await resolveAgentUuidByName(SERVER, TOKEN, WORKSPACE, 'developer');

  assert.ok(capturedHeaders, 'fetch was called');
  const headerNames = Object.keys(capturedHeaders).map((k) => k.toLowerCase());
  assert.ok(!headerNames.includes('mcp-session-id'), 'no Mcp-Session-Id header sent');
  assert.ok(!headerNames.includes('cookie'), 'no Cookie header sent');
  assert.deepEqual(
    headerNames.sort(),
    ['accept', 'authorization', 'user-agent'].sort(),
    'request carries only the expected per-request headers',
  );
});

test('client tolerates and ignores affinity headers on the response', async (t) => {
  __resetCache();

  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  // Simulate a hostile/legacy endpoint that DOES send affinity headers.
  // httpJson (index.mjs) never reads response.headers, so resolution must
  // still succeed identically — proving the client is stateless-tolerant,
  // not merely that a clean mock lacks the headers.
  const responseHeaders = new Headers({
    'content-type': 'application/json',
    'set-cookie': 'connect.sid=abc123; Path=/',
    'mcp-session-id': 'sticky-session-xyz',
  });
  globalThis.fetch = async () => ({
    status: 200,
    headers: responseHeaders,
    text: async () => JSON.stringify({ agents: [{ id: 'agent-1', name: 'developer' }] }),
  });

  const result = await resolveAgentUuidByName(SERVER, TOKEN, WORKSPACE, 'developer');

  assert.equal(result, 'agent-1', 'resolution succeeds unchanged despite affinity headers on the response');
});
