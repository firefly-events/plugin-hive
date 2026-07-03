# Loop Unroll Migration — runtime LOOP node → load-time unroll expander

_Epic `loop-unroll-templates`. Read alongside
[`predicate-grammar.md`](predicate-grammar.md) (boolean convergence signals) and
[`workflow-authoring.md`](workflow-authoring.md) (how to declare a loop)._

## What changed

`LOOP` is now an **authoring keyword, not a runtime node**. A workflow author
still writes a `node_type: loop` with a `loop_config`, but at **load time** the
expander (`hive/lib/dag_executor/graph/unroll.py`, `expand_loops`) rewrites it
into a pure acyclic DAG **before** the executor ever runs. After expansion the
graph contains **zero** `LOOP`-type nodes.

- **Before:** the executor carried a runtime `LOOP` handler that iterated a
  `sub_graph` in place (`_execute_loop_node` / `LoopHandler` / `NodeType.LOOP`).
- **After:** a bounded loop is unrolled at load into deterministic round copies
  `<node>__r<k>` (round 1..N) plus a terminal gate. The executor walks a plain
  DAG — no loop primitive, no cycles.

## Why

- **DAG-native.** Every round copy is an ordinary node, so per-round
  observability, memoization, replay, and telemetry come for free — no
  special-cased loop bookkeeping in the walker.
- **Deterministic ids.** Round-copy ids are stable across loads
  (`review__r1`, `review__r2`, …), so replay and cached-state matching work.
- **One skip surface.** Convergence rides the existing `skip_when:` predicate
  grammar (a converged-latch OR-chain), not a bespoke loop-exit mechanism.

## The bounded-only dividing line

Unrolling requires a **statically known ceiling**. `loop_config.max_rounds` (or
`loops.<feature>.max_rounds`) is that ceiling. There is no unbounded loop: a loop
that never converges runs exactly `max_rounds` rounds and then the terminal gate
decides (integrate or block). If you need "iterate until X" with no ceiling, that
is out of scope — pick a ceiling.

## Two expansion shapes

1. **Multi-round (`effective_rounds > 1`).** Emits `<node>__r1..rN` copies. Round
   1 always runs; rounds `k > 1` carry a converged-latch `skip_when` OR-chain
   over all prior rounds' boolean `convergence_signal`. Downstream `depends_on`,
   input `step_id`, and gate refs to the loop are rewired to the last round (with
   last-successful-round fallbacks so an early-converged run still resolves).
2. **Degenerate single pass (`effective_rounds == 1` — loop disabled or
   `max_rounds == 1`).** The body runs once. This is the opt-in-off / back-compat
   path.

## Output identity — the encapsulation requirement

The retired runtime `LOOP` node exposed the loop result under **one stable node
id**; internals were hidden. Static unroll must preserve that for
declared-name-coupled consumers (parity, metric-routing, classic decomposition,
scan-roots): the loop's output must remain resolvable under its declared
producer id, and round-copy `__rN` ids must not leak to subsystems that key off
declared step names. Round copies are an internal detail of the expanded graph.

## Opt-in defaults

Loop features are configured in `loops:` (see
[`workflow-authoring.md`](workflow-authoring.md)):

| feature | default | rationale |
|---------|---------|-----------|
| `review_converge` | **on** | core methodology loop |
| `tdd_red_green` | **on** | core methodology loop |
| `bdd_converge` | **on** | core methodology loop |
| `test_swarm` | **off** | expensive — opt-in |
| `grill` | **off** | opt-in ("turn grill on and set N rounds"); skill-level loop in /plan Phase A2, not a DAG loop |

A disabled loop degenerates to a single pass — pre-loop behavior is unchanged
until you turn a loop on.

## Known limitation — round 1 always runs (pr20-fable-review S1)

The expander unconditionally sets round 1's `skip_when` to `None`
(`unroll.py` `_expand_one_loop`, `if k == 1: new_node.skip_when = None`).
This means round 1's body ALWAYS runs, even when a pre-loop step already
produced a result equivalent to convergence — e.g. `development.classic
.workflow.yaml`'s `review-converge-loop`: if the pre-loop `review` step's
verdict is already not `needs_revision`, round 1 still unconditionally runs
`fix-cycle-implement` ("apply the changes requested" with no findings to
apply — hallucination risk) and a second `fix-cycle-review` pass. Similarly,
`test_swarm` (default OFF) still runs one full `swarm-generate`/`swarm-assess`
body pass even when disabled — so "disabled = pre-loop behavior unchanged"
(the claim two paragraphs up, and in `test_swarm.enabled` config comments) is
only true in the sense that no ADDITIONAL rounds run past round 1, not that
zero extra body passes are added versus a world with no loop at all.

