# slack-notify-await — Hermes Skill Runbook

> **Inline prompt.** This runbook defines the Slack notify-and-await human-gate transport.
> Paste as context alongside reconcile-tick when a surface-verdict or surface-error hook fires.
> References: `hive/lib/hermes-reconciler/slack-notify-await.mjs` — backing JS module.
> hermes-multica MCP tool used: `multica_write_state` (gate latch). The Slack post itself is an HTTP webhook
> (`HERMES_SLACK_WEBHOOK_URL`) handled by `slack-notify-await.mjs` — it is NOT an MCP tool.

---

## 0. Purpose

This skill is the **concrete channel for the human review gate** (and error/approval requests).
When reconcile-tick reaches `review_terminal` — or any error condition requiring human action —
it calls this skill instead of auto-advancing. The skill:

1. Latches `gate_state: "review_awaiting_human"` via `multica_write_state` **before** attempting Slack.
2. Posts a Slack message with the verdict/error context and the decision needed.
3. Returns `{ halted: true, gate_state: "review_awaiting_human" }`. The tick exits. Nothing advances.

The human reads the Slack message and responds. A follow-up trigger (incoming Slack action or
manual `resolve-gate` call) invokes this skill's resolution path to lift the gate.

---

## 1. When to Fire

| Trigger | Condition |
|---------|-----------|
| **surface-verdict** | reconcile-tick Branch 2 harvests `review_terminal` |
| **surface-error** | Any tick error that must not silently retry: dispatch failure, daemon down, max-attempts hit on a critical story |

Fire this skill in place of any auto-advance. **Never proceed past the hook without human action.**

---

## 2. Step-by-Step: Surface Verdict

```
surface-verdict(epic_handle, story_id, verdict, episode_summary, diff):

  // Step 1 — latch gate FIRST (fail-safe, before Slack is attempted)
  multica_write_state(
    epic_handle: <epic_handle>,
    patch: '{"gate_state": "review_awaiting_human"}'
  )

  // Step 2 — post Slack message
  message = buildVerdictMessage(epic_handle, story_id, verdict, episode_summary, diff)
  result  = slack_post(message)

  if result.error:
      // Slack failed — gate is already "review_awaiting_human"; log the error; DO NOT continue tick.
      log("WARN: Slack notify failed: " + result.error + ". Gate is 'review_awaiting_human'. Tick halted.")
      exit tick with error

  // Step 3 — halt
  return { halted: true, gate_state: "review_awaiting_human" }
  exit tick (do NOT proceed to any other branch)
```

### Verdict message format

```
## Review Verdict — <VERDICT_UPPERCASE>

- Epic: `<epic_handle>`
- Story: `<story_id>`
- Verdict: `<verdict>`

### Episode Summary
<episode_summary>

### Diff
```
<diff>
```

### Decision Required
Reply with one of:
- `approve` (or `continue`) — advance to the next story
- `revise` — send back for a new implementation attempt
- `reject` — halt this epic permanently
```

Omit Episode Summary and Diff sections if no content. Follow `standup-slack-format.md`
conventions: no ANSI, `##`/`###` headings, `-` lists, code blocks for tabular data.

---

## 3. Step-by-Step: Surface Error

```
surface-error(epic_handle, story_id, error_kind, details):

  // Step 1 — latch gate FIRST
  multica_write_state(
    epic_handle: <epic_handle>,
    patch: '{"gate_state": "review_awaiting_human"}'
  )

  // Step 2 — post Slack message
  message = buildErrorMessage(epic_handle, story_id, error_kind, details)
  result  = slack_post(message)

  if result.error:
      log("WARN: Slack notify failed: " + result.error + ". Gate is 'review_awaiting_human'. Tick halted.")
      exit tick with error

  // Step 3 — halt
  return { halted: true, gate_state: "review_awaiting_human" }
  exit tick
```

### Error message format

```
## Hermes Error — Action Required

- Epic: `<epic_handle>`
- Story: `<story_id>`   ← omit if not story-specific
- Error: `<error_kind>`

### Details
```
<details>
```

### Decision Required
Reply with one of:
- `continue` — acknowledge and resume from current state
- `reject` — halt this epic permanently
```

---

## 4. Fail-Safe Contract

| Failure mode | Behavior |
|-------------|----------|
| Slack webhook returns non-2xx | Gate stays `review_awaiting_human`. Error logged. Tick halts. |
| Slack unreachable (timeout / ECONNREFUSED) | Gate stays `review_awaiting_human`. Error logged. Tick halts. |
| `HERMES_SLACK_WEBHOOK_URL` not configured | Gate stays `review_awaiting_human`. Error thrown. Tick halts. |
| **Never** | Auto-advance without human confirmation. |

`gate_state: "review_awaiting_human"` is always written **before** the Slack call. Even if the Slack call
throws, the gate is already latched. The tick will not advance on the next cron run because
`gate_state != "pre_approved"` fails the §3 preflight check in reconcile-tick.

