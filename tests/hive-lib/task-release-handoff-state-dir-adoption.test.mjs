/**
 * State-dir resolver adoption tests (story sdr-5) for the Node partial-seam
 * modules: release_post.mjs, handoff/dispatch.mjs, and
 * external/github-issues-adapter.js. (The fourth sdr-5 module,
 * task-tracking-dispatch, is TypeScript and is covered by
 * hive/lib/task-tracking-dispatch/test/state-dir-adoption.test.ts, which runs
 * under the package's tsx-backed `npm test`.)
 *
 * Each module is exercised through the four Q2 precedence permutations:
 *   1. env only           → HIVE_STATE_DIR wins
 *   2. config only        → root-config paths.state_dir wins
 *   3. env + config       → env override beats config
 *   4. neither            → default `.pHive` unchanged
 * plus the module's explicit injection seam where one exists
 * (handoff `state_dir`, adapter `_deps.stateDir`).
 *
 * Run: node --test tests/hive-lib/task-release-handoff-state-dir-adoption.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { generateReleasePostArtifacts } from '../../hive/lib/release_post.mjs';
import { dispatchHandoff } from '../../hive/lib/handoff/dispatch.mjs';

const require = createRequire(import.meta.url);
const { _internal: { resolveStoryPath } } = require('../../hive/lib/external/github-issues-adapter.js');

// ---------------------------------------------------------------------------
// Helpers (pattern from state-dir-adoption.test.mjs / sdr-2)
// ---------------------------------------------------------------------------

const RESOLVER_ENV_KEYS = ['HIVE_STATE_DIR', 'CONFIG_FILE', 'HIVE_ROOT'];

// realpath so macOS /var → /private/var symlinks don't confuse path asserts
// (the resolver canonicalizes its output).
function makeTmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdr5-test-')));
}

function writeStateDirConfig(root, stateDir = 'custom-state') {
  fs.writeFileSync(
    path.join(root, 'hive.config.yaml'),
    `paths:\n  state_dir: ${stateDir}\n`,
    'utf8',
  );
}

/**
 * Run fn with cwd moved to dir, the resolver env tiers reset to `envOverride`
 * (everything else cleared), restoring both afterwards.
 */
async function inDir(dir, envOverride, fn) {
  const prevCwd = process.cwd();
  const prevEnv = {};
  for (const key of RESOLVER_ENV_KEYS) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, envOverride);
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

// The four Q2 permutations, expressed as setup + expected state-dir name.
// `expected` is relative to the tmp root.
const PERMUTATIONS = [
  {
    label: 'env only — env path wins',
    env: { HIVE_STATE_DIR: 'env-state' },
    config: null,
    expected: 'env-state',
  },
  {
    label: 'config only — configured path used, not .pHive',
    env: {},
    config: 'custom-state',
    expected: 'custom-state',
  },
  {
    label: 'env + config — env override beats config',
    env: { HIVE_STATE_DIR: 'env-state' },
    config: 'custom-state',
    expected: 'env-state',
  },
  {
    label: 'neither — default .pHive unchanged',
    env: {},
    config: null,
    expected: '.pHive',
  },
];

function setupRoot(perm) {
  const root = makeTmpDir();
  if (perm.config) writeStateDirConfig(root, perm.config);
  return root;
}

// ---------------------------------------------------------------------------
// release_post — collectShippedStories/generateReleasePostArtifacts read and
// write under the resolved state dir (repoRoot-keyed; no chdir needed, but
// env tiers are still process-global).
// ---------------------------------------------------------------------------

