# Outcomes Integration

This note defines the contract for wrapping `hive/workflows/code-review.workflow.yaml`
in an Outcomes loop.

## Loop Contract

- The loop wraps the workflow's `review` step; it does not replace the `analyze`
  step or the `summarize` step.
- Convergence is driven by the shared rubric file:
  [`rubric-format.md`](rubric-format.md).
- Each iteration runs own-context graders on the Messages-API substrate from S5
  via [`hive/lib/messages-session.js`](../lib/messages-session.js).
- Grader verdicts aggregate with this precedence:
  `needs_revision` → `needs_optimization` → `passed`.
- The loop terminates when either:
  - the aggregated verdict is `passed` (`terminated_by: rubric_pass`)
  - `circuit_breakers.max_outcomes_iterations` is reached
    (`terminated_by: iter_cap`)
  - the enclosing run budget halts the loop (`terminated_by: budget`)

## Peer Validator Stacking

Outcomes and `peer-validator` are stacked, not redundant.

- Outcomes owns convergence on the reviewer verdict.
- `peer-validator` runs exactly once after the loop terminates.
- Both consume the same rubric file, so the post-loop gate is deterministic and
  checks the final loop artifact rather than a different standard.

## Budget Envelope

- Initial breaker: `circuit_breakers.max_outcomes_iterations: 3`
- This is intentionally symmetric with `max_fix_iterations: 3`.
- This slice does not tune the cap to `5`.
- Every loop completion emits one metrics event carrying:
  `story_id`, `iterations_used`, `terminated_by`, and `final_verdict`.

## Q7 Escalation

Q7 is the budget-envelope review path for the Outcomes loop.

- Land the cap at `3` in S15.
- Review the metric distribution at `+30 days` from S15 close.
- Tune to `5` only if more than `40%` of loops hit the cap.
- TPM owns the calendar reminder and the follow-up decision.
