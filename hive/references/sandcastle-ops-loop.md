# Sandcastle Ops Loop — Autonomous Execution Reference

**Epic:** sandcastle-ops-layer
**Status:** opt-in / reference / maintainer-only
**Version introduced:** 2.1.0
**Related:** [`sandcastle-adoption-guide.md`](sandcastle-adoption-guide.md), [`task-tracking-adapter-abi-schemas/`](task-tracking-adapter-abi-schemas/)

## What this is

A reference end-to-end flow that lets a maintainer close the development loop on top of three pieces that already exist:

1. **`/plan`** publishes story YAMLs as labeled GitHub Issues (Story S1).
2. **Sandcastle** runs a worker prompt that picks up a labeled issue and ships it (Story S2).
3. **GitHub Actions** triggers the worker on a 15-minute cron and gates on token budget (Story S3).

No custom dispatcher. No daemon. No branch-lease logic. GitHub Actions owns scheduling, concurrency, and run history; sandcastle owns the agent loop, sandbox, and PR open.

## What this is NOT

- **Not a default consumer feature.** Plugin-hive distributes via `.claude-plugin/`, not `.github/`. The workflow at `.github/workflows/hive-worker.yml` ships in plugin-hive's own repo for the maintainer's autonomous-execution experiments. Consumers who want this copy the workflow into their own repo, configure secrets, and adopt sandcastle.
- **Not always-on.** The loop is gated by `external_task_tracking.adapter: github` + sandcastle adoption + a non-zero `tokens.daily_usd_limit`. Defaults are off.
- **Not a replacement for `/execute`.** Treat this as an after-hours backstop, not the primary execution surface.

## End-to-end flow

```
+---------------+      +-----------------+      +-----------------+
|   /plan       |      |  GH Actions     |      |    Sandcastle   |
| (developer)   |      |  cron + budget  |      |  worker prompt  |
+-------+-------+      +--------+--------+      +--------+--------+
        |                       |                        |
        v                       v                        v
  Stories YAML           Every 15 min OR           Pick oldest
  -> step 19a            workflow_dispatch         hive:ready issue
        |                       |                        |
        v                       v                        v
  hive:story +             budget-gate.js          Re-read YAML
  hive:ready labeled       (USD spend < limit)     from disk
  GH Issues                       |                        |
        |                         v                        v
        |                  docker build              Implement,
        |                  sandcastle:hive-worker    open PR,
        |                         |                  comment back
        |                         v                        |
        |                  Run worker runner               |
        +---------------->(.github/workflows/--->----------+
                          hive-worker.yml)
                                  |
                                  v
                          result.json artifact
                          + step summary
                                  |
                                  v
                          status==shipped?
                          yes -> issue closed by PR
                          no  -> hive:failed label
```

## Opt-in checklist

A consumer wiring this in their own repo needs all of:

1. **Adapter wiring** — set `external_task_tracking.adapter: github` in `hive.config.yaml` (Epic C). This makes `/plan` step 19a publish stories to GH Issues with `hive:story` + `hive:ready` labels.
2. **Sandcastle adoption** — install `@ai-hero/sandcastle` per [`sandcastle-adoption-guide.md`](sandcastle-adoption-guide.md) (Epic D). The worker runner at `hive/lib/sandcastle-worker-runner.js` lazily requires it.
3. **Copy the workflow** — copy `.github/workflows/hive-worker.yml` from plugin-hive into your repo. Plugin distribution does NOT auto-deploy GitHub workflows.
4. **Configure secrets / permissions** — `GITHUB_TOKEN` is sufficient for the built-in scopes (`issues: write`, `pull-requests: write`, `contents: write`). The workflow does not require additional secrets at v1.
5. **Set budget limit** — add `tokens.daily_usd_limit: <usd>` under `tokens:` in `hive.config.yaml`. Unset → gate disabled (Infinity).
6. **Pick a cadence** — default is `cron: '*/15 * * * *'`. Tune after observation.

