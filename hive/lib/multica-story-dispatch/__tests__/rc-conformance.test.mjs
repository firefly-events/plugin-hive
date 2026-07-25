/**
 * RC protocol-conformance smoke test for both hand-rolled MCP servers.
 *
 * Story definition of "against the RC": this is a protocol-conformance
 * assertion over each server's handleRpcMessage JSON-RPC dispatch, not a
 * live-server round-trip against an external RC target.
 *
 * The smoke covers the same RC-shaped message flow on both servers:
 *  1. initialize without protocolVersion returns the latest supported version.
 *  2. initialize echoes supported versions and rejects arbitrary future versions.
 *  3. tools/list succeeds without a prior initialize handshake.
 *  4. initialize advertises exactly {tools:{}}.
 *  5. a JSON-RPC notification is silently ignored and tools/call still
 *     round-trips a well-formed response.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MCP_PROTOCOL_VERSION } from '../../mcp-protocol-version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MULTICA_SERVER = path.join(__dirname, '..', 'mcp-tools.mjs');
const OPENAI_IMAGE_SERVER = path.join(__dirname, '..', '..', 'openai-image-mcp-server.js');

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

  notify(method, params) {
    this._proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async expectSilentNotification(method = 'notifications/initialized', params = {}) {
    const lines = [];
    const onData = (chunk) => {
      const text = String(chunk).trim();
      if (text) lines.push(text);
    };
    this._proc.stdout.on('data', onData);
    this.notify(method, params);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 100);
      timer.unref();
    });
    this._proc.stdout.off('data', onData);
    assert.deepEqual(lines, [], `${method} should not emit a response`);
  }

  close() {
    this._proc.stdin.end();
    return new Promise((resolve) => this._proc.on('close', resolve));
  }
}

function startServer(serverPath, env = {}) {
  const proc = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  return { client: new McpClient(proc), proc };
}

test('multica MCP server matches the RC conformance smoke contract', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-conformance-multica-'));
  const cycleStatePath = path.join(tmpDir, '.pHive', 'cycle-state', 'test-epic.yaml');
  await fs.mkdir(path.dirname(cycleStatePath), { recursive: true });
  await fs.writeFile(cycleStatePath, [
    'hermes_reconciler:',
    '  gate_state: pre_approved',
    '  current_phase: dispatched_impl',
    '  stories: {}',
  ].join('\n') + '\n');

  const { client } = startServer(MULTICA_SERVER);
  try {
    const toolsWithoutHandshake = await client.send('tools/list', {});
    assert.ok(Array.isArray(toolsWithoutHandshake.result?.tools));
    assert.equal(toolsWithoutHandshake.result.tools.length, 7);

    await client.expectSilentNotification();

    const omittedVersion = await client.send('initialize', {
      clientInfo: { name: 'rc-smoke', version: '0.0.0' },
    });
    assert.equal(omittedVersion.result?.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(omittedVersion.result?.protocolVersion, '2025-11-25');
    assert.notEqual(omittedVersion.result?.protocolVersion, '2024-11-05');
    assert.deepEqual(omittedVersion.result?.capabilities, { tools: {} });

    const negotiatedVersion = await client.send('initialize', {
      protocolVersion: '2099-01-01',
      clientInfo: { name: 'rc-smoke', version: '0.0.0' },
    });
    assert.equal(negotiatedVersion.result?.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.deepEqual(negotiatedVersion.result?.capabilities, { tools: {} });

    const toolCall = await client.send('tools/call', {
      name: 'multica_epic_status',
      arguments: {
        epic_handle: 'test-epic',
        cycle_state_path: cycleStatePath,
      },
    });
    assert.equal(toolCall.jsonrpc, '2.0');
    assert.equal(toolCall.id, 4);
    assert.ok(!toolCall.error, 'tools/call should return a JSON-RPC result');
    assert.equal(toolCall.result?.content?.[0]?.type, 'text');
    assert.equal(toolCall.result?.structuredContent?.epic, 'test-epic');
    assert.equal(toolCall.result?.structuredContent?.gate_state, 'pre_approved');
  } finally {
    await client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openai-image MCP server matches the RC conformance smoke contract', async () => {
  const { client, proc } = startServer(OPENAI_IMAGE_SERVER, { OPENAI_API_KEY: '' });
  try {
    const toolsWithoutHandshake = await client.send('tools/list', {});
    const toolNames = (toolsWithoutHandshake.result?.tools ?? []).map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, ['edit_logo_concept', 'generate_image', 'generate_logo_concepts']);

    await client.expectSilentNotification();

    const omittedVersion = await client.send('initialize', {
      clientInfo: { name: 'rc-smoke', version: '0.0.0' },
    });
    assert.equal(omittedVersion.result?.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(omittedVersion.result?.protocolVersion, '2025-11-25');
    assert.notEqual(omittedVersion.result?.protocolVersion, '2024-11-05');
    assert.deepEqual(omittedVersion.result?.capabilities, { tools: {} });

    const negotiatedVersion = await client.send('initialize', {
      protocolVersion: '2099-01-01',
      clientInfo: { name: 'rc-smoke', version: '0.0.0' },
    });
    assert.equal(negotiatedVersion.result?.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.deepEqual(negotiatedVersion.result?.capabilities, { tools: {} });

    const toolCall = await client.send('tools/call', {
      name: 'generate_image',
      arguments: { prompt: 'rc smoke robot mascot' },
    });
    assert.equal(toolCall.jsonrpc, '2.0');
    assert.equal(toolCall.id, 4);
    assert.ok(toolCall.error, 'tools/call should return a JSON-RPC error when API key is missing');
    assert.match(toolCall.error.message, /OPENAI_API_KEY/);
    assert.equal(proc.exitCode, null);
  } finally {
    await client.close();
  }
});
