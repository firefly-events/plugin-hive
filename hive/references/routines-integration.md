# Routines Integration
Hive can use Anthropic Routines as the scheduler-facing trigger layer for
`daily-ceremony.workflow.yaml`. In this arrangement, Routines owns the cron
schedule and webhook delivery, while Hive owns the workflow semantics, gates,
and local execution contract.

## Integration Boundary

The boundary is intentionally narrow:

- Routines decides when to invoke the daily ceremony.
- The webhook launches Hive's `daily-ceremony.workflow.yaml`.
- Hive evaluates the workflow YAML exactly as written; Routines does not
  rewrite step behavior or inject alternate gate policy.

This keeps the scheduling concern outside the workflow while preserving one
source of truth for ceremony behavior inside the repo.

## Daily Ceremony Trigger Model

For the daily ceremony, treat Routines as "cron plus delivery" rather than as
an alternate workflow engine. The expected flow is:

1. Routines fires on its configured schedule.
2. Routines sends a webhook to the Hive entrypoint for the sandbox or real repo.
3. Hive starts `daily-ceremony.workflow.yaml`.
4. Hive executes the workflow's declared steps and gates using normal local
   semantics.

If the same ceremony is started interactively, the workflow remains the same.
Only the invocation path changes.

## Scheduler Override Semantics

`daily-ceremony.workflow.yaml` declares `under_scheduler.auto_approve: true`
on the `plan-approval` pause step. This is a workflow-level signal on the step,
not a user config flag and not a global scheduler toggle.

Under the workflow schema contract:

| Field | Scheduler behavior |
|-------|--------------------|
| `under_scheduler.auto_approve: true` | Auto-passes the pause step without dispatching the pause handler. |
| `under_scheduler.auto_approve: false` | Fails closed with an error instead of blocking on a non-interactive pause. |
| Interactive run | Ignores `under_scheduler` and runs the pause normally. |

For daily ceremony scheduling, that means the scheduler context may pass
through `plan-approval` only because the workflow explicitly opted in at the
step level. Consumers should not infer that any other interactive gate will do
the same unless its workflow YAML declares the same metadata.

## Sandbox Dry-Run Guidance

Before pointing Routines at a real working repository, dry-run against a
sandbox repo that contains a valid Hive setup and a harmless ceremony target.

Validate these conditions first:

- The webhook launches `daily-ceremony.workflow.yaml`, not a different workflow.
- Scheduler context reaches `plan-approval` and auto-passes because the step
  carries `under_scheduler.auto_approve: true`.
- Downstream execution still respects normal workflow gates after that pause.
- Run artifacts, logs, and pause telemetry are written where operators expect.
- A failed or malformed webhook does not mutate real work in the sandbox repo.

Promote to a real workload only after the sandbox run proves the invocation
path, the auto-approval pass-through, and the post-trigger observability.

## Capability Skip When Routines Is Unreachable

Routines is an optional trigger capability, not a hard runtime dependency for the
ceremony itself. If Routines is unreachable, unavailable, or not configured:

- Do not treat that condition as a workflow error.
- Do not synthesize a fake scheduler context.
- Fall back to the normal interactive ceremony entry path.

This is a capability skip, not a failure of `daily-ceremony.workflow.yaml`. The
ceremony remains runnable by a human operator even when the remote trigger
layer is absent.
