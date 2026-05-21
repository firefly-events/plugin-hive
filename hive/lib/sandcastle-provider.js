'use strict';

/**
 * hive/lib/sandcastle-provider.js
 *
 * Centralised Sandcastle provider wrapper for Hive.
 *
 * Story: s2-provider-wrap (sandcastle-adoption-followon)
 *
 * Responsibilities:
 *  1. Runtime version preflight — fails fast before any Sandcastle module is
 *     constructed when @ai-hero/sandcastle is outside >=0.5.10 <0.6.0.
 *  2. Wraps the Sandcastle logger via hive/lib/sandcastle-log-redaction.js
 *     BEFORE constructing the SandboxProvider (so even startup log lines are
 *     sanitised).
 *  3. Provides Hive defaults: Podman by default, Docker opt-in, userns:false,
 *     and a bind-mount of .sandcastle/codex-config → /home/agent/.codex.
 *  4. createWorktree(storyId) — thin wrapper that sets branchStrategy to
 *     { type: "branch", branch: storyId }.  Sandcastle owns wt.close();
 *     legacy .claude/worktrees/{story-id} cleanup is untouched.
 *
 * NOTE: this module does NOT touch /execute routing (that is s3 scope).
 */

const path = require('node:path');
const fs = require('node:fs');

const { wrapSandcastleLogger } = require('./sandcastle-log-redaction.js');

// ---------------------------------------------------------------------------
// Inline semver satisfaction check for >=0.5.10 <0.6.0
// Avoids adding `semver` as a root dependency (per hive conventions).
// Only handles the specific range shapes this module needs.
// ---------------------------------------------------------------------------

/**
 * Parse a semver string into { major, minor, patch } integers.
 * Returns null if the string is not a valid semver.
 * @param {string} v
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

/**
 * Returns true iff `version` satisfies `>=0.5.10 <0.6.0`.
 * @param {string} version
 * @returns {boolean}
 */
