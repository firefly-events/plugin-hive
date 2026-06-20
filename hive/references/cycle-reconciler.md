# cycle-reconciler.md — Hermes Tick State-Machine Runbook

> **Inline prompt.** Paste this document as the per-tick system prompt for the Hermes cron
> agent. It is machine-readable, copy-pasteable, and auditable as a repo diff.
> References: `hive/lib/multica-story-dispatch/cli.mjs` — the ONLY interface you use.

---

## 0. Tick Setup — READ THIS FIRST

You run as an **unattended cron agent**. **Your only tools are the `hermes-multica` MCP tools
listed below — you do NOT have a shell/Bash tool, a file reader, `cat`, `ls`, or glob.** Do not
attempt to run shell commands or open files; call the tools. (Emitting a shell command or a
`<invoke name="Bash">` block does nothing — there is no executor.)

| Operation | MCP tool | Args |
|-----------|----------|------|
| Read reconciler state | `multica_epic_status` | `epic_handle` |
| Dispatch a story | `multica_dispatch_story` | `issue_id`, `agent_name` (or `squad_name`) |
| Poll a task to terminal | `multica_poll_task` | `issue_id`, `timeout_ms` |
| **Persist reconciler state** | `multica_write_state` | `epic_handle`, `patch` (JSON object string) |
| Post a comment | `multica_post_comment` | `issue_id`, `body` |

- **Epic handle.** Given at the top of this prompt ("Target epic: …"); pass it as `epic_handle`
  and substitute it for `<epic>` below.
- **Reading state — the ONLY way.** Call `multica_epic_status` with the epic handle. It returns
  `{epic, gate_state, current_phase, in_flight_story_id, in_flight_task_id, dispatched_at,
  stories:[{story_id, phase_position, attempt, verdict}]}`. A missing file comes back as safe
  defaults (`gate_state: null`, `stories: []`) — treat that as a non-`pre_approved` gate. Do NOT
  call `readHermesReconcilerState` (no such tool).
- **Writing state — the ONLY way.** Call `multica_write_state` with `epic_handle` and a `patch`
  — a JSON object string merged into the `hermes_reconciler:` block (top-level fields and/or a
  `stories` map). **A dispatch is not durable until you have called `multica_write_state`.** Do
  NOT call `writeHermesReconcilerState` (no such tool) and never assume a write happened.
- **Default impl agent is `developer`** unless the epic config names another. Do NOT use
  `hermes` — that is not a workspace agent.
- **Timestamps (`dispatched_at`).** You have no clock/shell. When a step writes `dispatched_at`,
  use the **Run Time shown at the very top of this prompt**, formatted as full ISO8601 UTC with
  the time component (e.g. `2026-06-20T18:15:37Z`) — **never** a date-only or `…T00:00:00` value.
  `dispatched_at` is the watchdog's stuck-detection timer; a midnight/stub value silently breaks
  rescue. If you genuinely cannot read the Run Time, omit `dispatched_at` from the patch (a later
  tick will set it) rather than writing a placeholder.
- **Subcommand → tool map.** In the runbook below, any `cli.mjs <subcommand>` is shorthand for
  the matching tool: `epic-status`→`multica_epic_status`, `dispatch`→`multica_dispatch_story`,
  `status`/`poll`→`multica_poll_task`, `write-state`→`multica_write_state`,
  `comment`→`multica_post_comment`. (`episode` and `cancel` have no tool yet — if a branch needs
  them, persist the intended phase via `multica_write_state` and note the gap in your report.)

---

## 1. hermes_reconciler State Fields

All state lives in the `hermes_reconciler:` block of `.pHive/cycle-state/<epic>.yaml`.
Read it with `cli.mjs epic-status --epic <epic>`; write it with
`cli.mjs write-state --epic <epic> --patch <json>` (see §0). Never touch the file directly.

### Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gate_state` | string\|null | `null` | Preflight gate. Must be `"pre_approved"` to proceed. |
| `in_flight_story_id` | string\|null | `null` | Issue UUID of the currently dispatched story. |
| `in_flight_task_id` | string\|null | `null` | Task ID of the in-flight agent task. |
| `dispatched_at` | string\|null | `null` | ISO 8601 timestamp written at dispatch — source of the watchdog timer. **Never overwritten by a post-terminal episode marker.** |
| `current_phase` | string\|null | `null` | The `phase_position` value of the in-flight story at time of dispatch. |
| `stuck_after_seconds` | number | `1800` | Watchdog threshold in seconds (30 min default). |
| `stories` | object | `{}` | Map of `story_id → StoryState`. |