**Why this isn't fixed yet.** The safe fix direction — seed round 1's
`skip_when` from a pre-loop signal (e.g.
`$review.output.review_passed == true`) — requires the pre-loop node to
actually emit a **boolean** output matching the loop's `convergence_signal`
name, evaluable by the strict-Archon predicate grammar (`== true` dotpath
only; no string-literal comparison, see `predicate-grammar.md`). Checked
against every current loop:

| loop | convergence_signal | pre-loop dep | pre-loop dep emits the signal? |
|---|---|---|---|
| classic `review-converge-loop` | `review_passed` (bool) | `review` | No — `review` emits `review_verdict` (string) and `review_findings`, not a `review_passed` boolean |
| tdd `tdd-red-green-loop` | `tests_green` (bool) | (implement-side entry) | No matching pre-loop boolean |
| bdd `bdd-converge-loop` | `behavior_satisfied` (bool) | `implement` | No matching pre-loop boolean |
| test-swarm `swarm-rounds-loop` | `coverage_satisfied` (bool) | `verify-baseline` | No matching pre-loop boolean |

None of the four shipped loops have a pre-loop producer of the exact
convergence-signal field today, so a "wire it when the field already
matches" mechanism would be dead code for all current templates — it would
not actually fix classic (the case the finding calls out), only cover a
hypothetical future template. Actually closing the gap for classic requires
adding a NEW boolean output (e.g. `review_passed`) to the pre-loop `review`
step and updating its task instructions to set it, then verifying that
skipping `fix-cycle-implement__r1` correctly cascades a skip through
`fix-cycle-review__r1` (single-upstream dependency, not a multi-upstream
join) without breaking the dense convergence-loop test suite
(`test_convergence_signal.py`, `test_review_converge_loop.py`,
`test_execute_graphs.py`, `test_parity_per_workflow.py`, and the classic
implement-decomposition skip-cascade tests). That is a multi-file,
behavior-changing edit to a heavily-tested surface — out of proportion to a
SHOULD-FIX finding, and risks the green baseline for a partial win. Left
undone; tracked here rather than papered over. A future fix should: (1) add
the pre-loop boolean output where one is missing, (2) add a generic,
opt-in-only rule in `_expand_one_loop` that seeds an entry node's round-1
`skip_when` to `$<pre_loop_producer>.output.<signal> == true` ONLY when such
a producer exists (so workflows without one are unaffected — zero behavior
change for tdd/bdd/test-swarm today), and (3) re-run the full convergence
test suite to confirm the skip cascades correctly through intra-body
single-upstream deps.

## Load-time guards (pr20-fable-review)

`load_workflow` rejects several loop-authoring shapes that would otherwise
either crash the walker or silently produce wrong scheduling/gating —
`GraphLoadError` (or `LoopConfigError`) at load time instead of a runtime
surprise:

| Guard | Rejects | Finding |
|---|---|---|
| `_validate_convergence_signals` | a declared `convergence_signal` with zero body nodes, or no body node producing it | s3 AC3 |
| `_validate_featured_loops_have_body` | a `feature`-tagged LOOP with zero matching body nodes (would survive `expand_loops` and crash the walker) | M1 |
| `_validate_body_nodes_have_deps` | a loop-body node with an empty `depends_on` (gets no inter-round ordering; all round copies would dispatch concurrently) | T3 |
| `_validate_no_nested_loops` | a LOOP whose body contains another LOOP node | T4 |
| multi-exit + `convergence_signal` + `max_rounds > 1` (`unroll.py` `_expand_one_loop`) | a loop body with >1 exit node that can early-converge (downstream multi-upstream join could be SKIPPED-not-evaluated) | S3 |
| compound gate + multi-round `convergence_signal` (`unroll.py` `_expand_one_loop`) | a downstream gate referencing a loop's `convergence_signal` inside a compound `&&`/`\|\|` expression when `max_rounds > 1` (no OR-chain fallback exists for compound gates, so early convergence false-blocks) | T2 |

All four shipped loop templates (`review_converge`, `tdd_red_green`,
`bdd_converge`, `test_swarm`) pass every guard today — these are latent-defect
rejections, not active constraints on current workflows.

## What retired

- `NodeType.LOOP` as a **runtime** node type (still parsed as an authoring
  keyword; removed from the executor's dispatch).
- The runtime loop handler / in-place `sub_graph` iteration.
- Any assumption that a loop is "one node" at execution time — at execution time
  it is N round copies + a gate.
