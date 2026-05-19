/**
 * .github/scripts/sandcastle-hive-bridge.mts
 *
 * Bridge between the GitHub Actions workflow and the upstream
 * `@ai-hero/sandcastle` programmatic API. Invoked by
 * `.github/workflows/hive-dispatch.yml` after a maintainer labels an
 * issue `hive:ready`.
 *
 * Responsibilities:
 *   1. Validate ISSUE_NUMBER + the API key env are present (clear error
 *      on absence — never silent).
 *   2. Build a prompt that delegates to `/hive:execute` against the
 *      labeled issue.
 *   3. Invoke `sandcastle.run({ ... })` with a per-issue branch.
 *   4. Emit a structured result line for the workflow to capture.
 *
 * Label state transitions (`hive:in-flight` -> `hive:shipped` |
 * `hive:failed`) are NOT this bridge's job — the workflow YAML owns
 * them so they survive bridge crashes via `if: failure()`.
 *
 * Scaffolded by `/hive:sandcastle-gh-init`. The auth secret is
 * `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth via `claude setup-token`;
 * the new default). Legacy modes available via re-scaffold:
 * `--secret-mode anthropic-api` (ANTHROPIC_API_KEY, pay-per-token) or
 * `--secret-mode openai` (OPENAI_API_KEY).
 */

import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const issueNumberRaw = process.env.ISSUE_NUMBER;
if (!issueNumberRaw || !/^\d+$/.test(issueNumberRaw)) {
  console.error(
    "[sandcastle-hive-bridge] ISSUE_NUMBER env var is required and must be a positive integer.",
  );
  process.exit(1);
}
const issueNumber: string = issueNumberRaw;

// Fail loudly when the API key secret is missing. The inner Hive agent
// has no way to recover from this — better to short-circuit here with a
// readable error than to hand the agent an unauthenticated client and
// debug a 401 deep in the run.
if (!process.env["CLAUDE_CODE_OAUTH_TOKEN"]) {
  console.error(
    "[sandcastle-hive-bridge] CLAUDE_CODE_OAUTH_TOKEN env var is not set. " +
      "Generate via `claude setup-token` then configure the secret on the " +
      "repository (Settings -> Secrets -> Actions) and reference it in " +
      "`.github/workflows/hive-dispatch.yml`.",
  );
  process.exit(1);
}

const branch = `agent/issue-${issueNumber}`;

// Prompt delegates to /hive:execute. The inner Claude Code (with the
// plugin-hive plugin loaded inside the sandcastle container image)
// resolves the slash command and runs the orchestrator path. The bridge
// itself does NOT invoke /hive:plan — planning is the human's loop.
//
// HIVE_EXECUTION_MODE=team is set at the workflow-step level (see
// hive-dispatch.yml) and inherited by the sandcastle child process; the
// prompt restates the rule defensively so the agent does not spawn
// nested sandcastles even if env propagation is altered upstream.
const prompt = [
  `You are running in a sandcastle container triggered by a GitHub Action.`,
  `Run /hive:execute on issue #${issueNumber} in this repository.`,
  `Read the issue body via \`gh issue view ${issueNumber}\` to discover the epic and stories.`,
  `Commit all work to branch ${branch}.`,
  `Do NOT invoke /hive:plan — that has already been done by the human.`,
  `Do NOT spawn additional sandcastles. HIVE_EXECUTION_MODE=team is set; honor it.`,
].join(" ");

const result = await run({
  agent: claudeCode("claude-opus-4-7"),
  // Explicit imageName matches the workflow's GHCR pull retag
  // (sandcastle:hive). Without this, sandcastle defaults to
  // `sandcastle:<cwd-basename>` = `sandcastle:plugin-hive`, which the
  // workflow never builds/retags → run fails with
  // "Image 'sandcastle:plugin-hive' not found locally".
  //
  // containerUid pinned to 1000 so the pre-built GHCR image works on
  // any runner regardless of the runtime `id -u` value. The image is
  // built with AGENT_UID=1000 in build-sandcastle-image.yml; sandcastle
  // defaults to matching runtime `id -u`, which can be 1001 on newer
  // ubuntu-latest images → "UID mismatch" error.
  // Forward auth + gh CLI tokens via the SANDBOX provider's env (matches
  // hive/lib/sandcastle-worker-runner.js cron pattern exactly — the bridge's
  // earlier attempt to pass these via `run({ env })` failed at runtime).
  // Without this the inner claude-code CLI crashes with
  // "Not logged in · Please run /login".
  sandbox: docker({
    imageName: "sandcastle:hive",
    containerUid: 1000,
    env: {
      ...(process.env.CLAUDE_CODE_OAUTH_TOKEN
        ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }
        : {}),
      ...(process.env.GH_TOKEN
        ? { GH_TOKEN: process.env.GH_TOKEN }
        : {}),
    },
  }),
  branchStrategy: { type: "branch", branch },
  prompt,
  maxIterations: 5,
  idleTimeoutSeconds: 600,
});

// Structured one-line result for the workflow to parse / surface in the
// step summary. Keeps the bridge stdout shape stable for future
// consumers (metrics, dashboards).
console.log(
  JSON.stringify({
    issueNumber,
    branch: result.branch,
    commitCount: result.commits.length,
    iterations: result.iterations.length,
    completionSignal: result.completionSignal,
  }),
);