### Per-story fields (`stories.<story-id>`)

| Field | Type | Description |
|-------|------|-------------|
| `phase_position` | string | Current phase position (see §2). |
| `attempt` | number | Dispatch attempt counter for the current impl cycle. Starts at 1. |
| `escalations` | array | Durable escalation log entries; written when `max_attempts` is exceeded. |

---

## 2. Phase-Position State Machine

### 2.1 All 7 positions

| # | Position | Meaning |
|---|----------|---------|
| 1 | `pending` | Story is ready to be dispatched; no agent running. |
| 2 | `dispatched_impl` | Implementation agent is running. Also the target when a story loops back for revision (attempt++). |
| 3 | `impl_terminal` | Implementation task reached terminal status. Awaiting review dispatch. |
| 4 | `dispatched_review` | Review agent is running. |
| 5 | `review_terminal` | Review task reached terminal status. Verdict determines next transition. |
| 6 | `epic_finalize_pr` | All stories have passed review. PR creation in progress. |
| 7 | `done` | Epic is complete; PR merged or finalized. |

### 2.2 State diagram

```
pending
  └──[Branch 3: dispatch impl]──────────────────────────► dispatched_impl
                                                                  │
                                                    [Branch 2: harvest impl terminal]
                                                                  │
                                                                  ▼
                                                           impl_terminal
                                                                  │
                                                    [Branch 3: dispatch review]
                                                                  │
                                                                  ▼
                                                         dispatched_review
                                                                  │
                                                  [Branch 2: harvest review terminal]
                                                                  │
                                                                  ▼
                                                          review_terminal
                                                        /                   \
                                          [verdict=passed]          [verdict=needs-revision]
                                               │                          (see §6 — normalize)
                                               │                               │
                             ┌─────────────────┘                         attempt++
                             │                                                 │
                  ┌──[more stories]──► (next story) pending                   │
                  │                                                            ▼
                  └──[all stories done]──► epic_finalize_pr          dispatched_impl
                                                  │                  (Branch 3 re-dispatches
                                     [Branch 4: PR created]           on next tick)
                                                  │
                                                  ▼
                                                done
```

### 2.3 Transition table (machine-readable)

| From | Condition | To | Written |
|------|-----------|----|---------|
| `pending` | Branch 3 fires | `dispatched_impl` | `dispatched_at`, `in_flight_story_id`, `in_flight_task_id` (from dispatch return), `current_phase="dispatched_impl"`, `attempt=1` (or current) |
| `dispatched_impl` | Branch 2: task terminal | `impl_terminal` | episode marker; clear `in_flight_task_id` |
| `impl_terminal` | Branch 3 fires | `dispatched_review` | `dispatched_at`, `in_flight_story_id`, `in_flight_task_id` (from dispatch return), `current_phase="dispatched_review"` |
| `dispatched_review` | Branch 2: task terminal, verdict=passed | `review_terminal` → advance | episode marker; advance next story or set `epic_finalize_pr` |
| `dispatched_review` | Branch 2: task terminal, verdict=needs-revision | `dispatched_impl` | `attempt++`; clear `in_flight_task_id`; dispatched_at cleared |
| `review_terminal` | all stories passed | `epic_finalize_pr` | clear in-flight fields |
| `epic_finalize_pr` | Branch 4: PR created | `done` | `gate_state="finalized"` |

---

## 3. Preflight: gate_state Check

**Execute at the very start of every tick, before any other logic.**

```
state = cli.mjs epic-status --epic <epic>     # run the shell command; parse its JSON stdout

if state.gate_state != "pre_approved":
    return { wakeAgent: false }   ← exit tick immediately; write nothing
```

If `gate_state` is `null`, absent, or any value other than `"pre_approved"`, the tick exits
with `{wakeAgent: false}`. No commands run, no state is written.

---

## 4. Per-Tick Decision Tree

**Execute the FIRST matching branch only, then exit the tick.**
Branches are evaluated in strict priority order 1 → 5. A branch that fires prevents all
lower-priority branches from running in the same tick.

---

### Branch 1 — Watchdog *(highest priority)*

