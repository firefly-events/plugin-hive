# Grill Record — team-cell-execution-mode

**Source draft:** `.pHive/epics/team-cell-execution-mode/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (research-brief §8 supplied 5 signals)
**Generated:** 2026-05-22T05:35:00Z

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 3 findings
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: 2 findings

## Vocabulary mismatches

The draft's §8 already anchors the 5 signals from the research brief. The two findings below are residual collisions that §8 does not cover.

- **V1** — "composer" reused for two different things.
  - Draft locations: §2.2 ("declarative composition in `hive/lib/team-cell-composer/`") and §2.2 implies the composer is a new code module. But planning-routing skill (`skills/hive/skills/planning-routing/SKILL.md`) Step 0.1 ALREADY does roster composition for the planning team — same job, different name.
  - Reference: `skills/hive/skills/planning-routing/SKILL.md` Step 0.1 "Build Team Composition" — calls itself "team composition" not "composer." Research brief §4.2 flagged this as the closest existing precedent.
  - Question for planner: Is `team-cell-composer` a generalization of planning-routing's roster builder, or a parallel concept? If generalization, refactor planning-routing onto the same lib. If parallel, pick a non-overlapping name (e.g. `cell-roster-resolver`).

- **V2** — "phase" usage inside §2.3 contradicts §8's resolution.
  - Draft location: §2.3 step 3 ("For each phase in roster order") and §2.5 R3 ("Reviewer-class agents are blocking by contract; failure = phase failed = story failed"). §8 says "Cell-internal phases are *workflow-phases*" but §2.3 uses bare "phase."
  - Reference: §8 self-rule.
  - Question for planner: substitute "workflow-phase" or "workflow-step" consistently in §2-7 to honor the §8 rule, or relax §8.

## Hidden assumptions

- **H1** — `writeMulticaRunEpisode` will accept per-phase invocation.
  - Draft location: §2.3 reuses `writeMulticaRunEpisode` as-is for per-phase markers; §2.5 F1 reuses existing dispatch path.
  - Why this matters: The function name says "multica-run" not "phase." Research §2.2 confirmed the existing marker is `multica-run.yaml` (one per story). Per-phase markers would be `multica-run-{phase}.yaml` or `research.yaml` / `implement.yaml` etc. — different shape, different schema constraints.
  - Question for planner: Will this be a thin wrapper that calls `writeMulticaRunEpisode` N times with different filenames, or does the function signature need a `phase` parameter? Either way, the design should declare which.

- **H2** — Per-persona runtime routing already exists in bootstrap.
  - Draft location: §2.4 "the bootstrap reconciliation … writes the correct runtime_id per persona; no per-dispatch routing logic needed."
  - Why this matters: Research §3.2 shows all 4 bootstrapped Multica agents share `runtime_id=0b8e2f02` (provider=claude, single Claude runtime). For codex routing to actually fire, researcher/developer/architect agents need `runtime_id` pointing at the codex runtime (`66507ebe`). The bootstrap reconciliation today reads `agent.persona_ref` and writes payload — but it does NOT consult `agent_backends` to pick a runtime. That code does not exist.
  - Question for planner: Slice-N must add `agent_backends → runtime_id` resolution to `hive/lib/multica-bootstrap/index.mjs`. Confirm that slice exists in the plan.

- **H3** — Brief-footer push constraint will be honored by agents.
  - Draft location: §2.5 F4 ("brief footer constrains push target to `feat/{epic}` only; `agent/developer/<task>` orphan branches forbidden").
  - Why this matters: Audit F4 shows agents already chose different push targets despite identical dispatch shape. A brief footer is advisory text; the agent may or may not follow it (especially under model variance). Footer-only is the same enforcement level that produced F4 in the first place.
  - Question for planner: Is footer the actual enforcement, or is there a post-task verification (e.g. orchestrator inspects the agent branch and fails the phase if push went to the wrong target)? Pick one; document explicitly.

## Unresolved tensions

- **U1** — Spike-then-commit vs commit-then-spike on primitive choice.
  - Draft location: §2.1 commits to Option (a) "by elimination" BEFORE the slice-0 spikes (§5 Q7, Q8). §6 then routes through "slice-0 spikes, slice-1 composer + cell YAMLs."
  - Tension: `feedback_test_offtheshelf_before_rewriting` says spike before committing. The design has already committed before the spike runs.
  - Question for planner: Should slice-0 be structured as "spike all three options, then commit," with slice-1 contingent on the spike result? Or stand by the commit and use slice-0 spikes only to characterize fallback paths? The latter is defensible (option a evidence is strong) but should be stated explicitly.

- **U2** — Phase-failure policy unclear (skip / retry / fail-story).
  - Draft locations: §2.3 step 3e ("fail-fast — no further phases dispatched"), §3 R3 ("Reviewer-class agents are blocking by contract; failure = phase failed = story failed = retry per `max_step_retries` (2)"), §5 Q2 (optional security-reviewer failure: "Recommend: block; failed optional is an escalation signal").
  - Tension: §2.3 says fail-fast (no retry mentioned). §3 R3 says retry-2 then story-fail. §5 Q2 says block on optional failure. Three behaviors, one mechanism.
  - Question for planner: Define one failure policy table — `core_phase_fail`, `optional_phase_fail`, `repeated_phase_fail`, `circuit_breaker_hit` — with the action for each. The current design has overlapping behaviors in three sections that don't agree.

## Convention violations

- **C1** — Audit-fix bundling risks slice coupling.
  - Draft location: §2.5 bundles F1, F4, F5, F6 inline with the new mode.
  - Convention: `feedback_admin_merge_leaks_lint_debt` warns about piling fixes into unrelated work because it leaks debt to the next PR. F5 specifically requires a USER-INTERACTIVE OAuth flow (research §6.2 — Multica CLI's GH OAuth needs re-auth with `workflow` scope). Bundling a user-interactive step inside an autonomous-execution epic creates a slice-0 hard-block that pauses for human input.
  - Reference: `feedback_admin_merge_leaks_lint_debt`, plus `feedback_scope_class_changes` (bigger deal = new skill, not more lines in same file).
  - Question for planner: Should F5 (token scope) be a separate prerequisite chore — a one-off `multica:auth-refresh-workflow-scope` chore PR that runs once, then this epic assumes the scope exists? That keeps this epic's slice-0 fully autonomous-spikeable.

## Posture mismatches

- **P1** — Hard-block on null project_id contradicts the gate-warning posture.
  - Draft location: §2.5 F1 ("dispatch refuses to fan out if `project_id` on the parent issue is null").
  - Reference: CONTEXT.md "Kickoff Gate — initialization check… Five read-only-shaped skill modes lift the gate to a warning instead of hard-blocking." The trend in the codebase is warning-with-defaults, not hard-block.
  - Question for planner: Should the missing-project case warn and proceed with a workspace-default project (auto-create if missing, per a relaxed F1 fix), or stay hard-block as the design has it? Either is defensible; pick one and explain.

- **P2** — Composer-as-code surface vs composable-substrate-as-skill north-star.
  - Draft location: §2.2 introduces `hive/lib/team-cell-composer/` (a new code lib) and `hive/team-cells/*.yaml` (new declarative configs).
  - Reference: CONTEXT.md "the 2.0 north star: composable substrate, user-directed — not a director-chair workflow." Composability typically lives at the SKILL layer (atomic skills + declarative config), not at hive-lib (orchestration code).
  - Question for planner: Should the cell composer be an atomic skill (`skills/cell-compose/SKILL.md`) that returns a roster, called from the new execute-mode-multica-cell skill? Or stay as a code module? Skill route is more composable; code route is faster. Plan needs to pick.

## Not flagged (intentional)

- §8 (Inconsistency-risk anchoring) is sound — the 5 signals from research brief are addressed with non-negotiable terminology rules. Reviewer enforcement is correctly baked in.
- §3 risk register is appropriate scope; risk-mitigation pairs are mutually consistent.
- §5 numbered questions provide a clean user-gate surface.
- §7 (Out of scope) correctly defers plan/review cells per user's "session definition is only for execution" cut.
- §9 ("What done looks like") provides verifiable acceptance — good.

## Hand-back

This grill-record is descriptive. The 9 findings each end in a question for the planner. Phase A2 → design-discussion should either revise the draft to address each, or annotate explicitly-accepted-and-justified deviations in a §10 "Grill responses" section before presenting to the user.
