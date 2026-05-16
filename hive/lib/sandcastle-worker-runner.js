'use strict';

/**
 * hive/lib/sandcastle-worker-runner.js
 *
 * Thin wrapper around `sandcastle.run()` that invokes the worker prompt at
 * .sandcastle/prompts/worker-issue-pickup.md with Output.object() typed
 * against hive/lib/sandcastle-worker-schema.js.
 *
 * Story: s2-sandcastle-worker-prompt (sandcastle-ops-layer)
 *
 * Sandcastle primitives used (no custom dispatcher logic):
 *   - run({ promptFile, output, branchStrategy, maxIterations })
 *   - codex(modelTag) agent provider — Codex CLI ≥ 0.129 requires the
 *     `auth.json` file mounted at `/home/agent/.codex/auth.json` inside
 *     the container. The GH Actions workflow materializes that file from
 *     the CODEX_AUTH_JSON secret before invoking the runner.
 *   - docker({ imageName }) sandbox provider
 *   - promptArgs { FORCE_ISSUE } for {{...}} substitution
 *   - branchStrategy: { type:"branch", branch:"agent/issue-<n>" }
 *   - default completionSignal "<promise>COMPLETE</promise>"
 *
 * BYO sandcastle: @ai-hero/sandcastle is only present once consumers have
 * adopted sandcastle. We `require()` lazily and surface a clear error
 * otherwise. Mirrors the BYO pattern in hive/lib/external/github-issues-adapter.js.
 *
 * Test seam: runOnce accepts a `_deps` object replacing run / codex /
 * docker so unit tests can verify the run() call args without booting a
 * container. Not part of public API.
 *
 * CLI: `node hive/lib/sandcastle-worker-runner.js [<issue#>]`
 *      Prints the parsed result.object JSON to stdout. Non-zero exit on
 *      failure-to-run. (Worker `status: "failed"` is exit 0 — the worker
 *      ran fine; only infrastructure failures yield non-zero.)
 */

const path = require('node:path');

// Lazy access: sandcastle-worker-schema's ResultSchema getter throws when
// zod isn't available. Tests inject `_deps.outputSchema` to bypass; the CLI
// path triggers the getter only when needed (zod resolves via sandcastle's
// peer dep tree).
function getDefaultOutputSchema() {
  // eslint-disable-next-line global-require
  return require('./sandcastle-worker-schema.js').ResultSchema;
}

const DEFAULT_IMAGE = 'sandcastle:hive';
const DEFAULT_MODEL = 'gpt-5.1-codex';
const DEFAULT_MAX_ITERATIONS = 5;
const PROMPT_FILE = '.sandcastle/prompts/worker-issue-pickup.md';

// @ai-hero/sandcastle is `"type": "module"` (ESM-only) and its `exports` map
// has only an `import` condition for the root entry. A bare `require()` from
// this CJS module fails with "No 'exports' main defined". Use dynamic
// `import()` instead — supported in CJS since Node 12.20 and returns the
// ESM namespace object directly.
async function loadSandcastle() {
  return import('@ai-hero/sandcastle');
}

async function loadDocker() {
  const mod = await import('@ai-hero/sandcastle/sandboxes/docker');
  return mod.docker;
}

async function getSandcastleDeps(_deps) {
  const deps = _deps || {};
  if (deps.run && deps.codex && deps.docker) {
    return { run: deps.run, codex: deps.codex, docker: deps.docker };
  }
  let sc;
  try {
    sc = await loadSandcastle();
  } catch (err) {
    throw new Error(
      '[sandcastle-worker-runner] @ai-hero/sandcastle not installed — ' +
      'run `npm install --no-save @ai-hero/sandcastle` and try again. ' +
      `(${err.message})`
    );
  }
  let dockerFactory;
  try {
    dockerFactory = deps.docker || (await loadDocker());
  } catch (err) {
    throw new Error(
      '[sandcastle-worker-runner] @ai-hero/sandcastle/sandboxes/docker not available: ' +
      err.message
    );
  }
  return {
    run: deps.run || sc.run,
    codex: deps.codex || sc.codex,
    docker: dockerFactory,
  };
}

/**
 * Run the worker prompt once and return the parsed structured result.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.issueNumber]   force a specific issue (manual path)
 * @param {string}  [opts.imageName]     docker image; default sandcastle:hive
 * @param {string}  [opts.modelTag]      codex model; default gpt-5.1-codex
 * @param {number}  [opts.maxIterations] default 5
 * @param {object}  [opts._deps]         test seam
 * @returns {Promise<{
 *   issue_number: number|null,
 *   pr_number: number|null,
 *   status: "shipped"|"failed"|"idle",
 *   reason?: string,
 *   branch?: string,
 *   duration_seconds?: number,
 * }>}
 */
async function runOnce(opts) {
  const options = opts || {};
  const _deps = options._deps || {};
  const { run, codex, docker } = await getSandcastleDeps(_deps);

  const imageName = options.imageName || DEFAULT_IMAGE;
  const modelTag = options.modelTag || DEFAULT_MODEL;
  const maxIterations = typeof options.maxIterations === 'number'
    ? options.maxIterations
    : DEFAULT_MAX_ITERATIONS;

  const forceIssue =
    typeof options.issueNumber === 'number' && options.issueNumber > 0
      ? String(options.issueNumber)
      : '';

  // branchStrategy.branch substitutes {{ISSUE}} at run time when an issue is
  // forced. When the worker picks idly (FORCE_ISSUE empty), the prompt's
  // idle path emits status:"idle" before any commits exist, so the branch
  // is never created. We still pass a placeholder so sandcastle has a value.
  const branchName = forceIssue ? `agent/issue-${forceIssue}` : 'agent/issue-pickup';

  const outputSchema = _deps.outputSchema || getDefaultOutputSchema();

  const runArgs = {
    agent: codex(modelTag),
    sandbox: docker({ imageName }),
    promptFile: PROMPT_FILE,
    promptArgs: { FORCE_ISSUE: forceIssue },
    branchStrategy: { type: 'branch', branch: branchName },
    maxIterations,
    output: outputSchema,
  };

  const result = await run(runArgs);

  if (!result || typeof result !== 'object' || result.output === undefined) {
    throw new Error(
      '[sandcastle-worker-runner] sandcastle.run returned no output — ' +
      'the worker likely failed to emit a structured result before maxIterations.'
    );
  }

  return result.output;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function cli(argv) {
  const args = argv.slice(2);
  const issueArg = args[0];
  const issueNumber = issueArg ? parseInt(issueArg, 10) : undefined;
  if (issueArg && (!Number.isFinite(issueNumber) || issueNumber <= 0)) {
    process.stderr.write(
      `[sandcastle-worker-runner] invalid issue number: ${issueArg}\n`
    );
    process.exit(2);
  }
  try {
    const result = await runOnce({ issueNumber });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[sandcastle-worker-runner] ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  cli(process.argv);
}

module.exports = {
  runOnce,
  // Exported for testing only — not stable public API.
  _internal: {
    DEFAULT_IMAGE,
    DEFAULT_MODEL,
    DEFAULT_MAX_ITERATIONS,
    PROMPT_FILE,
  },
};