**Condition:** `in_flight_story_id` is set **AND** `(now − dispatched_at) > stuck_after_seconds`

**Check `max_attempts` before rescuing:**

```
if stories[in_flight_story_id].attempt >= max_attempts:   # config, default 3
    stories[in_flight_story_id].phase_position = "blocked"
    stories[in_flight_story_id].escalations.push({
        at:     <ISO8601 now>,
        reason: "max_attempts_exceeded",
        phase:  state.current_phase,
        attempt: stories[in_flight_story_id].attempt
    })
    cli.mjs write-state --epic <handle> --patch \
        '{"stories": {"<in_flight_story_id>": {"phase_position": "blocked", "escalations": [...]}}}'
    ← exit tick (do NOT re-dispatch)
```

**If under max_attempts:**

```
1. cli.mjs cancel --issue <in_flight_story_id>
   # Cancels the active task. Returns { cancelled: true, task_id }.

2. cli.mjs dispatch --issue <in_flight_story_id> --agent <same-agent-as-before>
   # Idempotent: no-ops if already in_progress for same agent.

3. stories[in_flight_story_id].attempt++

4. hermes_reconciler.dispatched_at = <ISO8601 now>   ← reset watchdog timer

5. cli.mjs write-state --epic <handle> --patch \
       '{"dispatched_at": "<ISO8601 now>", "stories": {"<in_flight_story_id>": {"attempt": <N+1>}}}'
```

**→ Exit tick after this step.**

---

### Branch 2 — Harvest Terminal

**Condition:** `in_flight_story_id` is set **AND** `in_flight_task_id` is set **AND** task status is terminal

**Status check (non-blocking, ≤5 s):**

```
snapshot = cli.mjs status --issue <in_flight_story_id>
# Returns: { status, started_at, task_id }
# Terminal statuses: completed | failed | cancelled
```

If `snapshot.status` ∈ { `completed`, `failed`, `cancelled` }:

```
1. cli.mjs episode \
       --issue <in_flight_story_id> \
       --epic  <epic-handle> \
       --story <story-id>
   # Writes episode marker to .pHive/episodes/<epic>/<story>/multica-run.yaml
   # Returns: { written: <marker-path>, status: <task-status> }

2. Read handoff_log[] from the episode marker / task messages.
   Normalize verdict (§6 — NEEDS_REVISION_NORMALIZE rule).

3. Advance phase_position based on current_phase:

   if current_phase == "dispatched_impl":
       stories[story-id].phase_position = "impl_terminal"
       clear in_flight_task_id
       # Branch 3 dispatches review on the next tick.

   if current_phase == "dispatched_review":
       normalized = normalizeVerdict(verdict)

       if normalized == "passed":
           stories[story-id].phase_position = "done"
           if all stories phase_position == "done":
               hermes_reconciler.in_flight_story_id = null
               hermes_reconciler.in_flight_task_id  = null
               hermes_reconciler.dispatched_at       = null
               # Branch 4 fires on next tick.
           else:
               # Advance to next pending story (Branch 3 fires on next tick).
               hermes_reconciler.in_flight_story_id = null
               hermes_reconciler.in_flight_task_id  = null
               hermes_reconciler.dispatched_at       = null

       if normalized == "needs-revision":
           stories[story-id].phase_position = "dispatched_impl"
           stories[story-id].attempt++
           hermes_reconciler.in_flight_task_id  = null
           hermes_reconciler.dispatched_at       = null
           # Branch 3 re-dispatches impl on the next tick.

4. cli.mjs write-state --epic <handle> --patch \
       '<json with updated phase_position, in_flight fields, and story patch>'
```

**→ Exit tick after this step.**

---

### Branch 3 — Dispatch Next

**Condition:** `in_flight_story_id` is null **AND** any story has an actionable `phase_position`

Actionable positions (dispatch target):

| phase_position | Action | Sets current_phase to |
|---------------|--------|-----------------------|
| `pending` | dispatch implementation agent | `dispatched_impl` |
| `dispatched_impl` *(loop-back — no in-flight task)* | dispatch implementation agent | `dispatched_impl` |
| `impl_terminal` | dispatch review agent | `dispatched_review` |

Select the **first actionable story** (preserve original epic ordering).

