# Design Discussion — execute-flow follow-ons + bounded converge-loop

> **Revision pass — grill-record consumed.** This draft has been revised against
> `.pHive/epics/execute-flow-followons-converge-loop/docs/grill-record.md`. All six findings
> (V1, H1, H2, U1, U2, U3) are resolved inline below and tagged `[grill VN]` at the point of
> resolution. Conventions and posture were clean. No findings were silently dropped.

## 1. What Are We Doing?

PR #316 (`feat/dag-execute-node-outputs`) landed a batch of fixes that fell out of dogfooding `plan → execute → review` on a throwaway tic-tac-toe consumer project running on real Multica. This epic is the direct follow-on: harden the Hive DAG-executor × Multica execution substrate so the gaps that dogfooding surfaced don't bite a real consumer. The target repo is plugin-hive itself — this is internal tooling, not a consumer app — and the canonical language stays Python for the DAG executor per the project charter (`CLAUDE.md` → DAG executor is Python/Canonical).

"Done" is six independently-shippable stories, dependency-sequenced, each setting `needs_backend: true` because every one is Python executor work with no UI. The architectural invariant that must survive all six: the deterministic DAG executor owns flow, gates, and routing; Multica provides only agent execution. No squads. Where a story extends a #316 fix, it cites #316.

Concretely the six are: (1) mirror the classic gate-review into the tdd + bdd methodology workflows so a `needs_revision` verdict can't silently ship there; (2) make each implement node's output visible to the review node *before* integrate, so review never passes code it couldn't read; (3) extend the Multica #13 output channel across the whole test-swarm flow, not just the one step that has it; (4) verify (then fix if broken) whether re-dispatching an already-terminal Multica issue actually restarts the agent; (5) seed the `.pHive/dag-outputs/` gitignore into consumer repos; and (6) the deep one — a bounded converge-loop primitive (review → fix → re-review until gate-clean or max iterations, then halt loud) that generalizes today's `Node.retry`.

## 2. What I Found

The classic methodology already has the gate this epic propagates. `hive/workflows/development.classic.workflow.yaml:596` defines a `gate-review` node (`node_type: gate`) with predicate `"review_verdict must not equal needs_revision"`, `retry: {max_attempts: 1, on: gate_failed, retry_node: review}`, and `integrate` (`:622`) lists `gate-review` in its `depends_on`. The enforcement is exercised by `hive/lib/dag_executor/routing/tests/test_gate_review_enforce.py` and a bounded-retry test (`test_classic_gate_has_bounded_retry`). The tdd and bdd workflows have the *verdict* but not the *gate*: both produce `review_verdict` from a review node and have `integrate` depend on `review` directly (`development.tdd.workflow.yaml:203,237`; `development.bdd.workflow.yaml:163,196`) — there is no interposed gate node, so `needs_revision` flows straight into integrate. Story 1's gap is real and confirmed. Note tdd already uses a gate elsewhere (`"implementation must not be empty"`, `:153`), so mirroring `gate-review` is a known-good shape, not new machinery.

The gate predicate engine and the "must not equal" handling were hardened in #316 itself (`8d441edc`: "must not equal" gate fails loud on a missing/empty value) — so the mirror inherits a predicate parser that already fails closed.

For output harvest: the Multica agent binding harvests a node's declared outputs three ways, in `hive/lib/dag_executor/executor/handlers/agent.py`. `_harvest_git_state` reads commit metadata from the agent's work_dir HEAD (`:603`); `_harvest_node_outputs` reads the #13 general channel `.pHive/dag-outputs/outputs.yaml` (`:512`); `_harvest_artifacts` maps committed/uncommitted `.pHive/epics/.../docs/<name>.md` to output `<name>` with hyphens→underscores (`:539`). The #13 channel is the only path for *non-file* semantic values that `when:` predicates and downstream input edges consume. The test-swarm flow has step files `step-00-rebuild` through `step-08-promote` plus `step-04b-scenario-replay` (`hive/workflows/steps/test-swarm/`); only `step-04b` carries the #13 block today. Story 3 is mechanical breadth: add the `.pHive/dag-outputs/outputs.yaml` block + declared node outputs to the other ~8 steps.

