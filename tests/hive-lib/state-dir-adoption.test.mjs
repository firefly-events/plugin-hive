/**
 * Relocated-state regression tests (story sdr-2).
 *
 * With `paths.state_dir: custom-state` in hive.config.yaml (and no
 * HIVE_STATE_DIR), story-status, session-registry, session-episode-writer,
 * and multica-issue-closer must read/write under custom-state/ rather than
 * .pHive/. With no state-dir configuration, the default .pHive paths must be
 * unchanged.
 *
 * Run: node --test tests/hive-lib/state-dir-adoption.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deriveStoryStatus, deriveAllStatuses } from '../../hive/lib/story-status.mjs';
import * as sessionRegistry from '../../hive/lib/session-registry.js';
import { writeEpisode } from '../../hive/lib/session-episode-writer.js';
import { closeStoryIssue } from '../../hive/lib/multica-issue-closer.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOLVER_ENV_KEYS = ['HIVE_STATE_DIR', 'CONFIG_FILE', 'HIVE_ROOT'];

// realpath so macOS /var → /private/var symlinks don't confuse path asserts
// (the resolver canonicalizes its output).
function makeTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdr2-test-')));
}

function writeStateDirConfig(root, stateDir = 'custom-state') {
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  state_dir: ${stateDir}\n`,
    'utf8',
  );
}

function writeStory(root, stateDir, epic, story, { steps = ['s1', 's9'] } = {}) {
  const dir = path.join(root, stateDir, 'epics', epic, 'stories');
  fs.mkdirSync(dir, { recursive: true });
  const stepLines = steps.map((s) => `  - id: ${s}`).join('\n');
  fs.writeFileSync(
    path.join(dir, `${story}.yaml`),
    `id: ${story}\nstatus: pending\nsteps:\n${stepLines}\n`,
    'utf8',
  );
}

function writeMarker(root, stateDir, epic, story, stepId, status, filename) {
  const dir = path.join(root, stateDir, 'episodes', epic, story);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, filename ?? `${stepId}.yaml`),
    `step_id: ${stepId}\nstatus: ${status}\n`,
    'utf8',
  );
}

/**
 * Run fn with cwd moved to dir and the resolver env tiers cleared, restoring
 * both afterwards. The registry and episode writer resolve their default
 * paths from process.cwd()/process.env at call time, so this is how a test
 * exercises the resolver path (rather than the explicit-path override).
 */
async function inDir(dir, fn) {
  const prevCwd = process.cwd();
  const prevEnv = {};
  for (const key of RESOLVER_ENV_KEYS) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
    for (const key of RESOLVER_ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
  }
}

// ---------------------------------------------------------------------------
// story-status
// ---------------------------------------------------------------------------

test('story-status: configured state_dir — reads epics + episodes under custom-state, ignores .pHive', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);
  writeStory(root, 'custom-state', 'epic-a', 'story-1');
  writeMarker(root, 'custom-state', 'epic-a', 'story-1', 's9', 'completed');
  // Decoy under the legacy path: a failed marker that must NOT be seen.
  writeMarker(root, '.pHive', 'epic-a', 'story-1', 's9', 'failed');

  await inDir(root, () => {
    const status = deriveStoryStatus({ epic_id: 'epic-a', story_id: 'story-1', repo_root: root });
    assert.equal(status, 'completed');
  });
});

test('story-status: configured state_dir — deriveAllStatuses scans custom-state/epics', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);
  writeStory(root, 'custom-state', 'epic-a', 'story-1');

  await inDir(root, () => {
    const all = deriveAllStatuses({ repo_root: root });
    assert.equal(all.length, 1);
    assert.equal(all[0].epic_id, 'epic-a');
    assert.equal(all[0].story_id, 'story-1');
    assert.equal(all[0].derived_status, 'pending');
  });
});

test('story-status: state_dir unset — default .pHive paths unchanged', async () => {
  const root = makeTmpDir();
  writeStory(root, '.pHive', 'epic-a', 'story-1');
  writeMarker(root, '.pHive', 'epic-a', 'story-1', 's9', 'completed');

  await inDir(root, () => {
    const status = deriveStoryStatus({ epic_id: 'epic-a', story_id: 'story-1', repo_root: root });
    assert.equal(status, 'completed');
  });
});