function satisfiesSandcastleRange(version) {
  const v = parseSemver(version);
  if (!v) return false;
  // >=0.5.10: major=0, minor=5, patch>=10
  const atLeast = v.major > 0 ||
    (v.major === 0 && v.minor > 5) ||
    (v.major === 0 && v.minor === 5 && v.patch >= 10);
  // <0.6.0: major=0, minor<6
  const belowUpper = v.major === 0 && v.minor < 6;
  return atLeast && belowUpper;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SANDCASTLE_RANGE = '>=0.5.10 <0.6.0';
const DEFAULT_IMAGE = 'sandcastle:hive';
const DEFAULT_CODEX_CONFIG_HOST_PATH = path.join(process.cwd(), '.sandcastle', 'codex-config');
const DEFAULT_SANDBOX_PATH = '/home/agent/.codex';

// ---------------------------------------------------------------------------
// Version preflight
// ---------------------------------------------------------------------------

/**
 * Read the installed @ai-hero/sandcastle version and throw if it falls outside
 * SANDCASTLE_RANGE. Called before any SandboxProvider is constructed.
 *
 * @param {() => string} versionResolver — test seam; defaults to reading
 *   package.json of the installed module. NOT part of the public API.
 */
function runVersionPreflight(versionResolver) {
  const resolveVersion = versionResolver || function defaultVersionResolver() {
    // @ai-hero/sandcastle ships ESM-only (no `require` key in its `exports`),
    // so both `require('@ai-hero/sandcastle/package.json')` AND
    // `require.resolve('@ai-hero/sandcastle')` fail with
    // ERR_PACKAGE_PATH_NOT_EXPORTED on Node >= 22. Walk the filesystem for
    // the package manifest the same way Node's resolver would, starting from
    // process.cwd() (consumer install) and falling back to this module's
    // location (plugin-bundled install).
    const searchStarts = [process.cwd(), __dirname];
    for (const start of searchStarts) {
      let dir = path.resolve(start);
      while (dir) {
        const candidate = path.join(
          dir, 'node_modules', '@ai-hero', 'sandcastle', 'package.json',
        );
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf8')).version;
        }
        if (dir === path.parse(dir).root) break;
        dir = path.dirname(dir);
      }
    }
    throw new Error(
      '[hive/sandcastle-provider] could not locate @ai-hero/sandcastle ' +
      `package.json from cwd=${process.cwd()} or module=${__dirname}. ` +
      `Install: npm install @ai-hero/sandcastle@"${SANDCASTLE_RANGE}"`,
    );
  };

  const installed = resolveVersion();

  if (!satisfiesSandcastleRange(installed)) {
    throw new Error(
      `[hive/sandcastle-provider] @ai-hero/sandcastle version mismatch: ` +
      `installed=${installed}, required=${SANDCASTLE_RANGE}. ` +
      `Run: npm install @ai-hero/sandcastle@">=0.5.10 <0.6.0"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Sandcastle provider pair (sandboxProvider + helpers).
 *
 * @typedef {{ command: string; timeoutMs?: number }} HostHookCmd
 *   Sandcastle HostHookCmd shape — NO `sudo`, NO `cwd` (host-hook contract).
 *   See user-decisions-b1.md Q4 for authoritative shape definition.
 *
 * @param {object} [options]
 * @param {boolean} [options.useDocker=false]        — opt-in Docker; default is Podman
 * @param {string}  [options.imageName]              — override container image name
 * @param {string}  [options.codexConfigHostPath]    — override .sandcastle/codex-config host path
 * @param {Function} [options.logger]                — custom base logger (default: console.log)
 * @param {object}  [options.hooks]                  — Sandcastle lifecycle hook lists (V1: host.onWorktreeReady only)
 * @param {HostHookCmd[]} [options.hooks.host.onWorktreeReady] — run on host after worktree is ready
 *   NOTE: Sandcastle hooks are lifecycle hooks (worktree/container layer), NOT Hive PreToolUse hooks.
 *   See user-decisions-b1.md Q4 and the inline comment at the hook wiring site below.
 *
 * @param {object} [_deps]  — TEST SEAM; not public API. Inject module factories
 *                            to avoid real @ai-hero/sandcastle install in tests.
 * @param {() => string}   [_deps.versionResolver]
 * @param {Function}       [_deps.podmanFactory]
 * @param {Function}       [_deps.dockerFactory]
 * @param {Function}       [_deps.createWorktreeFn]
 *
 * @returns {{ sandboxProvider: object, createWorktree: Function }}
 */
function createSandcastleProvider(options, _deps) {
  const opts = options || {};
  const deps = _deps || {};

  // ------------------------------------------------------------------
  // Step 0: Validate hook options — V1 minimal-hooks contract
  //
  // Sandcastle hooks are lifecycle hooks (worktree/container layer),
  // NOT Hive PreToolUse hooks. See user-decisions-b1.md Q4.
  //
  // V1 wires ONLY host.onWorktreeReady. The deferred hook points
  // (host.onSandboxReady, sandbox.onSandboxReady) are explicitly NOT
  // surfaced here — they will be added only when a real consumer story
  // requires them.
  // ------------------------------------------------------------------
  const hooksOpts = opts.hooks;

  if (hooksOpts !== undefined && hooksOpts !== null && typeof hooksOpts === 'object') {
    // Reject deferred hook points if caller attempts to pass them
    if (hooksOpts.host && hooksOpts.host.onSandboxReady !== undefined) {
      throw new Error(
        '[hive/sandcastle-provider] hooks.host.onSandboxReady is deferred in V1 (minimal-hooks decision). ' +
        'See .pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md Q4. ' +
        'Remove this option until a real consumer story requires it.',
      );
    }

    if (hooksOpts.sandbox && hooksOpts.sandbox.onSandboxReady !== undefined) {
      throw new Error(
        '[hive/sandcastle-provider] hooks.sandbox.onSandboxReady is deferred in V1 (minimal-hooks decision). ' +
        'See .pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md Q4. ' +
        'Remove this option until a real consumer story requires it.',
      );
    }

    // Validate HostHookCmd shape for onWorktreeReady entries
    const onWorktreeReady = hooksOpts.host && hooksOpts.host.onWorktreeReady;
    if (onWorktreeReady !== undefined) {
      if (!Array.isArray(onWorktreeReady)) {
        throw new TypeError('[hive/sandcastle-provider] hooks.host.onWorktreeReady must be an array of HostHookCmd');
      }

      for (let i = 0; i < onWorktreeReady.length; i++) {
        const cmd = onWorktreeReady[i];
        if (!cmd || typeof cmd !== 'object') {
          throw new TypeError(`[hive/sandcastle-provider] hooks.host.onWorktreeReady[${i}] must be an object`);
        }
        if (typeof cmd.command !== 'string' || !cmd.command) {
          throw new TypeError(`[hive/sandcastle-provider] hooks.host.onWorktreeReady[${i}].command must be a non-empty string`);
        }
        // HostHookCmd has no `sudo` or `cwd` — reject extra keys that violate the contract
        if ('sudo' in cmd) {
          throw new Error(
            `[hive/sandcastle-provider] hooks.host.onWorktreeReady[${i}]: 'sudo' is not allowed on host hooks (HostHookCmd contract). ` +
            'Only { command, timeoutMs? } are valid.',
          );
        }
        if ('cwd' in cmd) {
          throw new Error(
            `[hive/sandcastle-provider] hooks.host.onWorktreeReady[${i}]: 'cwd' is not allowed on host hooks (HostHookCmd contract). ` +
            'Only { command, timeoutMs? } are valid.',
          );
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Step 1: Version preflight — throws before any Sandcastle code runs
  // ------------------------------------------------------------------
  runVersionPreflight(deps.versionResolver);

  // ------------------------------------------------------------------
  // Step 2: Wrap logger BEFORE provider construction so even startup
  //         log lines from the provider factory are redacted.
  // ------------------------------------------------------------------
  const baseLogger = opts.logger || (function defaultLogger(msg) { process.stdout.write(String(msg) + '\n'); });
  const redactingLogger = wrapSandcastleLogger(baseLogger);

  // ------------------------------------------------------------------
  // Step 3: Construct the SandboxProvider with Hive defaults
  // ------------------------------------------------------------------
  const imageName = opts.imageName || DEFAULT_IMAGE;
  const codexConfigHostPath = opts.codexConfigHostPath || DEFAULT_CODEX_CONFIG_HOST_PATH;

  const sandboxOptions = {
    imageName,
    userns: false,
    mounts: [
      {
        hostPath: codexConfigHostPath,
        sandboxPath: DEFAULT_SANDBOX_PATH,
      },
    ],
    logger: redactingLogger,
  };

  // ------------------------------------------------------------------
  // Hook wiring — V1 minimal: host.onWorktreeReady only
  //
  // Sandcastle hooks are lifecycle hooks (worktree/container layer),
  // NOT Hive PreToolUse hooks. See user-decisions-b1.md Q4.
  //
  // host.onWorktreeReady: runs on the host machine after the worktree
  // is prepared but before the sandbox container starts. Use to copy
  // persona files, memory paths, or in-worktree config snapshots.
  //
  // DEFERRED (not wired here): host.onSandboxReady, sandbox.onSandboxReady
  // These are deferred per V1 minimal-hooks decision until a real
  // consumer story requires them.
  // ------------------------------------------------------------------
  const onWorktreeReadyCmds =
    hooksOpts && hooksOpts.host && hooksOpts.host.onWorktreeReady;

  if (Array.isArray(onWorktreeReadyCmds) && onWorktreeReadyCmds.length > 0) {
    sandboxOptions.hooks = {
      host: {
        onWorktreeReady: onWorktreeReadyCmds,
      },
    };
  }

  let sandboxProvider;

  if (opts.useDocker) {
    // Docker opt-in path
    const dockerFactory = deps.dockerFactory || (function loadDocker() {
      // eslint-disable-next-line import/no-extraneous-dependencies
      return require('@ai-hero/sandcastle/sandboxes/docker').docker;
    }());
    sandboxProvider = dockerFactory(sandboxOptions);
  } else {
    // Default: Podman
    const podmanFactory = deps.podmanFactory || (function loadPodman() {
      // eslint-disable-next-line import/no-extraneous-dependencies
      return require('@ai-hero/sandcastle/sandboxes/podman').podman;
    }());
    sandboxProvider = podmanFactory(sandboxOptions);
  }

  // ------------------------------------------------------------------
  // Step 4: Expose createWorktree helper
  // ------------------------------------------------------------------

  /**
   * Create a Sandcastle-managed worktree for the given story.
   *
   * branchStrategy field is `branch` (not `name`) — confirmed against:
   *   - .pHive/spikes/sandcastle/harness.ts  (branchStrategy.branch)
   *   - research-findings.md §2.4 API surface (branch?: string)
   * The work-item prompt used `name:` which conflicts with the canonical
   * source; canonical source wins per hive conventions.
   *
   * Sandcastle owns wt.close(). Hive's legacy .claude/worktrees/{story-id}
   * cleanup is NOT called here.
   *
   * @param {string} storyId
   * @returns {Promise<object>} Sandcastle Worktree object
   */
  async function createWorktree(storyId) {
    if (!storyId || typeof storyId !== 'string') {
      throw new TypeError('[hive/sandcastle-provider] createWorktree: storyId must be a non-empty string');
    }

    const createWorktreeFn = deps.createWorktreeFn || (function loadCreateWorktree() {
      // eslint-disable-next-line import/no-extraneous-dependencies
      return require('@ai-hero/sandcastle').createWorktree;
    }());

    return createWorktreeFn({
      sandbox: sandboxProvider,
      branchStrategy: {
        type: 'branch',
        branch: storyId,
      },
    });
  }

  return {
    sandboxProvider,
    createWorktree,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createSandcastleProvider,
  SANDCASTLE_RANGE,
};
