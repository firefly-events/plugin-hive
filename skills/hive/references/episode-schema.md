# Status Markers

Status markers are lightweight files that track workflow step completion. They replace the previous verbose episode format. The `/hive:status` command reads these to determine story progress.

## Storage Path

```
state/episodes/{epic-id}/{story-id}/{step-id}.yaml
```

## Format

```yaml
step_id: research
status: completed
timestamp: "2026-03-25T21:00:00Z"
artifacts:
  - path/to/created/file.md
```

That's it. Four fields. Target: under 200 bytes per marker.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | string | yes | Step ID matching the workflow definition |
| `status` | enum | yes | `completed`, `failed`, or `escalated` |
| `timestamp` | string | yes | ISO 8601 completion time |
| `artifacts` | list | yes | File paths created or modified (empty list if none) |

## Status Values

| Status | Meaning |
|--------|---------|
| `completed` | Step finished successfully |
| `failed` | Step encountered an unrecoverable error |
| `escalated` | Step needs human intervention |

## What status markers do NOT contain

- Conclusions, decisions, or context — these are either passed directly between agents via prompts or captured as insights (see `agent-memory-schema.md`)
- Token usage or duration — operational metrics belong in logging, not state files
- Story/epic IDs — derivable from the file path

## Reading markers for status

Check `state/episodes/{epic-id}/{story-id}/` for marker files. Cross-reference the workflow step order:

| Condition | Story Status |
|-----------|-------------|
| No markers exist | pending |
| Markers exist but final step has none | in-progress |
| Final step marker has `status: completed` | completed |
| Any marker has `status: failed` or `escalated` | failed |
| All `depends_on` stories not yet completed | blocked |

For in-progress stories, the most recent marker (by step order in the workflow) indicates the current phase.

## Inter-phase context passing

Context between workflow steps is passed **directly via agent prompts**, not stored in marker files. When the orchestrator or team lead runs step N+1, they include relevant output from step N in the task prompt. This is ephemeral — it lives in the conversation, not on disk.

For context that should persist beyond the current session, use the **insight capture** system (see `agent-memory-schema.md`).