function writeShippedStory(root, stateDir, epic, story) {
  const dir = path.join(root, stateDir, 'epics', epic, 'stories');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${story}.yaml`),
    `id: ${story}\ntitle: Story ${story}\nstatus: shipped\noutcome: Shipped ${story}.\n`,
    'utf8',
  );
}

for (const perm of PERMUTATIONS) {
  test(`release_post: ${perm.label}`, async () => {
    const root = setupRoot(perm);
    writeShippedStory(root, perm.expected, 'epic-a', 'story-1');
    if (perm.expected !== '.pHive') {
      // Decoy under the legacy path: a shipped story that must NOT be seen.
      writeShippedStory(root, '.pHive', 'epic-a', 'decoy-story');
    }

    const result = await inDir(root, perm.env, () =>
      generateReleasePostArtifacts({
        epicIds: ['epic-a'],
        releaseId: 'v1.0.0',
        projectName: 'SDR5 Project',
        repoRoot: root,
      }),
    );

    assert.equal(result.outDir, path.join(root, perm.expected, 'releases', 'v1.0.0'));
    for (const file of result.written) {
      assert.ok(fs.existsSync(file), `artifact missing: ${file}`);
    }
    assert.equal(result.stories.length, 1);
    assert.equal(result.stories[0].storyId, 'story-1');
    assert.equal(
      result.stories[0].sourcePath,
      `${perm.expected}/epics/epic-a/stories/story-1.yaml`,
    );
  });
}

// ---------------------------------------------------------------------------
// handoff/dispatch — evidence writes land under the resolved state dir. A
// fake `claude` binary on PATH keeps the child invocation hermetic.
// ---------------------------------------------------------------------------

function installFakeClaude(root) {
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'claude');
  fs.writeFileSync(bin, '#!/bin/sh\necho "all tests passed"\n', 'utf8');
  fs.chmodSync(bin, 0o755);
  return binDir;
}

async function withFakeClaude(root, fn) {
  const prevPath = process.env.PATH;
  process.env.PATH = `${installFakeClaude(root)}${path.delimiter}${prevPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = prevPath;
  }
}

for (const perm of PERMUTATIONS) {
  test(`handoff dispatch: ${perm.label}`, async () => {
    const root = setupRoot(perm);

    const result = await inDir(root, perm.env, () =>
      withFakeClaude(root, () =>
        dispatchHandoff({ story_id: 'story-1', target: 'test', branch: 'main' }),
      ),
    );

    assert.equal(result.ok, true);
    assert.equal(result.verdict, 'passed');
    const evidenceDir = path.join(root, perm.expected, 'handoff-evidence');
    assert.ok(
      result.evidence_ref.startsWith(evidenceDir + path.sep),
      `evidence_ref ${result.evidence_ref} not under ${evidenceDir}`,
    );
    assert.ok(fs.existsSync(result.evidence_ref));
  });
}

test('handoff dispatch: injected state_dir stays honored over env + config', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');
  const injected = path.join(root, 'injected-state');

  const result = await inDir(root, { HIVE_STATE_DIR: 'env-state' }, () =>
    withFakeClaude(root, () =>
      dispatchHandoff({ story_id: 'story-1', target: 'test', branch: 'main', state_dir: injected }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.evidence_ref.startsWith(path.join(injected, 'handoff-evidence') + path.sep));
  assert.ok(!fs.existsSync(path.join(root, 'env-state')));
  assert.ok(!fs.existsSync(path.join(root, 'custom-state', 'handoff-evidence')));
});

// ---------------------------------------------------------------------------
// github-issues-adapter — resolveStoryPath defaults through the resolver
// (cwd-relative form), _deps.stateDir injection preserved.
// ---------------------------------------------------------------------------

for (const perm of PERMUTATIONS) {
  test(`github-issues-adapter: ${perm.label}`, async () => {
    const root = setupRoot(perm);

    const storyPath = await inDir(root, perm.env, () =>
      resolveStoryPath('epic-a', 'story-1', undefined),
    );

    assert.equal(
      storyPath,
      path.join(perm.expected, 'epics', 'epic-a', 'stories', 'story-1.yaml'),
    );
  });
}

test('github-issues-adapter: injected _deps.stateDir stays honored over env + config', async () => {
  const root = makeTmpDir();
  writeStateDirConfig(root, 'custom-state');

  const storyPath = await inDir(root, { HIVE_STATE_DIR: 'env-state' }, () =>
    resolveStoryPath('epic-a', 'story-1', { stateDir: 'injected-state' }),
  );

  assert.equal(
    storyPath,
    path.join('injected-state', 'epics', 'epic-a', 'stories', 'story-1.yaml'),
  );
});
