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

## External Coordinators (Hermes Equivalence)

Any cron- or webhook-capable coordinator can plug into the daily ceremony via
the same scheduler-as-trigger contract described in this document. Anthropic
Routines is the reference implementation, but it is not the only valid trigger.

**Hermes** (or any equivalent external supervisor) connects by:

1. Owning a cron schedule or trigger condition outside the Hive repo.
2. Invoking `/hive:standup --format slack` on the configured repo via CLI or
   webhook.
3. Capturing stdout and delivering the Phase 1 report verbatim to Slack (or
   another channel).

Because `--format slack` suppresses Phase 2/3 and all interactive prompts, the
invocation is safe to run under cron capture without a PTY. The output is
plain markdown suitable for direct Slack delivery.

**Phase 2/3 handoff remains operator-driven at MVP.** The operator sees the
Phase 1 report in Slack, then opens a Claude Code session to run Phase 2
(planning) and Phase 3 (execution) interactively. Auto-approve under cron is
not supported at MVP due to idempotency risk (see design-discussion §4 H4).

**No Routines-specific metadata required.** External coordinators do not need
to inject `under_scheduler` context. The `--format slack` flag is the sole
signal that differentiates cron-driven invocations from interactive ones. The
workflow's `plan-approval` pause step is never reached under `--format slack`,
so its `under_scheduler.auto_approve` field is irrelevant for this path.

This equivalence means any coordinator that can shell out (or call a webhook
that triggers a Claude Code run) can participate in the same daily-ceremony
pipeline as Routines — without bespoke integration work on Hive's side.
