# Design Discussion — wire `/plan` to the DAG executor (command cutover + conditional gates)

## 1. What Are We Doing?

We're closing the last gap that keeps the deterministic plan graph off the user's `/plan`
command. The graph at `hive/workflows/plan.workflow.yaml` (`research ‖ design → author →
reconcile → output-validation`) already runs end-to-end and has authored a real 6-story epic
through `hive.lib.dag_executor.run(...)`. But that entrypoint is reachable only by hand — the
`/plan` command never routes to it. `/execute` already solved the equivalent problem: its
`execute-dispatch` skill returns a `runner_path`, and when that value is `hive-dag` it calls
`run_workflow(...)` instead of narrating phases inline. We want `/plan` to do the same thing,
additively and registry-gated, so the default orchestrator-narrated path has zero regression.

The twist that makes this more than a copy-paste of `/execute` is gates. `/plan` has
human-in-the-loop review gates (design-discussion, H/V slicing, structured-outline). The DAG
executor runs nodes to completion — it has no concept of stopping to ask a human a question
mid-graph. So "done" here is two things: (a) `/plan` routes through the executor when
configured, and (b) the executor can pause at a gate, surface the artifact, and resume — but
only *conditionally*, running unattended when the planner is confident and interrupting the
human only on real doubt. That conditional behavior is the heart of the epic.

## 2. What I Found

The `/execute` cutover is the template and it is precise. `skills/hive/skills/execute-dispatch/SKILL.md`
is the **single dispatch point**: it returns `runner_path ∈ {hive-dag, orchestrator-narrated}`
(execute-dispatch/SKILL.md:16) decided by a five-stage gate — consumer config present →
`executor` field equals `hive-dag` → `executor_default` truthy → graduation registry readable →
the workflow name is listed (execute-dispatch/SKILL.md:192–202). The registry lives at
`.pHive/runtime/executor-graduated-workflows.yaml` and I read it: it carries an explicit, ordered
graduation list (Order 1–9 today: `meta-team-cycle`, `code-review`, … `daily-ceremony`).
`plan` is **not** in it yet. The reader helper is `hive.lib.dag_executor.executor_enabled_for(workflow_name)`,
and the schema's cutover section (workflow-schema.md:307–328) confirms no schema-versioning is
required to graduate a workflow.

On the `/plan` side, the insertion point is **step 0c persona-dispatch** (plan/SKILL.md:139–158),
which today resolves a `mode_decision ∈ {cc-workflows, multica, default}` from env/config and
routes personas. There is no `hive-dag` branch. Critically, the three review gates are
**orchestrator-local**: the gate-ownership invariant (plan/SKILL.md:179–184, 302–305, 330–333)
says CC-Workflows- and Multica-dispatched planning may produce artifacts but "never advance user
review/sign-off gates." The plan graph itself confirms this — `plan.workflow.yaml` has only five
nodes and a comment that H-V/structured-outline nodes "remain orchestrator-local (s9 wiring owns
that boundary)." So today the executor literally does not own the gates.

Inside the executor I found the machinery story 3 actually needs. There are two existing
primitives: the **hde-8 PAUSE node** (`executor/handlers/pause.py`) that suspends via
`_record_pause_suspended()` + `save_state()`, emits a resume token, and waits for an operator
sentinel at `<runs_root>/<run_id>/pause/<node_id>.{approve,reject}`; and **hde-5 run-state
resume** (`run_state/resume.py`, `Walker.replay()`) that reloads `state.output_graph` from
`<run_state_path>/<run_id>/run_state.yaml` and replays from the last successful node. The existing
`output-validation` node is `node_type: gate`, evaluated by `GateHandler` as a **pure predicate
with no human** (regex match against `node.gate`). And the predicate grammar
(`predicate-grammar.md`) is a tight EBNF: six comparison ops, `&&`/`||`, dotpaths, numeric/bool
literals — **no function calls, no parentheses, no string literals**, and it is *culturally
locked* (extending it requires an epic, not a story).

The single most important finding: **`efcl-s6` does not exist anywhere in the repo.** The
requirement says story 3 should "reuse efcl-s6 converge-loop machinery." Grep returns nothing.
What exists is triage item **t-005** — "Add a bounded converge-loop primitive to the DAG graph
model" — still in the `prioritized` state, not built. The graph model (`graph/model.py:34`)
deliberately locks out cycles; only the degenerate `Node.retry.max_attempts` case exists. So the
"shared machinery" the requirement gestures at is *unbuilt*. This reshapes the whole approach.

