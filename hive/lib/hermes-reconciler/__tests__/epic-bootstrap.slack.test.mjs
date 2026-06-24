/**
 * epic-bootstrap.slack.test.mjs — tester step (hpr-4) coverage for gaps in the
 * developer's epic-bootstrap.test.mjs. Focuses on:
 *
 *   - AC5: optional Slack lights-on notice confirms the epic is in the loop
 *   - AC1: write goes through the validated boundary and preserves other blocks
 *   - AC4: NO module on the reconcile-tick surface imports epic-bootstrap
 *
 * Slack tests use a real local HTTP server (the impl speaks http: for http URLs),
 * so they must drive the child with async spawn — a blocking spawnSync would
 * deadlock the single event loop that the local server's request handler runs on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { readHermesReconcilerState, writeHermesReconcilerState } from '../state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECONCILER_DIR = path.resolve(HERE, '..');
const BOOTSTRAP = path.join(RECONCILER_DIR, 'epic-bootstrap.mjs');

function tmpCycleStatePath(name = 'test-epic') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpr4-slack-'));
  return path.join(dir, '.pHive', 'cycle-state', `${name}.yaml`);
}

// Async runner — required when the bootstrap must reach a server on this process's
// own event loop (spawnSync would block that loop and never service the request).
function runBootstrapAsync(argv, { input = null, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BOOTSTRAP, ...argv], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    if (input !== null) child.stdin.write(input);
    child.stdin.end();
  });
}

// Start a local Slack-webhook stand-in that records the one request it receives.
function startSlackStub({ statusCode = 200 } = {}) {
  const received = { hits: 0, body: null };
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      received.hits += 1;
      received.body = data;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(statusCode >= 400 ? '{"error":"boom"}' : 'ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, received, url: `http://127.0.0.1:${port}/services/T/B/xxx` });
    });
  });
}

// ── AC5: optional Slack notice ─────────────────────────────────────────────────

test('AC5: on success, posts a Slack lights-on notice naming the epic', async () => {
  const { server, received, url } = await startSlackStub();
  try {
    const file = tmpCycleStatePath('slack-epic');
    const res = await runBootstrapAsync(
      ['--epic', 'slack-epic', '--cycle-state', file, '--slack-webhook', url, '--yes'],
    );
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    // State was written...
    const state = readHermesReconcilerState(file);
    assert.equal(state.gate_state, 'pre_approved');
    assert.equal(state.epic_of_record, 'slack-epic');
    // ...and exactly one notice reached the webhook, confirming lights-on.
    assert.equal(received.hits, 1, 'expected exactly one Slack POST');
    const payload = JSON.parse(received.body);
    assert.match(payload.text, /slack-epic/, 'notice must name the epic');
    assert.match(payload.text, /lights-on/i, 'notice must confirm the epic is in the loop');
    assert.match(res.stdout, /Slack notice sent/i);
  } finally {
    server.close();
  }
});

test('AC5: webhook can be supplied via HERMES_SLACK_WEBHOOK_URL env var', async () => {
  const { server, received, url } = await startSlackStub();
  try {
    const file = tmpCycleStatePath('env-epic');
    const res = await runBootstrapAsync(
      ['--epic', 'env-epic', '--cycle-state', file, '--yes'],
      { env: { HERMES_SLACK_WEBHOOK_URL: url } },
    );
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.equal(received.hits, 1, 'env-configured webhook should receive the notice');
  } finally {
    server.close();
  }
});

test('AC5: Slack failure is best-effort — state is still written, exit 0, warning emitted', async () => {
  const { server, received, url } = await startSlackStub({ statusCode: 500 });
  try {
    const file = tmpCycleStatePath('slack-fail-epic');
    const res = await runBootstrapAsync(
      ['--epic', 'slack-fail-epic', '--cycle-state', file, '--slack-webhook', url, '--yes'],
    );
    // The bootstrap must NOT fail just because the notice failed — the arm succeeded.
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.equal(received.hits, 1);
    const state = readHermesReconcilerState(file);
    assert.equal(state.gate_state, 'pre_approved', 'state must be written even if Slack fails');
    assert.match(res.stderr, /Warning/i, 'a warning should be surfaced on Slack failure');
  } finally {
    server.close();
  }
});

test('AC5: no webhook configured → no Slack attempt, echo says so', async () => {
  const file = tmpCycleStatePath('no-slack-epic');
  // Ensure no ambient env webhook leaks in.
  const res = await runBootstrapAsync(
    ['--epic', 'no-slack-epic', '--cycle-state', file, '--yes'],
    { env: { HERMES_SLACK_WEBHOOK_URL: '' } },
  );
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /Slack notice\s*:\s*no/i);
  assert.doesNotMatch(res.stdout, /Slack notice sent/i);
});

// ── AC1: validated write boundary reuse ─────────────────────────────────────────

test('AC1: bootstrap writes through the validated boundary and preserves other blocks', async () => {
  const file = tmpCycleStatePath('preserve-epic');
  // Seed an unrelated top-level block; the validated writer must keep it verbatim.
  writeHermesReconcilerState(file, { in_flight_story_id: 'pre-existing' });
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8') + '\nother_block:\n  keep: me\n',
    'utf8',
  );

  const res = await runBootstrapAsync(['--epic', 'preserve-epic', '--cycle-state', file, '--yes']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);

  const state = readHermesReconcilerState(file);
  assert.equal(state.gate_state, 'pre_approved');
  assert.equal(state.epic_of_record, 'preserve-epic');
  // The unrelated block survives — proof the bootstrap reuses the merge-preserving
  // writeHermesReconcilerState boundary, not a naive overwrite.
  const yaml = (await import('js-yaml')).default;
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.other_block, { keep: 'me' });
});

// ── AC4: structurally off the reconcile-tick surface ────────────────────────────

test('AC4: no reconcile-tick module imports epic-bootstrap (full-surface scan)', () => {
  // Scan every source module in the reconciler dir except the bootstrap itself.
  // None may import epic-bootstrap — that is the structural human-only invariant.
  const surface = fs.readdirSync(RECONCILER_DIR)
    .filter((f) => f.endsWith('.mjs') && f !== 'epic-bootstrap.mjs');
  assert.ok(surface.length > 0, 'expected reconcile-tick modules to scan');
  for (const f of surface) {
    const content = fs.readFileSync(path.join(RECONCILER_DIR, f), 'utf8');
    assert.ok(
      !content.includes('epic-bootstrap'),
      `${f} (tick surface) must not reference epic-bootstrap`,
    );
  }
});
