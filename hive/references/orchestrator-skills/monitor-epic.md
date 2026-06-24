# monitor-epic — Hermes Skill Runbook

> **Inline prompt.** This runbook defines the monitor-epic status-digest skill.
> Paste as context when a human or cron heartbeat requests an epic status view.
> References: `hive/lib/multica-story-dispatch/cli.mjs` (epic-status subcommand),
> `hive/lib/context-snapshot.mjs` (composeContextSnapshot API).
> hermes-multica MCP tools used: `multica_epic_status` (state read), `multica_poll_task`.
> Episode/triage/metric data is NOT an MCP tool — call `composeContextSnapshot` (`hive/lib/context-snapshot.mjs`) directly.

---

## 0. Purpose

monitor-epic is the **"what's happening" surface** for a running epic. Given an epic handle, it
emits a structured status digest in a single read pass with **zero state writes**.

The digest covers:
- Per-story phase positions (where each story sits in the state machine)
- In-flight task id and age vs the watchdog threshold
- Recent episode markers (last N per story)
- Open triage items
- Metric verdicts

monitor-epic is **purely composable**: it calls `multica_epic_status` for reconciler state and
`composeContextSnapshot` (or `multica_context_snapshot`) for episode/triage/metric data, then
joins the two. It calls no write tools and mutates no files.

**Consumers:** human operator glances, `watch-cron` heartbeats, `reconcile-tick` pre-decision reads.

---

## 1. When to Run

| Caller | Use case |
|--------|----------|
| Human operator | Quick glance at epic progress |
| `watch-cron` | Scheduled heartbeat digest (no gate required) |
| `reconcile-tick` (pre-tick) | Sanity snapshot before Branch 1–5 decision tree |
| CI / alerting pipeline | Input to threshold-based alerts |

monitor-epic has **no gate check**. It runs regardless of `gate_state`. A gated or finalized epic
still produces a valid read.

---

## 2. Inputs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `epic_handle` | Yes | The epic identifier string (e.g. `hermes-integration-mvp`) |
| `episode_limit` | No | Max episode markers per story in digest (default: `5`) |
| `now` | No | ISO-8601 UTC timestamp for age calculations. Use the **Run Time shown at the top of your prompt** — the same source as `dispatched_at` in cycle-reconciler. Do NOT call `Date.now()`. If unavailable, omit the `age_seconds` field from in-flight section. |

---

## 3. Step-by-Step

```
monitor-epic(epic_handle, episode_limit=5, now):

  // Step 1 — Read reconciler state (no gate check; read-only)
  state = multica_epic_status(epic_handle)
  // Returns: { epic, gate_state, current_phase, in_flight_story_id,
  //            in_flight_task_id, dispatched_at, stuck_after_seconds,
  //            stories: [{ story_id, phase_position, attempt, verdict }] }

  // Step 2 — Read context snapshot (episodes, triage, metrics)
  snapshot = multica_context_snapshot({ epic: epic_handle, episodeLimit: episode_limit })
  // Returns: context-snapshot-schema.md payload filtered to this epic.
  // If multica_context_snapshot is unavailable, call composeContextSnapshot() directly.

  // Step 3 — Build in-flight block
  if state.in_flight_story_id is not null:
      age_seconds = computeAge(state.dispatched_at, now)   // see §4
      stuck       = (age_seconds is not null) AND (age_seconds > state.stuck_after_seconds)
      in_flight = {
          story_id:      state.in_flight_story_id,
          task_id:       state.in_flight_task_id,
          phase:         state.current_phase,
          dispatched_at: state.dispatched_at,
          age_seconds:   age_seconds,          // null if now unavailable
          stuck_after_seconds: state.stuck_after_seconds,
          potentially_stuck: stuck
      }
  else:
      in_flight = null   // idle — see §5

  // Step 4 — Build per-story phase table
  story_phases = []
  for story in state.stories:
      story_phases.push({
          story_id:       story.story_id,
          phase_position: story.phase_position,
          attempt:        story.attempt
      })

  // Step 5 — Assemble digest
  digest = {
      epic:          epic_handle,
      gate_state:    state.gate_state,
      generated_at:  now,                          // omit if now unavailable
      story_phases:  story_phases,
      in_flight:     in_flight,                    // null = idle
      episodes_recent: snapshot.episodes_recent,   // EpisodeSet[] from context-snapshot
      triage_open:   snapshot.triage_open,         // TriageItem[] from context-snapshot
      metrics_health: snapshot.metrics_health      // MetricEntry[] from context-snapshot
  }

  // Step 6 — Return (ZERO state writes)
  return digest
```

**No `multica_write_state` calls. No file mutations. Read-only invariant is absolute.**