## 3. My Proposed Approach

My central claim is that the conditional user-gate **does not need a loop primitive at all**, and
wiring it to the unbuilt t-005 would block the deep story on a dependency that isn't coming. A
conditional gate is forward-only: evaluate a predicate; if it says auto-pass, behave exactly like
today's `output-validation` gate (proceed, no human); if it says halt, behave exactly like the
hde-8 PAUSE node (suspend, surface the artifact, resume on the operator sentinel via the existing
run-state checkpoint). It is the **union of two primitives that already ship** — `gate` and
`pause` — switched by one per-gate predicate. The convergence/cycle concern that t-005 owns is a
different problem (review↔fix until clean); this epic should explicitly decouple from it and reuse
only the pause/resume *checkpoint substrate* (`run_state`), which both would share anyway.

Concretely, sequenced by dependency:

**Story 1 — plan-dispatch runner resolution.** After grilling Open Question 1, I've moved off
"shared helper both flows call." The posture-correct and lower-blast-radius move is a **sibling
`plan-dispatch` atomic skill** that mirrors `execute-dispatch` and *consumes the existing reader
helper* `executor_enabled_for("plan")` — exactly the relationship the single-dispatch-point posture
already prescribes (execute-dispatch/SKILL.md:210–214: others "use `executor_enabled_for` only as
the reader helper"). This keeps each command's dispatch a distinct atomic skill, avoids re-opening
`execute-dispatch`'s execution-mode internals (stories/parallel-teams/sessions are irrelevant to
planning), and means story 1 adds **zero** regression surface to `/execute` — it touches no code
`/execute` consumes. The shared, already-graduated surface is the registry + the reader helper, not
a refactored resolver. `plan-dispatch` returns `runner_path ∈ {hive-dag, orchestrator-narrated}`
for the planning flow.

**Story 2 — `/plan` cutover.** At step 0c, when `runner_path == hive-dag`, call
`run_workflow(plan.workflow.yaml, binding, flow="planning", context={requirement})`; otherwise the
existing narrated phases run unchanged. One dispatch boundary, mirroring `/execute` step 5pre/5e.

**Story 3 — conditional user-gate node type (the deep one).** Add `node_type: user_gate` carrying
an `auto_pass_when` predicate evaluated by the **existing** `GateHandler` evaluator with **zero new
grammar constructs** (no new literal, no null-coalescing, no function — see the C1 guarantee in §4).
`auto_pass_when` true → proceed like `output-validation`; otherwise → hde-8 pause-surface-resume.
Reuse `pause.py` and `run_state` directly; touch `graph/model.py`, `loader.py`, and add
`handlers/user_gate.py`.

The grill exposed the real boundary of the "no t-005 needed" bet, and I'm narrowing the claim
rather than defending the broad version. Forward-only pause/resume cleanly covers **auto-pass** and
**halt-then-approve** (the human reviews, drops `.approve`, `Walker.replay()` resumes forward with
the same artifact). It does **not** cover **revise-in-loop**: a human who rejects and wants a
*corrected* artifact needs re-entry into the upstream `design`/`H-V`/`SO` node — a backward edge
`graph/model.py:34` forbids and which is precisely the converge-loop t-005 owns. So story 3 pins
**reject semantics as terminal, not iterative**: a `.reject` sentinel *aborts the run* (the planner
re-invokes `/plan`, or edits the artifact out-of-band and resumes). Revise-on-reject is explicitly
deferred to t-005. This keeps story 3 genuinely decoupled — but only because we are not promising
in-graph revision. That tradeoff is stated, not hidden.

**Story 4 — emit gate signals.** The design / H-V / SO step-files and node `outputs` declare
`confidence` (0–100) and `open_questions[]`. Because the grammar forbids `len(...)`, each gate also
emits a companion scalar the predicate can read directly — `open_questions_count` (int) so SO's
predicate is `$so.output.open_questions_count == 0`, and H/V's is `$hv.output.confidence >= 80`.
The design gate's predicate is the constant always-halt case (`auto_pass_when` absent/false).

**Story 5 — tests + schema note.** Cutover-acceptance test mirroring
`test_cutover_acceptance_*`, spine-parity under the executor, `verify-dispatch-parity.mjs`,
document the `user_gate` predicate schema, mirror the workflow-schema cutover section, and add
`plan` to the graduation registry as Order 10.

