# Grill Record — substrate-coverage-and-test-cleanup

**Source draft:** `.pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (research-brief §7, 6 signals)
**Generated:** 2026-06-05T00:00:00Z

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 4 findings
- Unresolved tensions: 3 findings
- Convention violations: 2 findings
- Posture mismatches: 1 finding

## Vocabulary mismatches

Findings where draft terminology contradicts CONTEXT.md or shifts meaning mid-document.

- **V1** — Draft uses "slice" throughout (Slice A/B/C/D/E) while CONTEXT.md states the new convention prefers "wave" ("CWC 2026 used 'slice' throughout; new epics prefer 'wave'").
  - Draft location: line 22 ("17 stories merged behind a single epic branch"), line 39 ("I'd land the epic in five slices"), §3 throughout, §4 "Slice E s-3", §8 "5 slices".
  - Reference: `.pHive/CONTEXT.md` — "Wave — a sequencing label … Synonymous with the older term *slice*" + "new epics prefer 'wave'".
  - Question for planner: Should this new (Part 2) epic adopt the "wave" vocabulary (W0..W4 or W-A..W-E) per CONTEXT.md's stated preference, or is "slice" being retained intentionally because Part 1 (cc-workflows-first-party) used slice? If retained, surface a one-line rationale in §1.

- **V2** — Draft uses "updateStatus" as the canonical ABI verb when describing the Multica side ("extend `updateStatus` to accept `needs-rework`, implement on both adapters", line 41), but per the brief and source code Multica exposes `updateStory({status})`, not `updateStatus({state})`. The draft acknowledges the mismatch in §4 but then writes prose in §3 as if the verb is uniform.
  - Draft location: line 41 ("extend `updateStatus` to accept `needs-rework`, implement on both adapters") vs §4 high-severity #1 (lines 56-57) which contradicts it.
  - Reference: `hive/adapters/multica/index.ts:335-348` (`updateStory`), `hive/adapters/github/index.ts:291-309` (`updateStatus`).
  - Question for planner: Once Q2 lands (ABI shape), should §3 prose be rewritten to use the resolved verb (e.g., `markNeedsRework` or `invoke('updateStatus',…)`) so the doc reads consistently, or kept as shorthand with a forward-pointer?

## Hidden assumptions

Claims made without grounding (architectural, behavioral, performance, etc.).

- **H1** — Draft assumes cc-workflows substrate runs do NOT require a worktree-isolation precondition. The four new `*-mode-cc-workflows` skills inherit the Step-0 precondition gate from `plan-mode-cc-workflows`, but the draft does not document a worktree-isolation check in §5 Constraints, §3 (Slice E lint), or the Step-0 precondition contract.
  - Draft location: line 30 (atomic shape description), line 79 (Constraint #4 cc-workflows runs INLINE Claude), §3 Slice E `s-3` (lint covers `agentType:` only — no worktree check), §6 (no Q on isolation).
  - Why this matters: A planner-supplied mid-Phase-A directive states "cc-workflows substrate runs MUST always isolate to dedicated worktree". If this is a hard precondition, it belongs either as a Step-0 gate in every `*-mode-cc-workflows` skill (precondition: assert worktree, not main checkout) OR as a Slice E lint/preflight story. Neither appears in the draft. Without it, a contributor running /plan or /test in cc-workflows mode from the main checkout could mutate the working tree mid-dispatch.
  - Question for planner: Should worktree-isolation be added as (a) a Step-0 precondition assertion inside every `*-mode-cc-workflows` skill body, (b) a Slice E story (e.g., `s-4 cc-workflows-worktree-gate` shared helper + lint), or (c) a `dispatch-parity.md` invariant that the dispatcher checks once before delegating? Pick a placement and surface it as a story.

- **H2** — Draft picks Pattern B (constraint-injection-upfront) for /design without contrasting against Pattern A (parallel-constraints-late) or Pattern C (constraint-as-review-pass).
  - Draft location: line 19 ("ui-designer wireframes ONCE with constraints baked in — Pattern B / constraint-injection-upfront"), line 43 Slice B description (asserts Pattern B), §6 Q6 names the three patterns but does not contrast them.
  - Why this matters: The choice of Pattern B locks in a structural insert (net-new Phase A) in `/design` — see Risk #medium-2. If Pattern C (constraint-as-review-pass) had been picked, no Phase A insert would be needed; the existing single dispatch step plus a post-review constraint pass would suffice. The structural-cost vs alignment-strength tradeoff is invisible in the draft.
  - Question for planner: What is the tradeoff calculus (e.g., wireframe rework cost when constraints arrive late, vs structural-insert cost of Phase A, vs review-pass latency) that makes B preferable to A and C? Surface a one-paragraph justification before story `d-1` is written.

- **H3** — Draft assumes `loadScenario` (`hive/lib/scenarios/load.mjs`) covers the scenario-replay step's needs and that the test-architect "just authors `.yaml` and existing loader validates" (research-brief §8). The draft inherits this claim without independent verification.
  - Draft location: line 51 ("`loadScenario` (`hive/lib/scenarios/load.mjs`) for `t-1` scenario-replay").
  - Why this matters: If `loadScenario` does NOT cover the swarm-step-04b shape (e.g., missing run-context fields the swarm worker emits, or scenario schema diverges from what step-04b consumes), then `t-1` quietly grows from "add one step file" to "extend loader + step file".
  - Question for planner: Has `loadScenario`'s schema been verified against the swarm step-04b needs (post-worker, pre-inspector state shape), or is this an unverified assumption? If unverified, add a verification step before story `t-1` is finalized.

- **H4** — Draft assumes the missing `cc-workflows-smoke-1780516800.yaml` audit (§4 high-sev #2, §6 Q4) is non-blocking ("doc-debt at minimum"). It does not consider that the missing file could have contained a substrate finding that materially affects the design (e.g., a discovered Codex leak, a worktree contamination event, an episode-marker collision).
  - Draft location: lines 58-59 ("doc-debt at minimum; could mean a substrate finding was never written up").
  - Why this matters: If the smoke audit was written and went missing, the design proceeds without a known signal. If it was never written, Constraint #5 (gate-ownership invariant) loses one of two cited sources and the design rests on a single citation.
  - Question for planner: Is there an action ahead of story authoring to (a) recover/locate the audit, (b) re-run the smoke and produce a fresh audit, or (c) explicitly accept-the-risk and reduce Constraint #5 to a single-source citation?

## Unresolved tensions

Competing requirements or constraints the draft acknowledges but does not reconcile.

- **U1** — Codex-routing prohibition is documented (Constraint #4, line 79) AND a Slice E lint (`s-3`) is proposed (line 49), but the two are not connected as a single enforce-and-document loop. The draft documents the rule and proposes the lint separately. The unresolved half: does the lint cover ONLY `agentType:` literal strings, or also indirect routings (helper imports, dynamic dispatch, persona-config overrides that could re-introduce Codex)? The mid-Phase-A directive flags this exact ambiguity.
  - Draft location: line 30 ("No Codex `agentType` in cc-workflows mode, ever"), line 49 ("`s-3` adds the no-Codex-in-cc-workflows lint as `hive/scripts/lint-cc-workflows-no-codex.mjs`, wired into `npm test`"), line 79 (Constraint #4), §7 Automated tests ("lint script asserts zero matches for `agentType:` in cc-workflows mode skill files").
  - Tension: Constraint cites the rule; lint enforces a literal grep. If a future cc-workflows mode skill imports a helper that itself spawns a `codex:codex-rescue` subagent, the grep passes but the constraint is violated.
  - Question for planner: Should `s-3`'s AC be widened to cover (a) `agentType: codex` AND `agentType: codex:codex-rescue`, (b) any import of `agent-spawn` paths that route through codex backends, (c) `agent_backends` keys that resolve to codex inside cc-workflows mode skill files? Pick the lint scope.

- **U2** — `/test` simulated-manual fold-in tension between two conventions: outline + draft §3 line 41 say the new step lives at `hive/workflows/steps/test/step-04b-scenario-replay.md`, but the swarm pipeline runs out of `hive/workflows/steps/test-swarm/`. The draft surfaces this in §4 medium-severity ("does the file land under `test-swarm/`, or do we rename/merge the dirs first?") and Q1 in §6 but does NOT pick a side.
  - Draft location: line 62 (§4 medium-severity), line 91 (Q1), §8 line 134 ("1 new test step file (test-swarm/step-04b-scenario-replay.md)" — which is itself self-contradictory with the outline path cited in §3).
  - Tension: §8 scale block writes `test-swarm/step-04b-scenario-replay.md` while §3 inherits the outline's `test/step-04b…` path. The doc disagrees with itself, and Q1 is left open.
  - Question for planner: Pick the path before story authoring (the directive in the outer task hints this should land under `test-swarm/` to follow the swarm-pipeline convention, but the planner must explicitly resolve). If `test/` is chosen, why does §8 write `test-swarm/`? If `test-swarm/` is chosen, update §3.

- **U3** — `design-review-mode-cc-workflows` semantic question (§4 medium-sev, Q11) — preserve the 4-step model with 4 `agent()` calls, or collapse to a single-shot script. The draft surfaces the question but does not lean.
  - Draft location: line 64 ("either preserves the 4-step model (4 `agent()` calls) or collapses it"), Q11.
  - Tension: Preserving the 4-step shape gives substrate parity with the workflow.yaml; collapsing gives substrate parity with other `*-mode-cc-workflows` skills (which tend to be single-shot inline scripts). The two parities pull opposite directions.
  - Question for planner: Which parity wins — workflow.yaml shape (4 `agent()` calls preserving per-step episode markers) or cc-workflows atom shape (single-shot script with one aggregate return)? Pick before story `dr-3` is written.

## Convention violations

Design choices that contradict project memory feedback memos or established conventions.

- **C1** — Draft does not document a worktree-isolation gate for cc-workflows substrate runs, but a worktree-isolation precondition is consistent with `feedback_codex_parallel_race` (which establishes that `Agent(isolation: worktree)` does NOT isolate codex-rescue subagents — the failure mode is that runs that should be isolated end up sharing a tree). cc-workflows runs INLINE Claude (no codex), but the same worktree-isolation discipline arguably applies because cc-workflows mode skills mutate state on the working tree (episode markers, scenario files, wireframe artifacts) and concurrent dispatchers in the same checkout would race.
  - Draft location: §3 Slice E describes only `dispatch-parity.md`, the 5-tier resolver, and the Codex lint — no isolation discipline. §5 Constraints #4 says "INLINE Claude" but stops short of worktree-isolation.
  - Convention: `feedback_codex_parallel_race` (worktree isolation discipline for parallel agent dispatch) + planner-supplied mid-Phase-A directive ("cc-workflows substrate runs MUST always isolate to dedicated worktree"). See V/H1 above for the same concern from the hidden-assumption angle.
  - Question for planner: Should Slice E add a 4th story (`s-4` worktree-isolation gate + lint) to align with the parallel-race convention and the mid-Phase-A directive, or is this deemed a runtime/operator concern out of scope for the substrate-coverage epic?

- **C2** — Outline + draft say `test-sentinel`'s triage step bounces a story to `needs-rework`, but the persona `.md` has no executable step; the contract lives in `hive/workflows/steps/test-swarm/step-06-triage.md` (research-brief Risk #medium, §6). Draft §4 medium-severity says "Story AC for `t-2` must point at the step file, not the persona" — but draft §8 Files-affected list still mentions both ("hive/agents/test-sentinel.md or test-swarm/step-06-triage.md").
  - Draft location: line 135 ("hive/agents/test-sentinel.md or test-swarm/step-06-triage.md" in scale-block files-affected).
  - Convention: CONTEXT.md "Step file" definition: "A markdown procedure at `hive/workflows/steps/{workflow}/{step}.md`. The HOW for a workflow step (the persona is the WHO)." Wiring an emit point belongs in the step file (HOW), not the persona (WHO).
  - Question for planner: Resolve the "or" in §8 — should story `t-2` AC point uniquely at `hive/workflows/steps/test-swarm/step-06-triage.md` (per CONTEXT.md step-vs-persona discipline), or is there a case for editing the persona too? If both, surface why.

## Posture mismatches

Design choices that depart from project posture (composable substrate, atomic skills, etc.) without explicit justification.

- **P1** — `/design` Pattern B (constraint-injection-upfront, structural Phase A insert) extends `/design` from a single dispatch step into a fixed 3-persona pipeline that runs ALL personas, ALL the time, regardless of whether accessibility or animations constraints are relevant to the screen. This is a director-chair / hard-wired posture rather than a composable substrate posture (CONTEXT.md: "composable substrate, user-directed — not a director-chair workflow").
  - Draft location: line 19 ("3-persona pipeline (accessibility-specialist + animations-specialist constraint pass, then ui-designer wireframes ONCE with constraints baked in — Pattern B / constraint-injection-upfront)"), line 43 ("introduces a net-new Phase A that assembles `[accessibility-specialist, animations-specialist, ui-designer]`, runs the two specialists serial to produce constraint notes").
  - Posture reference: CONTEXT.md line 3 + `project_hive_2_0_milestone` memo ("composable substrate, user-directed"). Compare to specialist-triggers pattern (CONTEXT.md "Specialist team — pre-exec or post-exec team triggered by escalations") which is escalation-driven, not always-on.
  - Question for planner: Should the 3-persona pipeline be (a) always-on as Pattern B describes, (b) escalation-driven via specialist-triggers (e.g., a `design:a11y-constraint` trigger that activates the accessibility-specialist only when work-type signals warrant), or (c) operator-toggled via `/design --include-constraints accessibility,animations`? Pattern B as drafted hard-wires the pipeline; the substrate posture suggests the composition should be operator-directable.

## Notes

- The draft's §8 scale block contradicts §3 on the test-step-file path (`test-swarm/step-04b…` vs `test/step-04b…`). This is captured in U2 but worth flagging as a coherence issue.
- §6 numbers questions 1-11 but mixes research-brief carry-forward (1-5) with outline-surfaced (6-11) in a single list. The downstream consumer (structured-outline if approved) should know which questions are blocking-before-stories (Q1, Q2 per §8) and which are deferrable. The draft asserts this in §8 ("2 are pre-plan blockers (Q1 dir placement, Q2 ABI shape)") but the list itself is unordered by priority.
- The mid-Phase-A directive on worktree isolation surfaces twice (H1 hidden assumption + C1 convention violation) because it sits at the intersection of "undocumented precondition" and "convention drawn from the parallel-race memo". The planner can resolve both with a single decision.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
