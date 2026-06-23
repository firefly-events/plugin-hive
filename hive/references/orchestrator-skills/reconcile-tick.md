# reconcile-tick — Hermes Skill Runbook

> **Inline prompt.** This runbook defines the reconcile-tick skill — the canonical
> advance core for the Hermes orchestrator. One tick reads state, picks the first
> matching branch, acts once, and exits.
> References:
> - `hive/references/cycle-reconciler.md` — full state-machine spec and field contract
> - `hive/references/orchestrator-skills/slack-notify-await.md` — h-06 Slack surface for verdict surfacing
> - `hive/references/orchestrator-skills/monitor-epic.md` — composable pre-tick read
> MCP surface: `multica_epic_status`, `multica_dispatch_story`, `multica_poll_task`,
> `multica_write_state`, `multica_post_comment`.

---

## 0. Purpose

reconcile-tick is the **advance core**. On each tick it:

1. Reads gate state — refuses to advance unless `gate_state == "pre_approved"`.
2. Evaluates the five-branch decision tree in strict priority order.
3. Takes exactly **one** action (the first matching branch), writes state via
   `multica_write_state`, and exits.
4. Auto-advances **only** a `passed` + ff-merge-verified verdict (marks the story
   `done`). Every non-passing or unverified verdict surfaces to a human-gate hook
   and halts with `gate_state = "review_awaiting_human"` — and never auto-loops a
   revision. (The human reviews the exceptions; passing work flows through.)
5. Never marks a story done on an agent's claimed "pushed" status alone — verifies
   via ff-merge before advancing.

reconcile-tick is the **only** skill that writes to `hermes_reconciler` state.

---

## 1. Three Hard Lessons Baked In

### L-1: Watchdog — `dispatched_at` drives stuck-detection

`dispatched_at` is the **only** timer source for Branch 1. Never use a task
`completed_at`, an episode marker timestamp, or any other field. The value must come
from the **Run Time shown at the top of your prompt** (same source as cycle-reconciler
§0). If you genuinely cannot read the Run Time, **omit `dispatched_at` from the patch**
(a later tick sets it) rather than writing a midnight/stub value. A stub timestamp
silently breaks rescue.

### L-2: Verify, don't trust — agents over-claim "pushed"

An implementation agent saying "I pushed to feat/<branch_name>" is not evidence. Before
advancing a story from `review_terminal` to `done`, confirm the branch is an
**ff-merge ancestor of the epic branch HEAD**. Only a confirmed ff-merge is durable.

### L-3: Human gate at `review_terminal`

A non-passing verdict at `review_terminal` must **not** auto-advance the story or
auto-dispatch a revision. Instead:

1. Call the pluggable `surface-verdict` hook (stub defined in §6; h-06 provides the
   Slack transport implementation).
2. Set `gate_state = "review_awaiting_human"` via `multica_write_state`.
3. Halt the tick — no further branch evaluation.

The human restores `pre_approved` via:

```sh
cli.mjs write-state --epic <handle> --patch '{"gate_state":"pre_approved"}'
```

---

## 2. Inputs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `epic_handle` | Yes | Epic identifier (e.g. `hermes-integration-mvp`) |
| `epic_config` | Yes | Config object: `{ impl_agent, review_agent, max_attempts, stuck_after_seconds }` |
| `now` | Yes | ISO-8601 UTC Run Time from your prompt header — used for `dispatched_at` and elapsed calculations. If absent, omit timestamp writes rather than substituting a placeholder. |

---

## 3. Preflight — Gate Check

**Execute at the very start of every tick, before any branch.**

```
state = multica_epic_status(epic_handle)

// epic_of_record guard
if state.epic_of_record != null AND state.epic_of_record != epic_handle:
    return { wakeAgent: false }   // wrong instance; do nothing

// gate guard
if state.gate_state != "pre_approved":
    report "not approved — gate_state is <state.gate_state>; nothing advanced"
    return { wakeAgent: false }
```

If `gate_state` is `null`, `"review_awaiting_human"`, `"finalized"`, or any value other
than `"pre_approved"`, the tick exits immediately. No commands run, no state is written.

---

## 4. Branch Decision Tree

**Evaluate branches in strict priority order 1 → 5. Execute the FIRST matching branch,
then exit the tick.** A matching branch prevents all lower-priority branches from running
in the same tick.

---

### Branch 1 — Watchdog *(highest priority)*

**Condition:** `state.in_flight_story_id` is set **AND** elapsed time since
`state.dispatched_at` exceeds `epic_config.stuck_after_seconds` (default `1800`).

