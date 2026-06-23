---
name: monitor-epic-read-only-invariant
description: "monitor-epic must never call multica_write_state or dispatch — it is the only Hermes skill with a hard read-only contract, and callers (watch-cron, reconcile-tick) rely on this to avoid double-write races"
type: pattern
agent: developer
last_verified: 2026-06-23
ttl_days: 90
source: agent
---

monitor-epic is unique among Hermes orchestrator skills in that it has a **hard read-only
contract**: zero state writes, zero dispatches, zero file mutations. Every other skill
(reconcile-tick, slack-notify-await, resolve-gate) writes state as part of its purpose.
monitor-epic does not.

This matters because both `watch-cron` and `reconcile-tick` call monitor-epic before or after
their decision trees. If monitor-epic ever wrote state, a cron heartbeat could race with a
concurrent reconcile-tick and corrupt `dispatched_at` or `phase_position`.

**Practical rule:** if you find yourself about to add `multica_write_state` inside monitor-epic
for any reason (e.g., to "stamp" the digest timestamp, or to "helpfully" clear a stale field),
stop. That logic belongs in reconcile-tick Branch 1 (Watchdog) or a new purpose-built skill.

**`now` sourcing:** monitor-epic needs a timestamp for age calculation but cannot call
`Date.now()` (which is blocked in workflow scripts). Always source `now` from the **Run Time
shown at the top of the prompt** — the same convention used by `dispatched_at` in the reconciler.
If `now` is unavailable, omit `age_seconds` and set `potentially_stuck: false` rather than
erroring. This prevents a missing timestamp from breaking the idle-clean guarantee.

**Idle is always valid:** `in_flight_story_id == null` is not an error condition. monitor-epic
emits `in_flight: null` and reports story phases cleanly. Any code path that throws or warns on
idle is a bug.
