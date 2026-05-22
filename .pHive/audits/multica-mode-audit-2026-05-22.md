# Multica Execute-Mode Audit — 2026-05-22

**Audit scope:** `execute-mode-multica` skill + workspace / daemon configuration
**Date:** 2026-05-22
**Author:** hive meta-team (Phase B2 input to epic team-cell-execution-mode)
**Epic:** `team-cell-execution-mode` (proposals + design discussion on file)

---

## Context

The `/hive:execute` skill supports two dispatch paths: session-mode (local
Claude Code session) and multica-mode (`execute-mode-multica`). This audit
was triggered by a dogfood run of the `story-loop-closure` epic under multica
mode. Five of six stories required manual salvage; one story (s1-3, CI
workflow file) was unsalvageable. The audit captures the deviation between
intended and actual behavior, records findings F1–F6, and specifies
remediations. Epic `team-cell-execution-mode` closes these findings inline.

---

## Reality vs intent

| Dimension | Intent | Reality (2026-05-22 run) |
|---|---|---|
| Persona split | researcher → developer → tester → reviewer → developer (5 distinct roles) | Single `developer` per whole story (all five phases collapsed) |
| Backend routing | researcher/developer/architect/technical-writer → Codex; tester/reviewer → Claude | All Sonnet, Codex idle |
| Push target | `feat/{epic}` on firefly-events/plugin-hive | Mixed: `feat/`, orphan, and lost pushes |
| Workspace clone | firefly-events/plugin-hive via configured project | Nova36/plugin-hive (stale binding) on one dispatch path |
| Insight capture | Per-phase episode markers at `.pHive/episodes/{epic}/{story}/{phase}.yaml` | Zero per-phase markers; multica-run markers only when manually salvaged |
| CI-touching stories | Succeed (`.github/workflows/**` push included in PR) | Unsalvageable (OAuth `workflow` scope absent from daemon GH token) |

---

## Findings

### F1 — Stale workspace repo binding

**Severity:** High
**Symptom:** Daemon log shows `repo checkout readiness failed … url=https://github.com/Nova36/plugin-hive`. One dispatch path resolved the repo binding to the Nova36 clone rather than the firefly-events canonical fork. Tasks on that path pushed commits nowhere useful and required manual salvage.

**Root cause:** The daemon resolves the repo via `project_id` on the issue. When an issue was created without a configured `project_id`, the daemon fell back to a stale workspace-level binding pointing to the Nova36 clone.

**Evidence:** Daemon log lines (research-brief §5.3) — `url=Nova36/plugin-hive error="repo is not configured for this workspace"` before fix; `url=firefly-events/plugin-hive branch=agent/developer/<task>` after.

**Remediation (story tce-10):** `dispatchStoryToAgent` hard-blocks if resolved `project_id` is null before creating any child issue. Error code `PROJECT_ID_REQUIRED`. Block added at the skill layer so the failure is surfaced before any Multica API call is made.

**Status:** CLOSED — implemented in epic `team-cell-execution-mode` via story `tce-10-dispatch-null-project-hardblock`.

---

### F2 — Single-developer dispatch bypasses persona split

**Severity:** High
**Symptom:** Every story dispatched as `developer`, running all five workflow-phases in one agent session. Persona split, backend routing, and cross-LLM verification all collapsed.

**Root cause:** `execute-mode-multica` dispatched one issue per story and assigned it to the workspace `developer` agent. No cell composition logic existed to fan out per-phase child issues to role-correct agents.

**Remediation (epic team-cell-execution-mode, slices 1–4):** The new cell mode creates one parent issue + N child issues (one per resolved workflow-phase). The `cell-roster-resolver` resolves the per-story roster. Each child is assigned to the role-correct agent persona with the correct backend runtime.

**Status:** CLOSED — addressed by epic `team-cell-execution-mode` (slices 1–4: bootstrap routing, resolver, episode shape, skill rewrite).

---

### F3 — No `/hive:execute` orchestration ran

**Severity:** Medium
**Symptom:** Stories were dispatched via direct `multica issue create` invocations, bypassing the `/hive:execute` orchestrator and the dispatch atom. Episode markers were not written; story status tracking was manual.

**Root cause:** The operator ran `multica issue create` directly rather than invoking `/hive:execute`. The skill was not invoked, so none of its dispatch logic, brief injection, or marker writing ran.

**Remediation:** No code change required. The fix is operational: always invoke `/hive:execute` rather than issuing raw Multica CLI commands. Epic slices include end-to-end verification that the skill dispatch path is exercised (slice-7 dogfood gate).

**Status:** CLOSED — operational fix. Epic slice-7 adds a dogfood acceptance gate that exercises the full `/hive:execute` path.

---

### F4 — Inconsistent push behavior across agent tasks

**Severity:** High
**Symptom:** Push targets mixed across tasks: some pushed to `feat/{epic}` correctly, some to orphan branches, and some were lost (no evidence of push). Audit §Reality vs intent "Push target" row shows "Mixed: feat, orphan, lost".

**Root cause:** Brief footer contained a push-target instruction, but agents disobeyed it twice. No enforcement existed post-task to verify the push actually landed on `feat/{epic}`.

**Evidence:** Salvaged commit `9856fe5` (story s1-2) — pushed to `feat/story-loop-closure` (correct). Other tasks: orphan branch or no push confirmed.

