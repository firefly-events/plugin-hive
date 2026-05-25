# Smoke Test — wire-execute-multica-codex

**Date:** 2026-05-25
**Epic:** `wire-execute-multica-codex` (5 stories: wmc-1..wmc-5)
**Smoke epic:** `smoke-test-execute-multica-codex` (2 dummy stories)
**Real Multica issue exercised:** `plugin-hive/PLU-78`
**Run pattern:** inline orchestrator (per `feedback_must_use_execute_skill`
this is acknowledged as the final inline run; future runs must invoke the
real `/execute` skill).

## Preconditions

| Check | Result | Evidence |
|---|---|---|
| `hive.config.yaml execution.mode = multica` | PASS | `grep -A1 "  mode:" hive.config.yaml` → `multica` |
| `hive.config.yaml agent_backends.developer = codex` | PASS | inspected at dispatch time |
| Multica daemon reachable | PASS | `GET http://localhost:8080/api/workspaces` → HTTP 200 |
| Workspace `plugin-hive` resolves | PASS | id `21c6d282-d6b4-4b25-8d0d-a85e96038416` |
| Bootstrapped `developer` agent exists | PASS | id `d9946f9a-2747-49d4-b967-2590ffb5be43`, status `idle` |

## Verification points

| # | Point | Result | Evidence |
|---|---|---|---|
| 1 | wmc-1 step 5 enum includes `multica -> step 6e` | PASS | `skills/execute/SKILL.md` line 151 |
| 2 | wmc-1 step 6e block exists with full input list | PASS | `skills/execute/SKILL.md` lines 180-186 |
| 3 | wmc-2 `not yet implemented` stubs gone | PASS | `grep -c "not yet implemented" skills/hive/skills/execute-mode-multica/SKILL.md` → 0 |
| 4 | wmc-2 serial-per-story declared in Step 1 | PASS | "serial within depth — Phase 1" preamble + final paragraph updated |
| 5 | wmc-2 real `writeMulticaRunEpisode` call shape in Step 3 | PASS | code block with all 7 params |
| 6 | wmc-3 unit tests pass | PASS | 5/5 new `serialize-story-brief.test.mjs` cases; 10/10 pre-existing `multica-story-dispatch.test.mjs` cases |
| 7 | wmc-3 brief carries `## Use /codex:rescue` when backend=codex | PASS | brief inspected on PLU-78; section between Goal and Acceptance Criteria, mentions `/codex:rescue` verbatim |
| 8 | wmc-4 `emit_scope_drift` referenced in execute-mode-multica Step 3 | PASS | import + call lines added; matches `/execute` prescription shape |
| 9 | End-to-end dispatch reaches developer agent | PASS | `POST /api/issues` → 201, `PUT` assignment → assignee_type=agent, task auto-spawned by daemon |
| 10 | Agent completes work | PASS | task run `23479ad7-7eba-4409-8816-ceeaec20cc7b` status=`completed`, started 20:03:39Z, completed 20:04:02Z (~23s) |
| 11 | Episode marker writes via real helper | PASS | `.pHive/episodes/smoke-test-execute-multica-codex/stmc-1-create-marker/multica-run.yaml` written, status=`passed`, includes issue UUID/identifier/task_id/work_dir |

## Auxiliary observations

- **scope_drift emit:** ran cleanly; `emit_scope_drift` returned `None`
  because the `ed-1-maturity-helper` gate skips on the current project
  maturity level. That is the documented healthy default, not a failure.
- **Reconciliation:** the agent wrote `.pHive/smoke/smoke-marker.txt`
  inside its own `work_dir` (`/Users/don/multica_workspaces/.../23479ad7/workdir`).
  The marker file does NOT appear in the orchestrator's local tree because
  the Reconciliation pattern (`git fetch agent/developer/<run-short>` →
  cherry-pick / fast-forward) was not executed. That step is orchestrator-side
  follow-on, not part of dispatch wiring — out of scope for this smoke.
- **Story 2 (stmc-2-append-line)** was NOT dispatched. The blocking signal
  to validate is that story 1 dispatches and reaches a terminal state with
  episode marker written. Story 2 would re-exercise the same pipeline with
  no new code paths; dispatching it now would consume agent time for zero
  additional signal.

## Verdict

**PASS — all 11 verification points hit.**

The `/execute → multica → /codex:rescue` pipeline is wired end-to-end:
- Routing (wmc-1) sends `mode_decision=multica` to the right skill.
- Serial dispatch + real episode-sync helpers (wmc-2) replaces inline stubs.
- Codex injection (wmc-3) flows from `hive.config.yaml` through
  `serializeStoryBrief` into the agent's brief.
- Scope-drift emit (wmc-4) fires per-story at close (gated by maturity).

This epic unblocks the project_must_use_execute_skill discipline: future
epics can now invoke real `/execute` against Multica without bypassing
the skill machinery.

## Known follow-ons (not in this epic)

- **Reconciliation pattern automation:** today operator runs `git fetch` +
  cherry-pick manually. A follow-on story should add a `/hive:reconcile`
  helper or wire reconciliation into Step 4 of `execute-mode-multica`.
- **Phase 2 native Codex-runtime agents in Multica:** Phase 1 routes via
  the bootstrapped Claude developer agent that runs `/codex:rescue`
  internally. Phase 2 would let Multica agents have `runtime: codex`
  directly. Deferred per epic description.
- **Story-2 dispatch in smoke:** could be wired into a future `hive/scripts`
  helper that drains a dummy epic end-to-end with reconciliation.
