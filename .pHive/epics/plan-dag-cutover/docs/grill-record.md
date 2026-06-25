# Grill Record — plan-dag-cutover

**Source draft:** `.pHive/epics/plan-dag-cutover/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (`.pHive/epics/plan-dag-cutover/docs/research-brief.md` §INCONSISTENCY_RISK_SIGNALS — task framing said "absent", but the brief exists and was used to focus the pass)
**Generated:** 2026-06-23T00:00:00Z

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 3 findings
- Unresolved tensions: 3 findings
- Convention violations: 1 finding
- Posture mismatches: 2 findings

## Vocabulary mismatches

Findings where draft terminology contradicts CONTEXT.md or shifts meaning mid-document.

- **V1** — "single dispatch point" is asserted of `execute-dispatch`, then the draft proposes to *factor out / reuse* its runner-resolution logic for `/plan`. The term "single dispatch point" (a per-flow boundary) silently shifts to mean "a shared, flow-agnostic resolver" without naming the new surface. The brief's own signal flags the same drift ("the word 'extend' may overstate the shared surface").
  - Draft location: line 24–25 (`is the **single dispatch point**`) vs line 78–81 (`The five-stage gate in execute-dispatch is not execute-specific; I'd factor the runner-path resolution so /plan calls the same logic`)
  - Reference: `skills/hive/skills/execute-dispatch/SKILL.md:210–214` ("This skill is the single dispatch point… Callers must consume… instead of re-implementing"); CONTEXT.md "Mattpocock posture / atomic-skill" + research-brief.md:134–136
  - Question for planner: does "single dispatch point" survive as a per-skill boundary (each of `/plan`, `/execute` owns its own dispatch skill that *consumes* `executor_enabled_for`), or are you redefining it as one shared resolver both call? Name the exact surface (new `plan-dispatch` skill vs. shared helper) so the vocabulary stays stable.

- **V2** — "the operator sentinel *is* the human sign-off." CONTEXT.md and plan/SKILL.md treat "user review/sign-off gate" as an orchestrator-presented, human-approval event; hde-8's `pause/<node_id>.{approve,reject}` is an *operator* filesystem sentinel. The draft equates "operator" with "user/human sign-off," collapsing two distinct actors the rest of the codebase keeps separate.
  - Draft location: line 113–114 (`the operator sentinel … *is* the human sign-off`)
  - Reference: `skills/plan/SKILL.md:179–184, 302–305` ("Workflow tool completion and Multica completion are artifact-readiness signals, **not user review approvals**"); `executor/handlers/pause.py:7–8` (sentinel path)
  - Question for planner: is "operator" the same actor as the "user" who owns the review gate, or a different role? If a CI/automation process can drop `.approve`, the sentinel is not equivalent to human sign-off and the equation in U1/H2 collapses — define the actor explicitly.

## Hidden assumptions

Claims made without grounding (architectural, behavioral, performance, etc.).

- **H1** — Draft assumes the conditional gate needs NO loop primitive and is "the union of two primitives that already ship" (`gate` + `pause`). This is the load-bearing architectural bet of the whole epic, but it rests on an unstated premise: that no gate ever needs to *re-run upstream work* after a halt. A human who rejects a design artifact at the pause does not re-trigger `design` — `Walker.replay()` "replays from the last successful node" and reloads prior outputs. Forward-only resume after a *reject* may strand the run with the same rejected artifact.
  - Draft location: line 70–73 (`It is the **union of two primitives that already ship**`) and line 90–91 (`Reuse pause.py and run_state directly… No cycles, no t-005`)
  - Why this matters: if "reject" must produce a corrected artifact, you need either a re-entry into `design` (a backward edge → exactly the cycle `graph/model.py` forbids and t-005 owns) or an out-of-band human edit. The draft asserts decoupling from t-005 as settled, but the reject-then-revise path is precisely where convergence sneaks back in.
  - Question for planner: what is the documented behavior of a *reject* sentinel — abort the run, resume forward with the unchanged artifact, or re-enter the upstream node? If revise-on-reject is in scope, justify why that is not the converge-loop t-005 owns.

- **H2** — Draft assumes the operator sentinel "cleanly substitutes" for the orchestrator-local human sign-off with "no regression," but provides no grounding that the sentinel surface is reachable by the human in the binding the planning flow actually runs under. The draft itself contradicts this in Open Question 4 (the multica binding has no filesystem sentinel).
  - Draft location: line 112–117 (`the operator sentinel … *is* the human sign-off; ownership moves but the human stays in the loop`) vs line 159–161 (Open Question 4: `hde-8 expects a filesystem sentinel; the planning flow may run under Multica where the human signs off via an issue`)
  - Why this matters: if the graduated `/plan` path runs under multica and the human cannot reach a filesystem sentinel, the "human stays in the loop" claim fails for the exact deployment where it matters, and the pause node hangs indefinitely.
  - Question for planner: is the binding-aware pause surface a precondition of story 3, or is the epic scoped to the filesystem binding only (with multica explicitly deferred)? The "human stays in the loop / no regression" claim cannot be asserted until this is resolved.

