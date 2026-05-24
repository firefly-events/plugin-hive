# Context Snapshot Schema

Schema specification for the JSON payload produced by `composeContextSnapshot()` in `hive/lib/context-snapshot.mjs`.

## Versioning rule

- `schema_version` is an integer, starting at `1`.
- Additions of new top-level keys or new optional fields within existing keys are **additive-only** and do not increment the version.
- Any breaking change (key removal, rename, type change, semantic shift) MUST increment `schema_version`.
- Consumers MUST tolerate unknown keys (forward-compat) and MUST reject payloads whose `schema_version` is higher than the version they were written against.

## API

```js
import { composeContextSnapshot } from 'hive/lib/context-snapshot.mjs';

const snapshot = composeContextSnapshot({
  stateDir: '/path/to/repo',   // repo root (contains .pHive/)
  epic: 'my-epic',             // optional — filter to one epic
  episodeLimit: 5,             // optional — max episode markers per story (default 5)
});
```

## Top-level keys

| Key | Type | Source | Notes |
|---|---|---|---|
| `schema_version` | `number` | hardcoded | Always `1` at this revision |
| `generated_at` | `string` | runtime | ISO-8601 UTC timestamp |
| `branch` | `string \| null` | `git rev-parse --abbrev-ref HEAD` | null if git unavailable |
| `epics` | `EpicSummary[]` | `.pHive/epics/*/epic.yaml` + cycle-state | |
| `stories` | `StorySummary[]` | `.pHive/epics/*/stories/*.yaml` | status via `deriveStoryStatus` |
| `episodes_recent` | `EpisodeSet[]` | `.pHive/episodes/` | most recent N markers per story |
| `triage_open` | `TriageItem[]` | `.pHive/triage/queue.yaml` | absent file → `[]` |
| `metrics_health` | `MetricEntry[]` | story `metric:` blocks | stories without block omitted |

## EpicSummary

```json
{
  "id": "my-epic",
  "title": "My Epic Title",
  "methodology": "classic",
  "story_count": 4,
  "phase": "execution",
  "branch": "feat/my-epic"
}
```

`phase` and `branch` come from `.pHive/cycle-state/{epic-id}.yaml`. Both are `null` if the cycle-state file is absent.

## StorySummary

```json
{
  "epic_id": "my-epic",
  "story_id": "s-01-setup",
  "title": "S.01 — Setup",
  "status": "in_progress",
  "complexity": "medium",
  "depends_on": ["s-00-bootstrap"]
}
```

`status` is always the value returned by `deriveStoryStatus` — never the raw YAML `status:` field.

Valid status values: `pending`, `in_progress`, `completed`, `deferred`, `blocked`, `failed`.

## EpisodeSet

```json
{
  "epic_id": "my-epic",
  "story_id": "s-01-setup",
  "markers": [
    { "file": "research.yaml", "step_id": "research", "status": "completed" },
    { "file": "implement.yaml", "step_id": "implement", "status": "completed" }
  ]
}
```

`markers` contains at most `episodeLimit` entries (default 5), sorted by filename ascending (most recent last when files use date-prefixed names). Stories with zero episode markers are omitted from `episodes_recent`.

## TriageItem

```json
{
  "id": "t-001",
  "state": "inbox",
  "kind": "bug",
  "title": "Login drops session on Safari refresh",
  "priority": null,
  "reporter": "alice@example.com"
}
```

Only items with `state != "closed"` are included. If `.pHive/triage/queue.yaml` is absent, `triage_open` is `[]`.

## MetricEntry

```json
{
  "epic_id": "my-epic",
  "story_id": "s-01-setup",
  "applies": true,
  "metric": {
    "name": "hive.dispatch.label_to_pr_latency_seconds",
    "direction": "down",
    "unit": "seconds",
    "baseline": null
  }
}
```

When `applies` is `false`, `metric` is `null`. Stories whose YAML has no `metric:` block are omitted entirely.

## Example payload

```json
{
  "schema_version": 1,
  "generated_at": "2026-05-24T08:00:00.000Z",
  "branch": "feat/hermes-integration-mvp",
  "epics": [
    {
      "id": "hermes-integration-mvp",
      "title": "Hermes Integration MVP",
      "methodology": "classic",
      "story_count": 3,
      "phase": "execution",
      "branch": "feat/hermes-integration-mvp"
    }
  ],
  "stories": [
    {
      "epic_id": "hermes-integration-mvp",
      "story_id": "h-01-context-snapshot-composer",
      "title": "H-01 — Library composer + JSON schema for context-snapshot",
      "status": "completed",
      "complexity": "medium",
      "depends_on": []
    }
  ],
  "episodes_recent": [
    {
      "epic_id": "hermes-integration-mvp",
      "story_id": "h-01-context-snapshot-composer",
      "markers": [
        { "file": "implement.yaml", "step_id": "implement", "status": "completed" }
      ]
    }
  ],
  "triage_open": [
    {
      "id": "t-001",
      "state": "inbox",
      "kind": "bug",
      "title": "Snapshot misses cycle-state on new epics",
      "priority": null,
      "reporter": "don@example.com"
    }
  ],
  "metrics_health": [
    {
      "epic_id": "hermes-integration-mvp",
      "story_id": "h-01-context-snapshot-composer",
      "applies": false,
      "metric": null
    }
  ]
}
```