---

## 4. Age Calculation

```
function computeAge(dispatched_at, now):
    if dispatched_at is null OR now is null:
        return null
    return parseISO(now) - parseISO(dispatched_at)    // result in seconds
```

`dispatched_at` and `now` are both ISO-8601 UTC strings. Subtract their epoch values to get
`age_seconds`. If either is null or unparseable, return null — do not throw.

---

## 5. Idle Case (No In-Flight Task)

When `state.in_flight_story_id` is null, the epic is idle between dispatches (or not yet started,
or finalized). Emit `in_flight: null` in the digest. Do NOT emit an error or warning — idle is a
valid and expected state.

Example idle digest excerpt:

```json
{
  "in_flight": null,
  "story_phases": [
    { "story_id": "h-01-setup",  "phase_position": "done",    "attempt": 1 },
    { "story_id": "h-02-impl",   "phase_position": "pending", "attempt": 0 }
  ]
}
```

---

## 6. Stuck-Task Flag

When `in_flight` is non-null and `age_seconds > stuck_after_seconds`:

```json
{
  "in_flight": {
    "story_id":          "h-03-feature",
    "task_id":           "tsk_abc123",
    "phase":             "dispatched_impl",
    "dispatched_at":     "2026-06-23T10:00:00Z",
    "age_seconds":       3720,
    "stuck_after_seconds": 1800,
    "potentially_stuck": true
  }
}
```

`potentially_stuck: true` is informational only. monitor-epic does **not** cancel, re-dispatch, or
write state. The watchdog branch in `reconcile-tick` (Branch 1) is the only actor that rescues
stuck tasks. If `now` is unavailable, omit `age_seconds` and set `potentially_stuck: false`.

---

## 7. Full Digest Schema

```json
{
  "epic":         "hermes-integration-mvp",
  "gate_state":   "pre_approved",
  "generated_at": "2026-06-23T15:30:00Z",
  "story_phases": [
    { "story_id": "h-01-setup",   "phase_position": "done",              "attempt": 1 },
    { "story_id": "h-02-impl",    "phase_position": "dispatched_review",  "attempt": 2 },
    { "story_id": "h-03-feature", "phase_position": "pending",            "attempt": 0 }
  ],
  "in_flight": {
    "story_id":          "h-02-impl",
    "task_id":           "tsk_abc123",
    "phase":             "dispatched_review",
    "dispatched_at":     "2026-06-23T15:00:00Z",
    "age_seconds":       1800,
    "stuck_after_seconds": 1800,
    "potentially_stuck": true
  },
  "episodes_recent": [
    {
      "epic_id":  "hermes-integration-mvp",
      "story_id": "h-01-setup",
      "markers": [
        { "file": "implement.yaml", "step_id": "implement", "status": "completed" }
      ]
    }
  ],
  "triage_open": [
    {
      "id": "t-001", "state": "inbox", "kind": "bug",
      "title": "Snapshot misses cycle-state on new epics",
      "priority": null, "reporter": "don@example.com"
    }
  ],
  "metrics_health": [
    {
      "epic_id": "hermes-integration-mvp",
      "story_id": "h-01-setup",
      "applies": false,
      "metric": null
    }
  ]
}
```

---

## 8. Read-Only Invariant

| Invariant | Rule |
|-----------|------|
| **Zero writes** | monitor-epic MUST NOT call `multica_write_state`, write any file, or mutate `.pHive/`. |
| **No dispatch** | monitor-epic MUST NOT call `multica_dispatch_story` or `multica_poll_task`. |
| **No gate check** | Runs regardless of `gate_state`. A gated epic is valid to monitor. |
| **No side effects** | Repeated calls with the same inputs produce the same output; calling n times ≡ calling once. |

If a caller asks monitor-epic to "fix" or "rescue" a stuck task, refuse. Direct the caller to
`reconcile-tick` (Branch 1 — Watchdog) which is the single source of truth for rescue decisions.

---

## 9. MCP Tool Reference

| Tool | Args | Notes |
|------|------|-------|
| `multica_epic_status` | `epic_handle` | Read-only rollup of hermes_reconciler block. See §0 of cycle-reconciler.md for full return shape. |
| `multica_context_snapshot` | `{ epic, episodeLimit }` | Returns context-snapshot-schema.md payload. If absent, call `composeContextSnapshot()` directly from `hive/lib/context-snapshot.mjs`. |

`multica_context_snapshot` is the Studio fork's MCP surface for `composeContextSnapshot`. If it is
absent in your environment, import and call `composeContextSnapshot` directly with
`{ stateDir: <repo-root>, epic: epic_handle, episodeLimit: episode_limit }`.
