# Design Discussion: Sandcastle GitHub-Issue Event Dispatch

## Goal

Replace cron-based polling of GitHub issues with event-driven dispatch. When a maintainer labels an issue `hive:ready` (the existing canonical label), a GitHub Actions workflow fires immediately, runs `/hive:execute` against the issue inside a Sandcastle container, commits to `agent/issue-<n>`, opens a PR, and transitions the label through the existing state machine (`hive:ready` → `hive:in-flight` → `hive:shipped` | `hive:failed`).

Plan and execute are intentionally SEPARATE — the human plans via `/hive:plan` locally, reviews, then labels `hive:ready` to trigger autonomous execution. No auto-flow plan→execute.

Ship this as a Hive scaffold skill (`/hive:sandcastle-gh-init`) that drops the workflow + bridge script into consumer repos, layered on top of an already-initialized `.sandcastle/` (user ran `npx sandcastle init` first).

## Proposed Approach

### 1. New public skill: `/hive:sandcastle-gh-init`

**Sandcastle init is a prerequisite, NOT a wrapped call.** The user runs `npx sandcastle init` themselves first — they pick provider (Docker/Podman/Vercel), template, backlog manager. The Hive skill assumes that work is done and only layers GH-event-trigger glue on top.

The skill does exactly four things:

1. **Prereq check**: stat `.sandcastle/Dockerfile` (proxy for "sandcastle init has run"). If absent, exit 2 with remediation message. Zero files written before this check passes.
2. Renders `assets/hive-dispatch.yml.tpl` into `.github/workflows/hive-dispatch.yml` with runner + secret-key substitutions.
3. Renders `assets/sandcastle-hive-bridge.mts.tpl` into `.github/scripts/sandcastle-hive-bridge.mts`.
4. Writes `.hive-dispatch/manifest.yaml` recording sandcastle version pin, args, timestamp, and `managed_files` list for idempotent re-runs.

The skill does NOT create labels — `hive:ready` / `hive:in-flight` / `hive:shipped` / `hive:failed` are existing canonical labels already on the repo. The skill verifies their presence and warns (non-blocking) if any are missing, printing the `gh label create` commands consumers can copy-paste.

Skill args:
- `--runner <ubuntu-latest|self-hosted>` — default `ubuntu-latest`.
- `--secret-mode <anthropic|openai>` — default `anthropic`. Determines which secret the workflow expects.

No `--label` arg (label name is the existing canonical convention; override would fragment the state machine). No `--template` arg (template choice belongs to upstream `sandcastle init`).

Managed files live under `.github/` and `.hive-dispatch/` — NOT inside `.sandcastle/`. That directory stays sandcastle's domain so consumers can re-run `sandcastle init` without colliding with Hive's files.

### 2. Label state machine (existing — keep as-is)

| Label | Meaning | Set by |
|---|---|---|
| `hive:ready` | Issue spec'd, human-approved, ready for autonomous pickup | Human (trigger) |
| `hive:in-flight` | Worker claimed | Workflow YAML (claim step) |
| `hive:shipped` | PR opened by worker | Workflow YAML (success step) |
| `hive:failed` | Worker exited non-shipped | Workflow YAML (failure step via `if: failure()`) |

Topic labels (`hive:epic:<id>`, `hive:story:<id>`, `hive:blocked-by:<id>`) coexist and are orthogonal to this state machine.

**Workflow owns the transitions**, not the inner Hive agent. Atomic with GH job lifecycle. If the bridge crashes mid-run, the `if: failure()` step still fires and transitions `hive:in-flight` → `hive:failed` cleanly.

### 3. Workflow template

`.github/workflows/hive-dispatch.yml`:

