# kickoff-plan — Hermes Skill Runbook

> **Inline prompt.** This runbook defines how Hermes starts `/plan` in Multica mode and
> routes each planning gate to the human via Slack notify-await. Paste as context alongside
> reconcile-tick when a `plan_required` trigger fires.
> References:
> - `skills/plan/SKILL.md` — the `/plan` skill, gate-ownership invariant, gate list
> - `hive/references/orchestrator-skills/slack-notify-await.md` — human gate transport
> - `hive/lib/hermes-reconciler/slack-notify-await.mjs` — backing JS module
> MCP surface: `multica_dispatch_story`, `multica_poll_task`, `multica_write_state`,
> `multica_post_comment`, `multica_slack_notify`.

---

## 0. Purpose

This skill is the **planning trigger**. When a new requirement arrives, kickoff-plan:

1. Sets `planning_gate_state: "in_progress"` in hermes_reconciler state.
2. Dispatches `/plan` in Multica mode on a planning agent.
3. Polls the planning issue; when a gate comment arrives, surfaces it to the human via
   Slack notify-await and **halts** — it does NOT post an automatic answer.
4. When the human approves the gate via Slack, posts the approval to the planning issue
   so `/plan` can proceed.
5. When `/plan` completes (terminal), writes `planning_gate_state: null` — **not**
   `pre_approved`. `gate_state` stays null until a **separate human action** triggers
   kickoff-exec.

Hermes' role is to **start** planning and **route gates to humans**. It does not:
- Answer design questions
- Sign off on design discussions, H/V plans, or outlines
- Auto-advance any planning gate because a Multica issue completed
- Mint stories or epics outside this gated flow (or `/triage --hand-off`)

---

## 1. When to Fire

| Trigger | Condition |
|---------|-----------|
| `plan_required` | A new requirement arrives and `planning_gate_state` is null or missing |
| **Never** | Retry automatically while `planning_gate_state == "gate_awaiting"` — a human gate is open |
| **Never** | When `gate_state == "pre_approved"` — execution is in progress; planning is already done |

Check `planning_gate_state` before firing. If `"in_progress"` or `"gate_awaiting"`, a prior
run already started. Check the in-flight planning issue status before re-dispatching.

---

## 2. Planning Gates

`/plan` has four user-facing sign-off gates. Each gate is a point where the running planning
agent **cannot proceed without human input**. When Hermes detects a gate comment, it treats it
as a `review_terminal` equivalent and calls `slack-notify-await`.

| Gate | /plan Step | Trigger pattern in planning issue comment |
|------|-----------|-------------------------------------------|
| Design review | Step 5 | `PLANNING_GATE: design_discussion` |
| H/V plan review | Step 8 | `PLANNING_GATE: hv_plan` |
| Structured outline sign-off | Step 10 | `PLANNING_GATE: structured_outline` |
| Final plan confirmation | Step 18 | `PLANNING_GATE: confirm` |

The planning agent running `/plan` **must** post a structured comment when it reaches each gate.
The comment format is:

```
PLANNING_GATE: <gate_id>

## [Gate name] — Input Required

<Gate-specific summary, questions, scale decision, or traceability check>

Reply `approve`, `revise`, or `reject` to proceed.
```

Hermes polls for this comment pattern. On detection it halts and surfaces the gate to the human
via Slack. The human's response is then posted back as a comment on the planning issue.

---

## 3. Step-by-Step: Start Planning

```
kickoff-plan(epic_handle, requirement):

  // Step 1 — write initial state
  multica_write_state(
    epic_handle: <epic_handle>,
    patch: '{
      "planning_gate_state": "in_progress",
      "planning_requirement": "<requirement>",
      "planning_issue_id": null,
      "planning_current_gate": null,
      "dispatched_at": "<ISO8601 UTC now from Run Time>"
    }'
  )

  // Step 2 — dispatch the planning issue
  planning_story = buildPlanningStory(epic_handle, requirement)
  result = multica_dispatch_story(
    issue_id: <planning_issue_id>,
    agent_name: "developer"   // or the configured planning agent
  )

  if result.error:
      call surface-error(epic_handle, null, "DISPATCH_FAILED", result.error) // via slack-notify-await
      exit

  // Step 3 — persist planning issue ID
  multica_write_state(
    epic_handle: <epic_handle>,
    patch: '{"planning_issue_id": "<result.task_id>"}'
  )

  // Step 4 — enter poll loop (each cron tick resumes here via reconcile-tick)
  exit  // next tick will call poll-planning-issue
```