test('story-status: repo root found via hive.config.yaml when .pHive is relocated', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);
  writeStory(root, 'custom-state', 'epic-a', 'story-1');
  const nested = path.join(root, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });

  // No repo_root passed — findRepoRoot must climb from cwd to the config file.
  await inDir(nested, () => {
    const status = deriveStoryStatus({ epic_id: 'epic-a', story_id: 'story-1' });
    assert.equal(status, 'pending');
  });
});

// ---------------------------------------------------------------------------
// session-registry
// ---------------------------------------------------------------------------

test('session-registry: configured state_dir — index.yaml lands under custom-state/sessions', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);

  await inDir(root, async () => {
    await sessionRegistry.upsert('sess-1', { epic_id: 'e', story_id: 's', status: 'active' });
  });

  const relocated = path.join(root, 'custom-state', 'sessions', 'index.yaml');
  assert.ok(fs.existsSync(relocated), `expected ${relocated}`);
  assert.ok(!fs.existsSync(path.join(root, '.pHive')), '.pHive must not be created');
  assert.match(fs.readFileSync(relocated, 'utf8'), /session_id: sess-1/);

  // update + read resolve to the same relocated file
  await inDir(root, async () => {
    await sessionRegistry.update('sess-1', { status: 'completed' });
    const data = sessionRegistry.read();
    assert.equal(data.sessions.length, 1);
    assert.equal(data.sessions[0].status, 'completed');
  });
});

test('session-registry: state_dir unset — index.yaml lands under .pHive/sessions', async () => {
  const root = makeTmpDir();

  await inDir(root, async () => {
    await sessionRegistry.upsert('sess-2', { status: 'active' });
  });

  assert.ok(fs.existsSync(path.join(root, '.pHive', 'sessions', 'index.yaml')));
});

// ---------------------------------------------------------------------------
// session-episode-writer
// ---------------------------------------------------------------------------

test('session-episode-writer: configured state_dir — episode lands under custom-state/episodes', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);

  const written = await inDir(root, () =>
    writeEpisode({ session_id: 'sess-1', epic_id: 'e', story_id: 's', step_id: 'step-1' }),
  );

  assert.equal(written, path.join(root, 'custom-state', 'episodes', 'e', 's', 'step-1-sess-1.yaml'));
  assert.ok(fs.existsSync(written));
  assert.ok(!fs.existsSync(path.join(root, '.pHive')), '.pHive must not be created');
});

test('session-episode-writer: state_dir unset — episode lands under .pHive/episodes', async () => {
  const root = makeTmpDir();

  const written = await inDir(root, () =>
    writeEpisode({ session_id: 'sess-1', epic_id: 'e', story_id: 's', step_id: 'step-1' }),
  );

  assert.equal(written, path.join(root, '.pHive', 'episodes', 'e', 's', 'step-1-sess-1.yaml'));
  assert.ok(fs.existsSync(written));
});

// ---------------------------------------------------------------------------
// multica-issue-closer
// ---------------------------------------------------------------------------

function writeRunMarker(root, stateDir, epic, story) {
  const dir = path.join(root, stateDir, 'episodes', epic, story);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'multica-run.yaml'),
    'mode: multica\nissue_id: issue-uuid-1\nassignee_id: agent-uuid-1\n',
    'utf8',
  );
}

test('multica-issue-closer: configured state_dir — marker read from custom-state/episodes', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);
  writeRunMarker(root, 'custom-state', 'epic-a', 'story-1');

  // no_auth (not no_marker) proves the marker was found under custom-state.
  const result = await inDir(root, () =>
    closeStoryIssue({
      epic_id: 'epic-a',
      story_id: 'story-1',
      repo_root: root,
      config_path: path.join(root, 'missing-multica-config.json'),
    }),
  );
  assert.equal(result.reason, 'no_auth');
});

test('multica-issue-closer: configured state_dir — legacy .pHive marker is NOT read', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root);
  writeRunMarker(root, '.pHive', 'epic-a', 'story-1');

  const result = await inDir(root, () =>
    closeStoryIssue({ epic_id: 'epic-a', story_id: 'story-1', repo_root: root }),
  );
  assert.equal(result.reason, 'no_marker');
});

test('multica-issue-closer: state_dir unset — marker read from default .pHive/episodes', async () => {
  const root = makeTmpDir();
  writeRunMarker(root, '.pHive', 'epic-a', 'story-1');

  const result = await inDir(root, () =>
    closeStoryIssue({
      epic_id: 'epic-a',
      story_id: 'story-1',
      repo_root: root,
      config_path: path.join(root, 'missing-multica-config.json'),
    }),
  );
  assert.equal(result.reason, 'no_auth');
});
