# Meta-Experiment Runtime Library

This directory is shared runtime Python code under `hive/lib/`. It is not a `SKILL.md` and does not define a user-invocable procedure.

The module is consumed later by:

- `maintainer-skills/meta-meta-optimize/` for local-only maintainer workflows
- `skills/hive/skills/meta-optimize/` for the public skill surface

Submodules:

- `envelope`
- `baseline`
- `compare` (shipped in L1.4)
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

## Promotion adapter module

Purpose: abstract seam for maintainer and public promotion paths. The maintainer swarm will later bind a direct-commit adapter in S9, while the public swarm will later bind a PR-only adapter in S10.

API:

- `PromotionAdapter`
- `PromotionResult`
- `PromotionEvidence`
- `RollbackResult`

Contract:

- `PromotionAdapter` defines the shared `promote(envelope, decision)` and `rollback(envelope, rollback_ref)` interface only
- `PromotionResult` carries success state, explicit promotion evidence, rollback targeting, and optional notes
- `RollbackResult` carries success state, optional revert reference, and optional notes
- `PromotionEvidence` is load-bearing and requires exactly one non-`None` reference: `commit_ref` or `pr_ref`

Risk guard:

- The architect raised `closure-evidence-shape-mismatch` in `.pHive/cycle-state/meta-improvement-system.yaml`: a shared closure validator could overfit direct-commit evidence and later reject valid PR-only close records
- This module prevents that overfitting by making promotion evidence explicit and dual-shaped at the type boundary, so later shared validation can accept either a commit-backed close or a PR-backed close without guessing or fallback logic

Delivery note:

- concrete direct-commit and PR-only adapters are intentionally out of scope here and land in S9 and S10

## Rollback watch module

Purpose: post-close observation-window watch that evaluates an accepted experiment against its candidate-time `metrics_snapshot` and exposes one delayed-regression behavior only: auto-revert through a supplied callback.

Q3 reminder:

- one behavior only: auto-revert
- no alternate modes
- no recommendation-only branch
- no human-gated branch

API:

- `evaluate_watch(envelope, post_close_snapshot, threshold_pct, now, auto_revert_callback, envelope_writer)`

Window rule:

- the observation window is start-inclusive and end-exclusive: `start <= now < end`

Return shapes:

- `TripEvent(experiment_id, tripped_at, tripped_by, regression_metrics, threshold_pct, rollback_ref, rollback_result)`
- `NoActionResult(reason)` where `reason` is one of `no-regression`, `window-elapsed`, `not-yet-in-window`, `not-accepted`, `not-armed`, `already-tripped`

Side-effect sequencing on trip:

1. Build a `TripEvent` with `rollback_result=None`
2. If `envelope_writer` is provided, call `set_regression_watch(experiment_id, {"state": "tripped", "tripped_by": post_close_snapshot, "tripped_at": now})`
3. If `auto_revert_callback` is provided, call it with `(envelope, rollback_ref)`
4. If the callback returns `success=True` and `envelope_writer` is provided, call `set_decision(experiment_id, "reverted")`
5. Return the final `TripEvent`

Writer behavior:

- `envelope_writer` is optional
- when omitted, the module still computes the trip result and still invokes the callback, but it performs no envelope writes

Delivery note:

- The `rollback-realism-proof-ambiguity` escalation remains open for S9; BL2.4 and BL2.6 will bind a real adapter and prove the end-to-end rollback path against concrete promotion machinery