## Constraints (hard, v1)

| Constraint | Why |
|---|---|
| Serial execution | `concurrency.group: hive-worker, cancel-in-progress: false` — two overlapping cron firings queue rather than parallelize. v1 safety; parallel deferred. |
| Human-on-first-fail | A worker that exits non-zero without `status: shipped` gets the issue labeled `hive:failed`. No auto-retry. |
| Pre-flight budget gate | `node hive/lib/budget-gate.js` runs BEFORE sandcastle. Manual dispatch is subject to the same gate — emergency override = edit `tokens.daily_usd_limit` in a separate PR. |
| Branch convention | One branch per epic (`feat/<epic-id>`), one commit per story. Worker uses `agent/issue-<n>` for its working branch. |
| Worker re-reads canonical YAML | Issue body is a snapshot, not source of truth. The S2 prompt re-reads `.pHive/epics/<epic>/stories/<story>.yaml` from the checked-out workspace before implementing. |

## Key config keys

| Key | Where | Purpose |
|---|---|---|
| `external_task_tracking.adapter` | `hive.config.yaml` | `github` enables /plan step 19a publish |
| `tokens.daily_usd_limit` | `hive.config.yaml` | USD cap read by budget-gate; unset → Infinity |
| `cron:` in workflow | `.github/workflows/hive-worker.yml` | Cadence; default `*/15 * * * *` |
| `inputs.issue_number` | workflow_dispatch | Optional; pins worker to a single issue |

## Key files

| File | Role |
|---|---|
| `hive/lib/external/github-issues-adapter.js` | S1 — story-YAML → GH Issue with labels |
| `skills/plan/SKILL.md` step 19a | S1 — calls adapter when `adapter: github` |
| `.sandcastle/prompts/worker-issue-pickup.md` | S2 — worker prompt body |
| `hive/lib/sandcastle-worker-schema.js` | S2 — Zod result schema (`Output.object`) |
| `hive/lib/sandcastle-worker-runner.js` | S2 — thin `sandcastle.run()` wrapper, CLI entry |
| `.github/workflows/hive-worker.yml` | S3 — cron + dispatch trigger |
| `hive/lib/budget-gate.js` | S3 — pre-flight USD-spend gate |
| `tests/budget-gate.test.js` | S3 — gate unit tests |

## Failure modes

| Mode | Surface | Action |
|---|---|---|
| Budget exceeded | Workflow run fails at budget-gate step | Wait for the next UTC day OR raise `daily_usd_limit` in a separate PR |
| Sandcastle image build fails | Workflow run fails at build step | Often network/Docker issue on the runner; rerun or move image to GHCR |
| Worker crashes mid-run | Workflow run fails; result.json may be missing | `hive:failed` label applied to the pinned issue if known; human review |
| Worker ships PR but PR review fails | PR opens, review surfaces issues | Standard review-fix-merge loop; loop does not auto-retry |
| Two cron firings within 15 min | Concurrency queues the second | First completes, second runs against current state |

## Observability

- **Per-run:** `result.json` uploaded as artifact `worker-result`; step summary on the workflow run page mirrors the same JSON.
- **Daily spend:** `node hive/lib/budget-gate.js` from any checkout prints today's running spend.
- **Outcome metric:** `autonomous_stories_closed` — count of `hive:story`-labeled issues closed via PR opened by the worker in the 14-day window after merge. Target floor is 3 (≥1 round-trip more than once). Tune up after the first observation window.

## When to walk away from this loop

- Cold-start image build cost matters → pre-build to GHCR + a separate publish workflow.
- 15-min cadence is too aggressive or too slow → adjust the `cron:` line; first-week observation tunes it.
- Need parallel pickup → remove `concurrency.group` (NOT recommended at v1 — branch collisions, double-PRs).
- Need a non-GitHub tracker → write a tracker adapter conforming to the Epic C ABI; this loop is GH Issues-shaped at v1.