```yaml
name: Hive dispatch
on:
  issues:
    types: [labeled]

permissions:
  contents: write
  issues: write
  pull-requests: write

concurrency:
  group: hive-issue-${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  run:
    if: github.event.label.name == 'hive:ready'
    runs-on: ubuntu-latest                          # replaced at scaffold time
    timeout-minutes: 60
    steps:
      - name: Claim issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          gh issue edit "$ISSUE_NUMBER" \
            --repo "${{ github.repository }}" \
            --remove-label hive:ready \
            --add-label hive:in-flight

      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: actions/setup-node@v4
        with: { node-version: '22' }

      - run: npm ci

      - name: Run Hive via sandcastle bridge
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}   # or OPENAI_API_KEY (--secret-mode openai)
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          HIVE_EXECUTION_MODE: team   # prevent nested sandcastle inside the outer container
        run: npx tsx .github/scripts/sandcastle-hive-bridge.mts

      - name: On success — ship + label
        if: success()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          BRANCH="agent/issue-${ISSUE_NUMBER}"
          if git ls-remote --exit-code --heads origin "$BRANCH"; then
            gh pr create --base "${{ github.event.repository.default_branch }}" \
              --head "$BRANCH" \
              --title "Hive: #${ISSUE_NUMBER}" \
              --body "Automated /hive:execute run for #${ISSUE_NUMBER}." || true
          fi
          gh issue edit "$ISSUE_NUMBER" \
            --remove-label hive:in-flight \
            --add-label hive:shipped
          gh issue comment "$ISSUE_NUMBER" \
            --body "Hive execute completed — see PR from \`$BRANCH\`."

      - name: On failure — label + comment
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          gh issue edit "$ISSUE_NUMBER" \
            --remove-label hive:in-flight \
            --add-label hive:failed
          gh issue comment "$ISSUE_NUMBER" \
            --body "Hive execute failed — see workflow logs."
```

Key choices:
- `on: issues:[labeled]` only — never `[opened, edited, ...]`.
- `if: github.event.label.name == 'hive:ready'` step-level guard (GH cannot pre-filter labels in `on:`).
- Per-issue `concurrency.group` — concurrent labels on the same issue queue, not double-run.
- `cancel-in-progress: false` — preserves the in-flight job if a second `hive:ready` label fires (rare edge case).
- `timeout-minutes: 60` — hard ceiling on the job.
- `HIVE_EXECUTION_MODE: team` — prevents the inner Hive `/execute` from spawning more sandcastles. Single isolation layer.
- Label transitions are workflow YAML's responsibility (not the bridge), so `if: failure()` covers bridge crashes.
- PR creation `|| true` and conditional on remote branch existing — Hive may complete with zero commits.

### 4. Bridge script

`.github/scripts/sandcastle-hive-bridge.mts`:

```ts
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const issueNumber = process.env.ISSUE_NUMBER;
if (!issueNumber) {
  console.error("ISSUE_NUMBER env var required");
  process.exit(1);
}

const branch = `agent/issue-${issueNumber}`;

const result = await run({
  agent: claudeCode("claude-opus-4-7"),
  sandbox: docker(),
  branchStrategy: { type: "branch", branch },
  prompt: `You are running in the firefly-events/plugin-hive repo inside a sandcastle container.
Run /hive:execute on issue #${issueNumber}. Read the issue body via \`gh issue view ${issueNumber}\`
to discover the epic and stories. Commit all work to branch ${branch}. Do NOT invoke /hive:plan —
that is the human's responsibility and has already been done. Do NOT spawn additional sandcastles
(HIVE_EXECUTION_MODE=team is set; honor it).`,
  maxIterations: 5,
  idleTimeoutSeconds: 600,
});

console.log(JSON.stringify({
  branch: result.branch,
  commitCount: result.commits.length,
  iterations: result.iterations.length,
  completionSignal: result.completionSignal,
}));
```

Bridge keeps `.sandcastle/` completely untouched. It uses the upstream `sandcastle.run()` API directly with the consumer's existing `.sandcastle/Dockerfile` (picked up automatically by the docker sandbox factory).

### 5. Hive-side wiring

The new skill is a sibling of `/hive:execute-mode-sandcastle` — that skill is the INTERNAL sandcastle execution mode for Hive's own orchestrator; this skill scaffolds the CONSUMER-FACING GH-issue trigger. Internal execution path unchanged.

Future labels (`hive:plan` for autonomous plan, `hive:test`, `hive:review`) are OUT OF SCOPE for this epic. They'd be added as additional `if:` branches in the workflow's first dispatch step, each calling a different bridge prompt.

