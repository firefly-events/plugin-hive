# Gate: Code Validation

## Purpose

Confirm that test artifacts were produced before the reviewer runs. Guards against
an empty-test condition masquerading as a green run.

## Predicate

```
test_artifacts must not be empty
```

## Retry policy

On gate failure, the upstream `test` node re-runs up to `retry.max_attempts` times
(default 3). After the retry bound is exhausted the run fails — no infinite loop,
no LOOP primitive.

## Inputs

| Name            | Source      | Required | Notes                        |
|-----------------|-------------|----------|------------------------------|
| `test_artifacts`| step_output | required | Ref from the `test` node.    |

## Outputs

| Name          | Type | Notes                      |
|---------------|------|----------------------------|
| `gate_passed` | json | `true` when predicate holds.|
