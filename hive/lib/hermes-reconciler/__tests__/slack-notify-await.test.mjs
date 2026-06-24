import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVerdictMessage,
  buildErrorMessage,
  surfaceVerdictHook,
  surfaceErrorHook,
  resolveGate,
  parseGateAction,
  resolveGateInvoker,
} from '../slack-notify-await.mjs';
import { readHermesReconcilerState, writeHermesReconcilerState } from '../state.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slack-notify-test-'));
}

function cycleStatePath(dir, epic = 'test-epic') {
  return path.join(dir, '.pHive', 'cycle-state', `${epic}.yaml`);
}

/** Spin up a minimal HTTP server that captures requests and responds. */
function mockSlackServer({ statusCode = 200, body = 'ok' } = {}) {
  const received = [];
  return new Promise((resolveServer) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, body: raw });
        res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}/webhook`;
      resolveServer({ server, url, received });
    });
  });
}

// ── buildVerdictMessage ───────────────────────────────────────────────────────

test('buildVerdictMessage: includes epic, story, verdict, and decision prompt', () => {
  const { text } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'passed',
    episodeSummary: 'All AC met.',
  });

  assert.match(text, /my-epic/);
  assert.match(text, /h-06/);
  assert.match(text, /passed/i);
  assert.match(text, /Episode Summary/);
  assert.match(text, /All AC met/);
  assert.match(text, /Decision Required/);
  assert.match(text, /approve/i);
});

test('buildVerdictMessage: normalizes needs_revision verdict (underscore → hyphen)', () => {
  const { text } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'needs_revision',
  });
  assert.match(text, /needs-revision/i);
  assert.doesNotMatch(text, /needs_revision/);
});

test('buildVerdictMessage: includes diff when provided', () => {
  const { text } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'passed',
    diff: '+line added',
  });
  assert.match(text, /Diff/);
  assert.match(text, /\+line added/);
});

test('buildVerdictMessage: omits diff and episode sections when absent', () => {
  const { text } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'passed',
  });
  assert.doesNotMatch(text, /Episode Summary/);
  assert.doesNotMatch(text, /Diff/);
});

test('buildVerdictMessage: clamps oversized diff/summary so no section exceeds Slack 3000-char limit', () => {
  const huge = 'x'.repeat(20000);
  const { blocks } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'needs_revision',
    episodeSummary: huge,
    diff: huge,
  });
  const sectionTexts = blocks
    .filter((b) => b.type === 'section' && b.text?.type === 'mrkdwn')
    .map((b) => b.text.text);
  // At least the summary + diff sections present.
  const big = sectionTexts.filter((t) => /Episode Summary|Diff/.test(t));
  assert.ok(big.length >= 2, 'expected episode-summary and diff sections');
  for (const t of sectionTexts) {
    assert.ok(t.length <= 3000, `section text must stay <= 3000 (Slack limit), got ${t.length}`);
  }
  // Truncation is signalled, not silent.
  assert.ok(big.some((t) => /truncated/.test(t)), 'oversized content must be marked truncated');
});

// ── buildErrorMessage ─────────────────────────────────────────────────────────

test('buildErrorMessage: includes epic, errorKind, details, and decision prompt', () => {
  const { text } = buildErrorMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    errorKind: 'dispatch_failure',
    details: 'No agents available',
  });

  assert.match(text, /my-epic/);
  assert.match(text, /h-06/);
  assert.match(text, /dispatch_failure/);
  assert.match(text, /No agents available/);
  assert.match(text, /Decision Required/);
  assert.match(text, /continue/i);
  assert.match(text, /reject/i);
});

test('buildErrorMessage: works without storyId', () => {
  const { text } = buildErrorMessage({
    epicHandle: 'my-epic',
    errorKind: 'daemon_down',
  });
  assert.match(text, /daemon_down/);
  assert.doesNotMatch(text, /Story:/);
});

// ── surfaceVerdictHook ────────────────────────────────────────────────────────

test('surfaceVerdictHook: writes gate_state=review_awaiting_human before Slack post', async (t) => {
  const { server, url, received } = await mockSlackServer();
  t.after(() => server.close());

  const dir = tmpDir();
  const statePath = cycleStatePath(dir);

  writeHermesReconcilerState(statePath, { gate_state: 'pre_approved' });

  const result = await surfaceVerdictHook(
    statePath,
    { epicHandle: 'e', storyId: 's1', verdict: 'passed' },
    { slackWebhookUrl: url },
  );

  assert.equal(result.halted, true);
  assert.equal(result.gate_state, 'review_awaiting_human');

  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'review_awaiting_human');
  assert.equal(received.length, 1, 'Slack should have received exactly one request');
});

test('surfaceVerdictHook: gate stays review_awaiting_human when Slack returns non-2xx', async (t) => {
  const { server, url } = await mockSlackServer({ statusCode: 500, body: 'error' });
  t.after(() => server.close());

  const dir = tmpDir();
  const statePath = cycleStatePath(dir);

  await assert.rejects(
    () => surfaceVerdictHook(
      statePath,
      { epicHandle: 'e', storyId: 's1', verdict: 'passed' },
      { slackWebhookUrl: url },
    ),
    /HTTP 500/,
  );

  // Gate must be 'review_awaiting_human' even though Slack failed — no auto-advance
  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'review_awaiting_human');
});

test('surfaceVerdictHook: throws and halts when Slack URL not configured', async () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  const savedEnv = process.env.HERMES_SLACK_WEBHOOK_URL;
  delete process.env.HERMES_SLACK_WEBHOOK_URL;

  try {
    await assert.rejects(
      () => surfaceVerdictHook(statePath, { epicHandle: 'e', storyId: 's1', verdict: 'passed' }),
      /HERMES_SLACK_WEBHOOK_URL/,
    );
    // Gate must still be latched to review_awaiting_human
    const state = readHermesReconcilerState(statePath);
    assert.equal(state.gate_state, 'review_awaiting_human');
  } finally {
    if (savedEnv !== undefined) process.env.HERMES_SLACK_WEBHOOK_URL = savedEnv;
  }
});

test('surfaceVerdictHook: Slack message contains verdict context', async (t) => {
  const { server, url, received } = await mockSlackServer();
  t.after(() => server.close());

  const dir = tmpDir();
  const statePath = cycleStatePath(dir);

  await surfaceVerdictHook(
    statePath,
    { epicHandle: 'my-epic', storyId: 'h-06', verdict: 'needs_revision', episodeSummary: 'Tests failing.' },
    { slackWebhookUrl: url },
  );

  assert.equal(received.length, 1);
  const payload = JSON.parse(received[0].body);
  assert.match(payload.text, /my-epic/);
  assert.match(payload.text, /needs-revision/i);
  assert.match(payload.text, /Tests failing/);
});

// ── surfaceErrorHook ──────────────────────────────────────────────────────────

test('surfaceErrorHook: writes gate_state=review_awaiting_human and posts error message', async (t) => {
  const { server, url, received } = await mockSlackServer();
  t.after(() => server.close());

  const dir = tmpDir();
  const statePath = cycleStatePath(dir);

  const result = await surfaceErrorHook(
    statePath,
    { epicHandle: 'e', errorKind: 'dispatch_failure', details: 'timeout' },
    { slackWebhookUrl: url },
  );

  assert.equal(result.halted, true);
  assert.equal(result.gate_state, 'review_awaiting_human');
  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'review_awaiting_human');
  assert.equal(received.length, 1);
  const payload = JSON.parse(received[0].body);
  assert.match(payload.text, /dispatch_failure/);
});

test('surfaceErrorHook: gate stays review_awaiting_human when Slack unreachable', async () => {
  // Use a port that nothing is listening on
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);

  await assert.rejects(
    () => surfaceErrorHook(
      statePath,
      { epicHandle: 'e', errorKind: 'daemon_down' },
      { slackWebhookUrl: 'http://127.0.0.1:1/unreachable' },
    ),
  );

  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'review_awaiting_human');
});

// ── resolveGate ───────────────────────────────────────────────────────────────

test('resolveGate: approve → gate_state=pre_approved', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, { gate_state: 'review_awaiting_human' });

  const result = resolveGate(statePath, { action: 'approve' });

  assert.equal(result.resolved, true);
  assert.equal(result.gate_state, 'pre_approved');
  assert.equal(readHermesReconcilerState(statePath).gate_state, 'pre_approved');
});

test('resolveGate: approve marks the surfaced in-flight story done and clears in-flight', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, {
    gate_state: 'review_awaiting_human',
    in_flight_story_id: 's-42',
    in_flight_task_id: 't-99',
    stories: { 's-42': { phase_position: 'dispatched_review' } },
  });

  const result = resolveGate(statePath, { action: 'approve' });

  assert.equal(result.gate_state, 'pre_approved');
  assert.equal(result.story_done, 's-42');
  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'pre_approved');
  assert.equal(state.stories['s-42'].phase_position, 'done');
  assert.equal(state.in_flight_story_id, null);
  assert.equal(state.in_flight_task_id, null);
});

test('resolveGate: continue → gate_state=pre_approved, no story completed', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, {
    gate_state: 'review_awaiting_human',
    in_flight_story_id: 's-7',
    stories: { 's-7': { phase_position: 'dispatched_impl' } },
  });

  const result = resolveGate(statePath, { action: 'continue' });

  assert.equal(result.gate_state, 'pre_approved');
  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'pre_approved');
  // continue is an error-ack resume — it must NOT complete the story.
  assert.equal(state.stories['s-7'].phase_position, 'dispatched_impl');
  assert.equal(state.in_flight_story_id, 's-7');
});

test('resolveGate: reject → gate_state=rejected, no further advance possible', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, { gate_state: 'review_awaiting_human' });

  const result = resolveGate(statePath, { action: 'reject' });

  assert.equal(result.gate_state, 'rejected');
  assert.equal(readHermesReconcilerState(statePath).gate_state, 'rejected');
});

test('resolveGate: revise → gate_state=pre_approved, story back to dispatched_impl, attempt++', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, {
    gate_state: 'review_awaiting_human',
    stories: { 's1': { phase_position: 'review_terminal', attempt: 2 } },
  });

  const result = resolveGate(statePath, { storyId: 's1', action: 'revise' });

  assert.equal(result.gate_state, 'pre_approved');
  assert.equal(result.attempt, 3);

  const state = readHermesReconcilerState(statePath);
  assert.equal(state.gate_state, 'pre_approved');
  assert.equal(state.stories['s1'].phase_position, 'dispatched_impl');
  assert.equal(state.stories['s1'].attempt, 3);
});

test('resolveGate: revise clears in-flight fields so Branch 3 re-dispatches', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, {
    gate_state: 'review_awaiting_human',
    in_flight_story_id: 's1',
    in_flight_task_id: 'task-xyz',
    dispatched_at: '2026-01-01T00:00:00Z',
    stories: { 's1': { phase_position: 'review_terminal', attempt: 1 } },
  });

  resolveGate(statePath, { storyId: 's1', action: 'revise' });

  const state = readHermesReconcilerState(statePath);
  assert.equal(state.in_flight_story_id, null);
  assert.equal(state.in_flight_task_id, null);
  assert.equal(state.dispatched_at, null);
});

test('resolveGate: revise throws if storyId missing', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  // Precondition: gate must be awaiting a human before any action is resolvable.
  writeHermesReconcilerState(statePath, { gate_state: 'review_awaiting_human' });
  assert.throws(
    () => resolveGate(statePath, { action: 'revise' }),
    /storyId is required/,
  );
});

test('resolveGate: refuses to transition when gate is not review_awaiting_human', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  // gate_state is null (never halted) — a stale action must not resume the cycle.
  assert.throws(
    () => resolveGate(statePath, { action: 'approve' }),
    /not "review_awaiting_human"/,
  );
  // finalized (terminal) must also refuse.
  writeHermesReconcilerState(statePath, { gate_state: 'finalized' });
  assert.throws(
    () => resolveGate(statePath, { action: 'approve' }),
    /not "review_awaiting_human"/,
  );
});

test('resolveGate: revise throws if story not found in state', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  writeHermesReconcilerState(statePath, { gate_state: 'review_awaiting_human' });
  assert.throws(
    () => resolveGate(statePath, { action: 'revise', storyId: 'ghost-story' }),
    /not found in reconciler state/,
  );
});

test('resolveGate: throws on unknown action', () => {
  const dir = tmpDir();
  const statePath = cycleStatePath(dir);
  assert.throws(
    () => resolveGate(statePath, { action: 'snooze' }),
    /unknown action/,
  );
});

// ── Block Kit emission ────────────────────────────────────────────────────────

test('buildVerdictMessage: returns blocks array with gate action buttons', () => {
  const { blocks } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'passed',
  });
  assert.ok(Array.isArray(blocks), 'blocks must be an array');
  const actionsBlock = blocks.find((b) => b.type === 'actions');
  assert.ok(actionsBlock, 'must include an actions block');
  assert.ok(Array.isArray(actionsBlock.elements) && actionsBlock.elements.length > 0, 'actions block must have elements');
});

test('buildVerdictMessage: button values round-trip through parseGateAction', () => {
  const { blocks } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'passed',
  });
  const actionsBlock = blocks.find((b) => b.type === 'actions');
  for (const el of actionsBlock.elements) {
    const parsed = parseGateAction(el.value);
    assert.equal(parsed.epicHandle, 'my-epic');
    assert.equal(parsed.storyId, 'h-06');
    assert.ok(parsed.action, 'action must be present');
  }
});

test('buildVerdictMessage: needs-revision verdict omits continue button', () => {
  const { blocks } = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'needs_revision',
  });
  const actionsBlock = blocks.find((b) => b.type === 'actions');
  const actions = actionsBlock.elements.map((el) => parseGateAction(el.value).action);
  assert.ok(!actions.includes('continue'), 'needs-revision should not have continue button');
  assert.ok(actions.includes('approve'), 'needs-revision must have approve');
  assert.ok(actions.includes('revise'), 'needs-revision must have revise');
  assert.ok(actions.includes('reject'), 'needs-revision must have reject');
});

test('buildVerdictMessage: retains text fallback alongside blocks', () => {
  const result = buildVerdictMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    verdict: 'passed',
  });
  assert.ok(typeof result.text === 'string' && result.text.length > 0, 'text fallback must be present');
  assert.ok(Array.isArray(result.blocks), 'blocks must be present');
});

test('buildErrorMessage: returns blocks array with continue + reject buttons', () => {
  const { blocks } = buildErrorMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    errorKind: 'dispatch_failure',
    details: 'timeout',
  });
  assert.ok(Array.isArray(blocks), 'blocks must be an array');
  const actionsBlock = blocks.find((b) => b.type === 'actions');
  assert.ok(actionsBlock, 'must include an actions block');
  const actions = actionsBlock.elements.map((el) => parseGateAction(el.value).action);
  assert.ok(actions.includes('continue'), 'error message must have continue button');
  assert.ok(actions.includes('reject'), 'error message must have reject button');
});

test('buildErrorMessage: button values round-trip through parseGateAction', () => {
  const { blocks } = buildErrorMessage({
    epicHandle: 'my-epic',
    storyId: 'h-06',
    errorKind: 'daemon_down',
  });
  const actionsBlock = blocks.find((b) => b.type === 'actions');
  for (const el of actionsBlock.elements) {
    const parsed = parseGateAction(el.value);
    assert.equal(parsed.epicHandle, 'my-epic');
    assert.ok(parsed.action, 'action must be present');
  }
});

// ── parseGateAction ───────────────────────────────────────────────────────────

test('parseGateAction: parses a valid encoded button value', () => {
  const value = JSON.stringify({ a: 'approve', e: 'my-epic', s: 'h-06' });
  const result = parseGateAction(value);
  assert.equal(result.action, 'approve');
  assert.equal(result.epicHandle, 'my-epic');
  assert.equal(result.storyId, 'h-06');
});

test('parseGateAction: throws on non-JSON input', () => {
  assert.throws(() => parseGateAction('not-json'), /invalid button value/);
});

test('parseGateAction: throws when action field missing', () => {
  assert.throws(
    () => parseGateAction(JSON.stringify({ e: 'my-epic', s: 'h-06' })),
    /missing or invalid.*action/,
  );
});

test('parseGateAction: throws when epicHandle field missing', () => {
  assert.throws(
    () => parseGateAction(JSON.stringify({ a: 'approve', s: 'h-06' })),
    /missing or invalid.*epicHandle/,
  );
});

test('parseGateAction: returns null storyId when absent', () => {
  const value = JSON.stringify({ a: 'continue', e: 'my-epic', s: null });
  const result = parseGateAction(value);
  assert.equal(result.storyId, null);
});

// ── resolveGateInvoker ────────────────────────────────────────────────────────

test('resolveGateInvoker: resolves gate via cycleStateDirPath', () => {
  const dir = tmpDir();
  const statePath = path.join(dir, 'my-epic.yaml');
  writeHermesReconcilerState(statePath, { gate_state: 'review_awaiting_human' });

  const result = resolveGateInvoker(
    { epicHandle: 'my-epic', action: 'approve' },
    { cycleStateDirPath: dir },
  );
  assert.equal(result.resolved, true);
  assert.equal(result.gate_state, 'pre_approved');
});

test('resolveGateInvoker: throws when cycleStateDirPath missing and env not set', () => {
  const saved = process.env.HERMES_CYCLE_STATE_DIR;
  delete process.env.HERMES_CYCLE_STATE_DIR;
  try {
    assert.throws(
      () => resolveGateInvoker({ epicHandle: 'my-epic', action: 'approve' }),
      /HERMES_CYCLE_STATE_DIR/,
    );
  } finally {
    if (saved !== undefined) process.env.HERMES_CYCLE_STATE_DIR = saved;
  }
});

test('resolveGateInvoker: uses HERMES_CYCLE_STATE_DIR env when no opts provided', () => {
  const dir = tmpDir();
  const statePath = path.join(dir, 'my-epic.yaml');
  writeHermesReconcilerState(statePath, { gate_state: 'review_awaiting_human' });
  const saved = process.env.HERMES_CYCLE_STATE_DIR;
  process.env.HERMES_CYCLE_STATE_DIR = dir;
  try {
    const result = resolveGateInvoker({ epicHandle: 'my-epic', action: 'reject' });
    assert.equal(result.gate_state, 'rejected');
  } finally {
    if (saved === undefined) delete process.env.HERMES_CYCLE_STATE_DIR;
    else process.env.HERMES_CYCLE_STATE_DIR = saved;
  }
});

test('resolveGateInvoker: rejects epicHandle with path separators / non-slug, writes nothing', () => {
  const dir = tmpDir();
  for (const bad of [
    '../escape', 'team/epic', 'a\\b', 'UPPER', 'under_score', '', '-leading',
    '/tmp/evil', '/etc/passwd', 'a/../../etc', '..',
  ]) {
    assert.throws(
      () => resolveGateInvoker({ epicHandle: bad, action: 'approve' }, { cycleStateDirPath: dir }),
      /slug|path separators|non-empty/i,
      `expected rejection for handle: ${JSON.stringify(bad)}`,
    );
  }
  // No state file may be created anywhere under the cycle-state dir.
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('resolveGateInvoker: rejects overlong epicHandle, writes nothing', () => {
  const dir = tmpDir();
  assert.throws(
    () => resolveGateInvoker({ epicHandle: 'a'.repeat(200), action: 'approve' }, { cycleStateDirPath: dir }),
    /slug|path separators/i,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('resolveGateInvoker: propagates resolveGate error for wrong gate_state', () => {
  const dir = tmpDir();
  assert.throws(
    () => resolveGateInvoker(
      { epicHandle: 'my-epic', action: 'approve' },
      { cycleStateDirPath: dir },
    ),
    /not "review_awaiting_human"/,
  );
});
