# h-05-reconcile-tick-skill — Insights

## 1. The "passed" verdict is not enough to mark done

Agents routinely claim "pushed to feat/<branch>" in their final message. This claim is
not evidence. Before setting `phase_position = "done"`, run a `git merge-base --is-ancestor
<claimed_sha> origin/<epic_branch>` check. If the claimed SHA is absent or not reachable from
the epic branch HEAD, the story is **not done** — set `gate_state = "review_awaiting_human"`
and let the human adjudicate. Skipping this check means a hallucinated push silently advances
the state machine.

## 2. `dispatched_at` is the one timer; a stub value breaks it silently

The watchdog's elapsed-time calculation reads only `hermes_reconciler.dispatched_at`. Any
other timestamp (task `started_at`, episode marker `written_at`, `completed_at`) is wrong.
If the cron environment doesn't provide a Run Time (Hermes has no shell clock), **omit the
field** from the patch — a later tick that does have the Run Time will fill it. Writing a
midnight/stub value (`2026-06-23T00:00:00Z`) sets the watchdog timer to midnight, making
every task appear stuck after 30 min and triggering spurious rescues.

## 3. Surface-verdict hook must be called before writing gate_state

The stub calls `multica_post_comment` first, then `multica_write_state`. That order matters:
if the write succeeds but the comment fails, the human will see the gate change with no
explanation. In practice, write-state is near-infallible (local file operation) while the
comment post is a network call — failing fast before the write gives you a clean retry.
The h-06 Slack transport follows the same ordering convention.

## 4. `in_flight_task_id: null` is a valid intermediate state

`multica_dispatch_story` may return `task_id: null` when the task isn't resolvable at
dispatch time. This is not an error — write `in_flight_task_id: null` to state anyway.
The watchdog in Branch 1 doesn't rely on `in_flight_task_id`; it only checks `dispatched_at`
elapsed time and re-dispatches idempotently. The task_id will be populated (or recovered) by
a later tick's Branch 2 snapshot.

## 5. One branch per tick is the stability invariant

Allowing two branches to fire in one tick (e.g. harvest + dispatch) creates a double-write
race and makes the audit log unreadable. The branch priority ordering (1→5) is strict: as
soon as one branch fires and calls `multica_write_state`, the tick exits. This is easy to
break by accident in a "just dispatch immediately" optimization — don't.