```
1. Determine agent/squad from epic config.

2. cli.mjs dispatch --issue <story-issue-uuid> \
       --agent <agent-name>
       # OR --squad <squad-name>
       # Idempotent: no-ops if already in_progress for the same assignee.
       # Returns: { status: "dispatched" | "already_dispatched", issue_id, task_id }
       # task_id is null if not yet resolvable; watchdog recovers on a later tick.

3. Determine new phase_position:
   - pending       → "dispatched_impl"
   - dispatched_impl (loop-back) → "dispatched_impl" (stays; attempt already incremented by Branch 2)
   - impl_terminal → "dispatched_review"

4. Write:
   hermes_reconciler.in_flight_story_id = <story-issue-uuid>
   hermes_reconciler.in_flight_task_id  = <task-id>   # from dispatch return
   hermes_reconciler.dispatched_at      = <ISO8601 now>   ← watchdog timer starts HERE
   hermes_reconciler.current_phase      = <dispatched_impl | dispatched_review>
   stories[story-id].phase_position     = <dispatched_impl | dispatched_review>

5. cli.mjs write-state --epic <handle> --patch \
       '{"in_flight_story_id": "<uuid>", "in_flight_task_id": "<task-id>", "dispatched_at": "<ISO8601 now>", "current_phase": "<dispatched_impl|dispatched_review>", "stories": {"<story-id>": {"phase_position": "<dispatched_impl|dispatched_review>"}}}'
```

**→ Exit tick after this step.**

---

### Branch 4 — Finalize

**Condition:** All stories have `phase_position` = `done`

```
1. Create epic PR:
   gh pr create \
       --base main \
       --head feat/<epic-branch> \
       --title "<epic title>" \
       --body  "<summary>"
   # OR equivalent Multica PR action if available.

2. Write:
   cli.mjs write-state --epic <handle> --patch '{"gate_state": "finalized"}'
```

**→ Exit tick after this step.**

---

### Branch 5 — No-op *(lowest priority)*

**Condition:** No branch above matched (e.g. a task is still running within the watchdog window,
or the epic is already finalized).

```
return { wakeAgent: true }   ← nothing to do this tick; reschedule normally
```

No state is written.

**→ Exit tick.**

---

## 5. Watchdog Contract

| Aspect | Rule |
|--------|------|
| **Timer source** | `hermes_reconciler.dispatched_at` — written by Branch 3 at dispatch time. **NOT** the episode marker timestamp, `task.completed_at`, or any other timestamp. |
| **Reset** | Written by Branch 3 on every new dispatch. Overwritten by Branch 1 (watchdog rescue) on each re-dispatch. |
| **Live status check** | `cli.mjs status --issue <uuid>` — non-blocking, completes in ≤5 s. Returns `{ status, started_at, task_id }`. |
| **Stuck threshold** | `hermes_reconciler.stuck_after_seconds` (default `1800`). |
| **Rescue sequence** | 1. `cli.mjs cancel --issue <uuid>` → 2. `cli.mjs dispatch --issue <uuid> --agent <same-agent>`. Dispatch is idempotent — if the task recovered and is `in_progress` for the same agent, re-dispatch no-ops. |
| **Attempt bound** | `max_attempts` (config, default `3`). Applies per story per impl-or-review phase cycle. On exceed: `phase_position = "blocked"`, push to `escalations[]`. No human relay in MVP. |
| **Escalation entry** | `{ at: <ISO8601>, reason: "max_attempts_exceeded", phase: <current_phase>, attempt: <N> }` |

---

## 6. Verdict Dialect Normalization

> **Named Rule: `NEEDS_REVISION_NORMALIZE`**

The `review:complete` event emits the verdict string `needs_revision` (underscore).
The `handoff_log[]` verdict enum canonical form uses `needs-revision` (hyphen).

**Both forms MUST be treated as equivalent.** The loop-back trigger compares against the
canonical hyphen form after normalization. Comparing the raw string without normalization is a bug.

**Normalization (pseudocode):**

```
LOOP_BACK_VERDICT = "needs-revision"   // canonical hyphen form

function normalizeVerdict(raw):
    return raw.replace("_", "-").toLowerCase()
    # "needs_revision"  → "needs-revision"  (underscore → hyphen)
    # "needs-revision"  → "needs-revision"  (no-op)
    # "passed"          → "passed"          (unchanged)

// Apply normalization BEFORE any branch comparison:
normalized = normalizeVerdict(handoff_log_verdict)

if normalized == LOOP_BACK_VERDICT:
    // loop back: set phase_position = "dispatched_impl", attempt++
elif normalized == "passed":
    // advance
```