### Building the planning story

The planning issue sent to the planning agent MUST include:
- The verbatim requirement text
- The directive: "Run `/plan` for this requirement. Post a `PLANNING_GATE: <gate_id>` comment at each user-facing gate (design_discussion, hv_plan, structured_outline, confirm). Wait for a human `approve`, `revise`, or `reject` reply before proceeding past each gate."
- The epic handle for state writes
- `HIVE_PLANNING_MODE=multica` in the environment or the note to set `planning.mode: multica` in `hive.config.yaml`

---

## 4. Step-by-Step: Poll Planning Issue (per tick)

```
poll-planning-issue(epic_handle):

  state  = multica_epic_status(epic_handle)
  task   = multica_poll_task(state.planning_issue_id, timeout_ms: 0)  // non-blocking check

  if task.status == "terminal" and task.outcome == "success":
      call handle-plan-complete(epic_handle)
      return

  if task.status == "terminal" and task.outcome != "success":
      call surface-error(epic_handle, null, "PLANNING_FAILED", task.error)
      return

  // Non-terminal: check for a gate comment
  last_comment = multica_get_last_comment(state.planning_issue_id)

  if last_comment matches /^PLANNING_GATE: (\w+)/m:
      gate_id = match[1]
      call surface-planning-gate(epic_handle, gate_id, last_comment.body)
      return

  // Still running, no gate comment — do nothing; next tick will re-check
  return
```

---

## 5. Step-by-Step: Surface Planning Gate

```
surface-planning-gate(epic_handle, gate_id, gate_body):

  // Step 1 — latch gate FIRST (fail-safe before Slack)
  multica_write_state(
    epic_handle: <epic_handle>,
    patch: '{
      "planning_gate_state": "gate_awaiting",
      "planning_current_gate": "<gate_id>"
    }'
  )

  // Step 2 — post Slack message
  message = buildGateMessage(epic_handle, gate_id, gate_body)
  result  = multica_slack_notify(message)

  if result.error:
      log("WARN: Slack notify failed: " + result.error + ". Gate latched 'gate_awaiting'. Tick halted.")
      exit tick with error

  // Step 3 — halt
  return { halted: true, planning_gate_state: "gate_awaiting" }
  exit tick — do NOT post approve/revise/reject automatically
```

### Gate message format

```
## Hermes Planning Gate — <GATE_ID_UPPERCASE>

- Epic: `<epic_handle>`
- Gate: `<gate_id>`

### Content Requiring Review
<gate_body>

### Decision Required
Reply with one of:
- `approve` — proceed past this planning gate
- `revise` — ask the planning agent to revise before proceeding
- `reject` — abandon planning for this requirement

Your response will be forwarded to the planning agent.
```

**Never** include a default action or a pre-written approval in the Slack message. The human
must actively respond. An automated approval is the same as auto-advancing the gate.

---

## 6. Step-by-Step: Resolve Planning Gate (Human Response)

```
resolve-planning-gate(epic_handle, gate_id, action, human_feedback):

  validate action ∈ {approve, revise, reject}

  if action == "reject":
      multica_write_state(epic_handle, '{"planning_gate_state": "rejected"}')
      state = multica_epic_status(epic_handle)
      multica_post_comment(state.planning_issue_id, "Planning rejected by human. Stopping.")
      return { resolved: true, planning_gate_state: "rejected" }

  if action == "revise":
      multica_post_comment(
        state.planning_issue_id,
        "GATE_RESPONSE: revise\n\n" + human_feedback
      )
      // planning_gate_state stays "in_progress" — the planning agent will re-produce
      // the gate artifact and post another PLANNING_GATE comment when ready
      multica_write_state(epic_handle, '{
        "planning_gate_state": "in_progress",
        "planning_current_gate": null
      }')
      return { resolved: true, planning_gate_state: "in_progress" }

  // approve
  multica_post_comment(
    state.planning_issue_id,
    "GATE_RESPONSE: approve\n\n" + (human_feedback || "Approved.")
  )
  multica_write_state(epic_handle, '{
    "planning_gate_state": "in_progress",
    "planning_current_gate": null
  }')
  return { resolved: true, planning_gate_state: "in_progress" }
```

