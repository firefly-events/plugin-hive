/**
 * State-dir resolver adoption tests (story sdr-6) for scenario loading,
 * story-status backfill, episode-marker audit, reverse-sync, and the
 * gate-mode audit aggregator.
 *
 * Each adopted surface is exercised through the Q2 precedence permutations
 * that apply to it:
 *   1. env only           → HIVE_STATE_DIR wins
 *   2. config only        → root-config paths.state_dir wins
 *   3. env + config       → env override beats config
 *   4. neither            → default `.pHive` unchanged
 * plus the surface's explicit injection seam where one exists
 * (reverse-sync `stateDir` option, gate-mode-audit `--state-dir` flag).
 *
 * Run: node --test tests/hive-lib/scenarios-audits-reverse-sync-state-dir-adoption.test.mjs
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadScenario } from '../../hive/lib/scenarios/load.mjs';
import { run as reverseSyncRun } from '../../hive/scripts/multica-reverse-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT_SCRIPT = path.join(REPO_ROOT, 'hive', 'scripts', 'audit-episode-markers.mjs');
const BACKFILL_SCRIPT = path.join(REPO_ROOT, 'hive', 'scripts', 'story-status-backfill.mjs');
const GATE_AUDIT_SCRIPT = path.join(REPO_ROOT, 'hive', 'scripts', 'gate-mode-audit.mjs');

// ---------------------------------------------------------------------------
// Helpers (pattern from task-release-handoff-state-dir-adoption.test.mjs / sdr-5)
// ---------------------------------------------------------------------------

const RESOLVER_ENV_KEYS = ['HIVE_STATE_DIR', 'CONFIG_FILE', 'HIVE_ROOT'];

// realpath so macOS /var → /private/var symlinks don't confuse path asserts
// (the resolver canonicalizes its output).
function makeTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdr6-test-')));
}

function writeStateDirConfig(root, stateDir = 'custom-state') {
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  state_dir: ${stateDir}\n`,
    'utf8',
  );
}

/** Run fn with the resolver env tiers reset to `envOverride`, restoring after. */
async function withResolverEnv(envOverride, fn) {
  const prevEnv = {};
  for (const key of RESOLVER_ENV_KEYS) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, envOverride);
  try {
    return await fn();
  } finally {
    for (const key of RESOLVER_ENV_KEYS) {
      delete process.env[key];
      if (prevEnv[key] !== undefined) process.env[key] = prevEnv[key];
    }
  }
}

/** Subprocess env with resolver tiers cleared, then overridden. */
function subprocessEnv(envOverride = {}) {
  const env = { ...process.env };
  for (const key of RESOLVER_ENV_KEYS) delete env[key];
  return { ...env, ...envOverride };
}

function runScript(script, args, { cwd, env, expectFailure = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: cwd || REPO_ROOT,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (err) {
    if (!expectFailure) {
      throw new Error(
        `script ${script} exited ${err.status}\nstdout: ${err.stdout}\nstderr: ${err.stderr}`,
      );
    }
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function writeScenario(root) {
  const file = path.join(root, 'scenario.yaml');
  fs.writeFileSync(
    file,
    [
      'id: sdr6-scenario',
      'title: relocated-state scenario',
      'mode: implementation-walk',
      'story: s1',
      'epic: e1',
      'steps:',
      '  - action: do the thing',
      '    expected: the thing is done',
      '',
    ].join('\n'),
    'utf8',
  );
  return file;
}

function writeIntegrateMarker(stateDirAbs, epic = 'e1', story = 's1') {
  const dir = path.join(stateDirAbs, 'episodes', epic, story);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'integrate.yaml'), 'status: completed\n', 'utf8');
}

function writeRunMarker(stateDirAbs, { epic = 'e1', story = 's1', complete = true } = {}) {
  const dir = path.join(stateDirAbs, 'episodes', epic, story);
  fs.mkdirSync(dir, { recursive: true });
  const fields = complete
    ? ['issue_id: 11111111-1111-1111-1111-111111111111', 'issue_identifier: PLU-1', 'workspace_id: 22222222-2222-2222-2222-222222222222', `story_id: ${story}`, `epic: ${epic}`]
    : ['issue_id: 11111111-1111-1111-1111-111111111111'];
  fs.writeFileSync(path.join(dir, 'multica-run.yaml'), fields.join('\n') + '\n', 'utf8');
}

function writeStoryYaml(stateDirAbs, { epic = 'e1', story = 's1', status = 'pending', steps = [] } = {}) {
  const dir = path.join(stateDirAbs, 'epics', epic, 'stories');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`id: ${story}`, `status: ${status}`];
  if (steps.length > 0) {
    lines.push('steps:');
    for (const s of steps) lines.push(`  - id: ${s}`);
  }
  fs.writeFileSync(path.join(dir, `${story}.yaml`), lines.join('\n') + '\n', 'utf8');
  return path.join(dir, `${story}.yaml`);
}

