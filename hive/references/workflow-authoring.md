# Workflow Authoring — loop templates

_How to declare a bounded, configurable loop in a workflow. Read with
[`loop-unroll-migration.md`](loop-unroll-migration.md) (runtime model) and
[`predicate-grammar.md`](predicate-grammar.md) (convergence-signal grammar)._

## Declaring a loop template

A loop is a `node_type: loop` node whose `loop_config` names a **feature**, a
**sub_graph** (the body), a **convergence_signal** (a boolean output a body node
emits), and a **max_rounds** ceiling:

```yaml
  # body nodes tagged with the sub_graph
  - id: fix-cycle-implement
    agent: developer
    sub_graph: review-fix-cycle
    outputs:
      - name: fix_implementation
        type: string

  - id: fix-cycle-review
    agent: reviewer
    sub_graph: review-fix-cycle
    depends_on: [fix-cycle-implement]
    outputs:
      - name: review_verdict
        type: string
      - name: review_passed        # <-- the boolean convergence signal
        type: json

  - id: review-converge-loop
    node_type: loop
    loop_config:
      sub_graph: review-fix-cycle
      feature: review_converge     # <-- the loops.<feature> config key
      convergence_signal: review_passed
      max_rounds: 3
      gate_predicate: "review_verdict not equals needs_revision"  # legacy fallback
    depends_on: [review]
    outputs:
      - name: review_verdict
        type: string
      - name: review_passed
        type: json
```

At load time this unrolls into `fix-cycle-implement__r1..r3` /
`fix-cycle-review__r1..r3` + a terminal gate (see the migration note).

## The reviewer/tester step MUST emit the declared boolean

Convergence rides `convergence_signal`, a **boolean** output. The body's
reviewer/tester step must declare it (`type: json`) and set it to a real
`true`/`false`. If the step forgets it, no round can satisfy the converged-latch
`skip_when`, so the loop runs to `max_rounds` and the terminal gate decides.
Prose convergence never works — the predicate grammar accepts only boolean/int
literals and dot-path refs (see `predicate-grammar.md`).

Canonical signals: `review_passed`, `tests_green`, `behavior_satisfied`,
`coverage_satisfied`.

## Configuring on/off + rounds — `loops.<feature>`

Each feature is toggled and bounded in `hive.config.yaml`:

```yaml
loops:
  review_converge:  { enabled: true,  max_rounds: 3 }   # core loop — on
  tdd_red_green:    { enabled: true,  max_rounds: 5 }
  bdd_converge:     { enabled: true,  max_rounds: 3 }
  test_swarm:       { enabled: false, max_rounds: 3 }   # opt-in — expensive
  grill:            { enabled: false, max_rounds: 3 }   # opt-in — skill-level loop
```

**Precedence (highest first):** env var → root `hive.config.yaml` → shipped
baseline `hive/hive.config.yaml`. The resolver is
`hive.lib.config.resolve_loop_config(feature)`.

**Env override form:**

```
HIVE_LOOPS_<FEATURE>_ENABLED=true       # e.g. HIVE_LOOPS_TEST_SWARM_ENABLED=true
HIVE_LOOPS_<FEATURE>_MAX_ROUNDS=5       # e.g. HIVE_LOOPS_GRILL_MAX_ROUNDS=5
```

**Disabled or `max_rounds == 1` → single degenerate pass** (body runs once, no
iteration). This is strict back-compat for BEHAVIOR — a workflow with a
disabled loop runs the same steps in the same order as it did before the loop
was added.

Note: this does NOT mean declared ids are preserved on disk. `_expand_one_loop`
unconditionally applies the `<node>__r{k}` round-copy suffix to every body node,
including round 1 of a degenerate (disabled or `max_rounds==1`) pass — e.g. a
body node declared `fix-cycle-implement` becomes `fix-cycle-implement__r1` in
the loaded graph even when the loop never iterates. Downstream consumers must
resolve the loop's output via the LOOP node's own declared id (see "Output
identity" in [`loop-unroll-migration.md`](loop-unroll-migration.md)), not by
assuming a body node's bare authored id survives into the executed graph.

## Skill-level loops (grill)

`grill` is NOT a DAG loop — it is a **skill-level** loop owned by `/plan` Phase
A2 (`skills/plan/SKILL.md`). It shares only the `loops.grill.{enabled,max_rounds}`
config surface. Phase A2 calls `resolve_loop_config('grill')`, then iterates
grill → writer-revise up to `max_rounds`, stopping early when the grill-record's
`unresolved_count == 0`. Each grill invocation is one atomic pass; `/plan` owns
the rounds. Disabled / `max_rounds == 1` → a single grill pass (pre-s8 behavior).
