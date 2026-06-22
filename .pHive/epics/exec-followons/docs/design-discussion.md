# Design Discussion — execute-flow follow-ons + bounded converge-loop

**Epic:** `exec-followons`
**Base branch:** `feat/exec-followons` (cut from `feat/dag-execute-node-outputs`, PR #316)
**Author:** architect (plan node `design`)
**Revision:** post-grill. Every finding in
`.pHive/epics/exec-followons/docs/grill-record.md` (V1–V2, H1–H2, U1–U2, C1, P1) is
resolved inline below — search "(Grill " for each resolution. No finding was silently
dropped.

## 1. What Are We Doing?

PR #316 (`feat/dag-execute-node-outputs`) hardened the Hive DAG executor × Multica
execution substrate, but dogfooding the full plan → execute → review chain on a
throwaway tic-tac-toe consumer surfaced six residual gaps it didn't close. This
epic closes them. The work is all in `plugin-hive` itself — this is Hive's own
internal tooling, not a consumer app — and the canonical language for the executor
is Python (`hive/lib/dag_executor/`), per the project charter.

The six items are not equal. Two are *correctness blockers* that let bad code ship
silently: the `gate-review` node that #316 added to `development.classic.workflow.yaml`
has no twin in the `tdd` and `bdd` methodology workflows (item 1), so a
`needs_revision` verdict can still integrate there; and during execute the `review`
node can run against a tree that doesn't yet contain the implement node's work, so
review can "pass" code it never read (item 2). Three are mechanical or tiny: the #13
`outputs.yaml` output channel reached only one of ~10 test-swarm step docs (item 3),
the consumer `.pHive/dag-outputs/` gitignore seed is missing at repo-bind time
(item 5), and re-dispatch-on-terminal Multica semantics are unverified (item 4,
investigation-first). The sixth is the deep one: a *bounded converge-loop* primitive
(item 6) that turns today's "needs_revision halts the run" into "review → fix →
re-review until clean or a hard cap, then halt loud." (Grill V2: this primitive is
the **DAG-level realization of the existing "outcomes loop"** — CONTEXT.md's
"iterative review-fix loop with rubric-format grading; wraps `/review` per CWC 2026
slice s15." The outcomes loop is the *behavior*; the converge-loop is that behavior
lowered into the deterministic executor as a first-class node primitive. Item 6
should cite the outcomes loop and stay semantically consistent with it, not coin a
rival concept.)

"Done" means: all three methodology workflows enforce the review verdict; review
always reads the real committed implementation; every test-swarm step can have its
outputs harvested; consumer repos never accrete execution scratch; the retry path
is proven to actually re-run; and the executor gains a real, bounded, resumable
loop primitive with schema, walker semantics, wiring, and tests. The DAG owns
flow/gates/routing; Multica only executes agents behind the AgentSpawn Protocol —
that separation is preserved throughout.

## 2. What I Found

The executor is a Python topological walker. `hive/lib/dag_executor/graph/model.py`
defines `Node` with exactly these node-shaping fields: `node_type`, `gate`, `retry`
(a free-form `dict`), `when`, `skip_when`, `depends_on`, `inputs`, `outputs`,
`optional`, `timeout_ms`. `NodeType` is a closed enum — `AGENT, SCRIPT, GATE, PAUSE,
RECONCILE`. The schema doc (`hive/references/workflow-schema.md`) states the design
lock plainly: "No LOOP." So item 6 is a genuinely new primitive, not a config knob.

`gate-review` already works on the #316 base. The gate handler
(`hive/lib/dag_executor/executor/handlers/gate.py`) compiles three predicate forms:
`_NOT_EMPTY` (`X must not be empty`), `_MUST_BE_VALID` (`X must be valid Y`), and —
added by #316 — `_MUST_NOT_EQUAL` (`review_verdict must not equal needs_revision`).
In `development.classic.workflow.yaml` the `gate-review` node (node_type `gate`,
predicate `review_verdict must not equal needs_revision`) sits between `review` and
`integrate`, and `integrate.depends_on` includes `gate-review`. The enforcement test
lives at `hive/lib/dag_executor/routing/tests/test_gate_review_enforce.py` and the
step file at `hive/workflows/step-files/review/gate-review.md`. So item 1 is a
faithful *mirror*: the handler and predicate already exist; I'm replicating one node
+ one dependency edge + one test into `development.tdd.workflow.yaml` and
`development.bdd.workflow.yaml`. Today the tdd workflow has only a `gate-tests` node
(gates `implement`, not the verdict) and the bdd workflow has no gate before
`integrate` at all — review depends straight on `test`.

