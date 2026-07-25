/**
 * Tests for openai-image-mcp-server.js — the openai-image hand-rolled MCP server.
 *
 * Verifies:
 *  1. The module loads as real ESM (regression guard for the CJS require()
 *     under a "type":"module" package.json — it used to fail to load at all).
 *  2. tools/list returns the three expected tools.
 *  3. initialize echoes a supported client protocolVersion unchanged.
 *  4. initialize falls back to the shared MCP_PROTOCOL_VERSION
 *     ('2025-11-25') when the client omits an unsupported protocolVersion — not the stale
 *     '2024-11-05' literal.
 *  5. tools/call surfaces a missing-API-key error as a JSON-RPC error rather
 *     than crashing the process.
 *
 * Approach: spawn the server as a child process and speak the same
 * newline-delimited JSON-RPC transport the MCP host uses at runtime (mirrors
 * multica-story-dispatch/__tests__/mcp-tools.test.mjs).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { MCP_PROTOCOL_VERSION } from '../mcp-protocol-version.js';
import * as server from '../openai-image-mcp-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = path.join(__dirname, '..', 'openai-image-mcp-server.js');

class McpClient {
  constructor(proc) {
    this._proc = proc;
    this._pending = new Map();
    this._nextId = 1;
    this._buffer = '';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      this._buffer += chunk;
      let idx;
      while ((idx = this._buffer.indexOf('\n')) !== -1) {
        const line = this._buffer.slice(0, idx).trim();
        this._buffer = this._buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const resolve = this._pending.get(msg.id);
        if (resolve) {
          this._pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  send(method, params) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const wrappedResolve = (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      };
      this._pending.set(id, wrappedResolve);
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, 10_000);
      timeout.unref();
      this._proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  close() {
    this._proc.stdin.end();
    return new Promise((resolve) => this._proc.on('close', resolve));
  }
}

function startServer(env = {}) {
  const proc = spawn(process.execPath, [MCP_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  return { client: new McpClient(proc), proc };
}

test('module loads as real ESM (CJS require() would throw under type:module)', () => {
  assert.equal(typeof server.startServer, 'function');
  assert.equal(typeof server.callTool, 'function');
});

test('tools/list returns the three openai-image tools', async () => {
  const { client } = startServer();
  try {
    const resp = await client.send('tools/list', {});
    const names = (resp.result?.tools ?? []).map((t) => t.name).sort();
    assert.deepEqual(names, ['edit_logo_concept', 'generate_image', 'generate_logo_concepts']);
  } finally {
    await client.close();
  }
});

test('initialize echoes a supported client protocolVersion unchanged', async () => {
  const { client } = startServer();
  try {
    const resp = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test', version: '0.0.0' },
    });
    assert.equal(resp.result.protocolVersion, '2024-11-05');
    assert.deepEqual(resp.result.capabilities, { tools: {} });
  } finally {
    await client.close();
  }
});

test('initialize returns the latest supported version when protocolVersion is omitted', async () => {
  const { client } = startServer();
  try {
    const resp = await client.send('initialize', {
      clientInfo: { name: 'test', version: '0.0.0' },
    });
    assert.equal(resp.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(resp.result.protocolVersion, '2025-11-25');
    assert.notEqual(resp.result.protocolVersion, '2024-11-05');
  } finally {
    await client.close();
  }
});

test('initialize negotiates an unsupported client version to the latest supported version', async () => {
  const { client } = startServer();
  try {
    const resp = await client.send('initialize', {
      protocolVersion: '2099-01-01',
      clientInfo: { name: 'test', version: '0.0.0' },
    });
    assert.equal(resp.result.protocolVersion, MCP_PROTOCOL_VERSION);
  } finally {
    await client.close();
  }
});

test('tools/call surfaces a missing API key as a JSON-RPC error, not a crash', async () => {
  const { client, proc } = startServer({ OPENAI_API_KEY: '' });
  try {
    const resp = await client.send('tools/call', {
      name: 'generate_image',
      arguments: { prompt: 'a friendly robot mascot' },
    });
    assert.ok(resp.error, 'expected a JSON-RPC error response');
    assert.match(resp.error.message, /OPENAI_API_KEY/);
    assert.equal(proc.exitCode, null);
  } finally {
    await client.close();
  }
});

test('callTool: unknown tool name rejects', async () => {
  await assert.rejects(
    () => server.callTool('not_a_real_tool', {}, {}),
    /Unknown tool/
  );
});
