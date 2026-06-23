# h-07 kickoff-exec Skill — Implementation Insights

## kickoff-exec is a gate enforcer, not a state writer

The central design constraint: kickoff-exec never calls `multica_write_state`. It reads
state and hands off to reconcile-tick, which owns all state writes. This keeps the write
authority boundary clean: if kickoff-exec wrote state, you'd need to ensure it doesn't
race with an in-flight tick. By staying read-only, it's trivially idempotent and can fire
from cron without coordination.

## Loud refusals are the north star

Every gate refusal must report the current `gate_state` AND the exact CLI command to
advance. Silent refusals — returning `{ started: false }` with no message — are the
failure mode that burns operators: they run kickoff-exec, see no output, assume it
started, and discover an hour later nothing advanced. "The epic is not approved" is not
enough; print `cli.mjs write-state --epic <handle> --patch '{"gate_state":"pre_approved",...}'`.

## Idempotency guard reads in_flight_story_id, not a running-flag

There is no explicit "loop running" field in hermes_reconciler state. The correct proxy is
`in_flight_story_id`: if it's set, reconcile-tick already dispatched a story this loop.
An alternative approach (checking a custom `loop_running: true` field) would require a
write on start and a write on stop — two new mutation paths with obvious races. Reading the
existing field is safer and requires no new invariants.

## Do not rescue stuck stories from kickoff-exec

If the idempotency guard fires because `in_flight_story_id` is set with an old
`dispatched_at`, the temptation is to "just fix it here" — cancel the stuck task and
re-dispatch. Don't. reconcile-tick Branch 1 (watchdog) exists precisely for this. kickoff-exec
re-firing a rescue write would create a race: two callers trying to write `dispatched_at`
and `attempt` concurrently. Log the condition; exit. The watchdog fires on the next cron tick.

## Comment failure must not abort the loop

The start notification comment posted in §3 Step 6 is informational. Its failure (network
error, rate limit) is not a reason to refuse loop start. The gate is already verified;
aborting because of a comment failure means the operator has to re-trigger kickoff-exec and
wonder why. Log the failure and proceed to reconcile-tick. Error handling hierarchy: gate
enforcement errors → hard abort; state read errors → hard abort; comment failures → warn
and continue.

## epic_of_record guard is load-bearing in multi-epic setups

If a Hermes instance monitors multiple epics and the wrong epic handle is passed to
kickoff-exec, it could start reconcile-tick against the wrong state. The `epic_of_record`
field (set alongside `gate_state=pre_approved` at human approval time) is the ownership
anchor. Validate it before starting — a mismatch means this Hermes instance is not the
owner. Report the mismatch explicitly; do not proceed.

## The "no actionable stories" guard prevents phantom starts

An epic with `gate_state=pre_approved` but all stories in `blocked` or unknown states
would cause reconcile-tick Branch 5 (no-op) to fire on every cron tick forever, making
it look like the loop is running but doing nothing. Checking for at least one actionable
story (`pending`, `dispatched_impl`, `impl_terminal`) before starting catches this
misconfiguration early with a clear error rather than a silent loop that burns cron budget.