Retry semantics live in `walker.py::_dispatch_with_retry`: bounded re-dispatch up to
`node.retry.max_attempts` on `HandlerError`, emitting a `node_retry` telemetry event.
The code comment is explicit: "no LOOP primitive, just per-node re-dispatch." This is
the seam item 6 generalizes — a converge-loop is retry with an *exit predicate* and a
loop *body* (review↔fix) instead of a single re-run.

Worktree isolation is per-*run*, not per-*node* (`walker.py::_maybe_open_worktree`,
`isolation/worktree.py`). Every node in a local run shares one worktree, and
`reconcile-*` nodes ff-merge an agent's committed sha into it before gates. That's
why review sees implement locally. But under the **Multica** binding
(`executor/handlers/agent.py::MulticaAgentSpawn`), each node is dispatched as a
*separate Multica issue* whose agent gets its *own fresh checkout* of the epic
branch. The implement agent commits to `agent/<persona>/<task>`, not the epic branch;
nothing pushes it; so the review agent's fresh checkout can't see it. That is the
exact shape of item 2 — and it only bites the Multica binding, not the local walk.

The #13 channel: agents write `.pHive/dag-outputs/outputs.yaml` (flat `key: value`),
the executor reads it from the node's `work_dir` and merges it onto the step's output
graph. On the #316 base every `development-classic` step doc carries the "## DAG
executor outputs (required)" block, but in the **test-swarm** flow only
`step-04b-scenario-replay.md` has it; `step-00..step-08` (minus 04b) do not.
`.gitignore` line 7 ignores `.pHive/dag-outputs/` in plugin-hive itself, but
`skills/multica-init/SKILL.md` (the `ensureRepos` repo-bind step) seeds nothing into
consumer repos. `MulticaAgentSpawn` reuses a cached tracker id from
`.pHive/dag-spawn-state/{run_id}/{step_id}/tracker.json`; the cli.mjs `dispatch`
path is idempotent only when the issue is already `in_progress` and assigned to the
same agent — which strongly suggests re-dispatching a *terminal* (completed) issue
no-ops rather than re-running. That's the hypothesis item 4 must confirm on a real
instance before any fix.

## 3. My Proposed Approach

I'd sequence this in four **tranches** (item-grouping, smallest-blast-radius first),
with item 6 as its own sub-sequence. (Grill V1: I call these "tranches," not "waves,"
because CONTEXT.md reserves *wave* for story-level sequencing labels — these groupings
*become* the story waves at decomposition, but they are not waves yet.)

**Tranche 0 — quick correctness + hygiene (items 1, 5).** Mirror the `gate-review`
node into `development.tdd.workflow.yaml` and `development.bdd.workflow.yaml`: copy
the classic node verbatim (predicate `review_verdict must not equal needs_revision`,
bounded `retry`, `node_type: gate`, agent `validator`, `step_file`
`hive/workflows/step-files/review/gate-review.md`), wire each workflow's `integrate`
to `depends_on: [..., gate-review]`, and bind `review_verdict` from that flow's
`review` node. (Grill C1: `agent: validator` is the inherited gate-node pseudo-agent
— gate nodes are `node_type: gate` and spawn no real persona, and the existing
classic `gate-code`/`gate-tests`/`gate-review` all use `validator`. Mirroring it is
convention-consistent, not an off-roster violation; I'm matching existing code, not
introducing a new agent.) Then mirror `test_gate_review_enforce.py` per methodology
(one test each asserting `needs_revision` raises `GateFailedError` and that
`integrate` is unreachable past the failed gate). Crucially (Grill U1), design these
tdd/bdd gates **loop-ready**: item 1 ships a *halting* gate now because a loud halt
is strictly better than today's silent integrate, but I'd structure the node so item
6 can *wrap* it into a converging loop rather than rewrite it — same predicate, same
`review_verdict` binding, so the converge-loop's `until` clause reuses the gate's
predicate verbatim. That makes the build-then-converge path additive, not rework.
Item 5 is a one-liner: extend the `multica-init` repo-bind step (and any
repo-create/bind helper) to append `.pHive/dag-outputs/` to the consumer repo's
`.gitignore`, idempotently — skip if the line is already there. These three are
independently shippable in one small PR.