- **H3** — Draft assumes registry-gating gives "zero regression" on the default narrated path. The runner-resolution refactor (story 1) touches the *shared* gate logic that `/execute` already depends on. "Zero regression for `/plan`'s default path" does not cover regression risk to `/execute` introduced by factoring its dispatch logic into a flow-agnostic form.
  - Draft location: line 11–12 (`so the default orchestrator-narrated path has zero regression`) and line 78–81 (factoring `execute-dispatch`'s resolution)
  - Why this matters: "zero regression" is claimed for the *plan* default path, but story 1 modifies the resolver `/execute` consumes. The blast radius of the refactor is broader than the draft's zero-regression framing admits.
  - Question for planner: does the zero-regression guarantee extend to `/execute` after the runner-resolution refactor, and what parity test pins `/execute`'s behavior across the refactor (not just `verify-dispatch-parity.mjs` for plan)?

## Unresolved tensions

Competing requirements or constraints the draft acknowledges but does not reconcile.

- **U1** — Gate-ownership invariant vs. moving gates into the executor. The draft acknowledges this is "a real posture shift" and "load-bearing," then resolves it by *assertion* (operator sentinel = human sign-off; registry-gating preserves the default path). But it does not reconcile the deeper invariant: plan/SKILL.md says gates are orchestrator-local *even when artifacts are produced by dispatched personas* — i.e., production-vs-approval separation is the invariant, not merely "which path runs." Moving the approval event itself into an executor pause node inverts that separation on the graduated path.
  - Draft location: lines 111–117 (acknowledged), lines 38–42 (invariant quoted)
  - Reference: `skills/plan/SKILL.md:302–305, 330–333` ("Workflow tool completion, Multica issue completion, or episode markers" must not "imply sign-off")
  - Tension: the invariant separates *artifact-readiness* from *user-approval*; a pause node's sentinel is an executor-emitted readiness signal being promoted to an approval — exactly what the invariant forbids on dispatched paths.
  - Question for planner: on the graduated path, is the executor allowed to *own* the approval event, or must the orchestrator still present and wait even when the DAG pauses? If the former, this is an explicit amendment to the gate-ownership invariant and should be stated as a deviation, not folded in as "ownership moves but the human stays."

- **U2** — Confidence signal grounding vs. autonomy of the design gate. The draft notes (line 130–132) the design node runs parallel to research, so design-gate confidence "is grounded in the requirement alone," and separately makes the design gate always-halt. But story 4 builds the `confidence`/`open_questions_count` machinery for H/V and SO gates whose `confidence >= 80` auto-pass is what enables *unattended* runs — the epic's stated heart (line 18–20). The draft never reconciles how a confidence scalar emitted by an agent that hasn't seen research can be trusted to skip a human.
  - Draft location: lines 18–20 (`running unattended when the planner is confident`), 96 (`H/V's is $hv.output.confidence >= 80`), 130–132 (research not joined at design)
  - Tension: the auto-pass threshold gates whether a human is interrupted, but the draft admits the upstream signal may be under-grounded; an over-confident agent silently skips the human.
  - Question for planner: what makes `confidence >= 80` a safe auto-pass boundary, and is there a fail-safe (e.g., always-halt on first run, or a max auto-pass count) for the case where the confidence scalar is unreliable?

- **U3** — Output contracts are not executor-enforced (acknowledged, line 124–128) vs. predicates that read those contracts to decide whether to halt. The draft notes a missing `confidence` key fails closed (→ halt) and calls that "safe," but a missing `open_questions_count` makes `$so.output.open_questions_count == 0` evaluate against an absent dotpath — the fail direction there is grammar/evaluator-dependent and not established by the draft.
  - Draft location: lines 96 and 124–128
  - Reference: `hive/references/predicate-grammar.md` (absent-dotpath evaluation semantics)
  - Tension: "fail-closed is safe" is asserted for `confidence` (halt) but the SO gate's `== 0` comparison against a missing scalar may fail *open* (or error) depending on evaluator null-handling, which the draft does not pin.
  - Question for planner: what does the predicate evaluator do when a referenced dotpath is absent (null) for each gate predicate, and is the fail direction safe (halt) for all three gates, not just the confidence one?

## Convention violations

Design choices that contradict project memory feedback memos or established conventions.

- **C1** — New `node_type: user_gate` adds a NodeType enum member to the executor. CONTEXT.md / CLAUDE.md mark the DAG executor as Python-canonical, so the *language* is compliant — but the predicate the new node carries (`auto_pass_when`) is evaluated by the **culturally-locked** predicate grammar, and the draft's chosen scalars (`open_questions_count`, `confidence`) are introduced specifically to stay inside it. That is convention-compliant *only if* no new operator/literal is needed; the draft must guarantee the `user_gate` predicate semantics add zero grammar surface, because grammar extension "requires an epic, not a story."
  - Draft location: line 87–91 (new node type), line 94–97 (companion scalars), line 119–122 (grammar constraint acknowledged)
  - Convention: `hive/references/predicate-grammar.md:9–24` (cultural lock — extension requires an epic) and CLAUDE.md Language Policy (Python-canonical executor)
  - Question for planner: confirm explicitly that `auto_pass_when` reuses the *existing* GateHandler predicate evaluator with zero new grammar constructs (no new literal, no `null`-coalescing, no function). If `user_gate` needs even one evaluator behavior change, it is an epic-scoped grammar change masquerading as a story — align or declare the deviation.

## Posture mismatches

Design choices that depart from project posture (composable substrate, atomic skills, etc.) without explicit justification.

- **P1** — Single dispatch boundary posture. The atomic-skill / single-dispatch posture is that one skill owns the runner decision and others *consume* `executor_enabled_for`. The draft's leaning resolution to Open Question 1 ("factor the runner resolution into a shared helper that both /execute and /plan call") risks moving decision logic *out of* the dispatch skill into a shared lib helper — which either thins the atomic dispatch skill to a wrapper or creates two callers of one un-skilled resolver. The posture-correct move (a sibling `plan-dispatch` atomic skill that consumes the reader helper, mirroring execute-dispatch) is not the draft's stated lean.
  - Draft location: lines 78–81, 152–154 (Open Question 1: `I lean shared, for one graduation semantics`)
  - Posture reference: `skills/hive/skills/execute-dispatch/SKILL.md:210–214` (single dispatch point; others use `executor_enabled_for` only as reader helper); CONTEXT.md "Mattpocock posture" (atomic skills)
  - Question for planner: does "shared helper both call" mean a new atomic `plan-dispatch` skill (posture-aligned) or collapsing both flows' dispatch into a non-skill lib function (posture-departing)? Justify the chosen shape against the atomic-skill / single-dispatch posture.

- **P2** — Additive + registry-gated cutover posture vs. modifying the live `plan.workflow.yaml` graph. The cutover posture is additive (graduate a workflow that *already passes spine-parity* under the executor, registry-gated, per-workflow rollback). But the draft (story 4/6 and research-brief Q at line 128) requires *inserting new `user_gate` nodes between `design` and `author`* in the existing 5-node graph — changing the graph the spine-parity tests run against. Modifying the graph topology to add halt nodes is not purely additive registry-gating; it alters the workflow before it can be a clean graduation candidate.
  - Draft location: lines 99–102 (story 5 adds plan as Order 10), lines 164–165 (Open Question 6: add H-V/SO nodes now or wire incrementally), and the implied topology change at lines 87–91
  - Posture reference: `hive/references/workflow-schema.md:307–328` ("Existing workflows that pass spine-parity tests under the executor are graduation candidates" — additive + registry-gated); `.pHive/runtime/executor-graduated-workflows.yaml` (locked Order sequence)
  - Question for planner: is `plan` graduated as the *existing* 5-node spine (additive, parity-clean) with gates wired separately, or does graduation require the new `user_gate` topology landed first? If the latter, the "additive + registry-gated, zero-regression" framing needs to account for a graph-topology change preceding graduation — state the ordering explicitly.

## Notes

- The task framing claimed "There is NO research-brief yet… `inconsistency_risk_signals` is absent → run heuristically." This is factually wrong for this epic: `research-brief.md` exists and carries a populated `INCONSISTENCY_RISK_SIGNALS` block (lines 132–152). The pass was run signal-focused, not purely heuristic. All five of the brief's signals were independently corroborated by this grill and map onto findings V1 (vocab/extend-vs-analogue), H1/H2 (efcl-s6 / pause assumptions), U1 (gate-ownership), C1 (No-LOOP model contract), P2 (routing-fork vs in-DAG gates). Where the brief and this pass agree, the planner should treat the tension as doubly-confirmed.
- The draft is internally honest about its own riskiest bet (efcl-s6 is a phantom; t-005 is `prioritized` not built — both verified). The grill does not dispute that finding; it presses on whether the *decoupling* claim (H1) fully holds once reject-then-revise is in scope.
- Factual claims in the draft verified true: `plan` absent from the graduation registry (would be Order 10); predicate grammar has 6 ops, no functions/parens/string-literals, culturally locked; `output-validation` is `node_type: gate`; pause sentinel path and `Walker.replay()` forward-only semantics; `hive.config.yaml` schema_version 1.2 / `gate_mode: warning`; no schema bump required to graduate.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