```
story = state.stories[state.in_flight_story_id]

if story.attempt >= epic_config.max_attempts:   // default max_attempts = 3
    escalation_entry = {
        at:      now,
        reason:  "max_attempts_exceeded",
        phase:   state.current_phase,
        attempt: story.attempt
    }
    multica_write_state(epic_handle, patch={
        "stories": {
            state.in_flight_story_id: {
                "phase_position": "blocked",
                "escalations": story.escalations + [escalation_entry]
            }
        }
    })
    report "story blocked after max_attempts"
    return   // ← exit tick; do NOT re-dispatch

// Under max_attempts — rescue
1. multica_cancel(state.in_flight_story_id)
   // cancels active task; idempotent if already terminal

2. multica_dispatch_story(state.in_flight_story_id, agent=story.last_agent)
   // idempotent: no-ops if already in_progress for same assignee

3. multica_write_state(epic_handle, patch={
       "dispatched_at": now,           // ← reset watchdog timer
       "stories": {
           state.in_flight_story_id: {
               "attempt": story.attempt + 1
           }
       }
   })
```

**→ Exit tick.**

---

### Branch 2 — Harvest Terminal

**Condition:** `state.in_flight_story_id` is set **AND** `state.in_flight_task_id` is
set **AND** task status is terminal.

```
snapshot = multica_poll_task(state.in_flight_story_id, timeout_ms=5000)
// Terminal statuses: completed | failed | cancelled

if snapshot.status NOT IN {completed, failed, cancelled}:
    fall through to Branch 3 check

// Task is terminal — read episode marker
episode = multica_episode(
    issue=state.in_flight_story_id,
    epic=epic_handle,
    story=state.in_flight_story_id
)
// Returns: { written, status }

// Normalize verdict (NEEDS_REVISION_NORMALIZE rule — cycle-reconciler §6)
raw_verdict = episode.handoff_log?.verdict ?? snapshot.status
normalized = raw_verdict.replace("_", "-").toLowerCase()
// "needs_revision" → "needs-revision"; "passed" → "passed"

if state.current_phase == "dispatched_impl":
    // Advance to impl_terminal; Branch 3 dispatches review on next tick
    multica_write_state(epic_handle, patch={
        "in_flight_story_id": null,
        "in_flight_task_id": null,
        "stories": {
            state.in_flight_story_id: {
                "phase_position": "impl_terminal"
            }
        }
    })

else if state.current_phase == "dispatched_review":

    if normalized == "passed":
        // VERIFY before advancing: ff-merge check (see §5)
        if NOT ff_merge_verified(state.in_flight_story_id):
            report "agent claimed pushed but ff-merge verification failed; halting"
            multica_write_state(epic_handle, patch={
                "gate_state": "review_awaiting_human",
                "in_flight_task_id": null,
                "dispatched_at": null
            })
            surface_verdict_hook({
                epic: epic_handle,
                story_id: state.in_flight_story_id,
                verdict: "push_unverified",
                reason: "ff-merge check failed; commit not reachable from epic branch HEAD"
            })
            return   // halt

        // Passed + verified
        multica_write_state(epic_handle, patch={
            "in_flight_story_id": null,
            "in_flight_task_id":  null,
            "dispatched_at":      null,
            "stories": {
                state.in_flight_story_id: {
                    "phase_position": "done"
                }
            }
        })
        // Branch 3 or 4 fires on next tick (next story or finalize)

    else:
        // Non-passing verdict — L-3: human gate, no auto-loop.
        // Latch the gate FIRST (fail-safe), THEN notify. surface_verdict_hook also
        // latches review_awaiting_human internally (idempotent) before posting to
        // Slack, so the gate stays halted even if the notification fails.
        multica_write_state(epic_handle, patch={
            "gate_state":         "review_awaiting_human",
            "in_flight_task_id":  null,
            "dispatched_at":      null
        })
        surface_verdict_hook({
            epic: epic_handle,
            story_id: state.in_flight_story_id,
            verdict: normalized,
            episode_path: episode.written
        })
        // HALT — do not dispatch revision; human resolves via resolve-gate
        // (approve marks the story done; revise re-dispatches; reject halts)
```

**→ Exit tick.**

---

### Branch 3 — Dispatch Next

**Condition:** `state.in_flight_story_id` is null **AND** any story has an actionable
`phase_position`.

Actionable positions:

