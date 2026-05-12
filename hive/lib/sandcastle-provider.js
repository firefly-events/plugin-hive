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
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v));
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
    // eslint-disable-next-line import/no-extraneous-dependencies
    return require('@ai-hero/sandcastle/package.json').version;
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
 * @param {object} [options]
 * @param {boolean} [options.useDocker=false]        — opt-in Docker; default is Podman
 * @param {string}  [options.imageName]              — override container image name
 * @param {string}  [options.codexConfigHostPath]    — override .sandcastle/codex-config host path
 * @param {Function} [options.logger]                — custom base logger (default: console.log)
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
