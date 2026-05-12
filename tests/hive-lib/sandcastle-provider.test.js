'use strict';

/**
 * Tests for hive/lib/sandcastle-provider.js
 *
 * Story: s2-provider-wrap (sandcastle-adoption-followon)
 * Run:   node tests/hive-lib/sandcastle-provider.test.js
 *
 * Mocking approach:
 *   @ai-hero/sandcastle is NOT installed at the repo root (no root package.json;
 *   per hive conventions CLIs are preferred over root deps). All tests inject
 *   a `_deps` object into `createSandcastleProvider()` to provide:
 *     - versionResolver: () => string       — controls what "installed" version reports
 *     - podmanFactory: (opts) => provider    — captures construction options
 *     - dockerFactory: (opts) => provider    — captures docker path
 *     - createWorktreeFn: (opts) => Worktree — captures branchStrategy
 *   This is a DI seam (test seam only, not public API) documented in
 *   hive/lib/sandcastle-provider.js.
 *
 * Covers:
 *  AC-1  Version preflight failure — 0.5.9 (below lower bound)
 *  AC-2  Version preflight failure — 0.6.0 (at upper bound, excluded)
 *  AC-3  Version preflight success — 0.5.10 (lower bound, included)
 *  AC-4  Version preflight success — 0.5.15 (within range)
 *  AC-5  Default options — Podman, userns:false, correct mount path
 *  AC-6  Docker opt-in — useDocker:true routes to dockerFactory
 *  AC-7  createWorktree — branchStrategy { type:"branch", branch:storyId }
 *  AC-8  Cleanup ownership — wt.close() callable; legacy path untouched
 *  AC-9  Redaction — fake key in logger output is masked
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', '..', 'hive', 'lib', 'sandcastle-provider.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

/**
 * Build a minimal _deps object for testing.
 * @param {string} version — simulated installed version
 * @param {object} [overrides]
 */
function makeDeps(version, overrides = {}) {
  // Captured call args
  const capturedPodmanOpts = [];
  const capturedDockerOpts = [];
  const capturedWorktreeOpts = [];

  const fakeWorktree = {
    branch: 'test-story',
    close: function fakeClose() { fakeWorktree._closed = true; },
    _closed: false,
  };

  return {
    versionResolver: () => version,
    podmanFactory: (opts) => {
      capturedPodmanOpts.push(opts);
      return { _type: 'podman', opts };
    },
    dockerFactory: (opts) => {
      capturedDockerOpts.push(opts);
      return { _type: 'docker', opts };
    },
    createWorktreeFn: async (opts) => {
      capturedWorktreeOpts.push(opts);
      return fakeWorktree;
    },
    // Expose capture arrays for assertions
    capturedPodmanOpts,
    capturedDockerOpts,
    capturedWorktreeOpts,
    fakeWorktree,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-1: Preflight failure — version 0.5.9 (below lower bound)
// ---------------------------------------------------------------------------

test('preflight — 0.5.9 throws with version-specific message before provider construction', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.9');

  assert.throws(
    () => createSandcastleProvider({}, deps),
    (err) => {
      assert.ok(err instanceof Error, 'must be an Error');
      assert.match(err.message, /0\.5\.9/, 'message must include installed version');
      assert.match(err.message, />=0\.5\.10 <0\.6\.0/, 'message must include required range');
      return true;
    },
  );

  // podmanFactory was never called — preflight fires before construction
  assert.equal(deps.capturedPodmanOpts.length, 0, 'provider must not be constructed on preflight failure');
});

// ---------------------------------------------------------------------------
// AC-2: Preflight failure — 0.6.0 (at upper bound, excluded by <0.6.0)
// ---------------------------------------------------------------------------

test('preflight — 0.6.0 throws (upper bound exclusive)', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.6.0');

  assert.throws(
    () => createSandcastleProvider({}, deps),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /0\.6\.0/);
      assert.match(err.message, />=0\.5\.10 <0\.6\.0/);
      return true;
    },
  );
  assert.equal(deps.capturedPodmanOpts.length, 0);
});

