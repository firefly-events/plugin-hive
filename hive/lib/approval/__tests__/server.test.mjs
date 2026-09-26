/**
 * Tests for server.mjs — the approval HTTP API + plain web dashboard fallback (DOS-221).
 *
 * Approach: start startApprovalServer() against a temp SQLite file on an
 * ephemeral port and drive it with real HTTP requests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// server.mjs reads APPROVAL_PORT into a module-level const at import time, so
// this must be set (to 0 — OS-assigned free port, a fresh one per listen()
// call) before the very first import, not inside withServer().
process.env.APPROVAL_PORT = '0';
const { startApprovalServer } = await import('../server.mjs');
const { createEngine } = await import('../engine.mjs');
const { register, shippedConfigs } = await import('../config-registry.mjs');

async function withServer(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-server-'));
  const dbPath = path.join(tmpDir, 'approval-audit.db');
  const server = startApprovalServer(dbPath);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    await fn({ base, dbPath });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('GET /health returns ok', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('GET / serves the plain web dashboard fallback HTML', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Approval Actions/);
    assert.match(body, /app\.js/);
  });
});

test('GET /app.js serves the client script', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/app.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const body = await res.text();
    assert.match(body, /submit-verdicts/);
  });
});

test('human-gate: full pending -> submit -> audit lifecycle over HTTP', async () => {
  await withServer(async ({ base, dbPath }) => {
    register('destructive-op', { mode: 'human-gate', enabled: true, options: {} });
    const seedEngine = createEngine(dbPath);
    const { pending } = seedEngine.request('destructive-op', { target: 'prod-db' }, 'agent-1');
    seedEngine._store.close();

    const listRes = await fetch(`${base}/api/approvals/pending`);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, pending.id);

    const submitRes = await fetch(`${base}/api/approvals/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: pending.id, approve: true, approverIdentity: 'mathew', note: 'ok' }),
    });
    assert.equal(submitRes.status, 200);
    const audit = await submitRes.json();
    assert.equal(audit.decision.allowed, true);

    const recordsRes = await fetch(`${base}/api/approvals/audit-records`);
    assert.equal((await recordsRes.json()).length, 1);
  });
});

test('POST /api/approvals/submit-verdicts resolves a multi-agent-vote pending approval', async () => {
  await withServer(async ({ base, dbPath }) => {
    const repoCreation = shippedConfigs().find((c) => c.actionType === 'repo-creation');
    register('repo-creation', repoCreation.modeConfig);
    const seedEngine = createEngine(dbPath);
    const { pending } = seedEngine.request('repo-creation', { repo: 'new-thing' }, 'agent-1');
    seedEngine._store.close();

    const verdicts = repoCreation.modeConfig.options.panel.map((lens) => ({
      identity: lens.id,
      approve: true,
      reasoning: 'looks fine',
    }));

    const res = await fetch(`${base}/api/approvals/submit-verdicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: pending.id, verdicts }),
    });
    assert.equal(res.status, 200);
    const audit = await res.json();
    assert.equal(audit.decision.allowed, true);
    assert.equal(audit.passCheck, true);
  });
});

test('POST /api/approvals/submit-verdicts rejects an incomplete panel (missing hard-veto lens)', async () => {
  await withServer(async ({ base, dbPath }) => {
    const repoCreation = shippedConfigs().find((c) => c.actionType === 'repo-creation');
    register('repo-creation', repoCreation.modeConfig);
    const seedEngine = createEngine(dbPath);
    const { pending } = seedEngine.request('repo-creation', { repo: 'new-thing' }, 'agent-1');
    seedEngine._store.close();

    const verdicts = repoCreation.modeConfig.options.panel
      .filter((lens) => lens.id !== 'duplication-scout')
      .map((lens) => ({ identity: lens.id, approve: true, reasoning: 'looks fine' }));

    const res = await fetch(`${base}/api/approvals/submit-verdicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: pending.id, verdicts }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.reason, 'incomplete_panel');
  });
});

test('POST /api/approvals/submit-verdicts with missing fields returns 400', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/approvals/submit-verdicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: 'x' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'missing_fields');
  });
});

// DOS-221 round 2: server.mjs previously sent a wildcard
// Access-Control-Allow-Origin, so a browser tab on any website could
// drive-by submit approval verdicts from a user's own machine with no auth.
// This regression test proves a cross-origin POST is rejected outright.
test('POST /api/approvals/submit from a foreign Origin is rejected, not answered with a wildcard', async () => {
  await withServer(async ({ base, dbPath }) => {
    register('destructive-op', { mode: 'human-gate', enabled: true, options: {} });
    const seedEngine = createEngine(dbPath);
    const { pending } = seedEngine.request('destructive-op', { target: 'prod-db' }, 'agent-1');
    seedEngine._store.close();

    const res = await fetch(`${base}/api/approvals/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ approvalId: pending.id, approve: true, approverIdentity: 'drive-by' }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const body = await res.json();
    assert.equal(body.error, 'origin_not_allowed');

    // The approval must still be pending — the cross-origin request never
    // reached the engine.
    const listRes = await fetch(`${base}/api/approvals/pending`);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, pending.id);
  });
});

test('OPTIONS preflight from a foreign Origin is rejected', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/approvals/submit`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

test('a same-origin POST still gets an Access-Control-Allow-Origin header echoing that origin', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/approvals/submit-verdicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ approvalId: 'x' }),
    });
    // Same-origin request is let through to the route handler (400 for
    // missing fields, not 403 for origin) and gets CORS headers back.
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('access-control-allow-origin'), base);
  });
});