For story 4, `_dispatch` (`agent.py:820`) runs `cli.mjs dispatch --issue <tracker_id> --agent <agent>`, and `_resolve_tracker_id` (`:729`) reuses a cached tracker id (local `tracker.json` + server `--dedup-title`). The under-run guard re-dispatches up to 3× reusing that same id; whether `dispatch` on a *terminal* issue restarts the agent or no-ops is genuinely unknown from the executor side — it depends on Multica server semantics, which the executor can't introspect. This is investigation-first.

For story 6, the binding constraint: `hive/lib/dag_executor/graph/model.py:17` states the `NodeType` enum is exactly `{AGENT, SCRIPT, GATE, PAUSE}` — *"No LOOP."* The walker's `_dispatch_with_retry` (`executor/walker.py:405`) re-dispatches the **same** node on `HandlerError` up to `max_attempts`; it does **not** honor `retry_node`. So the classic gate's `retry_node: review` is declarative intent today, not wired behavior — and the gate ships with `max_attempts: 1` precisely so it "fails loud immediately, no wasted re-dispatch" (comment at `:606`). The converge-loop is what makes `retry_node` real.

## 3. My Proposed Approach

I'd ship in the requirement's stated order — 1, 2, 5 quick; 3 mechanical; 4 investigation-first; 6 the deep one, staged last — because the dependency edges run that way and because 6 should land on a tree where 1 and 2 already hold.

**Story 1 (gate-review mirror).** Copy the classic `gate-review` node verbatim into tdd and bdd: same predicate string, same `retry` block, and rewrite `integrate.depends_on` to include `gate-review`. Then mirror the enforcement test — parametrize `test_gate_review_enforce.py` over all three methodology graphs rather than copy-pasting a per-graph test, so the three stay in lockstep and a future fourth methodology is one list entry. This is the cleanest possible story: no executor code changes, only graph YAML + one test generalization.

**Story 2 (review-sees-implement-tree).** The honest fix is a per-node visibility step: after each implement node terminates, make its output reachable by the review node before integrate runs. Two candidate mechanisms — a per-node push to the epic branch, or a per-node reconcile (mirroring the existing `reconcile` node in `executor/handlers/reconcile.py`, which already materializes committed work before a gate). I lean toward a per-node reconcile because reconcile already exists, already guards unsafe `epic_dir` (`7ab05505`), and keeps "Multica only executes" intact — pushing from inside the implement node leaks flow control into the agent. This touches walker/reconcile wiring plus all three dev graphs. **[grill H1]** The current reconcile runs *pre-gate only*, so I'm not assuming it is re-entrant mid-flow for free: story 2 opens with a small spike to confirm the reconcile handler is safe to invoke per-node within a parallel dispatch group (idempotent copytree, no shared-lock contention). If the spike says it isn't cheaply re-entrant, story 2 falls back to per-node push and accepts the posture cost rather than redesigning reconcile inside this epic.

