/**
 * Tests for mcp-server.mjs — the Approval Actions MCP fallback surface (DOS-221).
 *
 * Approach: spawn mcp-server.mjs as a child process pointed at a temp SQLite
 * file via APPROVAL_DB_PATH, write JSON-RPC messages to its stdin, and read
 * newline-delimited responses from stdout — the same transport an MCP host
 * uses at runtime. Mirrors hive/lib/multica-story-dispatch/__tests__/mcp-tools.test.mjs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = path.join(__dirname, '..', 'mcp-server.mjs');

const EXPECTED_TOOLS = [
  'get_decision_record',
  'get_pending_approval',
  'list_decision_records',
  'list_pending_approvals',
  'submit_verdict',
];

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

  callTool(name, args) {
    return this.send('tools/call', { name, arguments: args });
  }

  close() {
    this._proc.stdin.end();
    return new Promise((resolve) => this._proc.on('close', resolve));
  }
}

async function startMcpServer(dbPath) {
  const proc = spawn(process.execPath, [MCP_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, APPROVAL_DB_PATH: dbPath },
  });
  const client = new McpClient(proc);
  const initResp = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'test', version: '0.0.0' },
  });
  assert.equal(initResp.result?.serverInfo?.name, 'approval-actions');
  return { client, proc };
}

async function withTempDb(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-mcp-'));
  const dbPath = path.join(tmpDir, 'approval-audit.db');
  try {
    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// ── Protocol shape ───────────────────────────────────────────────────────────

test('tools/list returns all five approval tools', async () => {
  await withTempDb(async (dbPath) => {
    const { client } = await startMcpServer(dbPath);
    try {
      const resp = await client.send('tools/list', {});
      const names = (resp.result?.tools ?? []).map((t) => t.name).sort();
      assert.deepEqual(names, EXPECTED_TOOLS);
    } finally {
      await client.close();
    }
  });
});

test('tool definitions include required fields (name, description, inputSchema)', async () => {
  await withTempDb(async (dbPath) => {
    const { client } = await startMcpServer(dbPath);
    try {
      const resp = await client.send('tools/list', {});
      for (const tool of resp.result?.tools ?? []) {
        assert.ok(tool.name, `${tool.name} missing name`);
        assert.ok(tool.description, `${tool.name} missing description`);
        assert.ok(tool.inputSchema?.type === 'object', `${tool.name} inputSchema must be object`);
        assert.ok(Array.isArray(tool.inputSchema?.required), `${tool.name} missing required array`);
      }
    } finally {
      await client.close();
    }
  });
});

test('stateless MCP compat: tools/list works without an initialize handshake', async () => {
  await withTempDb(async (dbPath) => {
    const proc = spawn(process.execPath, [MCP_SERVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, APPROVAL_DB_PATH: dbPath },
    });
    const client = new McpClient(proc);
    try {
      const resp = await client.send('tools/list', {});
      const names = (resp.result?.tools ?? []).map((t) => t.name).sort();
      assert.deepEqual(names, EXPECTED_TOOLS);
    } finally {
      await client.close();
    }
  });
});

test('ping responds', async () => {
  await withTempDb(async (dbPath) => {
    const { client } = await startMcpServer(dbPath);
    try {
      const resp = await client.send('ping', {});
      assert.deepEqual(resp.result, {});
    } finally {
      await client.close();
    }
  });
});

test('unknown method returns -32601 error', async () => {
  await withTempDb(async (dbPath) => {
    const { client } = await startMcpServer(dbPath);
    try {
      const resp = await client.send('tools/unknown_method', {});
      assert.equal(resp.error?.code, -32601);
    } finally {
      await client.close();
    }
  });
});

// ── Approval contract: list / submit / read, human-gate end to end ─────────

test('human-gate: list_pending_approvals is empty, then reflects a request made via the engine directly', async () => {
  await withTempDb(async (dbPath) => {
    // Seed a pending approval through the same engine the server will open.
    const { createEngine } = await import('../engine.mjs');
    const { register } = await import('../config-registry.mjs');
    register('destructive-op', { mode: 'human-gate', enabled: true, options: {} });
    const seedEngine = createEngine(dbPath);
    const { pending } = seedEngine.request('destructive-op', { target: 'prod-db' }, 'agent-1');
    seedEngine._store.close();

    const { client } = await startMcpServer(dbPath);
    try {
      const listResp = await client.callTool('list_pending_approvals', {});
      const list = listResp.result?.structuredContent;
      assert.equal(list.length, 1);
      assert.equal(list[0].id, pending.id);
      assert.equal(list[0].actionType, 'destructive-op');

      const getResp = await client.callTool('get_pending_approval', { approvalId: pending.id });
      assert.equal(getResp.result?.structuredContent?.id, pending.id);

      const submitResp = await client.callTool('submit_verdict', {
        approvalId: pending.id,
        verdict: { approve: true, approverIdentity: 'mathew', note: 'looks fine' },
      });
      const audit = submitResp.result?.structuredContent;
      assert.equal(audit.approvalId, pending.id);
      assert.equal(audit.decision.allowed, true);
      assert.equal(audit.method, 'dashboard-click');

      const recordResp = await client.callTool('get_decision_record', { approvalId: pending.id });
      assert.equal(recordResp.result?.structuredContent?.id, audit.id);

      const recordsResp = await client.callTool('list_decision_records', {});
      assert.equal(recordsResp.result?.structuredContent?.length, 1);

      // Now resolved, so the default pending-only listing is empty.
      const listAfter = await client.callTool('list_pending_approvals', {});
      assert.equal(listAfter.result?.structuredContent?.length, 0);
    } finally {
      await client.close();
    }
  });
});

test('submit_verdict on an unknown approval id surfaces a JSON-RPC error, not a crash', async () => {
  await withTempDb(async (dbPath) => {
    const { client } = await startMcpServer(dbPath);
    try {
      const resp = await client.callTool('submit_verdict', {
        approvalId: 'does-not-exist',
        verdict: { approve: true, approverIdentity: 'mathew' },
      });
      assert.ok(resp.error, 'Expected a JSON-RPC error response');
      assert.equal(resp.error?.data?.reason, 'not_found');
    } finally {
      await client.close();
    }
  });
});

test('submit_verdict missing both verdict and verdicts surfaces MISSING_ARGS', async () => {
  await withTempDb(async (dbPath) => {
    const { client } = await startMcpServer(dbPath);
    try {
      const resp = await client.callTool('submit_verdict', { approvalId: 'x' });
      assert.ok(resp.error, 'Expected a JSON-RPC error response');
      assert.equal(resp.error?.data?.reason, 'MISSING_ARGS');
    } finally {
      await client.close();
    }
  });
});

test('a dropped hard-veto lens in multi-agent-vote is rejected (incomplete_panel), never silently passed', async () => {
  await withTempDb(async (dbPath) => {
    const { createEngine } = await import('../engine.mjs');
    const { register, shippedConfigs } = await import('../config-registry.mjs');
    const repoCreation = shippedConfigs().find((c) => c.actionType === 'repo-creation');
    register('repo-creation', repoCreation.modeConfig);
    const seedEngine = createEngine(dbPath);
    const { pending } = seedEngine.request('repo-creation', { repo: 'new-thing' }, 'agent-1');
    seedEngine._store.close();

    const { client } = await startMcpServer(dbPath);
    try {
      // Omit the hard-veto lens (duplication-scout) — 3 of the other lenses approve.
      const others = repoCreation.modeConfig.options.panel
        .map((l) => l.id)
        .filter((id) => id !== 'duplication-scout');
      const resp = await client.callTool('submit_verdict', {
        approvalId: pending.id,
        verdicts: others.map((identity) => ({ identity, approve: true, reasoning: 'looks fine' })),
      });
      assert.ok(resp.error, 'Expected a JSON-RPC error — panel is incomplete');
      assert.equal(resp.error?.data?.reason, 'incomplete_panel');

      // Approval must still be pending — the gate was not bypassed.
      const stillPending = await client.callTool('list_pending_approvals', {});
      assert.equal(stillPending.result?.structuredContent?.length, 1);
    } finally {
      await client.close();
    }
  });
});