**Remediation (stories tce-11 + tce-12):**
- `tce-11` — Brief footer updated to include an explicit `feat/{epic}` push constraint with failure consequences stated.
- `tce-12` — Post-phase push verifier runs after each child task terminates; it inspects the task's `work_dir` branch and fails the phase with `failed` (not `escalated`) if the branch is not `feat/{epic}`. Phase is eligible for retry per `max_step_retries`.

**Status:** CLOSED — implemented in epic `team-cell-execution-mode` via stories `tce-11-brief-footer-push-constraint` and `tce-12-post-phase-push-verifier`.

---

### F5 — Multica CLI's OAuth token lacks `workflow` scope

**Severity:** High
**Symptom:** Story s1-3 (CI workflow file — `.github/workflows/hive-dispatch.yml`) was unsalvageable. The daemon's GH OAuth token lacked the `workflow` scope, so any push touching `.github/workflows/**` files was rejected by GitHub.

**Root cause:** The initial `multica setup` / `multica login` OAuth flow did not request the `workflow` scope. The scope is not included by default in the Multica GH app OAuth grant.

**Evidence:** Research-brief §6.2 — "Audit F5 symptom: pushes fail on `.github/workflows/**` files — `workflow` OAuth scope absent on the daemon's GH token."

**Remediation (chore PR — tce-0):** EXTRACTED from this epic per design §10 C1. A separate prerequisite chore PR (`multica:auth-refresh-workflow-scope`) documents the operator runbook: re-run `multica setup` with the `workflow` scope checkbox checked. This is a one-time manual step per workspace. Epic slice-0 includes scope-detection logic that halts with a clear runbook line if `workflow` scope is still absent before any CI-touching dispatch proceeds.

**Status:** CLOSED — closed via chore PR documented in story `tce-0-f5-oauth-scope-prereq`. Scope fix is operator-interactive; epic slice-0 adds detection.

---

### F6 — Workspace agent commit identity drift

**Severity:** Low (cosmetic; breaks contribution-graph attribution)
**Symptom:** Salvaged commit `9856fe5` (story s1-2) authored as `Nova36 <don.matthews.iii@gmail.com>` — not `hive-worker <hive-worker@noreply.github.com>`. The agent inherited the OS-level git config of the host user (`~/.gitconfig`) rather than the canonical hive-worker identity.

**Root cause:** `hive/lib/multica-bootstrap/index.mjs` `buildAgentPayload` did not set any git identity env vars. The `custom_env` field on all agents defaulted to `{}`. The daemon's task runner inherits `user.name` / `user.email` from the parent clone's git config, which carried the maintainer's identity from the pre-OSS Nova36 era.

**Evidence:** Research-brief §7.2 — "`custom_env` could carry `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`, but no current agents-config sets them."

**Remediation (story tce-3):** Bootstrap reconciliation (`tce-3-bootstrap-reconciliation-tests`) injects `custom_env: {GIT_AUTHOR_NAME: "hive-worker", GIT_AUTHOR_EMAIL: "hive-worker@noreply.github.com"}` for all workspace agents at the bootstrap call site (`hive/lib/multica-bootstrap/index.mjs` `buildAgentPayload`). Per-role override is available. Default applies to all 13 personas reconciled in slice-1.

**Status:** CLOSED — implemented in epic `team-cell-execution-mode` via story `tce-3-bootstrap-reconciliation-tests`.

---

## Salvage record (2026-05-22 dogfood run)

| Story | Outcome | Notes |
|---|---|---|
| s1-1 | Manually salvaged | Commit pushed to feat/story-loop-closure by operator |
| s1-2 | Manually salvaged | Commit `9856fe5`; authored as Nova36 (F6) |
| s1-3 | Unsalvageable | `.github/workflows/**` push rejected; F5 |
| s2-1 | Manually salvaged | Closer-on-merge logic extracted + shipped separately |
| s3-1 | Manually salvaged | |
| s3-2 | Manually salvaged | |

5 of 6 stories required manual salvage. 1 story unsalvageable (F5).

---

## Recommended follow-ons

These were recorded as the audit's open action items. Each is now tracked
as a story in epic `team-cell-execution-mode`.

1. **F1 hard-block** — dispatch refuses null `project_id`. → `tce-10` (CLOSED)
2. **F4 push enforcement** — brief footer + post-phase verifier. → `tce-11` + `tce-12` (CLOSED)
3. **F6 git identity injection** — `custom_env` at bootstrap. → `tce-3` (CLOSED)
4. **F5 OAuth scope** — prerequisite chore PR runbook. → `tce-0` chore PR (CLOSED)
5. **F2 persona split** — cell mode with per-phase child issues. → Slices 1–4 of `team-cell-execution-mode` (CLOSED)
6. **F3 orchestration bypass** — operational fix + dogfood gate. → Epic slice-7 acceptance gate (CLOSED)

**F1 + F4 + F6 bundle note (tce-13):** These three findings were fixed
inline with the new cell mode rather than as piecemeal patches, per
`feedback_scope_class_changes` ("bigger deal = a new mode"). The reconciliation
pass (story `tce-13`) confirms the bundle is coherent: F1 lives in the skill
layer (tce-10), F4 lives in the brief footer + verifier (tce-11/tce-12), F6
lives in the bootstrap layer (tce-3). The integration test in
`tests/multica-cell-mode-audit-bundle.test.js` verifies F4 + F5 + F6 exercised
together in one CI-touching story run.

**F5 note:** F5 is NOT closed by this epic's code. It requires the operator
to re-authenticate Multica with the `workflow` OAuth scope. See `tce-0` for
the runbook. Epic slice-0 adds detection; slice-7 dogfood gate requires
`workflow` scope to be present before the acceptance run.
