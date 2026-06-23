# h-06 Slack Notify-Await — Implementation Insights

## Fail-safe ordering is non-negotiable

Write `gate_state: awaiting` via `multica_write_state` **before** attempting the Slack post.
If Slack fails after the gate is written, the tick halts with the gate latched. If Slack is
called first and it fails, the gate is still `pre_approved` and the tick would silently continue
on the next cron run — defeating the entire human-gate north star. The test for this ordering
is: kill the Slack endpoint after the gate write; the gate must still be `awaiting`.

## Slack failure must propagate as an error

When Slack is unreachable, log and throw — do not swallow the error and return `{ halted: true }`.
The distinction matters: a thrown error causes the tick to visibly fail (the cron runner marks it
failed, Hermes sees an error, the operator notices). A silent return of `{ halted: true }` looks
like a clean halt. The gate is already latched either way, but the operator needs to know Slack
is broken. Silent halts hide infrastructure problems.

## `revise` must increment attempt and clear in-flight fields

When the human picks `revise`, reconcile-tick's Branch 3 re-dispatches impl on the next tick.
Branch 3 checks `phase_position == "dispatched_impl"` AND `in_flight_story_id == null`.
If you only flip phase_position without clearing `in_flight_story_id`, Branch 2 (harvest)
fires instead of Branch 3 (dispatch), because in_flight_story_id is still set. The revise path
must clear all three: `in_flight_story_id`, `in_flight_task_id`, `dispatched_at`.

`attempt++` also belongs here, not deferred to the next tick. The next dispatch will read the
incremented attempt for watchdog max_attempts enforcement.

## `needs_revision` vs `needs-revision` — normalize before comparing

The `NEEDS_REVISION_NORMALIZE` rule from cycle-reconciler.md applies to the verdict passed into
`surfaceVerdictHook`. The message builder normalizes on display (underscore → hyphen) but the
caller (reconcile-tick) is responsible for normalizing before deciding which hook to call. Don't
build a second normalization path inside the hook — one authoritative path (the reconciler) is
enough; the hook trusts the verdict it receives.

## Protocol selection in postSlack

Node's `https` module will fail with `EPROTO` on `http://` URLs. Import both `http` and `https`,
then select based on `new URL(webhookUrl).protocol`. This matters for local/test environments
that mock Slack with a plain HTTP server. Production Slack webhooks are always HTTPS, but tests
are always HTTP — hard-coding `https` breaks the entire test suite.

## gate_state='awaiting' is not in h-03's original schema

h-03 describes `null → pre_approved` and `pre_approved → halted/awaiting` but the exact string
`"awaiting"` is implied, not named explicitly. h-06 is the first story to write `gate_state:
"awaiting"` as a durable state. The `"rejected"` terminal state is also first introduced here.
Both should be added to the cycle-state schema doc and the gate_state transition table in h-03.

## No-Slack guard: webhook URL missing must not silently succeed

When `HERMES_SLACK_WEBHOOK_URL` is unset, throw immediately (after writing `gate_state:
awaiting`). A missing webhook on a production Studio is a misconfiguration, not a recoverable
condition — failing loud is correct. If the intention is "post to stdout instead of Slack," that
should be an explicit opt-in flag, not the default when the env var is absent.
