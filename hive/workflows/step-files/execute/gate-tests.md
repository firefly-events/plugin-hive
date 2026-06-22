# Gate: Tests Validation

## Purpose

Confirm that the implementation artifact is non-empty before the reviewer runs.
In TDD mode this guards that the developer's implementation (which must pass
the pre-written failing tests) actually exists in the tree.

## Predicate

```
implementation must not be empty
```

## Retry policy

On gate failure, the upstream `implement` node re-runs up to `retry.max_attempts`
times (default 3). After the retry bound is exhausted the run fails — no infinite
loop, no LOOP primitive.

## Inputs

| Name             | Source      | Required | Notes                             |
|------------------|-------------|----------|-----------------------------------|
| `implementation` | step_output | required | Ref from the `implement` node.    |

## Outputs

| Name          | Type | Notes                       |
|---------------|------|-----------------------------|
| `gate_passed` | json | `true` when predicate holds. |