| `phase_position` | Action | Sets `current_phase` to |
|-----------------|--------|------------------------|
| `pending` | Dispatch impl agent | `dispatched_impl` |
| `dispatched_impl` *(loop-back; no in-flight task)* | Dispatch impl agent | `dispatched_impl` |
| `impl_terminal` | Dispatch review agent | `dispatched_review` |

```
story = first story (in epic ordering) where phase_position in actionable set

if story is null:
    fall through to Branch 4

// Determine agent
if story.phase_position == "impl_terminal":
    agent = epic_config.review_agent ?? "reviewer"
else:
    agent = epic_config.impl_agent   ?? "developer"

result = multica_dispatch_story(story.issue_id, agent=agent)
// Returns: { status: "dispatched"|"already_dispatched", issue_id, task_id }
// task_id may be null if not yet resolvable — watchdog recovers on a later tick

new_phase = (story.phase_position == "impl_terminal") ? "dispatched_review" : "dispatched_impl"

multica_write_state(epic_handle, patch={
    "in_flight_story_id": story.issue_id,
    "in_flight_task_id":  result.task_id,    // null is acceptable; watchdog fills it
    "dispatched_at":      now,               // L-1: use Run Time, never a stub
    "current_phase":      new_phase,
    "stories": {
        story.issue_id: {
            "phase_position": new_phase,
            "attempt": (story.phase_position == "pending") ? 1 : story.attempt
        }
    }
})
```

**→ Exit tick.**

---

### Branch 4 — Finalize

**Condition:** Every story in `state.stories` has `phase_position == "done"`.

```
gh pr create \
    --base main \
    --head feat/<epic-branch> \
    --title "<epic title>" \
    --body  "<summary>"

multica_write_state(epic_handle, patch={
    "gate_state": "finalized"
})
```

**→ Exit tick.**

---

### Branch 5 — No-op *(lowest priority)*

**Condition:** No branch above matched (task still running within watchdog window, or
epic already finalized).

```
return { wakeAgent: true }   // nothing to do; reschedule normally
```

No state is written.

---

## 5. FF-Merge Verification

Called inside Branch 2 when `normalized == "passed"` on a `dispatched_review` phase.

```
function ff_merge_verified(story_id):
    // Read the commit SHA the review agent cited in its handoff_log or last comment
    claimed_sha = episode.handoff_log?.commit_sha ?? read_last_agent_comment_sha(story_id)

    if claimed_sha is null:
        return false   // agent gave no sha; cannot verify

    // Check reachability: is claimed_sha an ancestor of the epic branch HEAD?
    // Fetch first so we compare against the fresh remote tip (FETCH_HEAD), not a
    // stale remote-tracking ref — matches multica-story-dispatch/index.mjs.
    shell("git fetch <repoUrl> <branch>")
    result = shell("git merge-base --is-ancestor <claimed_sha> FETCH_HEAD")
    return result.exit_code == 0
```

If the check fails or `claimed_sha` is absent, treat it as unverified. Set
`gate_state = "review_awaiting_human"` and call `surface_verdict_hook` with
`verdict: "push_unverified"`. Do NOT mark the story `done`.

---

## 6. Surface-Verdict Hook (Stub)

reconcile-tick calls this pluggable hook at `review_terminal` when the verdict is
non-passing or when ff-merge verification fails. The hook is responsible for notifying
the operator; the tick sets `gate_state = "review_awaiting_human"` regardless of
whether the hook succeeds.

```
function surface_verdict_hook(payload):
    // payload: { epicHandle, storyId, verdict, episodeSummary?, diff? }
    // (field names match slack-notify-await.mjs buildVerdictMessage)

    // Default stub: post a Multica comment on the epic issue
    multica_post_comment(payload.epicHandle, body=
        "## Hermes: Verdict Requires Human Review\n\n" +
        "- Story: " + payload.storyId + "\n" +
        "- Verdict: **" + payload.verdict + "**\n" +
        (payload.episodeSummary ? "- Episode: " + payload.episodeSummary + "\n" : "") +
        (payload.diff ? "- Diff:\n```\n" + payload.diff + "\n```\n" : "") +
        "\nSet `gate_state = \"pre_approved\"` to continue after your review."
    )
    // h-06 (slack-notify-await.md) provides the Slack transport.
    // To wire it: call the slack-notify-await surface-verdict hook (slack-notify-await.mjs), not an MCP tool.