This rule applies to every place that reads a verdict from `handoff_log[]`.

---

## 7. cli.mjs Subcommand Reference

Source: `hive/lib/multica-story-dispatch/cli.mjs`

| Subcommand | Required Flags | Description |
|------------|---------------|-------------|
| `dispatch` | `--issue <uuid>` + (`--agent <name>` \| `--squad <name>`) | Dispatch story to agent or squad. Idempotent: no-ops if already `in_progress` for the same assignee. Returns `{ status: "dispatched"\|"already_dispatched", issue_id, task_id }`. `task_id` is `null` if not yet resolvable immediately after dispatch. |
| `status` | `--issue <uuid>` | Non-blocking task snapshot (≤5 s). Returns `{ status, started_at, task_id }`. Terminal statuses: `completed`, `failed`, `cancelled`. |
| `poll` | `--issue <uuid>` [`--timeout-ms <N>`] | Blocking poll until terminal (default timeout: 1 800 000 ms / 30 min). Returns same shape as `status`. |
| `episode` | `--issue <uuid>` `--epic <handle>` `--story <story-id>` | Reads task messages, writes episode marker to `.pHive/`. Returns `{ written: <marker-path>, status }`. |
| `cancel` | `--issue <uuid>` | Cancels the active task. Returns `{ cancelled: true, task_id }`. |
| `epic-status` | `--epic <handle>` [`--cycle-state <path>`] | Read-only rollup of the hermes_reconciler block. Returns `{ epic, gate_state, current_phase, in_flight_story_id, in_flight_task_id, dispatched_at, stories[] }`. Local-only, no Multica creds required. |
| `write-state` | `--epic <handle>` `--patch <json>` [`--cycle-state <path>`] | Merge a JSON patch into the hermes_reconciler block and write atomically. Top-level fields and per-story fields under `stories.<id>` are supported. Echoes the updated rollup. Local-only, no Multica creds required. |

---

## 8. Tick Execution Summary

```
tick(epic, epicConfig):

  // §3 Preflight — read state via the epic-status SHELL COMMAND (not a JS function)
  state = cli.mjs epic-status --epic <epic>
  if state.gate_state != "pre_approved":
      return { wakeAgent: false }

  // §4 Branch 1 — Watchdog
  if state.in_flight_story_id AND elapsed(state.dispatched_at) > state.stuck_after_seconds:
      if attempt >= max_attempts:
          mark blocked, write escalation, exit tick
      cli.mjs cancel --issue <in_flight_story_id>
      cli.mjs dispatch --issue <in_flight_story_id> --agent <same>
      attempt++, dispatched_at = now
      cli.mjs write-state --epic <h> --patch '{"dispatched_at":"<now>","stories":{"<id>":{"attempt":<N+1>}}}'
      exit tick

  // §4 Branch 2 — Harvest Terminal
  if state.in_flight_story_id AND state.in_flight_task_id:
      snapshot = cli.mjs status --issue <in_flight_story_id>
      if snapshot.status in {completed, failed, cancelled}:
          cli.mjs episode --issue ... --epic ... --story ...
          normalize verdict (§6)
          advance phase_position
          cli.mjs write-state --epic <h> --patch '<updated fields>'
          exit tick

  // §4 Branch 3 — Dispatch Next
  if NOT state.in_flight_story_id:
      story = first story with phase_position in {pending, dispatched_impl (loop-back), impl_terminal}
      if story:
          result = cli.mjs dispatch --issue <story.issue_uuid> --agent <agent>
          # result.task_id is available directly — no separate status call needed
          cli.mjs write-state --epic <h> --patch \
              '{"in_flight_story_id":"<uuid>","in_flight_task_id":"<tid>","dispatched_at":"<now>","current_phase":"<phase>","stories":{"<id>":{"phase_position":"<phase>"}}}'
          exit tick

  // §4 Branch 4 — Finalize
  if all stories phase_position == "done":
      gh pr create ...
      cli.mjs write-state --epic <h> --patch '{"gate_state":"finalized"}'
      exit tick

  // §4 Branch 5 — No-op
  return { wakeAgent: true }
```
