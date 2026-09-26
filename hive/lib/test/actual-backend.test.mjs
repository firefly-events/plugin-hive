import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSimmanCmd,
  probeActualBackend,
  resolveActualBackend,
  decideActual,
  formatActualResolveLog,
} from '../actual-backend.mjs';

// ─── resolveSimmanCmd ──────────────────────────────────────────────────────────

test('resolveSimmanCmd: env wins over config cmd', () => {
  const prev = process.env.SIMMAN_CMD;
  process.env.SIMMAN_CMD = 'simman-from-env';
  assert.equal(resolveSimmanCmd({ simmanCmd: '/explicit/simman' }), 'simman-from-env');
  delete process.env.SIMMAN_CMD;
  if (prev !== undefined) process.env.SIMMAN_CMD = prev;
});

test('resolveSimmanCmd: config cmd wins over PATH default when no env', () => {
  const prev = process.env.SIMMAN_CMD;
  delete process.env.SIMMAN_CMD;
  assert.equal(resolveSimmanCmd({ simmanCmd: '/opt/simman/bin/simman' }), '/opt/simman/bin/simman');
  if (prev !== undefined) process.env.SIMMAN_CMD = prev;
});

test('resolveSimmanCmd: falls back to env then PATH default', () => {
  const prev = process.env.SIMMAN_CMD;
  process.env.SIMMAN_CMD = 'simman-from-env';
  assert.equal(resolveSimmanCmd(), 'simman-from-env');
  delete process.env.SIMMAN_CMD;
  assert.equal(resolveSimmanCmd(), 'simman');
  if (prev !== undefined) process.env.SIMMAN_CMD = prev;
});

// ─── resolveActualBackend (pure decision) ──────────────────────────────────────

test('resolveActualBackend: available → keep actual, backend=simman', () => {
  const d = resolveActualBackend({ available: true });
  assert.equal(d.mode_decision, 'actual');
  assert.equal(d.sources.actual_backend, 'simman');
  assert.equal(d.reason, 'simman-ready');
});

test('resolveActualBackend: unavailable + default policy → inconclusive (NOT routed to simulated-manual)', () => {
  const d = resolveActualBackend({ available: false, probeDetail: 'simman not found' });
  assert.equal(d.mode_decision, 'inconclusive');
  assert.equal(d.sources.actual_fallback, 'inconclusive');
  assert.match(d.reason, /simman-unavailable/);
});

test('resolveActualBackend: unavailable + abort policy → throws ACTUAL_UNAVAILABLE_ABORT', () => {
  assert.throws(
    () => resolveActualBackend({ available: false, onUnavailable: 'abort', probeDetail: 'no cli' }),
    (e) => e.code === 'ACTUAL_UNAVAILABLE_ABORT' && /no cli/.test(e.message),
  );
});

// ─── probeActualBackend (CLI presence) ─────────────────────────────────────────

test('probeActualBackend: CLI present → available, backend=simman', async () => {
  const p = await probeActualBackend({
    _probeCli: async () => ({ ok: true, detail: 'simman --help ok' }),
    _probeUrl: async () => { throw new Error('should not call probeUrl when no simmanUrl'); },
  });
  assert.equal(p.available, true);
  assert.equal(p.state, 'ready');
  assert.equal(p.backend, 'simman');
  assert.equal(p.cmd, 'simman');
});

test('probeActualBackend: CLI not found → unavailable', async () => {
  const p = await probeActualBackend({
    _probeCli: async () => ({ ok: false, detail: 'simman not found' }),
  });
  assert.equal(p.available, false);
  assert.equal(p.state, 'not_ready');
  assert.equal(p.backend, null);
});

test('probeActualBackend: simmanUrl reachable → available without CLI probe', async () => {
  let cliCalled = false;
  const p = await probeActualBackend({
    simmanCmd: '/opt/simman/bin/simman',
    simmanUrl: 'http://localhost:9000',
    _probeUrl: async (url) => ({ ok: true, detail: `${url} HTTP 200` }),
    _probeCli: async () => { cliCalled = true; return { ok: true, detail: 'ok' }; },
  });
  assert.equal(p.available, true);
  assert.equal(p.backend, 'simman');
  assert.equal(cliCalled, false, 'CLI probe must not run when URL probe succeeded');
});