**Tranche 1 — mechanical coverage (item 3).** Enumerate the test-swarm step docs and add
the exact "## DAG executor outputs (required)" block from the dev-classic steps to
each of `step-00-rebuild`, `step-01-scout`, `step-02-architect`, `step-03-worker`,
`step-04-inspector`, `step-05-sentinel`, `step-06-triage`, `step-07-report`,
`step-08-promote`. For each, the declared `outputs.yaml` keys must match that step's
declared node `outputs` in `test-swarm.workflow.yaml` — that's the real work, not the
boilerplate. Steps with genuinely no declared outputs (a pure side-effect step like
rebuild) get an explicit "no declared outputs" note rather than an empty block, so
the omission is intentional and greppable.

**Tranche 2 — investigation-then-fix (item 4).** Drive a real terminal Multica issue
through `MulticaAgentSpawn._dispatch` re-dispatch on a live instance and observe:
does the agent re-run, or does cli.mjs no-op? (Grill H2: the fix scope is
*conditional on what we observe*, and that includes a "no fix needed" branch. If the
live instance shows re-dispatch already re-runs a terminal issue, item 4 collapses to
a verify-only story — the under-run guard is correct and we simply document that. The
story's acceptance criteria must enumerate both branches up front so it isn't padded
with a fix that may not exist.) If it no-ops (my expectation, but only a hypothesis
from reading cli.mjs's idempotency guard), the under-run guard is burning attempts
without re-running — so the fix is in the dispatch path: detect terminal status
before re-dispatch and either reopen/reset the issue or mint a fresh tracker id for
the retry, while preserving idempotency for the genuine in-flight case.

**Tranche 2 (parallel) — review-sees-implement-tree (item 2).** The minimal change
that guarantees review reads real code: have each implement node make its output
visible to review *before* integrate. **First task is a verification, not a code
change** (Grill H1): confirm which ref `MulticaAgentSpawn` actually hands the review
agent — the epic branch, the default branch, or the implement node's own
`agent/<persona>/<task>` branch. The whole mechanism choice hinges on this; if review
checks out the default branch, pushing implement's work to the epic branch fixes
nothing. Once the ref is known, the lead option (Grill U2) is **push each implement
node's commit to a per-node ref the review checkout fetches** (e.g. a stable
`refs/dag/{run_id}/{step_id}` the review node fetches and checks out), *not* a shared
push of both backend and frontend onto the epic branch — that avoids the parallel
backend/frontend push race entirely because each node owns its own ref. The reconcile
node already knows the sha/branch/repo, so it can publish the per-node ref; the change
is *what ref it publishes and that review fetches it*. This touches the
walker/reconcile wiring and the classic/tdd/bdd graphs (review must depend on the
per-node ref being published).

**Tranche 3 — bounded converge-loop (item 6), its own sub-sequence.** I'd stage it as:
(a) **schema** — add a loop construct to the graph model + loader + validator, most
likely a `node_type: LOOP` (or a `loop:` block on an existing node) carrying
`body` (the node ids that form review↔fix), `until` (a gate-style exit predicate,
e.g. `review_verdict must not equal needs_revision`), and `max_iterations` (hard
bound); (b) **walker execution semantics** — generalize `_dispatch_with_retry` into a
loop driver that runs the body, evaluates `until`, repeats until clean or the cap,
then halts loud on cap-without-clean; (c) **termination + resume** — iteration count
must be persisted in run_state so a resumed run continues at the right iteration, not
from zero; (d) **telemetry** — `loop_iteration` / `loop_exit` events; (e) **wiring**
into classic/tdd/bdd (review↔optimize/fix as the body, replacing the halting
gate-review with a converging one); (f) **tests** for clean-exit, cap-halt, and
resume-mid-loop. This may itself warrant several stories. (Grill P1: the loop must be
the *minimal* substrate addition — loop-as-handler over an acyclic node-set, no new
user-facing surface, declared entirely in the workflow yaml. That keeps it
posture-aligned: substrate the user *directs* by declaring a loop block, not a
director-chair control-flow bolt-on. Growing the core primitive set is justified only
because it generalizes the `retry` seam that already exists, and because the outcomes
loop (V2) is already an accepted behavior that today has no deterministic home.)

## 4. What Could Go Wrong

**[high] Item 6 reopens the "No LOOP" design lock.** The schema explicitly forbids
loops, and the validator does cycle detection — a converge-loop is a *controlled*
cycle. If I model it as a real back-edge in the DAG, the cycle detector will reject
it; if I model it as an internal driver over a node-set (no back-edge in the graph),
the topological walk stays acyclic but the loop logic concentrates in the walker. I
favor the latter (loop-as-handler, acyclic graph) precisely to avoid fighting the
validator, but it's the biggest architectural call in the epic and deserves the H/V
or structured-outline treatment.

