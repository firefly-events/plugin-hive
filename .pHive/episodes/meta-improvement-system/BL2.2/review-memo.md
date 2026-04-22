# BL2.2 Review Memo — Orchestrate the Rewritten Control Plane from the Maintainer Skill

**Reviewer:** Opus 4.7
**Date:** 2026-04-22
**Artifact under review:** `/Users/don/Documents/plugin-hive/maintainer-skills/meta-meta-optimize/SKILL.md` (181 lines)
**Tests:** `/Users/don/Documents/plugin-hive/tests/meta_meta/test_skill_orchestration.py` — 9/9 green

## Verdict

**`passed`** — the skill is a clean thin orchestrator over the rewritten control plane, delegates to step files and shared-library handoffs, defaults to worktree isolation, preserves the non-bypassable close gate, and keeps BL2.3/BL2.4 wiring points open without boxing them out.

## Per-dimension scores

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 1 | Thin-orchestrator boundary | 5 | Every step section says "Load and follow `step-0N…md`"; no step logic inlined. |
| 2 | Two-swarm fidelity | 5 | Explicit "maintainer swarm" scoping; PR-flow, `/meta-optimize`, and public shipping all forbidden (SKILL.md:21, 162). Dry-run language retired (SKILL.md:14). |
| 3 | Worktree-default correctness | 5 | Lifecycle create→steps 4–6→promote@7→remove@8 specified coherently (SKILL.md:35-44). Cleanup correctly gated on close success (SKILL.md:135-144). |
| 4 | Shared-library dependency discipline | 5 | All six modules named with clean handoff points (SKILL.md:46-54); "must not reimplement" list nails it (SKILL.md:163). |
| 5 | Close-gate non-bypassability | 5 | `closure_validator.validate_closable(envelope)` named at SKILL.md:131, flagged non-bypassable, no escape hatch. |
| 6 | Failure-mode completeness | 4 | Three modes present and worded as stop actions (SKILL.md:152-156). Minor: "promotion failure" narrative uses the generic `PromotionFailure` keyword but does not name the two adapter sub-reasons (needs_revision vs. cherry-pick failure) — acceptable at skill layer. |
| 7 | Step 3/3b branching clarity | 5 | "when metric signal is present" vs "If there is no metric signal" is unambiguous; "Do not run both branches for the same cycle" closes the loophole (SKILL.md:82-86). |
| 8 | Test coverage sufficiency | 4 | 9 text-inspection tests cover all 4 ACs and are tightly aligned with the rubric. Coverage upgrade noted below. |
| 9 | BL2.3/BL2.4 forward compatibility | 5 | baseline→BL2.3 stop condition explicit (SKILL.md:50, 72); rollback_watch→BL2.4 left as post-cycle concern without implementation (SKILL.md:52). |

**Average:** 4.78 / 5.

## Findings

### Strengths

- **SKILL.md:14** — explicit "Dry-run mode is retired" statement kills the scaffold-era ambiguity that AC1 demands.
- **SKILL.md:20-22** — scope boundaries lock path, packaging, and promotion semantics in one block.
- **SKILL.md:24-32** — preconditions section is executable (not narrative); "If the backlog is missing or empty, stop immediately with `status: no_candidate`" is the correct explicit stop action.
- **SKILL.md:37** — "Worktree isolation is the default and MANDATORY path" — Q4 worded as policy, not suggestion.
- **SKILL.md:106-126** — step-07 promotion section cleanly separates the success envelope writes (`commit_ref`, `rollback_target`, insights staging) from the `PromotionFailure` discard path.
- **SKILL.md:158-165** — the "What This Skill Must Not Do" block is the single best anti-drift control in the document; it reifies every boundary from scope lock to close-gate non-bypass into one enforceable list.
- Test design choice: text-inspection tests run in 0.01s, making them cheap enough to keep the regression bar high forever; this matches the shipped-skill style benchmark.

### Minor observations (not blockers)

