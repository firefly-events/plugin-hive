---
date: 2026-05-02
decision: Cut over the Hive workflow runtime to the deterministic DAG executor on a per-workflow opt-in basis; treat orchestrator-narrated routing as maintenance-mode for existing workflows.
status: accepted
epic: hive-dag-executor (hde-1 through hde-11)
---

# ADR 001 — Hive DAG executor cutover

## Context

Hive workflows historically ran via the orchestrator-narrated path: the
session loaded the YAML, interpreted the prose `task:` fields and step
files, made routing decisions inline, and dispatched step-by-step. The
prose path has two failure modes that are structural, not behavioural:

1. **Routing conflation** — when a step's prose output encoded a
   routing signal (e.g. `metric_signal` woven into a paragraph), an
   orchestrator could conflate it with adjacent signals. PR #31 surfaced
   this when `meta-team-cycle` mis-routed because the orchestrator
   judged "metric signal present" from the same paragraph that
   described findings (see `feedback_metric_signal_findings_conflation`).
2. **Schema drift** — workflow YAMLs have additive fields (`when:`,
   `node_type:`, `tools:`, `output_format`) but no enforcement at the
   path that consumed them. Authors could write predicates that no
   evaluator ran.

The Hive DAG executor (the `hive-dag-executor` epic) builds a
deterministic runtime: a graph loader + validator, a strict-Archon
predicate grammar, a parallel scheduler with `none_failed_min_one_success`
joins, run-state persistence, worktree isolation, tool gating, pause
gates with HMAC-signed resume tokens, and a wrapper at
`hive/lib/dag_executor/__init__.py` exposing `run_workflow`,
`is_workflow_graduated`, and `executor_enabled_for`. It is callable from
`skills/execute/SKILL.md`.

## Decision

Adopt the DAG executor as the **target runtime** for workflows, with
graduation gated per-consumer and per-workflow:

- **Consumer flag** at `.pHive/hive.config.yaml`: `executor: hive-dag`
  AND `executor_default: true` (default OFF).
- **Graduation registry** at
  `.pHive/runtime/executor-graduated-workflows.yaml`: explicit list of
  workflow names that have been validated under the executor.
- **Routing point**: `skills/execute/SKILL.md` calls
  `executor_enabled_for(workflow_name)` and dispatches accordingly.
  Both gates must pass for the executor path to activate.

Treat orchestrator-narrated execution as **maintenance-mode** for
workflows already shipping under it; new workflows should be authored
to executor-friendly shapes (see migration guide below).

## Rollout history

The cutover ships as 11 stories on the `hive-dag-executor` epic, with
the per-workflow Order 1-9 sequence defined at the structured-outline
phase:

| Story | Subject | Notes |
|-------|---------|-------|
| hde-1 | Graph loader + validator | typed in-memory model, additive fields round-trip |
| hde-2 | Walker + dispatcher | spine parity with the orchestrator-narrated path |
| hde-3a | Predicate grammar | strict-Archon: no parens, 8 operators, fail-closed |
| hde-3b | output_format contract on step-02-analysis | structurally retires PR #31 |
| hde-4 | Parallel scheduler + barrier joins | wave detection, `none_failed_min_one_success` |
| hde-5 | Run-state persistence + `--resume` primitives | per-run YAML at `<runs_root>/<run_id>/run_state.yaml` |
| hde-6 | Worktree-per-run + meta-meta-optimize nesting | outer-cycle worktree reuse |
| hde-7 | Tool-gating contract + escalatable allow-list | per-step `tools` / `disallowed_tools` |
| hde-8 | Pause/approve gates with HMAC-signed tokens | `node_type: pause`, sentinel-file resume |
| hde-9a | Consumer flag + dispatch | four-corner truth table |
| hde-9b | Graduation registry shape | top-level `workflows:` (NOT `graduated_workflows:`) |
| hde-10 | Per-workflow cutover (Order 1-9) | this ADR |
| hde-11 | Docs collapse | this ADR + GUIDE/MAIN/CHANGELOG |

### Order 1-9 sequence

