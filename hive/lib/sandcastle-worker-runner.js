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
 *   - claudeCode(modelTag) agent provider — Claude Code runs in-container
 *     once the CLI is installed and the OAuth token is forwarded by the
 *     surrounding workflow stories.
 *   - docker({ imageName }) sandbox provider
 *   - promptArgs { FORCE_ISSUE } for {{...}} substitution
 *   - branchStrategy: { type:"branch", branch:"agent/issue-<n>" }
 *   - default completionSignal "<promise>COMPLETE</promise>"
 *
 * BYO sandcastle: @ai-hero/sandcastle is only present once consumers have
 * adopted sandcastle. We `require()` lazily and surface a clear error
 * otherwise. Mirrors the BYO pattern in hive/lib/external/github-issues-adapter.js.
 *
 * Test seam: runOnce accepts a `_deps` object replacing run / claudeCode /
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
const DEFAULT_MODEL = 'claude-opus-4-7';
// Default sandcastle idleTimeout is 600s. Claude Code on a non-trivial story
// (read context → plan → edit → test → commit → PR) routinely thinks
// quietly for >60s between stdout bursts. Bump to 1800s (30 min) to
// avoid killing the agent mid-task. The job-level 45-min timeout in the
// workflow remains the hard ceiling.
const DEFAULT_IDLE_TIMEOUT_S = 1800;
// Must match the literal `<result>…</result>` block in the worker prompt
// (.sandcastle/prompts/worker-issue-pickup.md). Sandcastle scans the
// rendered prompt for the tag and errors if it isn't referenced.
const OUTPUT_TAG = 'result';
// containerUid/Gid intentionally NOT pinned. We rebuilt the policy so the
// workflow now builds the image with AGENT_UID=$(id -u) AGENT_GID=$(id -g),
// which means the in-container agent always matches the host runner user.
// Sandcastle's docker provider defaults containerUid to process.getuid(),
// so leaving it unset is the right answer:
//
// - In CI: image built as runner UID, sandcastle uses runner UID → write
//   access to the bind-mounted worktree works.
// - Locally: image built as local UID, sandcastle uses local UID → same.
//
// Earlier we pinned to 1000 to silence sandcastle's "UID mismatch"
// preflight, but that introduced the inverse problem on the runner:
// container UID 1000 couldn't write to files owned by runner UID 1001.
// The build-arg fix is the canonical resolution.

// Env vars forwarded from the host into the sandcastle container. Test seam:
// `_deps.containerEnv` overrides the host env lookup so unit tests can pin
// the captured value.
function buildContainerEnv(_deps) {
  const deps = _deps || {};
  if (deps.containerEnv) return deps.containerEnv;
  const env = {};
  if (process.env.GH_TOKEN) env.GH_TOKEN = process.env.GH_TOKEN;
  return env;
}
// Sandcastle constraint: when `output: <Zod schema>` is set (structured
// output), maxIterations must be 1. Sandcastle's "iteration" is a
// sandbox-level retry of the whole prompt — not the agent's internal
// reasoning steps. The agent (Claude Code) iterates freely inside that single
// run via bash/edit tool calls; sandcastle only retries if the structured
// output fails validation, which structured-output mode disallows.
const DEFAULT_MAX_ITERATIONS = 1;
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
  if (deps.run && deps.claudeCode && deps.docker) {
    return { run: deps.run, claudeCode: deps.claudeCode, docker: deps.docker };
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
    claudeCode: deps.claudeCode || sc.claudeCode,
    docker: dockerFactory,
  };
}

/**
 * Run the worker prompt once and return the parsed structured result.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.issueNumber]   force a specific issue (manual path)
 * @param {string}  [opts.imageName]     docker image; default sandcastle:hive
 * @param {string}  [opts.modelTag]      Claude model; default claude-opus-4-7
 * @param {number}  [opts.maxIterations] default 1 (sandcastle constraint)
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
  const { run, claudeCode, docker } = await getSandcastleDeps(_deps);

  const imageName = options.imageName || DEFAULT_IMAGE;
  const modelTag = options.modelTag || DEFAULT_MODEL;
  // Reject NaN/Infinity/non-positive — sandcastle would throw or hang.
  const idleTimeoutSeconds =
    Number.isFinite(options.idleTimeoutSeconds) && options.idleTimeoutSeconds > 0
      ? Math.floor(options.idleTimeoutSeconds)
      : DEFAULT_IDLE_TIMEOUT_S;
  const maxIterations = typeof options.maxIterations === 'number'
    ? options.maxIterations
    : DEFAULT_MAX_ITERATIONS;
  if (maxIterations !== 1) {
    throw new Error(
      '[sandcastle-worker-runner] maxIterations must be 1 — sandcastle ' +
      'structured output (Output.object) is a one-shot operation per ' +
      `ADR 0010 (got ${maxIterations}).`
    );
  }

  const forceIssue =
    typeof options.issueNumber === 'number' && options.issueNumber > 0
      ? String(options.issueNumber)
      : '';

  // branchStrategy.branch substitutes {{ISSUE}} at run time when an issue is
  // forced. When the worker picks idly (FORCE_ISSUE empty), the prompt's
  // idle path emits status:"idle" before any commits exist, so the branch
  // is never created. We still pass a placeholder so sandcastle has a value.
  const branchName = forceIssue ? `agent/issue-${forceIssue}` : 'agent/issue-pickup';

  // Sandcastle expects an OutputObjectDefinition from `Output.object({ tag,
  // schema })`. The test seam still accepts a bare schema or pre-built
  // definition via `_deps.outputDefinition`; only the live path needs the
  // wrapping. The `tag` value MUST match the `<result>` block emitted by
  // .sandcastle/prompts/worker-issue-pickup.md (sandcastle parses prompt
  // text to confirm the tag is referenced).
  let outputDefinition;
  if (_deps.outputDefinition) {
    outputDefinition = _deps.outputDefinition;
  } else {
    const sc = await loadSandcastle();
    const schema = _deps.outputSchema || getDefaultOutputSchema();
    outputDefinition = sc.Output.object({ tag: OUTPUT_TAG, schema });
  }

  const runArgs = {
    agent: claudeCode(modelTag),
    sandbox: docker({
      imageName,
      // Forward the host's GH_TOKEN to the container so the gh CLI inside
      // can auth — the worker prompt runs `gh issue list / edit / create`
      // at prompt-render time.
      env: buildContainerEnv(_deps),
      // Temporary legacy mount retained while the Claude Code lane is
      // completed by follow-on infra stories. The default agent is now
      // claudeCode(); this mount is inert for that path.
      mounts: [
        {
          hostPath: '.sandcastle/codex-config/auth.json',
          sandboxPath: '/home/agent/.codex/auth.json',
          readonly: true,
        },
      ],
    }),
    promptFile: PROMPT_FILE,
    promptArgs: { FORCE_ISSUE: forceIssue },
    branchStrategy: { type: 'branch', branch: branchName },
    maxIterations,
    idleTimeoutSeconds,
    output: outputDefinition,
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
