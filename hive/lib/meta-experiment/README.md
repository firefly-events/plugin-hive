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

The implemented lifecycle modules are documented below.

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
- numeric event rows with `NaN` or `Infinity` values are skipped rather than added to the aggregate snapshot
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
- `regression_metrics`: names of metrics that tripped rejection, including numeric regressions over threshold and boolean regressions that flipped `True -> False`

Comparator convention:

- positive `delta_pct` means regression
- negative `delta_pct` means improvement
- the same `threshold_pct` scalar is applied uniformly across all numeric metrics
- numeric metrics are over threshold only when `delta_pct > threshold_pct`
- boolean metrics contribute to the verdict only when they flip in the regression direction from `True` to `False`

Scope:

- numeric metrics reject when they exceed the shared threshold
- boolean metrics reject immediately on a `True -> False` flip; there is no separate asymmetric threshold knob for booleans

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

## Closure validator module

Purpose: non-bypassable close-invariant gate per Q3. This module is a pure shared-library predicate; callers pass an envelope dict and receive either a pass or a distinct validation failure before ledger append.

API:

- `validate_closable(envelope)` raises on invalid close records and returns `None` on pass
- `is_closable(envelope)` returns a boolean and swallows validator exceptions

Required envelope fields for close:

- `decision`: one of `accept`, `reject`, or `reverted`; `pending` is not closable
- exactly one evidence field: `commit_ref` XOR `pr_ref`
- `metrics_snapshot`: non-empty dict
- `rollback_ref`: populated reference string

Distinct error classes:

- `CloseValidationError`
- `MissingEvidenceError`
- `AmbiguousEvidenceError`
- `MissingMetricsSnapshotError`
- `MissingRollbackTargetError`
- `InvalidDecisionError`

Evidence-shape guard:

- The architect raised `closure-evidence-shape-mismatch` in `.pHive/cycle-state/meta-improvement-system.yaml`: a shared closure validator could overfit direct-commit evidence and reject valid PR-only close records.
- This validator intentionally accepts current C1 `commit_ref` envelope evidence and forward-looking `pr_ref` envelope evidence. The current schema documents `commit_ref`; `pr_ref` acceptance is architecturally load-bearing so S10 does not have to retrofit the validator when the public PR-only close path lands.
- S9 ships the first direct-commit close evidence. S10 ships PR-only close evidence. Both satisfy this validator without changes.

## DirectCommitAdapter (BL2.1)

Purpose: maintainer-local promotion adapter that lands a worktree tip into the live repository with direct git commits rather than a PR flow.

Defaults:

- `repo_path` is the live checkout that receives the promotion
- `worktrees_root` defaults to `<repo_path>/.pHive/meta-team/worktrees`
- when `envelope["worktree_path"]` is omitted, the adapter derives `<worktrees_root>/<experiment_id>/`

Promotion semantics:

- `pass` and `needs_optimization` validate that the worktree exists and that its `HEAD` matches `candidate_ref`
- the adapter always captures the target branch pre-promotion `HEAD` as `rollback_target`
- it first attempts `git merge --ff-only <candidate_ref>` and falls back to `git cherry-pick <candidate_ref>` when fast-forward is unavailable
- on success it returns commit-backed evidence and removes the worktree
- on any promotion failure it aborts in-progress git operations, preserves the main tree at the pre-promotion `HEAD`, and force-removes the worktree
- on `needs_revision` it does not write to the main tree and only discards the worktree

Rollback semantics:

- rollback uses `git revert --no-edit <commit_ref>` on the target branch
- a successful rollback returns the new revert commit SHA in `revert_ref`
- rollback failures abort the revert and return `success=False`

Always returns `rollback_target`; pair with `closure_validator`.
