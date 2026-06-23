# kickoff-exec — Hermes Skill Runbook

> **Inline prompt.** This runbook defines the kickoff-exec skill — the "go" button for
> autonomous execution of a human-approved epic. Paste as context when a human says "go"
> (or a cron fires after a human has set `gate_state = "pre_approved"`).
> References:
> - `hive/references/orchestrator-skills/reconcile-tick.md` — the advance loop this skill starts
> - `hive/references/orchestrator-skills/slack-notify-await.md` — h-06 human gate transport
> - `hive/references/cycle-reconciler.md` — full state-machine spec and field contract
> MCP surface: `multica_epic_status`, `multica_write_state`, `multica_post_comment`.

---

## 0. Purpose

kickoff-exec is the **reconcile loop trigger**. It:

1. **Refuses to start** unless `gate_state == "pre_approved"`. The approval already happened
   (a separate human action set the latch); this skill enforces it as the entry gate.
2. **Verifies the loop is not already running** (idempotency guard — no double-dispatch).
3. **Starts the reconcile loop** by scheduling the first reconcile-tick invocation and
   confirming the epic is ready to advance.
4. **Never skips the review gate** — the loop it starts honors the `review_terminal` halt +
   Slack notify-await from reconcile-tick/slack-notify-await.

kickoff-exec is **not** a planning skill, not a human gate, and does not advance stories
itself. Its only job is to validate the preconditions and hand off to the reconcile loop.

---

## 1. When to Fire

| Trigger | Condition |
|---------|-----------|
| **Human says "go"** | Human ran `cli.mjs write-state --patch '{"gate_state":"pre_approved","epic_of_record":"<handle>"}'` and then invokes this skill |
| **Cron trigger** | A scheduled cron checks `gate_state`; if `pre_approved` and loop not running, fires kickoff-exec |
| **Never** | When `gate_state != "pre_approved"` — skill refuses and exits |
| **Never** | When the loop is already in flight (idempotency guard — see §3) |
| **Never** | When `gate_state == "finalized"` — epic is complete |
| **Never** | As a substitute for kickoff-plan — execution requires a completed, approved plan |

---

## 2. Inputs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `epic_handle` | Yes | Epic identifier (e.g. `hermes-integration-mvp`) |
| `epic_config` | Yes | Config object: `{ impl_agent, review_agent, max_attempts, stuck_after_seconds }` |
| `now` | Yes | ISO-8601 UTC Run Time from your prompt header. Passed to the first reconcile-tick invocation. If absent, omit timestamp writes rather than substituting a placeholder. |

---

## 3. Step-by-Step

```
kickoff-exec(epic_handle, epic_config, now):

  // Step 1 — Read current state
  state = multica_epic_status(epic_handle)

  // Step 2 — Gate check: refuse if not pre_approved
  if state.gate_state != "pre_approved":
      report "REFUSED: epic is not approved. gate_state is '" + state.gate_state + "'. " +
             "Set gate_state=pre_approved via: " +
             "cli.mjs write-state --epic " + epic_handle +
             " --patch '{\"gate_state\":\"pre_approved\",\"epic_of_record\":\"" + epic_handle + "\"}'"
      return { started: false, reason: "not_approved", gate_state: state.gate_state }

  // Step 3 — epic_of_record guard (prevents wrong-instance hijack)
  if state.epic_of_record != null AND state.epic_of_record != epic_handle:
      report "REFUSED: epic_of_record '" + state.epic_of_record + "' does not match target '" + epic_handle + "'. " +
             "This Hermes instance is not the owner of this epic."
      return { started: false, reason: "wrong_epic_of_record", epic_of_record: state.epic_of_record }

  // Step 4 — Idempotency guard: check if loop already in flight
  // A loop is in flight if in_flight_story_id is set with a non-terminal dispatched_at
  if state.in_flight_story_id != null:
      report "IDEMPOTENT: loop already running — in_flight_story_id=" + state.in_flight_story_id +
             ". No action taken. reconcile-tick will continue on the next cron tick."
      return { started: false, reason: "already_running", in_flight_story_id: state.in_flight_story_id }

  // Step 5 — Confirm there are actionable stories
  actionable = state.stories.filter(s =>
      s.phase_position IN {"pending", "dispatched_impl", "impl_terminal"}
  )
  all_done = state.stories.every(s => s.phase_position == "done")

  if state.stories is empty OR (actionable is empty AND NOT all_done):
      // No plan: either no stories exist or all are in a non-actionable state (blocked, etc.)
      report "REFUSED: no actionable stories found. Epic must have stories in pending, " +
             "dispatched_impl, or impl_terminal phase_position to start."
      return { started: false, reason: "no_actionable_stories" }

  if all_done:
      // All stories already done — kickoff-exec should not have fired; Branch 4 handles finalize
      report "REFUSED: all stories are done. reconcile-tick Branch 4 (finalize) should run instead."
      return { started: false, reason: "already_complete" }

  // Step 6 — Post a start notification comment on the epic issue
  multica_post_comment(epic_handle, body=
      "## Hermes: Execution Loop Started\n\n" +
      "- Epic: `" + epic_handle + "`\n" +
      "- gate_state: `pre_approved`\n" +
      "- Actionable stories: " + actionable.length + "\n" +
      "- First reconcile-tick will advance the first ready story.\n\n" +
      "The loop honors the review_terminal halt. A non-passing verdict will pause\n" +
      "execution and notify via Slack (h-06). Set `gate_state=pre_approved` to resume\n" +
      "after your review."
  )

  // Step 7 — Trigger first reconcile-tick
  // reconcile-tick reads state independently; no state write needed here.
  // The tick fires via the cron mechanism or direct invocation.
  // kickoff-exec hands off here — reconcile-tick drives the rest.
  reconcile_tick(epic_handle, epic_config, now)
  // If reconcile_tick is not directly callable (cron-only deployment):
  //   Post a comment confirming the loop is armed and the next cron tick will start it.
  //   The gate is already pre_approved; no further action needed.

  return { started: true, epic_handle: epic_handle, gate_state: "pre_approved" }
```