test('probeActualBackend: simmanUrl unreachable falls through to CLI', async () => {
  let sawCmd;
  const p = await probeActualBackend({
    simmanCmd: '/opt/simman/bin/simman',
    simmanUrl: 'http://localhost:9000',
    _probeUrl: async () => ({ ok: false, detail: 'connection refused' }),
    _probeCli: async (cmd) => { sawCmd = cmd; return { ok: false, detail: 'not found' }; },
  });
  assert.equal(sawCmd, '/opt/simman/bin/simman');
  assert.equal(p.cmd, '/opt/simman/bin/simman');
  assert.equal(p.available, false);
  assert.match(p.detail, /simman_url=http:\/\/localhost:9000/);
});

test('probeActualBackend: uses resolved cmd', async () => {
  let sawCmd;
  await probeActualBackend({
    simmanCmd: '/opt/simman/bin/simman',
    _probeCli: async (cmd) => { sawCmd = cmd; return { ok: false, detail: 'timed out' }; },
  });
  assert.equal(sawCmd, '/opt/simman/bin/simman');
});

// ─── decideActual (orchestrator) — the bridge-contract cases ───────────────────

test('decideActual case A: CLI present → actual', async () => {
  const d = await decideActual({
    _probe: async () => ({ available: true, state: 'ready', detail: 'ok', backend: 'simman', cmd: 'simman' }),
  });
  assert.equal(d.mode_decision, 'actual');
  assert.equal(d.sources.actual_backend, 'simman');
  assert.equal(d.probe.state, 'ready');
});

test('decideActual case B: absent + fallback → inconclusive (not routed to simulated-manual)', async () => {
  const d = await decideActual({
    onUnavailable: 'fallback',
    _probe: async () => ({ available: false, state: 'not_ready', detail: 'simman not found', backend: null, cmd: 'simman' }),
  });
  assert.equal(d.mode_decision, 'inconclusive');
  assert.equal(d.sources.actual_fallback, 'inconclusive');
});

test('decideActual case C: absent + abort → throws', async () => {
  await assert.rejects(
    decideActual({
      onUnavailable: 'abort',
      _probe: async () => ({ available: false, state: 'not_ready', detail: 'simman not found', backend: null, cmd: 'simman' }),
    }),
    (e) => e.code === 'ACTUAL_UNAVAILABLE_ABORT',
  );
});

test('decideActual default policy is fallback (inconclusive) when on_unavailable omitted', async () => {
  const d = await decideActual({
    _probe: async () => ({ available: false, state: 'not_ready', detail: 'x', backend: null, cmd: 'simman' }),
  });
  assert.equal(d.mode_decision, 'inconclusive');
});

// ─── formatActualResolveLog ────────────────────────────────────────────────────

test('formatActualResolveLog: ready path emits [telemetry] with simman backend', () => {
  const line = formatActualResolveLog({
    probe: { state: 'ready', backend: 'simman' },
    mode_decision: 'actual',
    sources: { actual_backend: 'simman' },
    reason: 'simman-ready',
  });
  assert.match(line, /^\[telemetry\]/);
  assert.match(line, /probe=ready decision=actual backend=simman/);
});

test('formatActualResolveLog: fallback path emits [WARNING] (loud, not INFO)', () => {
  const line = formatActualResolveLog({
    probe: { state: 'not_ready', backend: null },
    mode_decision: 'inconclusive',
    sources: { actual_fallback: 'inconclusive' },
    reason: 'simman-unavailable: simman not found',
  });
  assert.match(line, /^\[WARNING\]/);
  assert.match(line, /probe=not_ready decision=inconclusive/);
  assert.match(line, /simman-unavailable/);
});

test('formatActualResolveLog: uses probe.backend rather than re-deriving from sources', () => {
  // Probe already computed backend; formatActualResolveLog must use it, not sources
  const line = formatActualResolveLog({
    probe: { state: 'ready', backend: 'simman' },
    mode_decision: 'actual',
    sources: {},  // empty sources — backend must come from probe
    reason: 'simman-ready',
  });
  assert.match(line, /backend=simman/);
});