| Order | Workflow | Validates |
|-------|----------|-----------|
| 1 | meta-team-cycle | acceptance proof — AND-of-empty routing graduates from prose to mechanical YAML |
| 2 | code-review | linear spine production rollout |
| 3 | performance-audit | linear spine, 2-node minimal workflow |
| 4 | test-swarm | parallel fan-out + barrier-join in production (hde-4) |
| 5 | development.tdd | first development methodology graduation |
| 6 | development.bdd, development.tdd-codex | cross-model TDD; tdd-codex Darwin-only |
| 7 | ui-design, design-review | pause-gate semantics in production (hde-8) |
| 8 | development.classic | YAML-level decomposition for multi-domain stories (Q9 path-A) |
| 9 | daily-ceremony | post-hde-0 normalized; plan-approval pause migration |

## Sunset path for orchestrator-narrated routing

No date-driven sunset is committed. The orchestrator-narrated path
remains the default for any workflow not in the graduation registry.
Sunset will be revisited once:

1. Every shipped workflow is graduated AND has held the executor path
   in production for a release cycle without per-workflow rollback.
2. Authoring tools and templates default to executor-friendly shapes.
3. The deprecation messaging in `hive/references/workflow-schema.md`
   has had time to land with consumers maintaining custom workflows.

If those conditions are met, a follow-on ADR can flip the
`executor_default` shipped baseline to `true` and remove the
orchestrator-narrated dispatch from `skills/execute/SKILL.md`.

### Contingencies

- **Per-workflow rollback**: removing a name from the graduation
  registry rolls back ONLY that workflow. The other graduated workflows
  continue under the executor. This is the primary recovery primitive.
- **Consumer rollback**: flipping `executor_default: false` in
  `.pHive/hive.config.yaml` rolls back the entire consumer to the
  orchestrator path. Used for incident response.
- **Hard rollback**: removing the registry file altogether also rolls
  back to the orchestrator path (default-safe behaviour).

## Migration guide for custom workflows

To graduate a custom workflow:

1. **Predicate the routing.** Replace prose decisions in step files with
   `when:` clauses on the workflow YAML, using the grammar at
   `hive/references/predicate-grammar.md`. The grammar is intentionally
   small (no parens, 8 operators); restructure as multiple predicates
   on multiple steps if a single condition feels like it needs them.
2. **Add `output_format` blocks** to step files whose outputs downstream
   `when:` predicates reference. Booleans, ints, and strings only —
   predicates address structured data, not prose.
3. **Add the workflow to** `.pHive/runtime/executor-graduated-workflows.yaml`.
4. **Run parity tests.** Use `tests/dag_executor/test_parity_per_workflow.py`
   as a template: drive the executor with a `StubAgentSpawn` and assert
   the materialised output graph matches the workflow's declared step
   set. The parity bar is structural (events compared on `event_type`
   + `payload`, ignoring timestamps + run_id + path-introduced
   identifiers). Roll back the workflow from the registry if the parity
   bar fails; fix; re-add.

For multi-domain stories (e.g. `development.classic`'s implement step
splitting between backend and frontend): pre-compute booleans on a
story-context node (e.g. `preflight`) and predicate against
`$preflight.output.needs_backend == true` rather than reaching for a
hypothetical `$story.metadata.X` form (which the grammar does not
support). See `hive/references/story-spec-schema.md` for the canonical
boolean fields.

## References for traceability

- Structured-outline (Phase 6 §15) — docs collapse decision and
  authoring-forward defaults.
- User-gate decisions Q4 (consumer flag default OFF) and Q9 (path-A
  YAML-level decomposition for development.classic).
- `feedback_metric_signal_findings_conflation` — the bug class the
  output_format contract structurally retires.
- `feedback_internally_inconsistent_story_specs` — surfacing material
  conflicts to team-lead before committing.
- `feedback_design_handoff_is_planning` — the predicate-driven design
  handoff pattern is now executor-mechanical.
- `project_config_shipping_deferred` — shipped `hive/hive.config.yaml`
  must NOT carry maintainer-only flags; the consumer flag lives at
  `.pHive/hive.config.yaml`.