---

## 5. Gate Resolution (Human Response)

When the human responds via Slack, call `resolve-gate` with the epic handle, story ID
(for `revise`), and the action string.

| Action | Result |
|--------|--------|
| `approve` | `gate_state → pre_approved`; surfaced story `phase_position → done`, in-flight cleared — accept the verdict, story complete |
| `continue` | `gate_state → pre_approved` — error-ack resume from current state; **no story completed** |
| `revise` | `gate_state → pre_approved`, story `phase_position → dispatched_impl`, `attempt++`, in-flight cleared — next tick re-dispatches impl |
| `reject` | `gate_state → rejected` — epic halted permanently; no further advance |

`approve` and `continue` differ: `approve` answers a review verdict (mark the story done);
`continue` answers an error surface (resume without completing anything).

```
resolve-gate(epic_handle, story_id, action):

  validate action ∈ {approve, continue, reject, revise}

  // Precondition: only a gate that is actually awaiting a human is resolvable.
  // Refuse if gate_state != "review_awaiting_human" (a stale/misdirected action
  // must not resume a terminated epic or re-approve one that never halted).
  state = multica_epic_status(epic_handle)
  if state.gate_state != "review_awaiting_human":
      throw "nothing awaiting human resolution"

  if action == "reject":
      multica_write_state(epic_handle, '{"gate_state": "rejected"}')
      return { resolved: true, gate_state: "rejected" }

  if action == "revise":
      if story_id not in state.stories: throw "unknown story"
      new_attempt = state.stories[story_id].attempt + 1
      multica_write_state(epic_handle, '{
        "gate_state": "pre_approved",
        "in_flight_story_id": null,
        "in_flight_task_id": null,
        "dispatched_at": null,
        "stories": {"<story_id>": {"phase_position": "dispatched_impl", "attempt": <new_attempt>}}
      }')
      return { resolved: true, gate_state: "pre_approved", action: "revise" }

  if action == "approve":
      // Accept the verdict — mark the surfaced in-flight story done + clear in-flight.
      story = state.in_flight_story_id
      multica_write_state(epic_handle, '{
        "gate_state": "pre_approved",
        "in_flight_story_id": null, "in_flight_task_id": null, "dispatched_at": null,
        "stories": {"<story>": {"phase_position": "done"}}
      }')
      return { resolved: true, gate_state: "pre_approved", action: "approve", story_done: <story> }

  // continue — error-ack resume; completes no story
  multica_write_state(epic_handle, '{"gate_state": "pre_approved"}')
  return { resolved: true, gate_state: "pre_approved" }
```

---

## 6. Integration with reconcile-tick

In the reconcile-tick `review_terminal` branch (§4 Branch 2), replace the direct phase
advance with:

```diff
  if normalized == "passed":
+     if NOT ff_merge_verified(story-id):     # never trust a claimed push (§5)
+         call surface-verdict(epic_handle, story_id, "push_unverified", episode_summary, diff)
+         exit tick   ← halt for human
      stories[story-id].phase_position = "done"   # passed + verified → auto-advance
      ...advance or finalize...

- if normalized == "needs-revision":
-     stories[story-id].phase_position = "dispatched_impl"
-     ...
+ if normalized == "needs-revision":
+     call surface-verdict(epic_handle, story_id, "needs-revision", episode_summary, diff)
+     exit tick   ← human chooses approve (mark done) / revise / reject (not auto-loop)
```

A `passed` + ff-merge-verified verdict advances to `done` with no human gate — the human
reviews only the exceptions (non-passing, unverified, or error). For the gated cases, the
gate_state latch from surface-verdict ensures the next tick's §3 preflight check blocks
until the human responds via resolve-gate (`approve` marks the surfaced story done).

For error conditions (dispatch failure, daemon not responding, max-attempts exceeded on a story
the operator must review), replace any silent retry or auto-escalation with:

```
call surface-error(epic_handle, story_id, error_kind, details)
exit tick
```

---

## 7. MCP Tool Reference

| Tool / surface | Args | Notes |
|------|------|-------|
| `multica_write_state` (MCP) | `epic_handle`, `patch` (JSON string) | Atomic write; use for all gate_state transitions |
| `multica_epic_status` (MCP) | `epic_handle` | Read gate_state + stories for resolve-gate revise path |
| Slack post (**not MCP**) | `message` ({ text: string }) | Direct HTTP POST to `HERMES_SLACK_WEBHOOK_URL` (`{"text": "<message>"}`), done by `slack-notify-await.mjs` |

The Slack post is **not** an MCP tool — it is a direct HTTP POST to the webhook in
`HERMES_SLACK_WEBHOOK_URL`, performed by `slack-notify-await.mjs`. The gate_state write
(`multica_write_state`) is always first, so the gate stays latched even if the Slack post fails.
