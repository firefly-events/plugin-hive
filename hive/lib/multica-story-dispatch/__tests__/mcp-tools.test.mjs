/**
 * Tests for mcp-tools.mjs — the hermes-multica MCP server.
 *
 * Verifies:
 *  1. The server initialises and lists exactly the seven expected tools.
 *  2. multica_epic_status and multica_write_state produce output that is
 *     byte-equivalent to a direct cli.mjs invocation (parity AC).
 *  3. A cli.mjs non-zero exit is surfaced as a JSON-RPC error (not a crash).
 *
 * Approach: spawn mcp-tools.mjs as a child process, write JSON-RPC messages
 * to its stdin, and read newline-delimited responses from stdout — the same
 * transport the MCP host uses at runtime.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const execAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = path.join(__dirname, '..', 'mcp-tools.mjs');
const CLI = path.join(__dirname, '..', 'cli.mjs');

// ── MCP client helper ────────────────────────────────────────────────────────

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
      this._proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  close() {
    this._proc.stdin.end();
    return new Promise((resolve) => this._proc.on('close', resolve));
  }
}

async function startMcpServer(env = {}) {
  const proc = spawn(process.execPath, [MCP_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const client = new McpClient(proc);
  const initResp = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'test', version: '0.0.0' },
  });
  assert.equal(initResp.result?.serverInfo?.name, 'hermes-multica');
  return { client, proc };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('tools/list returns all seven hermes-multica tools', async () => {
  const { client } = await startMcpServer();
  const resp = await client.send('tools/list', {});
  const names = (resp.result?.tools ?? []).map((t) => t.name).sort();
  assert.deepEqual(names, [
    'multica_cancel',
    'multica_dispatch_story',
    'multica_epic_status',
    'multica_episode',
    'multica_poll_task',
    'multica_post_comment',
    'multica_write_state',
  ]);
  await client.close();
});

test('tool definitions include required fields (name, description, inputSchema)', async () => {
  const { client } = await startMcpServer();
  const resp = await client.send('tools/list', {});
  for (const tool of resp.result?.tools ?? []) {
    assert.ok(tool.name, `${tool.name} missing name`);
    assert.ok(tool.description, `${tool.name} missing description`);
    assert.ok(tool.inputSchema?.type === 'object', `${tool.name} inputSchema must be object`);
    assert.ok(Array.isArray(tool.inputSchema?.required), `${tool.name} missing required array`);
  }
  await client.close();
});

test('ping responds', async () => {
  const { client } = await startMcpServer();
  const resp = await client.send('ping', {});
  assert.deepEqual(resp.result, {});
  await client.close();
});

test('unknown method returns -32601 error', async () => {
  const { client } = await startMcpServer();
  const resp = await client.send('tools/unknown_method', {});
  assert.equal(resp.error?.code, -32601);
  await client.close();
});

// Parity test: multica_epic_status output === cli.mjs epic-status stdout
test('multica_epic_status parity with cli.mjs epic-status', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mcp-parity-'));
  const pHiveDir = path.join(tmpDir, '.pHive', 'cycle-state');
  await fs.mkdir(pHiveDir, { recursive: true });
  const epicHandle = 'test-epic';
  const cycleStatePath = path.join(pHiveDir, `${epicHandle}.yaml`);

  // Write a minimal cycle-state YAML that hermes-reconciler/state.mjs can read
  await fs.writeFile(cycleStatePath, [
    'hermes_reconciler:',
    '  gate_state: pre_approved',
    '  current_phase: dispatched_impl',
    '  stories: {}',
  ].join('\n') + '\n');

  // cli.mjs direct invocation
  const { stdout: cliStdout } = await execAsync(
    process.execPath,
    [CLI, 'epic-status', '--epic', epicHandle, '--cycle-state', cycleStatePath],
    { env: { ...process.env } },
  );
  const cliRaw = cliStdout.replace(/\n$/, '');

  // MCP tool invocation
  const { client } = await startMcpServer({ CLI_MJS_PATH: CLI });
  const resp = await client.send('tools/call', {
    name: 'multica_epic_status',
    arguments: { epic_handle: epicHandle, cycle_state_path: cycleStatePath },
  });
  const mcpText = resp.result?.content?.[0]?.text ?? '';
  await client.close();
  await fs.rm(tmpDir, { recursive: true, force: true });

  // Parity: the MCP text content must be byte-equivalent to cli.mjs stdout
  assert.equal(mcpText, cliRaw, 'multica_epic_status MCP text must match cli.mjs stdout');
});

// Parity test: multica_write_state output === cli.mjs write-state stdout
test('multica_write_state parity with cli.mjs write-state', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mcp-parity-'));
  const pHiveDir = path.join(tmpDir, '.pHive', 'cycle-state');
  await fs.mkdir(pHiveDir, { recursive: true });
  const epicHandle = 'test-epic';
  const cycleStatePath = path.join(pHiveDir, `${epicHandle}.yaml`);

  await fs.writeFile(cycleStatePath, [
    'hermes_reconciler:',
    '  gate_state: null',
    '  stories: {}',
  ].join('\n') + '\n');

  const patch = { gate_state: 'pre_approved' };

  // cli.mjs direct invocation
  const { stdout: cliStdout } = await execAsync(
    process.execPath,
    [CLI, 'write-state', '--epic', epicHandle, '--patch', JSON.stringify(patch), '--cycle-state', cycleStatePath],
    { env: { ...process.env } },
  );
  const cliRaw = cliStdout.replace(/\n$/, '');

  // Reset the file for the MCP call
  await fs.writeFile(cycleStatePath, [
    'hermes_reconciler:',
    '  gate_state: null',
    '  stories: {}',
  ].join('\n') + '\n');

  const { client } = await startMcpServer({ CLI_MJS_PATH: CLI });
  const resp = await client.send('tools/call', {
    name: 'multica_write_state',
    arguments: { epic_handle: epicHandle, patch, cycle_state_path: cycleStatePath },
  });
  const mcpText = resp.result?.content?.[0]?.text ?? '';
  await client.close();
  await fs.rm(tmpDir, { recursive: true, force: true });

  assert.equal(mcpText, cliRaw, 'multica_write_state MCP text must match cli.mjs stdout');
});

// Error propagation: cli.mjs non-zero exit → JSON-RPC error (not crash)
test('cli.mjs non-zero exit surfaces as JSON-RPC error', async () => {
  const { client } = await startMcpServer();
  // multica_dispatch_story with missing agent/squad triggers MISSING_ARG on cli.mjs
  // but it still needs real creds to hit that path — use an invalid UUID to get INVALID_ARG
  const resp = await client.send('tools/call', {
    name: 'multica_dispatch_story',
    arguments: { issue_id: 'not-a-uuid' },
  });
  // Should be a JSON-RPC error with code -32000, not an unhandled crash
  assert.ok(resp.error, 'Expected a JSON-RPC error response');
  assert.equal(resp.error?.code, -32000);
  assert.ok(resp.error?.message, 'Error message should be non-empty');
  await client.close();
});
