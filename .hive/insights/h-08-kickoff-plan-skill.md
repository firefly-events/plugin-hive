# h-08 kickoff-plan Skill — Implementation Insights

## gate_state and planning_gate_state are different fields

`gate_state` is the execution gate — it controls whether kickoff-exec can run and is the field
reconcile-tick's `pre_approved` check reads. `planning_gate_state` is the planning gate — it
tracks where `/plan` is in its lifecycle. Conflating the two is the key failure mode: if kickoff-plan
writes `gate_state: pre_approved` when planning completes, kickoff-exec fires immediately without
the intended human approval step. These must stay separate. kickoff-plan never writes `gate_state:
pre_approved` — that write belongs to a separate human action.

## Multica task terminal != planning gate approved

When the planning Multica issue reaches `terminal/success`, that means the planning agent finished.
It does NOT mean the human approved the plan. The completion signal goes to `handle-plan-complete`,
which writes `gate_state: null` and notifies the human. Only the human's explicit "go" reply
advances `gate_state` to `pre_approved`. Treating Multica completion as approval is the auto-advance
anti-pattern the gate-ownership invariant in `/plan`'s Phase 0 was written to prevent.

## Gate latch-before-Slack applies here too

Same fail-safe ordering as h-06: write `planning_gate_state: "gate_awaiting"` via `multica_write_state`
**before** calling `multica_slack_notify`. If Slack fails after the latch is written, the tick halts
with the gate correctly latched. If Slack is called first and fails, `planning_gate_state` is still
`"in_progress"` and reconcile-tick's next cron run could attempt to re-surface the gate or skip it
entirely depending on where it finds the planning issue. The latch-first order eliminates this race.

## The planning agent needs an explicit gate-comment protocol

The planning agent running `/plan` has no built-in mechanism to signal "waiting at gate X" in a
way that Hermes can detect via `multica_poll_task`. The gate-comment pattern
(`PLANNING_GATE: <gate_id>`) solves this: the planning agent posts a structured comment when it
reaches a gate and pauses. Hermes polls `multica_get_last_comment` for this pattern.
Without this protocol, Hermes would see the Multica issue as "still running" with no gate signal
and would never know a human decision is needed.

## `GATE_RESPONSE: approve` comment format matters

When Hermes posts the human's approval back to the planning issue, the format must match what the
planning agent polls for. If the planning agent expects `GATE_RESPONSE: approve` and Hermes posts
"Approved!" instead, the planning agent could time out waiting, or worse, treat the comment as
human feedback and try to apply it. Establish and test the exact comment format the planning agent
expects before wiring up the resolve path.

## revise path does not latch gate_awaiting

When the human picks `revise`, the planning agent needs to re-produce the gate artifact (e.g., revise
the design discussion) and post a new `PLANNING_GATE` comment. During that re-production,
`planning_gate_state` should be `"in_progress"`, not `"gate_awaiting"`. Setting it back to
`"in_progress"` after the `GATE_RESPONSE: revise` comment is posted ensures reconcile-tick's next
run calls `poll-planning-issue` instead of treating the gate as still open.

## No default action in Slack gate messages

The Slack message that surfaces a planning gate must NOT include a pre-written `approve` action
or suggest a default. If the Slack message says "We recommend approving — reply approve or ignore",
operators under time pressure will ignore it and the gate auto-advances effectively. Every planning
gate Slack message must require an active, explicit reply. This is the human-gate north star.
