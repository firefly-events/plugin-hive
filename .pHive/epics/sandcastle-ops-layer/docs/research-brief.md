# Research Brief — Sandcastle Ops Layer

**Epic:** sandcastle-ops-layer
**Source:** distilled from `.pHive/research-drafts/2026-05-15-sandcastle-ops-layer-plan.md` v2 + sandcastle spike findings (`.pHive/spikes/sandcastle/research-findings.md`) + Linear adapter precedent in `hive.config.yaml`.

## Tech-stack constraints

- **Project:** plugin-hive itself, on `dev/hive-2.0` branch family
- **Runtime:** Node.js (hive/lib/*.js — CJS)
- **Sandcastle version:** `@ai-hero/sandcastle` already vendored in `.pHive/spikes/sandcastle/node_modules/`; production provider lives at `hive/lib/sandcastle-provider.js`
- **CI:** GitHub Actions; existing workflow `.github/workflows/ci.yml`
- **CLI deps:** `gh` (auth verified on host); `jq` (available); `git`
- **Existing adapter pattern:** `hive.config.yaml.external_task_tracking` slot currently Linear-shaped — generalize to support `github` adapter

## Sandcastle primitives we lean on (no rewrite)

| Need | Sandcastle native | Source |
|---|---|---|
| Issue list pickup | `!`gh issue list ...`` in prompt template at render time | `.sandcastle/prompt.md` ships example |
| Per-issue branch | `branchStrategy: { type: "branch", branch: "agent/issue-<n>" }` | spike findings §2.8 |
| Structured result | `Output.object(zodSchema)` w/ Zod | spike §2.9 |
| Early termination | `completionSignal: "<promise>COMPLETE</promise>"` (default) | spike §2.10 |
| Session capture | default-on for `claudeCode()`; JSONL → `~/.claude/projects/...` w/ cwd rewrite | spike §2.11, §6 |
| Iteration cap | `maxIterations: N` (spike validated 5) | spike §2.1 |
| Setup hooks | `hooks.host.onWorktreeReady`, `hooks.sandbox.onSandboxReady` | spike §2.7 |
| Log redaction | already integrated via `hive/lib/sandcastle-log-redaction.js` | merged on feat/sandcastle-redaction-hyphenated |

## What sandcastle does NOT provide (caller-owned)

- Scheduler / cron loop — caller invokes `sandcastle run`
- Concurrency policy — caller decides parallel/serial
- Failure routing — caller reads `Output.object` result and acts

## Existing patterns to extend

- **External-task-tracking adapter shape** — `hive.config.yaml.external_task_tracking.adapter: linear | github`. Current Linear config: `linear_user_id`, `linear_team_id`, etc. New GitHub adapter: `github_owner`, `github_repo`, label namespace defaults (`hive:ready`, `hive:in-flight`, `hive:failed`, `hive:epic:<id>`, `hive:story:<id>`, `hive:blocked-by:<id>`)
- **Token-budget gate** — `hive.config.yaml.token_budget_limits` (existing). Pre-spawn check reads daily-spend telemetry from `.pHive/metrics/events/*.jsonl`
- **Branch convention** — one branch per epic, one commit per story (memory: `feedback_git_flow_per_epic`). Worker branches `agent/issue-<n>` get merged into the epic branch by sandcastle's branch-strategy

## Key files / patterns referenced

- `hive/lib/sandcastle-provider.js` — production sandcastle wrapper (consumed by execute-mode-sandcastle)
- `hive/lib/sandcastle-log-redaction.js` — already wraps log output for the adapter
- `.sandcastle/prompt.md` — template with the `!`command`` pattern; ships as example
- `skills/plan/SKILL.md` — `/plan` post-step hook point (line range TBD by S1 dev)
- `hive.config.yaml` — `external_task_tracking`, `token_budget_limits`, `agent_backends`
- `hive/references/sandcastle-adoption-guide.md` — section 3 on routing, section 10 warm pool deferred
- `.github/workflows/ci.yml` — existing CI; new workflow `hive-worker.yml` co-located

## Open risks

1. **`gh` auth in GH Actions** — `GITHUB_TOKEN` default permissions need `issues:write`, `pulls:write`, `contents:write`. Add explicit `permissions:` block to workflow
2. **Container runtime in CI** — sandcastle defaults to Docker/Podman. GH Actions ubuntu-latest ships Docker. Sandcastle image must be buildable in CI, or use pre-built image cached
3. **Token-budget gate timing** — must run BEFORE sandcastle invocation; budget telemetry comes from `.pHive/metrics/events/`; needs single source of truth for "today's spend"
4. **Spec drift** — issue body snapshots story YAML; worker re-reads YAML inside sandbox at runtime (`!`cat .pHive/epics/...``) so always uses latest. Confirmed safe pattern
5. **Concurrency** — start serial via GH Actions concurrency group `hive-worker` w/ `cancel-in-progress: false`. Parallel deferred
6. **First-failure routing** — auto-retry once vs human-on-first-fail — locked to **human-on-first-fail** (label `hive:failed`)

## Validation note

- **context7:** N/A — sandcastle has no Context7 entry; spike research is authoritative
- **Sandcastle README:** read directly from `.pHive/spikes/sandcastle/node_modules/@ai-hero/sandcastle/`; prompt-template `!`command`` syntax verified in shipped `.sandcastle/prompt.md`
- **Confidence:** high — every primitive used here was validated in sandcastle spike s1