Documentation:
- New: `hive/references/sandcastle-gh-dispatch.md` — runbook for maintainers (secret rotation, runner choice, label permission lockdown, future-labels extension point).
- Updated: `README.md` Sandcastle section — add line about `/hive:sandcastle-gh-init` for unattended mode.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Workflow runs without label filter → fires on every `labeled` event | high | Triple-guard: `on: issues:[labeled]` only, step `if:` on `hive:ready`, per-issue `concurrency.group`. Smoke test with a different `hive:*` label. |
| Bridge crash leaves label stuck at `hive:in-flight` | high | Failure step uses `if: failure()` — fires on bridge non-zero exit. Tested by intentionally failing the bridge (missing key). |
| Concurrent labels on same issue race the state machine | medium | `concurrency.group: hive-issue-<n>` queues, `cancel-in-progress: false` preserves in-flight. |
| Inner Hive ignores `HIVE_EXECUTION_MODE=team` and nests sandcastles | medium | Bridge sets env before sandcastle.run(); inner Hive inherits. Test reads agent stdout for "execution mode" log line; bridge prompt also explicitly states "do not spawn additional sandcastles". |
| Anthropic key leak via logs | high | Workflow uses secrets, never echoes. Existing `sandcastle-log-redaction.js` covers in-sandbox stdout. |
| Runner missing Docker → sandcastle Docker provider fails | medium | `ubuntu-latest` ships Docker preinstalled. Runbook (s3) covers Podman/self-hosted fallback. |
| PR auto-creation conflicts with consumer branch protection | medium | PR `|| true`; label transitions and comment still fire on PR-create failure. |
| Cost runaway from rapid `hive:ready` spam | medium | `maxIterations: 5`, `idleTimeoutSeconds: 600`, `timeout-minutes: 60`, concurrency dedupes per issue. |
| Public repos — anyone with triage perm can fire agents | high | Runbook documents label permission lockdown via repo settings. Future hardening: `if: github.event.sender.permission == 'admin' || 'write'`. |
| Sandcastle version drift breaks bridge's API contract | low | Manifest records sandcastle pin at scaffold time. Skill emits a warning when consumer's installed version doesn't match the manifest pin on re-runs. |

## Dependencies

- `@ai-hero/sandcastle` v0.5.10+ installed in consumer repo (after `npx sandcastle init`).
- `gh` CLI on runner (preinstalled on `ubuntu-latest`).
- Node 22 (matches sandcastle default Dockerfile).
- Consumer secret `ANTHROPIC_API_KEY` (default) or `OPENAI_API_KEY` (with `--secret-mode openai`).
- Canonical labels already exist on consumer repo: `hive:ready`, `hive:in-flight`, `hive:shipped`, `hive:failed`. Skill verifies; warns + prints remediation commands if missing.
- Hive's existing internal `execute-mode-sandcastle` path is unchanged. This is purely a CI-side entry surface.

## Open Questions

1. **PR base branch.** `github.event.repository.default_branch` or hardcoded `main`. Recommend `default_branch` — works for repos with non-`main` defaults.
2. **Claude model pin in bridge.** Bridge hardcodes `claude-opus-4-7`. Make configurable via `--model` flag, or leave hardcoded? Recommend hardcoded for v1; introduce flag only if a consumer asks.
3. **Future-labels extension.** Should s1 ship commented-out placeholders for `hive:plan` / `hive:test` / `hive:review` routes to make the extension obvious? Recommend NO — explicit-only initial scope, document the extension pattern in s3's runbook.
4. **Idempotency on re-run.** `manifest.managed_files` allowlist (allow-only-our-files-overwritten). User-owned files (`.sandcastle/*`, other workflow files, etc.) untouched on re-run.
5. **Plugin version bump level.** Additive consumer-visible feature (new public skill, new docs). → **minor** bump per semver.

## Scale Assessment

**Small.**

Reasoning:
- 3 stories, single layer (consumer-facing tooling + CI scripts).
- Multi-file: workflow YAML, TypeScript bridge, scaffold helper, manifest schema, runbook, README. No architectural changes inside Hive.
- No new agents, no new workflow step files, no schema changes inside Hive.
- Existing sandcastle substrate (`hive/lib/sandcastle-*`, `execute-mode-sandcastle` skill) untouched.
- Existing label state machine reused as-is.
- ~5-15 min per story for an agent with the design discussion in hand.

Routing per `/plan` rules: **Small → straight to Phase C.** No H/V planning, no structured outline.