**[high → medium, mitigated] Item 2's shared-branch push would race; per-node refs
avoid it.** A naive "push both implement nodes to the epic branch" races — frontend
and backend run as parallel `when:`-gated nodes with separate
`reconcile-backend`/`reconcile-frontend`, and the second concurrent push would be
rejected without a rebase/ff. This is exactly why §3's lead option is **per-node refs**
(`refs/dag/{run_id}/{step_id}`) instead: each implement node owns and publishes its
own ref, so there is no shared writer and no race, and review fetches the union of
the refs it depends on. The residual risk drops to "review must fetch the *right*
refs" — a binding/ordering concern the `depends_on` graph already expresses — rather
than a lost-commit concurrency bug. Getting the ref naming wrong is the remaining
hazard; getting it right makes the parallel case safe by construction.

**[medium] Item 4's fix could double-bill Multica work.** If the fix mints a fresh
tracker id on retry, we leave terminal issues behind and create new ones — that's
noisier but safe. If it reopens the same issue, we must be sure reopening actually
re-triggers the daemon. The wrong choice either burns attempts (status quo) or
spawns orphan issues. Investigation must settle this before code.

**[medium] Item 3 boilerplate-drift.** Mechanically pasting the outputs block risks
declaring keys that don't match each step's real node outputs. If they diverge,
downstream edges resolve to nothing and the run fails — the very bug #316 was fixing.
Each step's block must be cross-checked against `test-swarm.workflow.yaml`, not
copy-pasted blind.

**[low] Item 1 predicate-availability on the base.** Mirroring assumes
`_MUST_NOT_EQUAL` is present. It is on `feat/dag-execute-node-outputs`; if the epic is
ever rebased onto a base without #316, the gate silently fails to compile. Cutting
`feat/exec-followons` from the #316 branch (done) keeps this safe.

**[low] Item 5 clobbering a consumer `.gitignore`.** The seed must be idempotent and
append-only — never rewrite or reorder an existing consumer file.

## 5. Dependencies and Constraints

This epic sits on top of PR #316 (`feat/dag-execute-node-outputs`); the epic branch
is cut from it so `gate-review`, the `_MUST_NOT_EQUAL` predicate, the #13 channel on
dev-classic steps, and the `.pHive/dag-outputs/` gitignore line are all present.
Charter constraint: the DAG executor is **Python-canonical**
(`hive/lib/dag_executor/`); item 6 must be Python. The Multica dispatch bridge
(`hive/lib/multica-story-dispatch/cli.mjs`) is a *named Node bridge surface* — item
4's fix may touch it, which is permitted, but no new Node business logic should leak
outside that bridge. Every code story sets `backend: true` (Python executor work, no
UI). No squads. The DAG-owns-flow / Multica-executes separation is binding. Item 4 is
the only story that needs a *live Multica instance* to complete — it cannot be fully
verified offline. PR file count should stay under 150 (CodeRabbit threshold); item 6
alone may push that and may need to stack.

## 6. Open Questions

1. **Loop modeling (item 6):** loop-as-handler over an acyclic node-set, or a real
   back-edge with the validator taught to allow bounded cycles? I lean handler-driven
   (Grill P1 confirms this is the posture-aligned, minimal-substrate choice) — confirm
   at the gate.
2. **Loop body composition:** is the body always `review → fix/optimize`, or should
   the primitive be general enough to loop any node-set? General is more reusable but
   larger; methodology-specific is smaller and ships sooner.
3. **Item 2 — which ref does review's Multica checkout use?** (Grill H1, now the
   *gating* question for item 2.) Epic branch, default branch, or the implement node's
   own `agent/<persona>/<task>` branch? Item 2's first task answers this before any
   code; the per-node-ref mechanism in §3 assumes review can be made to fetch a
   published ref. If review is pinned to a ref it can't be redirected from, the
   mechanism changes.
4. **Item 4 fix shape (pending live investigation):** reopen the same terminal issue,
   mint a fresh tracker id on retry, or *no fix at all* if re-dispatch already
   re-runs. Decided by what the live instance actually does (Grill H2 — the "no fix"
   branch is explicitly in scope).
5. **Item 6's relationship to the outcomes loop (Grill V2):** confirm the converge-
   loop is the DAG-level realization of the existing outcomes loop, not a rival
   concept — so it cites slice s15 and stays semantically consistent.