---

## 7. Step-by-Step: Handle Plan Complete

```
handle-plan-complete(epic_handle):

  // /plan has finished. gate_state MUST remain null — not pre_approved.
  // Pre_approved is only set by a separate human action that enables kickoff-exec.

  multica_write_state(
    epic_handle: <epic_handle>,
    patch: '{
      "planning_gate_state": "complete",
      "planning_current_gate": null,
      "gate_state": null
    }'
  )

  // Notify human that planning is done and awaiting their go/no-go for execution
  message = buildPlanCompleteMessage(epic_handle)
  multica_slack_notify(message)

  return { planning_complete: true, gate_state: null }
  // kickoff-exec cannot fire until a human action sets gate_state = "pre_approved"
```

### Plan-complete message format

```
## Hermes — Planning Complete

- Epic: `<epic_handle>`

Planning has finished. Stories are decomposed and written to disk.

To begin execution, approve the plan:
- Reply `go` (or `approve`) to set gate_state = pre_approved and start kickoff-exec
- Reply `reject` to abandon this plan
- Or review the epic stories first, then reply

**No execution will start automatically.** You must approve to proceed.
```

---

## 8. Invariants — Never Violated

| Invariant | Mechanism |
|-----------|-----------|
| **No auto-advance at any planning gate** | Gate comment detection always calls `surface-planning-gate`; no branch advances `planning_gate_state` without a human `GATE_RESPONSE` comment |
| **gate_state stays null after /plan completes** | `handle-plan-complete` explicitly writes `gate_state: null`; only a human action writes `gate_state: pre_approved` |
| **No story minting outside this flow** | All story decomposition happens inside the planning agent running `/plan`; Hermes only dispatches the planning issue, never writes story YAMLs |
| **Multica completion ≠ gate approval** | A planning Multica issue moving to `terminal/success` triggers `handle-plan-complete`, NOT `pre_approved`; they are different events |
| **Gate latch before Slack** | `planning_gate_state: "gate_awaiting"` written before Slack post; if Slack fails, gate stays latched and tick halts (same fail-safe as `slack-notify-await`) |

---

## 9. State Field Reference

These fields live in the `hermes_reconciler:` block under `planning:`:

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `planning_gate_state` | string\|null | `null`, `in_progress`, `gate_awaiting`, `complete`, `rejected` | Current planning phase |
| `planning_requirement` | string | — | Verbatim requirement text that started this plan run |
| `planning_issue_id` | string\|null | Multica issue UUID | The dispatched planning agent issue |
| `planning_current_gate` | string\|null | `design_discussion`, `hv_plan`, `structured_outline`, `confirm` | Gate currently awaiting human input |
| `gate_state` | string\|null | `null`, `pre_approved`, `awaiting`, `rejected` | Execution gate — set by kickoff-exec, NOT by kickoff-plan |

`kickoff-plan` never writes `gate_state: pre_approved`. That is the execution gate and belongs to
the separate human approval step that enables `kickoff-exec`.

---

## 10. Integration with reconcile-tick

In the reconcile-tick, add a planning branch **before** the existing `pre_approved` check:

```diff
+ // Planning branch — runs when planning is in progress or awaiting a gate
+ if state.planning_gate_state == "in_progress":
+     call poll-planning-issue(epic_handle)
+     exit tick
+
+ if state.planning_gate_state == "gate_awaiting":
+     // A human gate is open. Do NOT re-surface unless the latch has expired (no latch TTL today).
+     exit tick (do nothing)
+
  // Execution branch — only reachable after planning_gate_state == "complete"
  // AND gate_state == "pre_approved" (human approved execution)
  if gate_state != "pre_approved":
      exit tick (no-op)
  ...existing reconcile-tick branches...
```

The planning branch is checked first. Execution never starts while `planning_gate_state` is
`in_progress` or `gate_awaiting` — the two branches are mutually exclusive by control flow.
