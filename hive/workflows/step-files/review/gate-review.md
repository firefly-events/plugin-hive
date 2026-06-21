# Gate: Review Artifact Validation

## Purpose

Confirm that the committed review artifact is non-empty before the run is
considered complete. On gate failure the upstream reviewer node re-runs up to
`retry.max_attempts` times (no LOOP primitive).

## Predicate

```
review_artifact must not be empty
```

## Retry policy

On gate failure, the `reviewer` node re-runs up to `retry.max_attempts` times
(default 3). After the retry bound is exhausted the run fails — no infinite loop,
no LOOP primitive. This satisfies the s13 bounded-retry acceptance criterion.

## Inputs

| Name                   | Source      | Required | Notes                                    |
|------------------------|-------------|----------|------------------------------------------|
| `review_artifact`      | step_output | required | Ref from the `reviewer` node.            |
| `review_artifact_path` | context     | optional | Path to the committed artifact on disk.  |

## Outputs

| Name          | Type | Notes                        |
|---------------|------|------------------------------|
| `gate_passed` | json | `true` when predicate holds. |
