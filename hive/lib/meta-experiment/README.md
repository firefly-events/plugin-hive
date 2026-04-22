# Meta-Experiment Runtime Library

This directory is shared runtime Python code under `hive/lib/`. It is not a `SKILL.md` and does not define a user-invocable procedure.

The module is consumed later by:

- `maintainer-skills/meta-meta-optimize/` for local-only maintainer workflows
- `skills/hive/skills/meta-optimize/` for the public skill surface

Planned submodules for later stories:

- `envelope`
- `baseline`
- `compare`
- `promotion_adapter`
- `rollback_watch`
- `closure_validator`

`hive/lib/` is the import boundary for runtime library code. Code placed here is shared implementation that other components import. This is distinct from `skills/`, which contains user-invocable procedures and their instructional packaging.

This scaffold is intentionally inert. It establishes the runtime module location and discovery contract only; no lifecycle logic is implemented here yet.

Test command:

```bash
python3 -m unittest discover hive/lib/meta-experiment/tests
```

## Envelope module

Purpose: lifecycle-facing wrapper over the C1 substrate envelope primitives in `hive.lib.metrics`.

API:

- `create`
- `load`
- `set_decision`
- `set_regression_watch`
- `set_commit_ref`
- `set_rollback_ref`
- `set_metrics_snapshot`

Contract:

- no new fields are introduced at this layer
- narrow-mutation-only helpers route updates through `hive.lib.metrics`
- storage is delegated to `hive.lib.metrics`; this module does not read or write envelope YAML directly

Source of record for field shapes: `.pHive/metrics/experiment-envelope.schema.md`

## Baseline module

Purpose: substrate-facing baseline capture that reads run events from `hive.lib.metrics`, derives a lean `metrics_snapshot`, and persists that snapshot through the envelope wrapper when requested.

API:

- `capture_from_run`
- `persist_to_envelope`
- `capture_and_persist`
- `NoBaselineError`

Contract:

- metrics-absent is a normal no-baseline outcome, not a failure; `capture_from_run` returns `None` for missing or empty event files
- malformed event rows raise `MetricsValidationError` rather than being silently ignored
- backlog-fallback compatibility is preserved; this module never forces metrics to exist and does not turn missing metrics into a crash
- persistence still routes through `hive.lib.meta_experiment.envelope`; this module does not read or write envelope YAML directly

## Compare module

Purpose: pure decision helper that compares baseline and candidate metric snapshots, applies one uniform threshold knob, and returns a structured `accept`/`reject` decision object for later lifecycle consumers.

API:

- `evaluate(baseline_metrics, candidate_metrics, threshold_pct)`
- `evaluate_from_envelope(envelope_dict, candidate_metrics, threshold_pct)`

Output shape:

- top-level `verdict`: `accept` or `reject`
- top-level `threshold_pct`: the single scalar knob used for the evaluation
- `metrics`: one entry per metric containing baseline and candidate values plus comparison details
- `regression_metrics`: names of numeric metrics whose `delta_pct` exceeded the threshold

Comparator convention:

- positive `delta_pct` means regression
- negative `delta_pct` means improvement
- the same `threshold_pct` scalar is applied uniformly across all numeric metrics
- numeric metrics are over threshold only when `delta_pct > threshold_pct`
- boolean metrics are included for visibility but do not contribute to the verdict

Scope:

- numeric metrics are the only metrics that can reject a decision
- boolean metrics are observational only; they always report `over_threshold: false`

Purity:

- the compare module performs no writes
- no envelope updates, promotion actions, rollback actions, or side effects occur here