// ---------------------------------------------------------------------------
// AC-3: Preflight success — 0.5.10 (exact lower bound, included)
// ---------------------------------------------------------------------------

test('preflight — 0.5.10 passes (lower bound inclusive)', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');
  assert.doesNotThrow(() => createSandcastleProvider({}, deps));
  assert.equal(deps.capturedPodmanOpts.length, 1, 'podman factory must be called');
});

// ---------------------------------------------------------------------------
// AC-4: Preflight success — 0.5.15 (within range)
// ---------------------------------------------------------------------------

test('preflight — 0.5.15 passes (within range)', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.15');
  assert.doesNotThrow(() => createSandcastleProvider({}, deps));
});

// ---------------------------------------------------------------------------
// AC-5: Default options — Podman, userns:false, correct mount path
// ---------------------------------------------------------------------------

test('default options — uses Podman with userns:false and .sandcastle/codex-config mount', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  createSandcastleProvider({}, deps);

  assert.equal(deps.capturedPodmanOpts.length, 1, 'podman factory called once');
  assert.equal(deps.capturedDockerOpts.length, 0, 'docker factory not called');

  const opts = deps.capturedPodmanOpts[0];
  assert.equal(opts.userns, false, 'userns must be false');
  assert.ok(Array.isArray(opts.mounts) && opts.mounts.length >= 1, 'mounts must be set');

  const mount = opts.mounts[0];
  assert.ok(
    mount.hostPath.endsWith(path.join('.sandcastle', 'codex-config')),
    `hostPath must end with .sandcastle/codex-config; got ${mount.hostPath}`,
  );
  assert.equal(mount.sandboxPath, '/home/agent/.codex', 'sandboxPath must be /home/agent/.codex');
});

// ---------------------------------------------------------------------------
// AC-6: Docker opt-in
// ---------------------------------------------------------------------------

test('useDocker:true — routes to dockerFactory, not podmanFactory', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  createSandcastleProvider({ useDocker: true }, deps);

  assert.equal(deps.capturedDockerOpts.length, 1, 'docker factory called once');
  assert.equal(deps.capturedPodmanOpts.length, 0, 'podman factory not called');

  const opts = deps.capturedDockerOpts[0];
  assert.equal(opts.userns, false);
  assert.ok(opts.mounts.length >= 1);
});

// ---------------------------------------------------------------------------
// AC-7: createWorktree — branchStrategy { type:"branch", branch:storyId }
// Note: field is `branch:`, NOT `name:`. Canonical source: harness.ts +
// research-findings.md §2.4. Work-item prompt had `name:` — canonical wins.
// ---------------------------------------------------------------------------

test('createWorktree — branchStrategy uses type:branch with storyId as branch field', async () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  const { createWorktree } = createSandcastleProvider({}, deps);
  await createWorktree('s2-provider-wrap');

  assert.equal(deps.capturedWorktreeOpts.length, 1);
  const wtOpts = deps.capturedWorktreeOpts[0];
  assert.deepEqual(wtOpts.branchStrategy, { type: 'branch', branch: 's2-provider-wrap' });
});

test('createWorktree — different storyId propagates correctly', async () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  const { createWorktree } = createSandcastleProvider({}, deps);
  await createWorktree('s3-dispatch-routing');

  const wtOpts = deps.capturedWorktreeOpts[0];
  assert.deepEqual(wtOpts.branchStrategy, { type: 'branch', branch: 's3-dispatch-routing' });
});

