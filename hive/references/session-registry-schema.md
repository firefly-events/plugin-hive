# Session Registry Schema

The session registry tracks Managed Agent sessions created by the Hive execute skill
(step 6b). Each session corresponds to a single story execution. The registry lives at
`state/sessions/index.yaml` and is initialized by the session-registry bootstrap skill.

## Storage Path

```
state/sessions/index.yaml
```

Created by `skills/hive/skills/session-registry/SKILL.md` at the start of any
session-based epic execution.

## Registry File Format

```yaml
created: "2026-04-14T08:00:00Z"
sessions:
  - session_id: "sess_abc123"
    epic_id: "memory-autonomy-foundation"
    story_id: "session-registry"
    step_id: "implement"
    agent_name: "backend-developer"
    model: "claude-sonnet-4-6"
    status: active
    created_at: "2026-04-14T08:01:00Z"
    last_active_at: "2026-04-14T08:05:00Z"
    sse_last_event_at: "2026-04-14T08:05:00Z"
```

## Session Record Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | string | yes | Unique session identifier (from /v1/sessions API response) |
| `epic_id` | string | yes | Epic this session belongs to |
| `story_id` | string | yes | Story being executed in this session |
| `step_id` | string | yes | Current workflow step (updated as session progresses) |
| `agent_name` | string | yes | Roster agent name (e.g., `backend-developer`, `reviewer`) |
| `model` | string | yes | Model identifier (e.g., `claude-sonnet-4-6`) |
| `status` | enum | yes | Session lifecycle status — see Status Values below |
| `created_at` | string | yes | ISO 8601 timestamp when the session was opened |
| `last_active_at` | string | yes | ISO 8601 timestamp of last status update |
| `sse_last_event_at` | string | no | ISO 8601 timestamp of last SSE event received — used by stuck detection (see `session-resilience.md`) |

## Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Session entry created; /v1/sessions call not yet made |
| `active` | Session is running — SSE events flowing |
| `completed` | Session finished successfully; story step done |
| `failed` | Session ended with an error; story step failed |
| `stuck` | No SSE events received within `stuck_timeout_ms` — retry triggered |

## Index-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `created` | string | ISO 8601 timestamp when the index was initialized |
| `sessions` | list | Ordered list of session records (most recent last) |

## Session Lifecycle

```
pending → active → completed
                 ↘ failed
         ↓ (no SSE within stuck_timeout_ms)
         stuck → [retry: new session_id, status: pending again]
```

A stuck session is never resumed — its `status` is set to `stuck` and a new session
record is appended with a fresh `session_id` and a reference to the continuation context
file. See `hive/references/session-resilience.md` for the full retry procedure.

## Related References

- `skills/hive/skills/session-registry/SKILL.md` — bootstrap command that creates `state/sessions/index.yaml`
- `skills/execute/SKILL.md` — step 6b creates and updates session records
- `hive/references/session-resilience.md` — stuck detection uses `sse_last_event_at`; retry appends new records
- `hive/references/configuration.md` — `sessions.*` config block controls enabled flag and timeouts
