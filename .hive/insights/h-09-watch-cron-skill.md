# h-09 — watch-cron skill insights

## RemoteTrigger routines are not repo workflows

meta-nightly and the standup loop are RemoteTrigger routines, not GitHub Actions workflows.
Their last-run status must come from `multica_routine_status` (or `multica routine get --output json`),
not from `gh run list` or the Actions API. Mixing these up silently returns wrong data —
the routine may appear "never ran" because Actions has no record of it.

Also: the routine's `branch_target` field (if exposed) should be validated against `develop`.
A successful run that targeted the wrong branch is a soft failure worth surfacing.

## Daemon down ≠ crashed

The Studio daemon requires a GUI Aqua macOS session to unlock Keychain credentials.
After a sleep/wake or headless SSH login, the daemon won't start — this is by design.
Alerting "process crashed" in that case sends the operator chasing phantom crashes.

The `session_type` and `keychain_accessible` fields from `multica_daemon_status` let you
distinguish three causes: SESSION_LOST (no Aqua), KEYCHAIN_DENIED (Aqua but locked),
PROCESS_CRASHED (Aqua + Keychain OK but no process). Each has a different remediation.
Always surface the cause, never just "daemon down."

## Quiet-on-health is load-bearing

Every other Hermes skill posts confirmation noise ("tick complete", "no action taken").
watch-cron must not. Operators tune out repetitive "all clear" alerts within days.
The absence of a Slack message IS the health signal. Resist any temptation to add
a heartbeat post — it defeats the purpose.

## watch-cron is a sibling, not a nested call

reconcile-tick is state-machine-driving; watch-cron is health-observing. They run on
the same cron schedule but are independent entry points. If bundled together, run
watch-cron first as a pre-tick health gate: daemon-down → alert + exit before reconcile-tick
attempts any dispatch. A stuck-dispatch alert and a daemon-down alert in the same tick
would be redundant and confusing.

## Stale thresholds belong in config, not in classifyRoutine

Hardcoding `93600` inside the classification function means every new routine requires
a code change. Put thresholds in `MONITORED_ROUTINES` config so adding a new routine
is a one-line config addition with no logic change.