function writeStepMarker(stateDirAbs, { epic = 'e1', story = 's1', step, status = 'completed' } = {}) {
  const dir = path.join(stateDirAbs, 'episodes', epic, story);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${step}.yaml`),
    `step_id: ${step}\nstatus: ${status}\n`,
    'utf8',
  );
}

function writeGateLiftEvents(stateDirAbs) {
  const dir = path.join(stateDirAbs, 'metrics', 'events');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'stop-aaaa.jsonl'),
    '{"event":"gate_lift_fired","run_id":"r1"}\n',
    'utf8',
  );
}

// stub fetch so reverse-sync sees every issue as cancelled without a network
async function withCancelledFetch(fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'cancelled' }) });
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
// 1. Scenario loading (hive/lib/scenarios/load.mjs)
// ---------------------------------------------------------------------------

test('loadScenario: config paths.state_dir relocates the integrate-marker lookup', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  writeIntegrateMarker(path.join(root, 'custom-state'));
  const scenario = writeScenario(root);
  await withResolverEnv({}, () => {
    const doc = loadScenario(scenario, { cwd: root });
    assert.equal(doc.mode, 'implementation-walk');
  });
});

test('loadScenario: HIVE_STATE_DIR env beats config', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'config-state');
  const envState = path.join(root, 'env-state');
  writeIntegrateMarker(envState);
  const scenario = writeScenario(root);
  await withResolverEnv({ HIVE_STATE_DIR: envState }, () => {
    const doc = loadScenario(scenario, { cwd: root });
    assert.equal(doc.id, 'sdr6-scenario');
  });
  // and with only the config state populated, env still wins → marker missing
  await withResolverEnv({ HIVE_STATE_DIR: path.join(root, 'empty-state') }, () => {
    assert.throws(
      () => loadScenario(scenario, { cwd: root }),
      (err) => err.code === 'INTEGRATE_MARKER_MISSING',
    );
  });
});

test('loadScenario: no configuration falls back to .pHive', async () => {
  const root = makeTmpDir();
  writeIntegrateMarker(path.join(root, '.pHive'));
  const scenario = writeScenario(root);
  await withResolverEnv({}, () => {
    const doc = loadScenario(scenario, { cwd: root });
    assert.equal(doc.story, 's1');
  });
});

test('loadScenario: missing marker under relocated state dir reports the relocated path', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  const scenario = writeScenario(root);
  await withResolverEnv({}, () => {
    assert.throws(
      () => loadScenario(scenario, { cwd: root }),
      (err) =>
        err.code === 'INTEGRATE_MARKER_MISSING' &&
        err.markerPath === path.join(root, 'custom-state', 'episodes', 'e1', 's1', 'integrate.yaml'),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Story-status backfill (hive/scripts/story-status-backfill.mjs)
// ---------------------------------------------------------------------------

test('story-status-backfill: HIVE_STATE_DIR relocates reads and --apply writes', () => {
  const root = makeTmpDir();
  const stateDir = path.join(root, 'env-state');
  const storyPath = writeStoryYaml(stateDir, { status: 'pending', steps: ['integrate'] });
  writeStepMarker(stateDir, { step: 'integrate', status: 'completed' });

  const { stdout } = runScript(BACKFILL_SCRIPT, ['--apply'], {
    env: subprocessEnv({ HIVE_STATE_DIR: stateDir }),
  });
  assert.match(stdout, /e1\/s1: pending → completed/);
  const rewritten = fs.readFileSync(storyPath, 'utf8');
  assert.match(rewritten, /^status: completed$/m);
});

test('story-status-backfill: CONFIG_FILE paths.state_dir relocates the scan', () => {
  const root = makeTmpDir();
  const stateDir = path.join(root, 'config-state');
  writeStoryYaml(stateDir, { status: 'pending', steps: ['integrate'] });
  writeStepMarker(stateDir, { step: 'integrate', status: 'completed' });
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  state_dir: ${stateDir}\n`,
    'utf8',
  );

  const { stdout } = runScript(BACKFILL_SCRIPT, [], {
    env: subprocessEnv({ CONFIG_FILE: path.join(root, 'hive.config.yaml') }),
  });
  // dry-run reports the relocated story as stale without writing
  assert.match(stdout, /1 stale story found\./);
});