1. **SKILL.md:52** — `rollback_watch` is correctly marked BL2.4-territory, but the skill does not name WHERE the rollback trigger lives post-cycle (orchestrator? cron? next maintainer run?). Leaving that for BL2.4 is fine; just flagging that BL2.4 will need to answer it.
2. **SKILL.md:117** — "capture `rollback_target` and store it in the envelope as the cycle rollback reference" uses `rollback_target` in narrative, while close gate checks `rollback_ref` (SKILL.md:133). Adapter returns `PromotionResult.rollback_target`, envelope persists as `rollback_ref`. The name-translation is done implicitly. Consider (BL2.3) adding one-line clarification "(stored as envelope `rollback_ref`)" to make the field mapping explicit.
3. **Test coverage upgrade (non-blocking, for BL2.3 authors):** current tests are pure text-inspection. A lightweight test that parses the SKILL.md step-file list and asserts each referenced `step-0N-…md` exists on disk would catch the class of regression where a step file is renamed or removed without updating the skill. One new test, maybe 6 lines. Cheap insurance.
4. **SKILL.md:91** — step-04 says "use the shared-library handoffs already established by boot rather than ad hoc lifecycle state." The word "handoffs" is used both for inputs (envelope already populated) and for module names (the 6 shared modules). Not confusing enough to block, but a BL2.3 copy-edit could distinguish "handoff modules" vs "handoff artifacts."
5. **research-brief §9 open question 2** — "Workflow orchestrator invocation API is not specified." The skill resolves this by saying "Load and follow `step-0N…md`" — i.e., treating step files as instructions the orchestrator executes in-band rather than a Python-callable workflow function. That is the right call for a Claude-Code-plugin skill, but the brief's open question is worth explicitly closing in the BL2.2 slice summary so downstream stories know not to reopen it.

### What was NOT violated (explicit non-findings)

- No step-specific logic leaks into the skill (step files are loaded by reference, not quoted).
- No surviving single-swarm language. "meta-team" appears only in path literals (`.pHive/meta-team/worktrees/`, `queue-meta-meta-optimize`, `charter`), which is historical-path preservation, not a logical single-swarm assumption.
- No residual dry-run scaffold wording.
- No implied close-gate escape hatch. Both SKILL.md:131 ("non-bypassable") and SKILL.md:164 ("Bypass `closure_validator.validate_closable(envelope)` … [MUST NOT]") close every obvious bypass.
- Step 3/3b cannot both run — "Do not run both branches for the same cycle" (SKILL.md:86) is binding.

## Acceptance-criteria trace

| AC | Evidence |
|----|----------|
| AC1: skill invokes rewritten control plane, not dry-run scaffold | SKILL.md:14 ("Dry-run mode is retired"), entire §Live Cycle (SKILL.md:56-144) loads real step files. `test_skill_references_all_eight_steps` enforces. |
| AC2: worktree-default + shared lifecycle library | SKILL.md:34-44 + SKILL.md:46-54 + SKILL.md:163 (must-not-reimplement list). `test_skill_defaults_to_worktree`, `test_skill_references_shared_library`, `test_skill_names_direct_commit_adapter` enforce. |
| AC3: no single-swarm / public-shipping revival | SKILL.md:20-22 (scope boundaries) + SKILL.md:158-165 (must-not list) + `test_skill_forbids_public_shipping`, `test_skill_preserves_two_swarm_boundary` enforce. |
| AC4: orchestration live, proof capture deferred | SKILL.md:50 + SKILL.md:72 (BL2.3 baseline stop condition) + SKILL.md:52 (BL2.4 rollback_watch deferred). `test_skill_defers_proof_artifact_capture_to_later_stories` enforces. |

All four ACs satisfied.

## Recommendation

Advance to integrate. The minor observations above are follow-ups for BL2.3 copy-editing, not pre-integrate blockers. No `needs_optimization` follow-ups required; no `needs_revision` required changes.

## Signed off

Reviewer: Opus 4.7 — 2026-04-22.