---

## 4. Gate Enforcement Contract

This skill is the **entry enforcer** for the pre_approved gate. The following table
summarizes every `gate_state` value and kickoff-exec's response:

| gate_state | kickoff-exec response |
|------------|----------------------|
| `null` | REFUSED — epic has not been approved. Report state, exit. |
| `"pre_approved"` | PROCEED — run idempotency guard (§3 Step 4), then start loop. |
| `"review_awaiting_human"` | REFUSED — loop is halted awaiting human review verdict. Do not restart. |
| `"finalized"` | REFUSED — epic is complete. Report state, exit. |
| any other value | REFUSED — unrecognized state. Report value, exit without advancing. |

**Gate refusals are loud, never silent.** Every refusal reports the current `gate_state`
and the action required to advance. This is a deliberate design choice: silent failures
here mean an operator thinks execution started when it didn't.

---

## 5. Idempotency Rules

kickoff-exec must be safe to call multiple times. The following rules enforce idempotency:

1. **In-flight guard (§3 Step 4):** If `in_flight_story_id` is set, a prior tick already
   dispatched a story. Log a message and return without action. Do NOT re-dispatch.

2. **reconcile-tick is idempotent:** Even if kickoff-exec fires again after the loop
   is running, calling reconcile-tick a second time hits its own idempotency guards
   (no duplicate dispatch if a story is already in-flight). Defense in depth.

3. **No state write on double-call:** kickoff-exec does not write state. It reads state
   and calls reconcile-tick. A second call sees the same state and either returns
   immediately (in-flight guard) or re-enters reconcile-tick idempotently.

---

## 6. Integration with reconcile-tick and slack-notify-await

kickoff-exec is the **entry point**. reconcile-tick is the **advance loop**. The
relationship:

```
kickoff-exec                reconcile-tick          slack-notify-await
     │                           │                         │
     ├─ gate check ────────────► │ (hands off here)        │
     │  (refuses if not         ├─ preflight gate ───────► │
     │   pre_approved)          ├─ branch 1-5             │
     │                          ├─ review_terminal ──────► surface-verdict
     │                          │                  ──────► gate latch
     │                          │                  ──────► Slack notify
     │                          └─ halts ◄──────────────── awaiting human
```

kickoff-exec does not call slack-notify-await directly. That path is wired through
reconcile-tick's `surface_verdict_hook` at `review_terminal`. kickoff-exec's only
Slack-visible artifact is the start comment posted in §3 Step 6.

---

## 7. Error Handling

| Error | Response |
|-------|----------|
| `multica_epic_status` returns null or errors | Log error. Treat as gate_state=null (not approved). Refuse to start. Do NOT fabricate state. |
| `multica_post_comment` fails | Log warning. Start comment is informational. Do NOT abort the loop start on comment failure. Proceed to Step 7. |
| `reconcile_tick` errors on first call | Log error. Report failure. Do NOT retry — the cron will re-fire kickoff-exec on the next interval; the gate is still pre_approved. |
| State is stale (in_flight + old dispatched_at) | Idempotency guard fires (§3 Step 4). reconcile-tick's Branch 1 watchdog will rescue the stuck story on its next cron tick — do NOT attempt rescue from kickoff-exec. |

---

## 8. MCP Tool Reference

| Tool | Args | Notes |
|------|------|-------|
| `multica_epic_status` | `epic_handle` | Read-only rollup. Returns `gate_state`, `current_phase`, `in_flight_*`, `stories[]`. |
| `multica_post_comment` | `issue_id`, `body` | Posts the start notification comment. Failure is non-fatal. |

kickoff-exec does **not** call `multica_write_state` — it reads state and hands off to
reconcile-tick, which owns all state writes.

---

## 9. Execution Summary

```
kickoff-exec(epic_handle, epic_config, now):

  // Read state
  state = multica_epic_status(epic_handle)

  // Gate check — refuse if not pre_approved
  if state.gate_state != "pre_approved":
      report refusal with current gate_state + remediation command
      return { started: false, reason: "not_approved" }

  // epic_of_record guard
  if state.epic_of_record != null AND state.epic_of_record != epic_handle:
      report refusal with mismatch
      return { started: false, reason: "wrong_epic_of_record" }

  // Idempotency guard — loop already running
  if state.in_flight_story_id != null:
      report already running; exit silently
      return { started: false, reason: "already_running" }

  // Story availability check
  if no actionable stories:
      report no actionable stories; refuse
      return { started: false, reason: "no_actionable_stories" }

  // Start notification comment (non-fatal if fails)
  multica_post_comment(epic_handle, start_message)

  // Hand off to reconcile-tick
  reconcile_tick(epic_handle, epic_config, now)

  return { started: true }
```

---

## 10. Invariants — Never Violated

| Invariant | Mechanism |
|-----------|-----------|
| **Gate required** | Exits immediately if `gate_state != "pre_approved"` — no exceptions |
| **No state writes** | kickoff-exec never calls `multica_write_state`; all state belongs to reconcile-tick |
| **Loud refusals** | Every gate refusal reports current state + remediation command |
| **No auto-approve** | kickoff-exec cannot set `gate_state = "pre_approved"`; that belongs to a human action |
| **No loop restart on stuck** | If `in_flight_story_id` is set, returns without action; watchdog in reconcile-tick Branch 1 handles rescue |
| **Comment failure non-fatal** | Start notification comment failure does not abort loop start |