## 4. What Could Go Wrong

**[high] The efcl-s6 dependency is a phantom — but only the narrowed claim survives.** `efcl-s6`
maps to triage t-005 (unbuilt, `prioritized`). The design decouples by building the gate from
existing `pause` + `run_state`. Grill correctly pressed that this holds *only* for auto-pass and
halt-then-approve; revise-in-loop would reintroduce the cycle t-005 owns. Mitigation: §3 pins
reject as terminal (abort/resume-unchanged), not iterative. If a future requirement demands
in-graph revision, that is a t-005-dependent follow-on epic, not a story here. Accepted deviation,
explicitly scoped.

**[high] Moving the approval event into the executor is an EXPLICIT AMENDMENT to the gate-ownership
invariant, not a clean fold-in.** Grill (U1/V2/H2) is right that I was collapsing two actors. The
invariant (plan/SKILL.md:302–305, 330–333) separates *artifact-readiness* from *user-approval* and
holds even when dispatched personas produce artifacts — a readiness signal must not imply sign-off.
A pause-node sentinel promoted to an approval event inverts exactly that separation on the graduated
path. So I will not assert "operator sentinel *is* human sign-off." Instead: (a) on the **default
narrated path**, the invariant is preserved verbatim — gates stay orchestrator-local, zero change;
(b) on the **graduated hive-dag path**, the executor *does* own the approval event via the pause
node, and this is documented as a **scoped amendment** to the invariant for the graduated path, with
the registry gate as the boundary. The "operator" who drops `.approve`/`.reject` must be the human
reviewer, not a CI automation — story 3 must state that actor contract, because if automation can
approve, the gate is theater.

**[high] The pause sentinel is filesystem-bound; the planning flow may run under the multica
binding.** Grill H2 + my own Open Question 4 collide here. hde-8 waits on
`<runs_root>/<run_id>/pause/<node_id>.{approve,reject}`; under the `multica` binding the human signs
off via an issue, not a file, so the pause would hang. Resolution: **scope the epic to the
filesystem binding first**; a binding-aware pause surface (issue-comment sentinel → file bridge) is
a *named precondition* for the multica deployment and is called out as its own follow-on, not
silently assumed inside story 3. The "human stays in the loop / no regression" claim is therefore
asserted only for the filesystem binding in this epic.

**[medium] Zero-regression must be provable for `/execute`, not just `/plan`.** Grill H3. The
sibling-`plan-dispatch` decision in §3 already shrinks this: story 1 touches nothing `/execute`
consumes (only the shared reader helper + registry, both already graduated). Story 5 still adds an
`/execute` dispatch-parity assertion as a guard so the refactor-blast-radius claim is *tested*, not
asserted.

**[medium] Predicate grammar is frozen; `user_gate` must add zero grammar surface.** Grill C1.
`len(open_questions) == 0` is illegal (no functions). The companion-scalar pattern
(`open_questions_count` int) is the only grammar-compatible route, and story 3 must confirm
`auto_pass_when` reuses the *existing* `GateHandler` evaluator unchanged. If even one evaluator
behavior changes, it is an epic-scoped grammar change masquerading as a story — hard stop.

**[medium] Absent-dotpath fail direction must be safe for ALL three gates, not just confidence.**
Grill U3. "Fails closed → halt" is only obviously true for `confidence >= 80` (missing → not ≥ 80 →
halt). For SO's `open_questions_count == 0`, a missing/null dotpath could evaluate *open* or error
depending on the evaluator's null handling. Story 5 must pin the evaluator's absent-dotpath
semantics and add a test that a missing scalar halts (never auto-passes) for every gate. If the
evaluator's null comparison doesn't guarantee halt, the gate predicate must be written so absence is
safe (e.g. gate on `open_questions_count >= 1` to auto-*halt*, inverting the default).

**[medium] Confidence auto-pass needs a fail-safe, and only research-grounded gates may use it.**
Grill U2. The design gate is **always-halt** precisely because the design node runs parallel to
research (`research_brief` joins at *author*) — it cannot emit a trustworthy confidence. The H-V and
SO gates run **downstream of author**, so their confidence *is* research-grounded; that is what makes
their auto-pass defensible. Even so, story 4 should carry a fail-safe (e.g. always-halt on the first
planning run for a requirement, or a cap on consecutive auto-passes) so an over-confident agent
cannot silently skip the human indefinitely.