```

The hook is intentionally minimal. **Never** auto-dispatch a revision from inside this
hook — the human gate is non-negotiable.

---

## 7. Verdict Dialect Normalization

From cycle-reconciler §6 (`NEEDS_REVISION_NORMALIZE` rule):

```
LOOP_BACK_VERDICT = "needs-revision"   // canonical hyphen form

function normalizeVerdict(raw):
    return raw.replace("_", "-").toLowerCase()
    // "needs_revision" → "needs-revision"
    // "needs-revision" → "needs-revision"  (no-op)
    // "passed"         → "passed"          (unchanged)
```

Apply before **any** branch comparison. Comparing the raw string is a bug.

---

## 8. State Write Contract

1. **Only `multica_write_state` may write reconciler state.** No direct YAML edits.
2. Every branch that mutates state ends with exactly one `multica_write_state` call.
3. A dispatch is not durable until `multica_write_state` has been called with the
   updated `in_flight_story_id`, `in_flight_task_id`, `dispatched_at`, and
   `phase_position`. Exiting before this call leaves state inconsistent.
4. `in_flight_task_id: null` is acceptable — the watchdog will set it on the next tick
   if the dispatch returns `task_id: null`.

---

## 9. Tick Execution Summary

```
reconcile-tick(epic_handle, epic_config, now):

  // §3 Preflight
  state = multica_epic_status(epic_handle)
  if state.epic_of_record != null AND state.epic_of_record != epic_handle:
      return { wakeAgent: false }
  if state.gate_state != "pre_approved":
      return { wakeAgent: false }   // not approved — refuse to advance

  // §4 Branch 1 — Watchdog
  if state.in_flight_story_id AND elapsed(now, state.dispatched_at) > epic_config.stuck_after_seconds:
      if attempt >= max_attempts: mark blocked, write escalation, exit
      cancel → re-dispatch → attempt++ → write dispatched_at=now → exit

  // §4 Branch 2 — Harvest Terminal
  if state.in_flight_story_id AND state.in_flight_task_id:
      snapshot = multica_poll_task(state.in_flight_story_id, 5000)
      if snapshot.status terminal:
          episode = multica_episode(...)
          normalized = normalizeVerdict(verdict)
          if dispatched_impl:  advance to impl_terminal, write-state, exit
          if dispatched_review AND passed AND ff_merge_verified:
              mark done, write-state, exit
          else:
              surface_verdict_hook(...), gate_state=review_awaiting_human, write-state, exit

  // §4 Branch 3 — Dispatch Next
  if NOT state.in_flight_story_id:
      story = first actionable story
      if story: dispatch → write dispatched_at=now, in_flight fields, phase → exit

  // §4 Branch 4 — Finalize
  if all stories done:
      gh pr create → write gate_state=finalized → exit

  // §4 Branch 5 — No-op
  return { wakeAgent: true }
```

---

## 10. Invariants — Never Violated

| Invariant | Mechanism |
|-----------|-----------|
| **Gate required** | Tick exits immediately if `gate_state != "pre_approved"` |
| **Write-state only** | No direct YAML writes; every mutation goes through `multica_write_state` |
| **No auto-revision** | Branch 2 non-pass → `surface_verdict_hook` + `gate_state=review_awaiting_human`; never re-dispatches |
| **No auto-done on claim** | ff-merge verification required before `phase_position=done` on review pass |
| **Timestamp integrity** | `dispatched_at` = Run Time from prompt header; omitted (not stubbed) if unavailable |
| **Single action per tick** | First matching branch fires, then tick exits; no cascading branches |
| **Dispatch durability** | `multica_write_state` always follows `multica_dispatch_story` in same tick |

---

## 11. MCP Tool Reference

| Tool | Args | Notes |
|------|------|-------|
| `multica_epic_status` | `epic_handle` | Read-only rollup; returns `gate_state`, `current_phase`, `in_flight_*`, `stories[]`. |
| `multica_dispatch_story` | `issue_id`, `agent_name` | Returns `{ status, issue_id, task_id }`. `task_id` may be null. Idempotent. |
| `multica_poll_task` | `issue_id`, `timeout_ms` | Non-blocking at 5000 ms. Returns `{ status, started_at, task_id }`. |
| `multica_write_state` | `epic_handle`, `patch` | Atomic merge into `hermes_reconciler` block. Returns updated rollup. |
| `multica_post_comment` | `issue_id`, `body` | Posts a comment on the Multica issue. Used by the default surface-verdict stub. |

Shell fallbacks (`cli.mjs` subcommands) map 1:1 per cycle-reconciler §0 subcommand table.
