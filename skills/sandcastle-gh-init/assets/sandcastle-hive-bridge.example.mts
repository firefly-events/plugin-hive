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
 *   2. Resolve the branch name: when the issue carries a
 *      `hive:epic:<epic-id>` label AND the repo's resolved
 *      `branch_strategy` (from `hive/lib/git_flow.mjs`) is `per-epic`,
 *      use `feat/<epic-id>`; otherwise fall back to `agent/issue-<n>`.
 *   3. Build a prompt that delegates to `/hive:execute` against the
 *      labeled issue.
 *   4. Invoke `sandcastle.run({ ... })` with the resolved branch.
 *   5. Emit a structured result line for the workflow to capture.
 *
 * Label state transitions (`hive:in-flight` -> `hive:shipped` |
 * `hive:failed`) are NOT this bridge's job — the workflow YAML owns
 * them so they survive bridge crashes via `if: failure()`.
 *
 * Scaffolded by `/hive:sandcastle-gh-init`. The `CLAUDE_CODE_OAUTH_TOKEN`
 * placeholder is substituted to one of:
 *   - `CLAUDE_CODE_OAUTH_TOKEN`  — `--secret-mode claude-oauth` (default).
 *     Long-lived headless OAuth token from `claude setup-token`;
 *     billed against the maintainer's Claude subscription. Read directly
 *     by the `claude` CLI inside the sandcastle container — no file
 *     mount or aliasing required (verified by the
 *     `.github/workflows/claude-auth-spike.yml` smoke test, 2026-05-17).
 *   - `ANTHROPIC_API_KEY`        — `--secret-mode anthropic-api`
 *     (legacy per-token API billing path; back-compat for consumers who
 *     already wired the API-key secret).
 *   - `OPENAI_API_KEY`           — `--secret-mode openai`.
 *
 * `@ai-hero/sandcastle`'s `claudeCode()` provider does NOT hardcode an
 * auth env var name; it forwards whatever `env` the caller passes (and
 * what `process.env` carries) into the container, and the `claude` CLI
 * itself decides which credential to use at request time. So this
 * bridge just env-presence-checks the configured secret and lets
 * sandcastle's launch-time env merge do the rest.
 */

import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import path from "node:path";

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
      "Configure the secret on the repository (Settings -> Secrets -> Actions) " +
      "and reference it in `.github/workflows/hive-dispatch.yml`.",
  );
  process.exit(1);
}

const repoRoot: string = process.cwd();

// Fetch the issue's labels via the GitHub REST API. We deliberately do
// not shell out to `gh` — AC-7 in `tests/sandcastle-gh-init-assets.test.js`
// enforces the no-subprocess rule for the bridge. GH_TOKEN +
// GITHUB_REPOSITORY are injected by the workflow / GitHub Actions runtime.
async function fetchIssueLabels(): Promise<string[]> {
  const repo: string | undefined = process.env.GITHUB_REPOSITORY;
  const token: string | undefined = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.error(
      "[sandcastle-hive-bridge] GITHUB_REPOSITORY or GH_TOKEN unset — cannot fetch labels; defaulting to no-epic branch derivation.",
    );
    return [];
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "plugin-hive-sandcastle-bridge",
        },
      },
    );
    if (!res.ok) {
      console.error(
        `[sandcastle-hive-bridge] GitHub API returned ${res.status} fetching labels; defaulting to no-epic.`,
      );
      return [];
    }
    const body = (await res.json()) as { labels?: Array<{ name?: string } | string> };
    const labels = Array.isArray(body.labels) ? body.labels : [];
    return labels
      .map((l) => (typeof l === "string" ? l : l?.name))
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  } catch (err) {
    console.error(
      `[sandcastle-hive-bridge] label fetch failed (${(err as Error).message}); defaulting to no-epic.`,
    );
    return [];
  }
}

const labels: string[] = await fetchIssueLabels();
const epicId: string | undefined = labels
  .find((l) => l.startsWith("hive:epic:"))
  ?.slice("hive:epic:".length);