**[medium] Graduation requires a graph-topology change first — the cutover is additive to the
*command surface*, not to the graph.** Grill P2. Inserting `user_gate` nodes between `design` and
`author` changes the very graph spine-parity runs against, so `plan` is **not** a clean graduation
candidate until that topology lands and passes parity. Ordering is explicit: (1) land `user_gate` +
the gate nodes in `plan.workflow.yaml`, (2) prove spine-parity on the new topology, (3) only then add
`plan` as registry Order 10. "Additive + registry-gated, zero-regression" means *no regression to the
default narrated `/plan`*, achieved by the registry gate — it does not mean the graph is unchanged.

**[low] Epic-id resolution before author.** The design node writes to `.pHive/epics/{epic_id}/docs/`
but the `author` node creates the epic dir. For this run the dir already exists (`plan-dag-cutover`);
generally the planning flow must fix the epic slug before the design node writes.

## 5. Dependencies and Constraints

This rests on primitives that already ship: the hde-8 PAUSE handler, hde-5 run-state
resume/`Walker.replay()`, the `GateHandler` predicate path, the frozen predicate grammar, the
graduation registry + `executor_enabled_for`, and the `execute-dispatch` runner-resolution logic.
It must respect the gate-ownership invariant (preserve it on the default path), the language policy
(Python-canonical for the executor; SKILL.md prose for wiring — no new Node), and the registry's
locked Order sequence (plan becomes Order 10). It explicitly **does not** depend on t-005 / the
converge-loop primitive *as long as reject is terminal* (§3) — severing that link is a design
decision with a stated boundary, not an oversight. Two things this epic must own as deliverables,
surfaced by grill: a **scoped amendment** to the gate-ownership invariant documenting that the
executor owns the approval event on the graduated path only; and an **`/execute` dispatch-parity
guard** proving the story-1 sibling skill leaves `/execute` untouched. A binding-aware pause surface
(for the multica deployment) is a named precondition, not in this epic's scope. `hive.config.yaml`
is schema_version 1.2 with `gate_mode: warning`; no schema bump is needed to graduate plan.

## 6. Open Questions

Several questions from the first draft were resolved by the grill pass and are now decisions, not
questions: runner resolution is a **sibling `plan-dispatch` atomic skill** consuming
`executor_enabled_for` (was Q1 — resolved toward posture-alignment + minimal `/execute` blast
radius); reject semantics are **terminal, not iterative** (resolved, decouples from t-005); the
multica pause surface is **out of scope / a named precondition** (was Q4). What genuinely remains
open for the structured-outline gate:

1. New `node_type: user_gate` vs extending `gate` with optional `auto_pass_when`. I lean new type
   (keeps pure-predicate `gate` semantics clean), but the team may prefer one node type — this is a
   real fork, not yet locked.
2. Companion scalar shape: `open_questions_count` (int) vs `has_open_questions` (bool). Int is more
   reusable, but the SO predicate's safe-on-absence direction (§4, U3) may favor whichever fails
   closed under the evaluator's null handling — settle these two together.
3. Always-halt design gate: `auto_pass_when: false`, or a dedicated `always_halt: true` attribute
   for readability? Behaviorally identical; readability/audit call.
4. Do we land the H-V and structured-outline nodes in `plan.workflow.yaml` in *this* epic (required
   before plan can graduate, per §4 P2 ordering), or land the `user_gate` type alone and wire the
   gate nodes in a fast follow before flipping registry Order 10? The ordering constraint is fixed;
   the packaging is the open call.
5. The actor contract: who is authorized to drop `.approve`/`.reject` — only a human reviewer, and
   how is automation excluded? (Story 3 must answer; left here so the gate is not theater.)

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: pytest (hive/lib/dag_executor/__tests__), node verify-dispatch-parity.mjs
  Platforms: Python executor + SKILL.md prose wiring (no UI)
  Automated: cutover-acceptance test (plan routes to hive-dag only when graduated);
             user_gate handler unit tests (auto-pass predicate true → proceed;
             false → suspend → sentinel → replay resumes); predicate-fail-closed test;
             spine-parity for plan.workflow.yaml under the executor; dispatch-parity check
  Manual: run /plan under hive-dag on a real requirement; confirm design gate always halts,
          H/V auto-passes at confidence ≥ 80 and halts below, SO auto-passes at zero
          open questions; confirm default (un-graduated) /plan is byte-for-byte unchanged
  Not verifying: the t-005 converge-loop (explicitly out of scope and decoupled);
                 grammar extensions (none are being made)
