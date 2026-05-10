---
name: standup
description: Run the daily ceremony — standup, planning, execution.
---

# Hive Standup

Run the daily ceremony workflow: standup → planning → execution.

**Input:** `$ARGUMENTS` optionally contains an epic ID to focus on.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

## Process

Load `hive/workflows/daily-ceremony.workflow.yaml` and execute its three phases. Each phase has step files at `hive/workflows/steps/daily-ceremony/`.

**Phase 1 — Standup:** Reconstruct state from previous sessions. Read status markers (`.pHive/episodes/`), cycle state (`.pHive/cycle-state/`), task tracker (pending human items), and agent memories. Present structured report to user.

**Phase 2 — Planning:** User short-lists today's work. Evaluate whether items need new planning or are already storied. If new work, run a compressed planning swarm. Present plan with agent-ready checklist results. User approves.

**Phase 3 — Execution:** Kick off dev team(s) for approved work. After completion, run session-end evaluation for insight promotion/discard.

**Daily restart model:** The orchestrator starts fresh each day with a 1M context window. The standup phase compresses prior state into the new session via status markers, cycle state, and task tracker — not by resuming a prior conversation.

## Anthropic Routines (Recommended Scheduler)

For scheduled daily ceremony runs, use Anthropic Routines as the recommended scheduler. Routines should own the cron schedule and webhook delivery, while Hive continues to run the same `daily-ceremony.workflow.yaml` described above.

Use [../../hive/references/routines-integration.md](../../hive/references/routines-integration.md) as the full bridge contract for this setup, including the scheduler boundary, webhook trigger model, sandbox dry-run guidance, and fallback behavior when Routines is absent.

When wiring the scheduled path, make sure the workflow-level scheduler signal is present in [../../hive/workflows/daily-ceremony.workflow.yaml](../../hive/workflows/daily-ceremony.workflow.yaml): the `plan-approval` pause step must declare `under_scheduler.auto_approve: true`. That step-level metadata is what allows a non-interactive scheduler run to pass through plan approval without blocking; interactive runs still use the normal approval behavior.

This recommendation is additive only. Manual invocation via `/hive:standup` remains supported and should continue to run the same daily ceremony workflow when a human operator starts it directly.

## Step Files

| Step | File | Phase |
|------|------|-------|
| Load state | `hive/workflows/steps/daily-ceremony/step-01-load-state.md` | Standup |
| Load memories | `hive/workflows/steps/daily-ceremony/step-02-load-memories.md` | Standup |
| Present standup | `hive/workflows/steps/daily-ceremony/step-03-present-standup.md` | Standup |
| Select work | `hive/workflows/steps/daily-ceremony/step-04-select-work.md` | Planning |
| Validate stories | `hive/workflows/steps/daily-ceremony/step-05-validate-stories.md` | Planning |
| Approve plan | `hive/workflows/steps/daily-ceremony/step-06-approve-plan.md` | Planning |
| Kick off | `hive/workflows/steps/daily-ceremony/step-07-kick-off.md` | Execution |
| Session end | `hive/workflows/steps/daily-ceremony/step-08-session-end.md` | Execution |

## Key References

- `hive/workflows/daily-ceremony.workflow.yaml` — workflow definition
- `hive/references/agent-memory-schema.md` — insight evaluation at session end
- `hive/references/episode-schema.md` — status marker format
- `hive/agents/orchestrator.md` — orchestrator coordination guidance