*Resolved by the grill pass (folded into §1/§3/§4, no longer open):* whether item 1's
halting gate and item 6's converging loop are rework (Grill U1 — **no**: item 1 ships
a loop-ready halting stopgap that item 6 *wraps*); whether item 2 uses a shared epic-
branch push or per-node refs (Grill U2 — **per-node refs**, race-free by
construction); and whether `agent: validator` is off-roster (Grill C1 — inherited
gate-node pseudo-agent, convention-consistent).

6. **Item 3 scope:** do side-effect-only steps (e.g. `step-00-rebuild`) get an
   explicit "no declared outputs" note, or are they simply skipped? (My lean: explicit
   note, so the omission is intentional and greppable.)

## 7. Verification Strategy

Executor work is Python, so pytest is the spine. Item 1 mirrors
`test_gate_review_enforce.py` per methodology — assert `needs_revision` raises
`GateFailedError` and `integrate` is gated. Item 6 needs new pytest coverage for the
three loop behaviors: clean-exit (body converges before the cap), cap-halt (body
never converges, run halts loud at `max_iterations`), and resume-mid-loop (iteration
count survives a run_state reload). Item 2 needs an integration-style test that an
implement node's commit is visible to the review node before integrate — ideally
asserted against the reconcile/push wiring, since a full Multica round-trip is
expensive. Item 3 is verified by a doc-lint / schema cross-check that every
test-swarm step's declared `outputs.yaml` keys match its node `outputs` in the
workflow yaml. Item 5 gets a unit test on the seed helper (idempotent append, no
clobber). Item 4 is the one that needs **manual verification on a live Multica
instance** — drive a terminal issue through re-dispatch and observe — and that
manual step is the story's gating acceptance criterion.

```
VERIFICATION PLAN:
  Tools: pytest (executor), doc/schema cross-check lint, live Multica instance (item 4)
  Platforms: Python 3 (hive/lib/dag_executor), Node bridge (cli.mjs, item 4 only)
  Automated: items 1, 3, 5, 6 (gate enforcement, output-contract lint, seed idempotency, loop semantics + resume)
  Manual: item 4 re-dispatch-on-terminal observation on a real Multica instance; item 2 end-to-end Multica review-sees-implement spot check
  Not verifying: consumer-app runtime behavior (this is Hive's own tooling); no load/perf testing (flow-control change, not data-intensive)
```

## 8. Scale Assessment

**Size indicators.** Files affected: ~20–30. Items 1+5 touch 2 workflow yamls, 2–3
new tests, the multica-init skill, and a seed helper. Item 3 touches ~9 step docs +
a lint. Item 2 touches the walker/reconcile wiring plus all three dev graphs. Item 6
is the heavy one — graph model, loader, validator, walker, run_state, telemetry, all
three graphs, and a test suite. Subsystems: the DAG executor (graph, walker,
handlers, run_state, isolation), the workflow yamls, the test-swarm step docs, and
the multica-init bridge. Migration/data changes: none (new schema field is additive
and back-compatible). Cross-team coordination: none (Hive-internal). Unknowns: 4 —
loop modeling, item-2 mechanism, item-4 live behavior, and converge-vs-halt
interaction between items 1 and 6.

**Recommendation.** Items 1, 3, 4, 5 are well-understood and proceed straight to
stories. Item 2 has one real design fork (push vs reconcile) but a small surface —
stories with the fork called out. Item 6 is large, reopens a design lock, and has
genuine architectural choices (loop modeling, body generality, resume semantics) — it
warrants a structured outline (or H/V) before decomposition, and several stories
(schema / walker / wiring / tests). So: proceed-to-stories for the five smaller
items, structured-outline for item 6.

```
SCALE ASSESSMENT:
  Files affected: ~20-30
  Subsystems: dag_executor (graph/walker/handlers/run_state/isolation), workflow yamls, test-swarm step docs, multica-init bridge
  Migration required: no
  Cross-team coordination: no
  Unknowns: 4 (loop modeling, item-2 mechanism, item-4 live behavior, converge-vs-halt overlap)

  RECOMMENDATION: Mixed — proceed to stories for items 1/3/4/5; needs structured outline for item 6 (converge-loop)
  RATIONALE: Five items are mechanical mirrors, doc coverage, investigation, or one-liners with bounded surface; item 6 is a new DAG primitive that reopens the "No LOOP" design lock and carries the epic's hardest architectural choices.
```

SCOPE_CLASS: single-epic