**Story 3 (test-swarm #13 coverage).** Enumerate the nine step files, and for each add the `.pHive/dag-outputs/outputs.yaml` emission block and a `declared node outputs` list matched to what that step actually produces. Copy `step-04b`'s block as the template. Pure doc work; verify by harvesting each step's outputs in a dry-run.

**Story 4 (retry-on-terminal).** Drive one real terminal Multica issue back through `dispatch` and observe: does the agent re-run? If it no-ops, the fix is in the dispatch path. **[grill U2]** Of the two candidate fixes, I treat cross-machine dedup as a hard constraint, so I lean toward **resetting the issue status before re-dispatch** (preserving the cached tracker id and the `--dedup-title` idempotency) over minting a fresh tracker id — the latter would force a re-run but weaken `_resolve_tracker_id`'s resume guarantee. I only fall to a fresh id if the investigation shows status-reset can't restart a terminal agent. Don't write either fix until the observation says one is needed.

**Story 6 (bounded converge-loop).** I'd reuse the walker's existing retry *plumbing* but NOT overload the `Node.retry` *field*. **[grill U1]** Rather than pile a second meaning onto `retry` (whose current meaning is transient-failure re-dispatch), I'd add a distinct `converge:` block to the schema (`{retry_node, max_iterations, exit_when}`) that the walker drives through the same re-dispatch machinery. This keeps the two semantics — "retry a flaky node" vs "iterate a fix→re-review cycle to convergence" — on separate fields while still respecting the `model.py:17` "No LOOP" invariant (the enum stays at four members; converge is a node attribute, not a new `NodeType`). **[grill H2]** I'm explicit that this is a *control-flow change to the walker*, not a field read: `_dispatch_with_retry` today re-dispatches only the **same** node (`walker.py:405`), so honoring a converge target means re-dispatching an *upstream* node (the fix/review pair) and re-walking its dependents until the gate is clean or `max_iterations` is hit — then halting loud. That walker change is the load-bearing sub-story, scoped as exactly that ("re-dispatch upstream + re-walk dependents"), not a retry tweak. Termination + resume telemetry piggybacks on the existing `node_retry` event (`walker.py:425`), extended with an iteration index. **[grill U3]** Story 6 ships as **one** independently-shippable story; any schema/walker/termination/telemetry/test split is internal sequencing only (a schema change without the walker change ships nothing usable, so those are not stand-alone stories in the requirement's sense).

## 4. What Could Go Wrong

**[high] Story 6 enum-vs-attribute is a real fork, not a detail.** If the maintainer wants an explicit `LOOP` primitive, that contradicts the `model.py:17` "No LOOP" invariant and forces changes to the enum, the graph validator, the loader, and every exhaustiveness check that switches on `NodeType`. **[grill U1]** My resolved position (see §3 Story 6) is a distinct `converge:` *node attribute* driven by the existing retry plumbing — no new `NodeType`, and no overloading of the `retry` field. The residual risk is that a `converge` block plus the existing `retry` block on the same node interact (e.g. a converge iteration that also hits a transient agent failure); the walker must define precedence between them. My concern is picking the wrong precedence and discovering it three stories deep — which is why this is still gated as Q1.

**[high] Story 4 is undefined until observed.** If `dispatch` on a terminal issue silently no-ops, the #22-redux under-run guard has been re-dispatching into the void for 3 attempts and "succeeding" by reusing a stale terminal result. That would mean past runs that looked retried weren't. The fix touches the idempotency layer (`_resolve_tracker_id`), which is load-bearing for cross-machine resume — easy to break dedup while fixing re-dispatch.

**[medium] Story 2 per-node reconcile could race or over-copy.** Reconcile already rejects unsafe `epic_dir` before copytree (`7ab05505`); running it per implement node multiplies the surface where a bad path or a half-written tree gets materialized into review's checkout. **[grill V1]** If two implement nodes run in the same *parallel dispatch group* (the walker's concurrent wave of ready nodes — distinct from CONTEXT.md's story-level "Wave" sequencing label), their reconciles could interleave. I use "parallel dispatch group" throughout for the executor concept to avoid colliding with the story-sequencing term.

**[medium] Story 1's mirror could drift.** If I copy-paste three gate nodes and three tests, a later predicate change updates one and forgets two. The parametrized-test approach mitigates this but only if the graphs are also factored, which they currently aren't (each methodology YAML is standalone by design).

**[low] Story 3 declared-output mismatch.** If a step's declared outputs don't match what the agent actually writes to `outputs.yaml`, harvest silently yields `{}` (best-effort by design, `agent.py:512`) and the gap looks like success. Verification must assert presence, not just absence of error.

**[low] Story 5 idempotency.** Seeding the gitignore line must be append-if-absent, or repeated `multica-init` runs duplicate it.

## 5. Dependencies and Constraints

This rests on the #316 substrate already merged on `feat/dag-execute-node-outputs`: the predicate parser fix (`8d441edc`), the reconcile `epic_dir` guard (`7ab05505`), the branch-contract-no-op-without-remote fix (`614c26b4`), and the single canonical `review_verdict` schema (`c748ab2c`). Story 6 depends on 1 and 2 being in place (a converge-loop wants a real gate to converge against and a tree review can actually see). Story 4 is independent and can land any time after the investigation. Stories 1, 3, 5 have no inter-dependencies and could parallelize.

Constraints: Python is canonical for all executor code (`CLAUDE.md`); no new Node outside the named bridge surfaces. Stdlib-first for any Python dependency. One branch per epic, one commit per story (`feedback_git_flow_per_epic`). PR file count < 150 (`feedback_pr_file_count_limit`) — story 3 touches ~9 files and story 6 several, both well under. The composable-substrate / atomic-skill posture (`.pHive/CONTEXT.md`) means the executor must not absorb flow logic into Multica or into agents.

## 6. Open Questions

1. **Story 6 shape (still load-bearing):** I've resolved the broad fork toward a distinct `converge:` node attribute over a `LOOP` node_type or an overloaded `retry` field (§3 Story 6) — the open part is **precedence**: when a node carries both `retry` (transient failure) and `converge` (deliberate iteration), which wins, and does a converge iteration reset the transient-retry counter? Maintainer call needed before schema work.
2. **Converge bound semantics:** is `max_iterations` counted per gate, or shared across a fix→review→gate cycle? And on exhaustion, does it halt the whole run or mark just that story failed?
3. **Story 2 mechanism:** per-node reconcile (my lean, pending the H1 re-entrancy spike) vs per-node push to the epic branch — does the maintainer accept reconcile being invoked per-node, not just pre-gate?
4. **Story 4 expected behavior:** if re-dispatch on a terminal issue no-ops, my lean is reset-issue-status-before-dispatch to preserve dedup (§3 Story 4); is preserving `_resolve_tracker_id` dedup a hard constraint, or is a fresh tracker id acceptable for a deliberate retry?
5. **Story 3 scope:** do all nine test-swarm steps emit semantic outputs worth declaring, or do some (e.g. `step-00-rebuild`) legitimately have none and just need the block present-but-empty?
6. **Story 6 sub-splitting:** confirmed as **internal-only** — story 6 emits as one independently-shippable story (§3 Story 6, [grill U3]); the schema/walker/termination/telemetry/test split is sequencing inside that one story, not separate epic stories. Flagging only so the gate can veto if the maintainer wants it emitted as multiple stories anyway.

## 7. Verification Strategy

Everything here is Python executor work, so the verification center of gravity is pytest against the existing `hive/lib/dag_executor/.../tests/` suites. Story 1 mirrors `test_gate_review_enforce.py` (parametrized over three graphs) plus the bounded-retry assertion. Story 2 needs a walker integration test proving the review node sees implement output before integrate — assert the file is readable in review's checkout, not just that integrate later pushed it. Story 3 verifies by a dry-run harvest per step asserting each declared output key is *present* (guarding the silent-`{}` failure mode). Story 4 is observation-first: a manual/integration drive of a real terminal issue through re-dispatch, recorded as the story's evidence before any fix. Story 6 needs the heaviest coverage: a converge-clean-on-iteration-2 case, a halt-loud-at-max-iterations case, and a resume-mid-loop case.

```
VERIFICATION PLAN:
  Tools: pytest (dag_executor suites), graph loader/validator fixtures, real Multica drive for story 4
  Platforms: Python executor (no UI, no mobile, no browser)
  Automated: gate-mirror enforcement (story 1), review-sees-tree integration (story 2), per-step output harvest (story 3), converge clean/halt/resume (story 6)
  Manual: terminal-issue re-dispatch observation (story 4), gitignore seed on a fresh repo-bind (story 5)
  Not verifying: Multica server internals (out of executor scope); no load/perf testing — flow-control logic, not hot path
```

## 8. Scale Assessment

This is a multi-story epic with one genuinely large primitive (the converge-loop) and five bounded follow-ons. Most of the surface is contained: stories 1, 3, 5 are YAML/doc/config edits with no executor logic change; story 2 is moderate (walker/reconcile wiring + three graphs); story 4 is small-but-uncertain (investigation gates the code change); story 6 is the deep one and may sub-split. No data migration. No cross-team coordination — it's all internal tooling on one repo. The main unknown that could expand scope is story 6's shape (Q1) and story 4's observed behavior (Q4); both are front-loaded as open questions precisely so the gate can resolve them before decomposition locks.

```
SCALE ASSESSMENT:
  Files affected: ~25 (3 graphs, ~9 test-swarm steps, executor walker/handlers, model/validator for story 6, tests, 1 skill for story 5)
  Subsystems: dag_executor (graph model, walker, agent+reconcile handlers), methodology workflows, test-swarm step files, multica-init skill
  Migration required: no
  Cross-team coordination: no
  Unknowns: 2 load-bearing (story 6 shape, story 4 terminal-dispatch behavior)

  RECOMMENDATION: Proceed to stories
  RATIONALE: The decomposition is already dictated by the requirement and the dependency edges are clear (1,2,5 quick; 3 mechanical; 4 investigation-first; 6 staged last). The two real unknowns are isolated to stories 4 and 6 and are captured as open questions for the design gate; they don't block sequencing the other four. Story 6 alone may warrant an internal structured outline, but the epic as a whole does not.
SCOPE_CLASS: single-epic
```
