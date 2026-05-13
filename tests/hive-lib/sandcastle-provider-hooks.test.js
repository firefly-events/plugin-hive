'use strict';

/**
 * Tests for hook wiring in hive/lib/sandcastle-provider.js
 *
 * Story: s2-hooks-minimal (sandcastle-adoption-followon)
 * Run:   node tests/hive-lib/sandcastle-provider-hooks.test.js
 *
 * Covers:
 *  H-1  hooks.host.onWorktreeReady configured → underlying provider receives it
 *  H-2  No hooks provided → provider receives no hooks key
 *  H-3  hooks.host.onSandboxReady passed → wrapper rejects with V1 contract error
 *  H-4  hooks.sandbox.onSandboxReady passed → wrapper rejects with V1 contract error
 *  H-5  Host hook command exits non-zero → createWorktree rejects (fail-fast)
 *  H-6  Marker copy invariant — hook command that writes a fixture marker propagates
 *        through wrapper and produces the expected marker in a mocked worktree path
 *  H-7  Invalid HostHookCmd entries (sudo, cwd) → wrapper rejects at construction
 *  H-8  onWorktreeReady is not an array → wrapper rejects at construction
 *  H-9  onWorktreeReady empty array → provider receives no hooks key (opt-in is real)
 *
 * Sandcastle hooks are lifecycle hooks (worktree/container layer),
 * NOT Hive PreToolUse hooks. See user-decisions-b1.md Q4.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

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
  const capturedPodmanOpts = [];
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
    dockerFactory: (opts) => ({ _type: 'docker', opts }),
    createWorktreeFn: async (opts) => {
      capturedWorktreeOpts.push(opts);
      return fakeWorktree;
    },
    capturedPodmanOpts,
    capturedWorktreeOpts,
    fakeWorktree,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// H-1: hooks.host.onWorktreeReady configured → underlying provider receives it
// ---------------------------------------------------------------------------

test('H-1: hooks.host.onWorktreeReady is passed through to the Sandcastle provider config', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  const hookCmds = [{ command: 'echo worktree-ready' }];

  createSandcastleProvider(
    { hooks: { host: { onWorktreeReady: hookCmds } } },
    deps,
  );

  assert.equal(deps.capturedPodmanOpts.length, 1, 'podman factory must be called once');
  const providerOpts = deps.capturedPodmanOpts[0];

  assert.ok(providerOpts.hooks, 'provider opts must have a hooks key');
  assert.ok(providerOpts.hooks.host, 'provider hooks must have a host key');
  assert.deepEqual(
    providerOpts.hooks.host.onWorktreeReady,
    hookCmds,
    'onWorktreeReady command list must be forwarded verbatim',
  );
});

test('H-1b: multiple onWorktreeReady commands all propagate', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  const hookCmds = [
    { command: 'cp persona.md /tmp/wt/' },
    { command: 'cp memory.md /tmp/wt/', timeoutMs: 5000 },
  ];

  createSandcastleProvider(
    { hooks: { host: { onWorktreeReady: hookCmds } } },
    deps,
  );

  const providerOpts = deps.capturedPodmanOpts[0];
  assert.deepEqual(providerOpts.hooks.host.onWorktreeReady, hookCmds);
});

// ---------------------------------------------------------------------------
// H-2: No hooks provided → provider receives no hooks key
// ---------------------------------------------------------------------------

test('H-2: no hooks option → provider config has no hooks key', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  createSandcastleProvider({}, deps);

  assert.equal(deps.capturedPodmanOpts.length, 1);
  const providerOpts = deps.capturedPodmanOpts[0];
  assert.ok(!('hooks' in providerOpts), 'provider config must not have a hooks key when no hooks are provided');
});

test('H-2b: hooks option omitted entirely → provider config has no hooks key', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  createSandcastleProvider(undefined, deps);

  const providerOpts = deps.capturedPodmanOpts[0];
  assert.ok(!('hooks' in providerOpts), 'provider config must not have a hooks key when options are omitted');
});

// ---------------------------------------------------------------------------
// H-9: onWorktreeReady is an empty array → still no hooks key on provider
// ---------------------------------------------------------------------------

test('H-9: empty onWorktreeReady array → no hooks key (opt-in is real)', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  createSandcastleProvider(
    { hooks: { host: { onWorktreeReady: [] } } },
    deps,
  );

  const providerOpts = deps.capturedPodmanOpts[0];
  assert.ok(!('hooks' in providerOpts), 'empty onWorktreeReady should not add a hooks key');
});

// ---------------------------------------------------------------------------
// H-3: hooks.host.onSandboxReady → rejected with V1 contract error
// ---------------------------------------------------------------------------

test('H-3: hooks.host.onSandboxReady → wrapper rejects at construction with clear V1 error', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  assert.throws(
    () => createSandcastleProvider(
      { hooks: { host: { onSandboxReady: [{ command: 'echo sandbox-ready' }] } } },
      deps,
    ),
    (err) => {
      assert.ok(err instanceof Error, 'must be an Error');
      assert.match(err.message, /onSandboxReady/, 'message must name the offending hook key');
      assert.match(err.message, /deferred/, 'message must mention deferral');
      assert.match(err.message, /user-decisions-b1\.md/, 'message must reference the decision doc');
      return true;
    },
  );

  // Construction must not complete — provider factory not called
  assert.equal(deps.capturedPodmanOpts.length, 0, 'provider must not be constructed when deferred hook is passed');
});

// ---------------------------------------------------------------------------
// H-4: hooks.sandbox.onSandboxReady → rejected with V1 contract error
// ---------------------------------------------------------------------------

test('H-4: hooks.sandbox.onSandboxReady → wrapper rejects at construction with clear V1 error', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  assert.throws(
    () => createSandcastleProvider(
      { hooks: { sandbox: { onSandboxReady: [{ command: 'echo sandbox', sudo: false }] } } },
      deps,
    ),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /onSandboxReady/);
      assert.match(err.message, /deferred/);
      assert.match(err.message, /user-decisions-b1\.md/);
      return true;
    },
  );

  assert.equal(deps.capturedPodmanOpts.length, 0);
});

// ---------------------------------------------------------------------------
// H-5: Host hook command exits non-zero → createWorktree rejects (fail-fast)
//
// The wrapper doesn't execute hooks itself — Sandcastle does. Fail-fast means:
// if Sandcastle's hook runner rejects createWorktreeFn (simulated here via
// an injected createWorktreeFn that rejects with a hook-failure error),
// the wrapper propagates the rejection and no worktree is returned.
// ---------------------------------------------------------------------------

test('H-5: non-zero hook exit → createWorktree rejects before returning worktree', async () => {
  const { createSandcastleProvider } = loadModule();

  const hookError = new Error('[sandcastle] host hook exited with code 1: /bin/false');
  hookError.hookFailure = true;

  const deps = makeDeps('0.5.10', {
    createWorktreeFn: async (_opts) => {
      // Simulate Sandcastle failing the hook runner
      throw hookError;
    },
  });

  const { createWorktree } = createSandcastleProvider(
    { hooks: { host: { onWorktreeReady: [{ command: '/bin/false' }] } } },
    deps,
  );

  await assert.rejects(
    () => createWorktree('s2-hooks-minimal'),
    (err) => {
      assert.ok(err.hookFailure === true, 'must propagate the hook failure error');
      return true;
    },
  );
});

test('H-5b: non-zero hook exit — no worktree object is returned on rejection', async () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10', {
    createWorktreeFn: async () => {
      throw new Error('[sandcastle] hook failed');
    },
  });

  const { createWorktree } = createSandcastleProvider(
    { hooks: { host: { onWorktreeReady: [{ command: '/bin/false' }] } } },
    deps,
  );

  let result;
  try {
    result = await createWorktree('s2-hooks-minimal');
  } catch (_err) {
    // Expected
  }

  assert.equal(result, undefined, 'no worktree object must be returned when hook fails');
});

// ---------------------------------------------------------------------------
// H-6: Marker copy invariant
//
// The hook command list is passed through unchanged to Sandcastle. We verify:
//   (a) The exact command string is in the captured provider options
//   (b) When the command is actually executed (via execSync in the test, not
//       by the wrapper), a marker file appears in the target path.
//
// This simulates what copyToWorktree does at the Sandcastle lifecycle layer.
// ---------------------------------------------------------------------------

test('H-6: marker copy invariant — hook command passes through to provider and marker appears at target path', async () => {
  const { createSandcastleProvider } = loadModule();

  // Create a temp worktree-like directory to serve as mock worktree path
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-wt-hook-test-'));
  const markerFile = path.join(wtDir, 'persona.md');

  // The hook command writes a marker file to the mock worktree dir
  const hookCommand = `touch ${markerFile}`;
  const hookCmds = [{ command: hookCommand }];

  // Capture the provider opts (which include hooks) at factory time
  const capturedProviderOpts = [];

  const deps = makeDeps('0.5.10', {
    podmanFactory: (opts) => {
      capturedProviderOpts.push(opts);
      // Simulate Sandcastle executing the onWorktreeReady hook at provider-build time
      // (in real Sandcastle, this runs when the worktree is created; here we simulate
      // it at factory time to prove the command passes through and is executable)
      if (opts.hooks && opts.hooks.host && opts.hooks.host.onWorktreeReady) {
        for (const hc of opts.hooks.host.onWorktreeReady) {
          execSync(hc.command, { timeout: hc.timeoutMs || 10000 });
        }
      }
      return { _type: 'podman', opts };
    },
  });

  createSandcastleProvider(
    { hooks: { host: { onWorktreeReady: hookCmds } } },
    deps,
  );

  // (a) hooks were passed through to the provider factory
  assert.equal(capturedProviderOpts.length, 1, 'provider factory must be called once');
  assert.ok(capturedProviderOpts[0].hooks, 'provider opts must have a hooks key');
  assert.deepEqual(
    capturedProviderOpts[0].hooks.host.onWorktreeReady,
    hookCmds,
    'hook command list must pass through verbatim to provider',
  );

  // (b) the marker file was created in the mock worktree path
  assert.ok(fs.existsSync(markerFile), `marker file must exist at ${markerFile} after hook command executes`);

  // Cleanup
  fs.rmSync(wtDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// H-7: Invalid HostHookCmd entries — sudo / cwd are rejected
// ---------------------------------------------------------------------------

test('H-7a: sudo in host hook command → rejected at construction (HostHookCmd contract violation)', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  assert.throws(
    () => createSandcastleProvider(
      { hooks: { host: { onWorktreeReady: [{ command: 'echo hi', sudo: true }] } } },
      deps,
    ),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /sudo/, 'message must mention sudo');
      assert.match(err.message, /HostHookCmd/, 'message must reference HostHookCmd contract');
      return true;
    },
  );
  assert.equal(deps.capturedPodmanOpts.length, 0);
});

test('H-7b: cwd in host hook command → rejected at construction (HostHookCmd contract violation)', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  assert.throws(
    () => createSandcastleProvider(
      { hooks: { host: { onWorktreeReady: [{ command: 'echo hi', cwd: '/tmp' }] } } },
      deps,
    ),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /cwd/, 'message must mention cwd');
      assert.match(err.message, /HostHookCmd/, 'message must reference HostHookCmd contract');
      return true;
    },
  );
  assert.equal(deps.capturedPodmanOpts.length, 0);
});

// ---------------------------------------------------------------------------
// H-8: onWorktreeReady is not an array → wrapper rejects at construction
// ---------------------------------------------------------------------------

test('H-8: onWorktreeReady as non-array (object) → TypeError at construction', () => {
  const { createSandcastleProvider } = loadModule();
  const deps = makeDeps('0.5.10');

  assert.throws(
    () => createSandcastleProvider(
      { hooks: { host: { onWorktreeReady: { command: 'echo oops' } } } },
      deps,
    ),
    (err) => {
      assert.ok(err instanceof TypeError);
      assert.match(err.message, /onWorktreeReady/);
      assert.match(err.message, /array/);
      return true;
    },
  );
  assert.equal(deps.capturedPodmanOpts.length, 0);
});

// ---------------------------------------------------------------------------
// Layer-distinction audit: the source module must contain the comment
// distinguishing Sandcastle lifecycle hooks from Hive PreToolUse hooks
// ---------------------------------------------------------------------------

test('AUDIT: source contains inline comment distinguishing Sandcastle lifecycle hooks from Hive PreToolUse hooks', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.match(
    source,
    /Sandcastle hooks are lifecycle hooks.*NOT Hive PreToolUse/,
    'Provider source must have inline comment stating Sandcastle hooks are lifecycle hooks (not Hive PreToolUse hooks)',
  );
  assert.match(
    source,
    /user-decisions-b1\.md/,
    'Provider source must reference user-decisions-b1.md near the hook wiring site',
  );
});