```

## 8. Scale Assessment

This is a multi-surface epic touching the executor internals, two skills, the plan graph, several
step-files, schema docs, and the registry — but each story is independently shippable and the deep
one (story 3) is bounded by reusing existing primitives rather than inventing a loop.

```
SCALE ASSESSMENT:
  Files affected: ~14 (plan.workflow.yaml, plan/SKILL.md, new skills/hive/skills/plan-dispatch/SKILL.md,
    graph/model.py, loader.py, handlers/user_gate.py, design/H-V/SO step-files, workflow-schema.md
    cutover+user_gate schema note, executor-graduated-workflows.yaml, gate-ownership-invariant
    amendment note, /execute dispatch-parity guard, tests)
  Subsystems: dag_executor (graph + handlers + run-state), /plan skill, dispatch resolution
  Migration required: no (additive to the command surface; no schema bump; per-workflow rollback by
    registry removal). NOTE: graph topology DOES change (user_gate nodes) before graduation — that
    is a parity-gated prerequisite, not a migration.
  Cross-team coordination: no (single repo, Python + SKILL prose)
  Unknowns: 4 (node-type vs gate-extension; companion-scalar shape + absent-dotpath fail direction;
    gate-node packaging/ordering; approve/reject actor contract). Binding-aware multica pause surface
    is a named out-of-scope precondition, not an unknown to resolve here.

  RECOMMENDATION: Needs structured outline
  RATIONALE: Five dependency-sequenced stories with one deep node-type story, a load-bearing posture
    shift (the gate-ownership invariant amendment), and a fixed topology-before-graduation ordering.
    The terminal-reject / t-005-decoupling boundary, the invariant amendment scope, and the
    conditional-gate predicate + absent-dotpath contract should be locked in a structured outline
    before decomposition.
```

SCOPE_CLASS: single-epic

---

## Revision Note — Grill-Record Consumption

This is the revised draft. Per the design-discussion revision protocol, every finding in
`.pHive/epics/plan-dag-cutover/docs/grill-record.md` is resolved into a draft change or an
explicitly-accepted-and-justified deviation — none silently dropped.

- **V1 (vocab: "single dispatch point" drift)** → resolved. §3 Story 1 + §6 now name the exact
  surface: a sibling `plan-dispatch` atomic skill that *consumes* `executor_enabled_for`. "Single
  dispatch point" stays a per-skill boundary; no redefinition.
- **V2 (operator vs human sign-off)** → resolved. §4 no longer equates the two. The actor contract
  (only a human reviewer may drop the sentinel) is now a story-3 requirement and §6 Q5.
- **H1 (no-loop bet hides reject-then-revise)** → accepted-and-scoped deviation. §3 narrows the
  claim: reject is terminal (abort/resume-unchanged); revise-in-loop is deferred to t-005.
- **H2 (sentinel reachable under the run's binding?)** → resolved. §4 scopes the epic to the
  filesystem binding; the multica pause surface is a named out-of-scope precondition (§5, §8).
- **H3 (zero-regression blast radius to /execute)** → resolved. The sibling-skill choice removes the
  refactor; §4/§5 add an `/execute` dispatch-parity guard (story 5) to *prove* it.
- **U1 (gate-ownership invariant inversion)** → accepted-and-scoped deviation. §4 reframes it as an
  explicit, registry-bounded amendment to the invariant on the graduated path; default path verbatim.
- **U2 (confidence grounding vs autonomy)** → resolved. §4 notes only research-grounded gates (H-V,
  SO — downstream of author) auto-pass; design gate always halts; a fail-safe (first-run halt / cap)
  is required of story 4.
- **U3 (absent-dotpath fail direction)** → resolved. §4 requires story 5 to pin evaluator
  null-handling and test that a missing scalar halts for all three gates.
- **C1 (frozen grammar)** → resolved. §3/§4 require `auto_pass_when` to reuse the existing evaluator
  with zero new grammar constructs; any evaluator change is a hard stop.
- **P1 (atomic-skill / single-dispatch posture)** → resolved. §3 Story 1 chooses the posture-aligned
  sibling skill over a shared lib helper.
- **P2 (graph topology change vs additive graduation)** → resolved. §4 fixes the ordering: land
  user_gate topology → prove spine-parity → then registry Order 10. "Additive" scoped to the command
  surface.
