# Design Discussion — Sandcastle Ops Layer

**Epic:** sandcastle-ops-layer
**Date:** 2026-05-15
**Source draft:** `.pHive/research-drafts/2026-05-15-sandcastle-ops-layer-plan.md` v2

## Goal

Close the autonomous-execution loop on top of the sandcastle runtime. Sandcastle is shipped; today it executes whatever prompt we hand it. To make it *do work without operator handholding*, we need three small additions:

1. A way for `/plan` to publish stories so an automated worker can pick them up — GitHub Issues with hive-namespaced labels
2. A worker prompt + result schema that lets sandcastle pick the highest-priority unblocked issue, work it, and report back
3. A scheduler (GitHub Actions cron) that invokes `sandcastle run` on a cadence

This finishes the operational loop sandcastle was a prerequisite for. It is not a "shift" — it is the rest of the existing roadmap, now executable because sandcastle is on `main`.

## Proposed approach

### Slice shape

Three stories, no inter-story coupling beyond linear dependency:

- **S1** — `github-issues-adapter` (Node lib) + `/plan` post-step that calls it
- **S2** — `worker-issue-pickup.md` prompt template + Zod result schema
- **S3** — `.github/workflows/hive-worker.yml` cron workflow + token-budget pre-flight gate

S1 unblocks S2 (worker needs labeled issues to exist). S2 unblocks S3 (cron needs a prompt to invoke).

### Sandcastle integration philosophy

**Minimum custom code; maximum native primitive use.** Concrete:

| Custom code | Why | Lines (est.) |
|---|---|---|
| `hive/lib/external/github-issues-adapter.js` | Map story YAML → `gh issue create` body+labels | ~150 |
| `/plan` post-step block | Iterate finalized stories, call adapter, write back `external_id` | ~50 |
| `.sandcastle/prompts/worker-issue-pickup.md` | The worker contract — `!`gh issue list`` + task | ~80 |
| Zod schema in `hive/lib/sandcastle-worker-schema.js` | `Output.object()` input | ~20 |
| `.github/workflows/hive-worker.yml` | Cron + budget gate | ~60 |
| Token-budget gate (`hive/lib/budget-gate.js` or inlined) | Read `.pHive/metrics/events/*.jsonl`, sum today, compare to limit | ~80 |

Total: ~440 lines across 6 files. No new abstractions.

**What we explicitly DO NOT build:**

- ❌ Custom dispatcher daemon — `sandcastle run` is the dispatcher; cron is the loop
- ❌ Branch-lease coordination — `branchStrategy: { type: "branch", branch: "agent/issue-<n>" }` gives unique branches per issue
- ❌ Worktree lifecycle — sandcastle owns it
- ❌ Session-capture wiring — sandcastle default-on
- ❌ Custom `/hive:dispatch` skill — prompt file IS the dispatch contract
- ❌ Per-issue retry/backoff state machine — sandcastle's `maxIterations: 5` bounds; failure marks `hive:failed`; humans review

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | `gh` auth scopes in GH Actions | medium | Workflow `permissions:` block: `issues: write`, `pull-requests: write`, `contents: write` |
| 2 | Sandcastle container build in CI | medium | Pre-build `sandcastle:hive-worker` image in separate workflow; cache; reference by tag |
| 3 | Token-budget telemetry drift | low | Single source: `.pHive/metrics/events/stop-*.jsonl`; gate reads same files orchestrator metrics hooks write |
| 4 | Issue body drift vs story YAML | low | Worker re-reads YAML at runtime via `!`cat`` in prompt; issue body = pointer, not source-of-truth |
| 5 | Concurrent workers racing same issue | low | GH Actions concurrency group + `hive:in-flight` label claim; serial v1 |
| 6 | Loop hang / runaway spend | medium | `maxIterations: 5`; budget gate before spawn; per-job `timeout-minutes:` in workflow |
| 7 | Worker can't open PR (e.g., gh auth) | medium | Worker emits `status: "failed"` + reason; result reaches caller; issue labeled `hive:failed`; no silent skip |
| 8 | First-failure human burden | low | Documented policy: human-on-first-fail. Burden is acceptable for v1; reconsider if signal is noisy |

## Dependencies

- **External:** none new. `gh`, `git`, `node`, sandcastle, GitHub Actions — all already in use
- **Internal:** sandcastle-provider on main ✅; log redaction on `feat/sandcastle-redaction-hyphenated` (in flight) ✅; `external_task_tracking` config slot exists ✅
- **Branch:** `dev/hive-2.0` (per stacked-PR convention since 2026-05-11)

## Open questions for user sign-off

All defaulted; user override welcome:

1. **Cadence:** 15-min cron (default) vs slower/faster?
2. **Concurrency cap:** serial (1 in-flight repo-wide) (default) vs serial per-epic with parallel across epics?
3. **First-failure policy:** human-on-first-fail (default) vs auto-retry once?
4. **Tracker scope:** GitHub-only v1 (default) vs generalize adapter for Linear in same epic?
5. **Worker prompt location:** `.sandcastle/prompts/worker-issue-pickup.md` (default) vs co-locate with `/plan` outputs?

## Scale assessment

**Medium.** Multi-file (~6 files), multi-layer (CI workflow + Node lib + sandbox prompt + config schema), but well-bounded. Spec is detailed enough that H/V can be brief and stories can carry full context.

## Recommended scope decision

**Medium with implicit `--fast` behavior** — spec already covers H/V-grade detail. TPM step compresses to a single sequencing pass + traceability. Stories generated immediately after this design discussion.

## Methodology

Default `classic` per `execution.default_methodology: classic`. Each story: research → implement → test → review → integrate.

Per-story methodology can override; nothing here suggests TDD/BDD is needed (worker prompt is content; adapter is integration; workflow is config — tests are integration-style).