test('createWorktree — empty storyId throws TypeError', async () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  const { createWorktree } = createSandcastleProvider({}, deps);
  await assert.rejects(
    () => createWorktree(''),
    (err) => {
      assert.ok(err instanceof TypeError);
      assert.match(err.message, /storyId/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// AC-8: Cleanup ownership — wt.close() is on Sandcastle's worktree object;
//        legacy .claude/worktrees path is NOT touched by this module.
// ---------------------------------------------------------------------------

test('cleanup ownership — wt.close() is callable on Sandcastle-owned worktree', async () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  const { createWorktree } = createSandcastleProvider({}, deps);
  const wt = await createWorktree('s2-provider-wrap');

  // wt.close() exists and is callable — ownership is on the Sandcastle object
  assert.equal(typeof wt.close, 'function', 'wt.close must be a function');
  assert.doesNotThrow(() => wt.close());
  assert.equal(deps.fakeWorktree._closed, true, 'close() must have been called');
});

test('cleanup ownership — no executable code references .claude/worktrees (comments OK)', () => {
  // Static check: the wrapper module must not contain legacy path references in
  // executable code lines. Comments documenting the ownership boundary are fine.
  // This catches accidental addition of legacy cleanup logic.
  const fs = require('node:fs');
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const executableLines = source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      // Strip single-line comment lines (// ...) and JSDoc lines (* ...)
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');

  assert.doesNotMatch(
    executableLines,
    /\.claude[/\\]worktrees/,
    'sandcastle-provider.js must not contain executable code referencing .claude/worktrees',
  );
});

// ---------------------------------------------------------------------------
// AC-9: Redaction — fake key value emitted during provider creation is masked
// ---------------------------------------------------------------------------

test('redaction — logger passed to provider factory is wrapped by wrapSandcastleLogger', () => {
  const { createSandcastleProvider } = loadModule();

  // Track what the base logger receives
  const received = [];
  const baseLogger = (msg) => received.push(msg);

  const deps = makeDeps('0.5.10', {
    // Override podmanFactory to simulate a log emission that the provider
    // constructor might trigger (e.g. "podman run -e OPENAI_API_KEY=sk-test")
    podmanFactory: (opts) => {
      // Emit directly through the logger that was passed into factory options
      // to simulate sandcastle startup log containing a secret
      opts.logger('podman run -e OPENAI_API_KEY=sk-secret-abc-123');
      opts.logger('Authorization: Bearer tok-fake-xyz');
      return { _type: 'podman', opts };
    },
  });

  createSandcastleProvider({ logger: baseLogger }, deps);

  assert.equal(received.length, 2, 'both log lines must be forwarded');

  // Secret values must be redacted
  assert.doesNotMatch(received[0], /sk-secret-abc-123/, 'API key must be redacted');
  assert.match(received[0], /\[REDACTED\]/, 'REDACTED placeholder must appear');

  assert.doesNotMatch(received[1], /tok-fake-xyz/, 'Bearer token must be redacted');
  assert.match(received[1], /\[REDACTED\]/);
});

test('redaction — logger wrapping happens before preflight error (order check)', () => {
  // If version is bad, construction never happens but that is fine —
  // this test validates that even a passing version still wraps before construction.
  const { createSandcastleProvider } = loadModule();

  let loggerPassedToFactory = null;
  const baseLogger = () => {};

  const deps = makeDeps('0.5.10', {
    podmanFactory: (opts) => {
      loggerPassedToFactory = opts.logger;
      return { _type: 'podman', opts };
    },
  });

  createSandcastleProvider({ logger: baseLogger }, deps);

  // The logger passed to factory should be the wrapped version, not baseLogger itself
  assert.notEqual(loggerPassedToFactory, baseLogger, 'wrapped logger must differ from baseLogger');
  assert.equal(typeof loggerPassedToFactory, 'function', 'wrapped logger must be a function');
});

// ---------------------------------------------------------------------------
// Module export sanity
// ---------------------------------------------------------------------------

test('module exports createSandcastleProvider as a function', () => {
  const mod = loadModule();
  assert.equal(typeof mod.createSandcastleProvider, 'function');
});

test('module exports SANDCASTLE_RANGE string', () => {
  const mod = loadModule();
  assert.equal(typeof mod.SANDCASTLE_RANGE, 'string');
  assert.match(mod.SANDCASTLE_RANGE, />=0\.5\.10 <0\.6\.0/);
});
