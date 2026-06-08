# Disposition Audit — multica-plan-test-cycles

**Audit date:** 2026-06-02
**Audit method:** git+disk over YAML status (per feedback_story_status_stale); Q3 default keep-as-second-party for first release.
**Shipped via:** PR #234 (merged 2026-05-28)

## Per-story dispositions

| Story ID | Candidate | Rationale | Git+disk evidence |
| --- | --- | --- | --- |
| mpt-1-squad-cell-dispatch-spike | keep-as-second-party | Spike picked the downstream carrier for Multica planning/test dispatch; keep as second-party substrate knowledge for the first release. | 951d931 (`.pHive/epics/multica-plan-test-cycles/research/squad-dispatch-spike.md`); PR #234 merge 432bad2. |
| mpt-2-scenario-schema-reconcile | keep-as-second-party | Reconciles simulated-manual scenario shape before Multica consumes scenarios; this is shared substrate for the routed test path. | 7deb30f (`hive/lib/scenarios/load.mjs`, `hive/lib/scenarios/__tests__/load.test.mjs`, `hive/references/test-scenario-schema.md`, `.pHive/test-scenarios/h-03-standup-format-slack-manual.yaml`); PR #234 merge 432bad2. |
| mpt-3-verdict-home-and-agent-name | keep-as-second-party | Pins story-YAML `manual_verdict` and `tester` naming used by local and Multica simulated-manual flows. | aee77c3 (`skills/test/SKILL.md`, `hive/workflows/steps/test/simulated-manual.md`, `hive/references/story-yaml-schema.md`); PR #234 merge 432bad2. |
| mpt-4-doc-verdict-done-signal-marker | keep-as-second-party | Adds the doc/verdict completion dialect so non-code-push Multica plan/test work can reach terminal. | ea7d69e (`hive/lib/multica-story-dispatch/episode-sync.mjs`, `hive/references/episode-schema.md`); PR #234 merge 432bad2. |
| mpt-5-dispatch-carrier-helper | keep-as-second-party | Adds the per-persona dispatch carrier helper selected by the spike, preserving persona identity and backend split. | a4a1018 (`hive/lib/multica-story-dispatch/index.mjs`, `hive/lib/multica-story-dispatch/__tests__/dispatch-carrier.test.mjs`); PR #234 merge 432bad2. |
| mpt-6-plan-mode-multica-skill | keep-as-second-party | Provides the atomic `plan-mode-multica` skill selected by `HIVE_PLANNING_MODE=multica` or `planning.mode: multica`. | 966b2cd (`skills/hive/skills/plan-mode-multica/SKILL.md`); PR #234 merge 432bad2. |
| mpt-7-planning-routing-multica-path | keep-as-second-party | Adds `multica` as a planning-routing spawn path with fallback vocabulary feeding `plan-mode-multica`. | 273dbf8 (`skills/hive/skills/planning-routing/SKILL.md`); PR #234 merge 432bad2. |
| mpt-8-wire-plan-phase0 | keep-as-second-party | Wires `/plan` Phase 0 to select the Multica planning path while keeping user review gates local. | e3dfdda (`skills/plan/SKILL.md`); dogfood checkpoint in `.pHive/epics/multica-plan-test-cycles/research/full-cycle-dogfood.md`; PR #234 merge 432bad2. |
| mpt-9-test-mode-multica-skill | keep-as-second-party | Provides the atomic `test-mode-multica` skill for simulated-manual dispatch to the Multica `tester`. | b5d9e80 (`skills/hive/skills/test-mode-multica/SKILL.md`); review follow-up 2096c14; PR #234 merge 432bad2. |
| mpt-10-wire-test-simulated-manual | keep-as-second-party | Wires `/test --simulated-manual` mode selection to `test-mode-multica` with local fallback when unset. | c31ba62 (`skills/test/SKILL.md`, `hive/workflows/steps/test/simulated-manual.md`); review follow-up 2096c14; PR #234 merge 432bad2. |
| mpt-11-full-cycle-dogfood | keep-as-second-party | Records the throwaway plan->execute->test dogfood run validating the routed cycle and branch discipline. | 3ad2303 (`.pHive/epics/multica-plan-test-cycles/research/full-cycle-dogfood.md`); review follow-up 2096c14; PR #234 merge 432bad2. |

## Load-bearing stories
- mpt-10-wire-test-simulated-manual: Phase 5 routes `/test --simulated-manual` by resolving the scenario first, then selecting Multica when `HIVE_TEST_MODE=multica` or root `hive.config.yaml` has `test.mode: multica`. `skills/test/SKILL.md` delegates selected runs to `skills/hive/skills/test-mode-multica/SKILL.md`; `hive/workflows/steps/test/simulated-manual.md` mirrors the branch and keeps the existing local executor as the unset-mode fallback. The Multica atom assigns one issue to the concrete `tester` agent, writes the story-YAML `manual_verdict`, and records the shared doc/verdict `multica-run.yaml` marker.
- mpt-8-wire-plan-phase0: `/plan` Phase 0 resolves `HIVE_PLANNING_MODE=multica` or root `planning.mode: multica`, passes that decision into `planning-routing`, and routes the assembled planning cell through `plan-mode-multica`. `planning-routing` calls `skills/hive/skills/plan-mode-multica/SKILL.md` for Multica personas; that atom fans out one Multica issue per persona via `dispatchStoryToPersonas`, polls to terminal, and writes per-persona doc/verdict markers. `skills/plan/SKILL.md` keeps design-discussion and structured-outline review gates local to the orchestrator.

## Defaults + deviations
- Default: keep-as-second-party (Q3)
- Any deviation requires explicit rationale citing git evidence.