test('story-status-backfill: unset state_dir keeps the default .pHive layout', () => {
  // paths.state_dir is unset; only paths.target_project relocates the base,
  // so the scan must land on the default `.pHive` name under it. (Scanning
  // the live repo tree instead would take ~45s of git calls per run.)
  const root = makeTmpDir();
  const stateDir = path.join(root, '.pHive');
  writeStoryYaml(stateDir, { status: 'pending', steps: ['integrate'] });
  writeStepMarker(stateDir, { step: 'integrate', status: 'completed' });
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  target_project: ${root}\n`,
    'utf8',
  );

  const { stdout } = runScript(BACKFILL_SCRIPT, [], {
    env: subprocessEnv({ CONFIG_FILE: path.join(root, 'hive.config.yaml') }),
  });
  assert.match(stdout, /1 stale story found\./);
});

// ---------------------------------------------------------------------------
// 3. Episode-marker audit (hive/scripts/audit-episode-markers.mjs)
// ---------------------------------------------------------------------------

test('audit-episode-markers: config paths.state_dir relocates the marker walk', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  writeRunMarker(path.join(root, 'custom-state'), { complete: true });

  const { stdout } = runScript(AUDIT_SCRIPT, [root], { env: subprocessEnv() });
  assert.match(stdout, /OK — 1 marker\(s\) scanned/);
});

test('audit-episode-markers: HIVE_STATE_DIR beats config and flags offenders there', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'config-state');
  writeRunMarker(path.join(root, 'config-state'), { complete: true });
  const envState = path.join(root, 'env-state');
  writeRunMarker(envState, { complete: false });

  const result = runScript(AUDIT_SCRIPT, [root], {
    env: subprocessEnv({ HIVE_STATE_DIR: envState }),
    expectFailure: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing or empty: issue_identifier/);
});

test('audit-episode-markers: no configuration falls back to .pHive', () => {
  const root = makeTmpDir();
  writeRunMarker(path.join(root, '.pHive'), { complete: true });

  const { stdout } = runScript(AUDIT_SCRIPT, [root], { env: subprocessEnv() });
  assert.match(stdout, /OK — 1 marker\(s\) scanned/);
});

// ---------------------------------------------------------------------------
// 4. Reverse-sync (hive/scripts/multica-reverse-sync.mjs)
// ---------------------------------------------------------------------------

test('reverse-sync: config paths.state_dir relocates marker reads and YAML writes', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  const stateDir = path.join(root, 'custom-state');
  writeRunMarker(stateDir);
  const storyPath = writeStoryYaml(stateDir, { status: 'pending' });

  const summary = await withResolverEnv({}, () =>
    withCancelledFetch(() =>
      reverseSyncRun({ repoRoot: root, serverUrl: 'https://example.invalid', token: 't' }),
    ),
  );
  assert.deepEqual(summary, { checked: 1, cancelled: 1, patched: 1, noops: 0 });
  assert.match(fs.readFileSync(storyPath, 'utf8'), /^status: deferred$/m);
});

test('reverse-sync: HIVE_STATE_DIR env beats config', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'config-state');
  writeRunMarker(path.join(root, 'config-state'));
  const envState = path.join(root, 'env-state');
  writeRunMarker(envState);
  const storyPath = writeStoryYaml(envState, { status: 'pending' });

  const summary = await withResolverEnv({ HIVE_STATE_DIR: envState }, () =>
    withCancelledFetch(() =>
      reverseSyncRun({ repoRoot: root, serverUrl: 'https://example.invalid', token: 't' }),
    ),
  );
  assert.deepEqual(summary, { checked: 1, cancelled: 1, patched: 1, noops: 0 });
  assert.match(fs.readFileSync(storyPath, 'utf8'), /^status: deferred$/m);
});

test('reverse-sync: no configuration falls back to .pHive', async () => {
  const root = makeTmpDir();
  const stateDir = path.join(root, '.pHive');
  writeRunMarker(stateDir);
  const storyPath = writeStoryYaml(stateDir, { status: 'pending' });

  const summary = await withResolverEnv({}, () =>
    withCancelledFetch(() =>
      reverseSyncRun({ repoRoot: root, serverUrl: 'https://example.invalid', token: 't' }),
    ),
  );
  assert.deepEqual(summary, { checked: 1, cancelled: 1, patched: 1, noops: 0 });
  assert.match(fs.readFileSync(storyPath, 'utf8'), /source: multica-cancelled/);
});

test('reverse-sync: explicit stateDir option beats the resolver', async () => {
  const root = makeTmpDir();
  const envState = path.join(root, 'env-state');
  writeRunMarker(envState);
  const seamState = path.join(root, 'seam-state');
  writeRunMarker(seamState);
  const storyPath = writeStoryYaml(seamState, { status: 'pending' });

  const summary = await withResolverEnv({ HIVE_STATE_DIR: envState }, () =>
    withCancelledFetch(() =>
      reverseSyncRun({
        repoRoot: root,
        serverUrl: 'https://example.invalid',
        token: 't',
        stateDir: seamState,
      }),
    ),
  );
  assert.deepEqual(summary, { checked: 1, cancelled: 1, patched: 1, noops: 0 });
  assert.match(fs.readFileSync(storyPath, 'utf8'), /^status: deferred$/m);
});

// ---------------------------------------------------------------------------
// 5. Gate-mode audit (hive/scripts/gate-mode-audit.mjs) — classified runtime
// ---------------------------------------------------------------------------

test('gate-mode-audit: config paths.state_dir relocates event reads and recommendation writes', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  writeGateLiftEvents(path.join(root, 'custom-state'));

  const { stdout } = runScript(GATE_AUDIT_SCRIPT, [], { cwd: root, env: subprocessEnv() });
  const report = JSON.parse(stdout);
  assert.equal(report.details.totalRuns, 1);
  assert.equal(report.flip, true);
  assert.equal(
    report.written,
    path.join(root, 'custom-state', 'meta-team', 'gate-mode-recommendation.md'),
  );
  assert.ok(fs.existsSync(report.written));
});

test('gate-mode-audit: HIVE_STATE_DIR env beats config', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'config-state');
  const envState = path.join(root, 'env-state');
  writeGateLiftEvents(envState);

  const { stdout } = runScript(GATE_AUDIT_SCRIPT, ['--dry-run'], {
    cwd: root,
    env: subprocessEnv({ HIVE_STATE_DIR: envState }),
  });
  const report = JSON.parse(stdout);
  assert.equal(report.details.totalRuns, 1);
});

test('gate-mode-audit: --state-dir flag beats the resolver', () => {
  const root = makeTmpDir();
  const envState = path.join(root, 'env-state');
  writeGateLiftEvents(envState);
  const flagState = path.join(root, 'flag-state');
  writeGateLiftEvents(flagState);
  fs.appendFileSync(
    path.join(flagState, 'metrics', 'events', 'stop-aaaa.jsonl'),
    '{"event":"gate_lift_fired","run_id":"r2"}\n',
  );

  const { stdout } = runScript(GATE_AUDIT_SCRIPT, ['--state-dir', flagState, '--dry-run'], {
    cwd: root,
    env: subprocessEnv({ HIVE_STATE_DIR: envState }),
  });
  const report = JSON.parse(stdout);
  // two runs only exist in the flag-state tree
  assert.equal(report.details.totalRuns, 2);
});

test('gate-mode-audit: no configuration falls back to .pHive under cwd', () => {
  const root = makeTmpDir();
  writeGateLiftEvents(path.join(root, '.pHive'));

  const { stdout } = runScript(GATE_AUDIT_SCRIPT, ['--dry-run'], {
    cwd: root,
    env: subprocessEnv(),
  });
  const report = JSON.parse(stdout);
  assert.equal(report.details.totalRuns, 1);
  assert.equal(report.written, '<dry-run>');
});
