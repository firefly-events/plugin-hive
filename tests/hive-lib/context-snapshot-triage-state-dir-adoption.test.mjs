/**
 * Relocated-state regression tests (story sdr-4).
 *
 * With `paths.state_dir: custom-state` in hive.config.yaml (or HIVE_STATE_DIR
 * set), context snapshot composition must read state from the configured dir,
 * the context-snapshot skill runner must write the snapshot there, and the
 * triage skill runner must keep its queue under <state-dir>/triage. With no
 * state-dir configuration, the default .pHive paths must be unchanged.
 *
 * Run: node --test tests/hive-lib/context-snapshot-triage-state-dir-adoption.test.mjs
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { composeContextSnapshot } from '../../hive/lib/context-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SNAPSHOT_RUNNER = path.join(REPO_ROOT, 'skills', 'context-snapshot', 'run.mjs');
const TRIAGE_RUNNER = path.join(REPO_ROOT, 'skills', 'triage', 'run.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOLVER_ENV_KEYS = ['HIVE_STATE_DIR', 'CONFIG_FILE', 'HIVE_ROOT', 'HIVE_TRIAGE_QUEUE_DIR'];

// realpath so macOS /var → /private/var symlinks don't confuse path asserts
// (the resolver canonicalizes its output).
function makeTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdr4-test-')));
}

function writeStateDirConfig(root, stateDir = 'custom-state') {
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  state_dir: ${stateDir}\n`,
    'utf8',
  );
}

function writeEpic(root, stateDir, epicId, title) {
  const dir = path.join(root, stateDir, 'epics', epicId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'epic.yaml'),
    `name: ${epicId}\ntitle: ${title}\nmethodology: classic\n`,
    'utf8',
  );
}

function writeTriageQueue(root, stateDir, itemId, title) {
  const dir = path.join(root, stateDir, 'triage');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'queue.yaml'),
    [
      'version: 1',
      'items:',
      `  - id: ${itemId}`,
      '    state: inbox',
      '    kind: bug',
      `    title: ${title}`,
      '    reporter: operator',
      '    reported_at: 2026-06-10T00:00:00Z',
      '',
    ].join('\n'),
    'utf8',
  );
}

/** Run fn with the resolver env tiers cleared, restoring them afterwards. */
function withCleanEnv(fn) {
  const prev = {};
  for (const key of RESOLVER_ENV_KEYS) {
    prev[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of RESOLVER_ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

/** Spawn a skill runner with the resolver env tiers controlled. */
function runSkill(runner, args, envOverrides) {
  const env = { ...process.env };
  for (const key of RESOLVER_ENV_KEYS) delete env[key];
  Object.assign(env, envOverrides);
  return execFileSync(process.execPath, [runner, ...args], {
    encoding: 'utf8',
    env,
  });
}

// ---------------------------------------------------------------------------
// composeContextSnapshot — composition reads the configured state dir
// ---------------------------------------------------------------------------

test('composeContextSnapshot reads epics and triage from configured state_dir, not .pHive', () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');

  writeEpic(root, 'custom-state', 'relocated-epic', 'Relocated Epic');
  writeTriageQueue(root, 'custom-state', 't-001', 'Relocated triage item');

  // Decoy legacy tree — must NOT be read when state_dir is configured.
  writeEpic(root, '.pHive', 'decoy-epic', 'Decoy Epic');
  writeTriageQueue(root, '.pHive', 't-666', 'Decoy triage item');

  const snap = withCleanEnv(() => composeContextSnapshot({ stateDir: root }));

  assert.deepEqual(snap.epics.map(e => e.id), ['relocated-epic']);
  assert.deepEqual(snap.triage_open.map(t => t.id), ['t-001']);
});

test('composeContextSnapshot with no configuration keeps the default .pHive behavior', () => {
  const root = makeTmpDir();

  writeEpic(root, '.pHive', 'legacy-epic', 'Legacy Epic');
  writeTriageQueue(root, '.pHive', 't-001', 'Legacy triage item');

  const snap = withCleanEnv(() => composeContextSnapshot({ stateDir: root }));

  assert.deepEqual(snap.epics.map(e => e.id), ['legacy-epic']);
  assert.deepEqual(snap.triage_open.map(t => t.id), ['t-001']);
});

// ---------------------------------------------------------------------------
// context-snapshot skill runner — reads and writes the configured state dir
// ---------------------------------------------------------------------------

test('context-snapshot runner --write lands the snapshot under HIVE_STATE_DIR', () => {
  const root = makeTmpDir();
  const stateDir = path.join(root, 'custom-state');

  writeEpic(root, 'custom-state', 'runner-epic', 'Runner Epic');

  const stdout = runSkill(SNAPSHOT_RUNNER, ['--write'], { HIVE_STATE_DIR: stateDir });

  const snap = JSON.parse(stdout);
  assert.deepEqual(snap.epics.map(e => e.id), ['runner-epic']);

  const outPath = path.join(stateDir, 'context-snapshot.json');
  assert.ok(fs.existsSync(outPath), `expected snapshot at ${outPath}`);
  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(written.schema_version, 1);
  assert.deepEqual(written.epics.map(e => e.id), ['runner-epic']);

  // Nothing written to a legacy .pHive next to the relocated state dir.
  assert.ok(!fs.existsSync(path.join(root, '.pHive')));
});

// ---------------------------------------------------------------------------
// triage skill runner — queue lives under <state-dir>/triage
// ---------------------------------------------------------------------------

test('triage runner writes the queue under <HIVE_STATE_DIR>/triage', () => {
  const root = makeTmpDir();
  const stateDir = path.join(root, 'custom-state');

  const createOut = runSkill(
    TRIAGE_RUNNER,
    ['Relocated queue entry', '--json'],
    { HIVE_STATE_DIR: stateDir },
  );
  const created = JSON.parse(createOut);
  assert.equal(created.state, 'inbox');

  const queuePath = path.join(stateDir, 'triage', 'queue.yaml');
  assert.ok(fs.existsSync(queuePath), `expected queue at ${queuePath}`);
  assert.match(fs.readFileSync(queuePath, 'utf8'), /Relocated queue entry/);

  const listOut = runSkill(TRIAGE_RUNNER, ['--list', '--json'], { HIVE_STATE_DIR: stateDir });
  const listed = JSON.parse(listOut);
  assert.equal(listed.count, 1);
  assert.equal(listed.items[0].id, created.id);

  assert.ok(!fs.existsSync(path.join(root, '.pHive')));
});

test('triage runner honors the config-file tier (CONFIG_FILE with absolute state_dir)', () => {
  const root = makeTmpDir();
  const stateDir = path.join(root, 'cfg-state');
  const configPath = path.join(root, 'hive.config.yaml');
  fs.writeFileSync(configPath, `paths:\n  state_dir: ${stateDir}\n`, 'utf8');

  runSkill(TRIAGE_RUNNER, ['Config-tier entry', '--json'], { CONFIG_FILE: configPath });

  const queuePath = path.join(stateDir, 'triage', 'queue.yaml');
  assert.ok(fs.existsSync(queuePath), `expected queue at ${queuePath}`);
  assert.match(fs.readFileSync(queuePath, 'utf8'), /Config-tier entry/);
});

test('triage runner keeps HIVE_TRIAGE_QUEUE_DIR test-isolation override ahead of the resolver', () => {
  const root = makeTmpDir();
  const queueDir = path.join(root, 'isolated-queue');

  runSkill(
    TRIAGE_RUNNER,
    ['Isolation entry', '--json'],
    { HIVE_TRIAGE_QUEUE_DIR: queueDir, HIVE_STATE_DIR: path.join(root, 'ignored-state') },
  );

  assert.ok(fs.existsSync(path.join(queueDir, 'queue.yaml')));
  assert.ok(!fs.existsSync(path.join(root, 'ignored-state')));
});