// Validate epicId against the same allowlist sandcastle uses for
// branchStrategy. The label is user-controlled (maintainers may create
// arbitrary `hive:epic:*` labels), so before pasting it into a branch
// name we hard-fail on anything outside [A-Za-z0-9._-]. Refusing here
// is the right outcome: a malformed epic label is operator error and
// the workflow's `if: failure()` path then flips the issue to
// `hive:failed` for human triage.
if (epicId !== undefined && !/^[a-zA-Z0-9._-]+$/.test(epicId)) {
  console.error(
    `[sandcastle-hive-bridge] hive:epic:${epicId} label contains characters ` +
      `outside the allowlist [A-Za-z0-9._-]; refusing to construct branch name. ` +
      `Rename the label and re-trigger.`,
  );
  process.exit(2);
}

// Resolve branch_strategy from the consumer repo's hive config. The
// helper is part of plugin-hive and only present when the consumer has
// vendored it; absence is normal and defaults to per-epic semantics so
// epic-labeled issues continue to use feat/<epic-id>.
async function resolveBranchStrategy(): Promise<"per-epic" | "per-story"> {
  const helperPath = path.resolve(repoRoot, "hive/lib/git_flow.mjs");
  try {
    const mod = (await import(helperPath)) as {
      resolveGitFlow?: (opts: { cwd: string }) => { branch_strategy?: string };
    };
    if (typeof mod.resolveGitFlow !== "function") return "per-epic";
    const out = mod.resolveGitFlow({ cwd: repoRoot });
    return out?.branch_strategy === "per-story" ? "per-story" : "per-epic";
  } catch {
    // hive/lib/git_flow.mjs not vendored in this repo — default to per-epic.
    return "per-epic";
  }
}

const branchStrategyMode = await resolveBranchStrategy();

let branch: string;
if (!epicId) {
  branch = `agent/issue-${issueNumber}`;
} else if (branchStrategyMode === "per-story") {
  console.warn(
    `[sandcastle-hive-bridge] branch_strategy=per-story configured; ignoring hive:epic:${epicId} label and using legacy agent/issue-${issueNumber} branch.`,
  );
  branch = `agent/issue-${issueNumber}`;
} else {
  branch = `feat/${epicId}`;
}

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
  // `sandcastle:<cwd-basename>` (e.g., `sandcastle:plugin-hive`), which
  // the workflow never builds/retags → run fails with
  // "Image 'sandcastle:<repo>' not found locally".
  //
  // containerUid pinned to 1000 so the pre-built GHCR image works on
  // any runner regardless of the runtime `id -u` value. The image is
  // built with AGENT_UID=1000 in build-sandcastle-image.yml; sandcastle
  // defaults to matching runtime `id -u`, which can be 1001 on newer
  // ubuntu-latest images → "UID mismatch" error.
  sandbox: docker({ imageName: "sandcastle:hive", containerUid: 1000 }),
  branchStrategy: { type: "branch", branch },
  // Forward auth + gh CLI tokens into the container so the inner
  // claude-code CLI sees CLAUDE_CODE_OAUTH_TOKEN (subscription OAuth)
  // and the inner gh CLI sees GH_TOKEN. Mirrors hive/lib/sandcastle-
  // worker-runner.js buildContainerEnv() (cron path). Without this,
  // the inner agent crashes with "Not logged in · Please run /login".
  env: {
    ...(process.env["CLAUDE_CODE_OAUTH_TOKEN"]
      ? { ["CLAUDE_CODE_OAUTH_TOKEN"]: process.env["CLAUDE_CODE_OAUTH_TOKEN"] }
      : {}),
    ...(process.env.GH_TOKEN
      ? { GH_TOKEN: process.env.GH_TOKEN }
      : {}),
  },
  prompt,
  maxIterations: 5,
  idleTimeoutSeconds: 600,
});

// Structured one-line result for the workflow to parse / surface in the
// step summary. Keeps the bridge stdout shape stable for future
// consumers (metrics, dashboards). `branchStrategyMode` + `epicId` are
// included so post-run reviewers can verify the derivation.
console.log(
  JSON.stringify({
    issueNumber,
    branch: result.branch,
    epicId: epicId ?? null,
    branchStrategy: branchStrategyMode,
    commitCount: result.commits.length,
    iterations: result.iterations.length,
    completionSignal: result.completionSignal,
  }),
);
