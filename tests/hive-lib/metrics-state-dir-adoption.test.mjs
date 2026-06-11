/**
 * Relocated-state regression tests for the metrics cluster (story sdr-3).
 *
 * budget-gate's default events dir must resolve through the sdr-1 resolver
 * (HIVE_STATE_DIR env > paths.state_dir in hive.config.yaml > default
 * .pHive), so the Node metrics reader scans the same tree the shell metrics
 * hooks write. Decoy assertions prove legacy .pHive is NOT read when a
 * custom state dir is configured.
 *
 * Run: node --test tests/hive-lib/metrics-state-dir-adoption.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { computeDailySpend, gate } from '../../hive/lib/budget-gate.js';

// realpath so macOS /var → /private/var symlinks don't confuse path asserts
// (the resolver canonicalizes its output).
function makeTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdr3-test-')));
}

function writeStateDirConfig(root, stateDir = 'custom-state') {
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  state_dir: ${stateDir}\n`,
    'utf8',
  );
}

const NOW = new Date('2026-05-15T12:00:00Z');
const TODAY_TS = '2026-05-15T08:00:00Z';

// One opus row: 1M input × $15/MTok = $15.00.
function writeStopEvent(root, stateDir, { inputTokens = 1_000_000 } = {}) {
  const eventsDir = path.join(root, stateDir, 'metrics', 'events');
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, 'stop-test.jsonl'),
    `${JSON.stringify({
      timestamp: TODAY_TS,
      metric_type: 'tokens',
      value: inputTokens,
      dimensions: { model: 'claude-opus-4-8', input_tokens: inputTokens, output_tokens: 0 },
    })}\n`,
    'utf8',
  );
}

test('configured paths.state_dir: spend read from custom tree, decoy .pHive ignored', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  writeStopEvent(root, 'custom-state', { inputTokens: 1_000_000 }); // $15
  // Decoy under the legacy default tree — must NOT be counted.
  writeStopEvent(root, '.pHive', { inputTokens: 10_000_000 }); // $150 if read

  const spend = computeDailySpend({ cwd: root, env: {}, now: NOW, warn: () => {} });
  assert.equal(Number(spend.toFixed(2)), 15.0);
});

test('HIVE_STATE_DIR env wins over configured paths.state_dir', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'config-state');
  writeStopEvent(root, 'env-state', { inputTokens: 1_000_000 }); // $15
  // Decoy under the config-pointed tree — env override must shadow it.
  writeStopEvent(root, 'config-state', { inputTokens: 10_000_000 });

  const spend = computeDailySpend({
    cwd: root,
    env: { HIVE_STATE_DIR: path.join(root, 'env-state') },
    now: NOW,
    warn: () => {},
  });
  assert.equal(Number(spend.toFixed(2)), 15.0);
});

test('no env, no config: default .pHive/metrics/events unchanged', () => {
  const root = makeTmpDir();
  writeStopEvent(root, '.pHive', { inputTokens: 1_000_000 }); // $15

  const spend = computeDailySpend({ cwd: root, env: {}, now: NOW, warn: () => {} });
  assert.equal(Number(spend.toFixed(2)), 15.0);
});

test('gate() resolves the same relocated tree end-to-end', () => {
  const root = makeTmpDir();
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    'paths:\n  state_dir: custom-state\ntokens:\n  daily_usd_limit: 10\n',
    'utf8',
  );
  writeStopEvent(root, 'custom-state', { inputTokens: 1_000_000 }); // $15 > $10

  const result = gate({
    cwd: root,
    env: {},
    now: NOW,
    warn: () => {},
    log: () => {},
    err: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.limit, 10);
  assert.equal(Number(result.spend.toFixed(2)), 15.0);
});
