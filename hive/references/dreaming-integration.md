# Dreaming Integration

This document defines the S16 local adapter contract for cross-session replay.

- Binding decision: per `.pHive/cycle-state/cwc-2026-integration.yaml`, `dreaming-module-location` is `separate-module`; `hive/lib/dreaming-replay.js` is invoked by a Routines-scheduled job and does not extend `hive/lib/session-end.js` with Phase D.
- Trigger references: `s11-c1-under-scheduler-step-metadata` and `s12-c2-routines-acr-integration-refs` are named here as the parallel-session trigger surface; this slice does not wait for their runtime landing.
- Q3 primary source: `https://platform.claude.com/docs/en/managed-agents/dreams` (last checked `2026-05-09`). Public Dreams is a managed-agents async resource over `memory_store` + optional `sessions` inputs, returning a `dream` resource with `inputs[]`, `outputs[]`, lifecycle status, usage, and error fields.
- Local adapter rule: Hive replays `.pHive/episodes/**/*.yaml` as local pseudo-sessions. `runDreamingReplay()` mirrors the public Dreams envelope where practical, then places a local `outputs[0].type: playbook_delta` payload carrying wiki/KG deltas.
- Capability skip: live Dreaming preview access is intentionally not verified in this slice. When Dreaming capability is unreachable or disabled, `runDreamingReplay()` returns `{ playbookDeltas: [], capabilityErr: null }`.
- Proposal source contract: meta-optimize consumes dreaming replay as the fifth ranked source after `kg_signal` and before backlog. A capability skip propagates as `[]`; the other four sources remain unaffected.
- Output intent: the replay module is cross-session only. It does not change per-session substrate semantics from `hive/references/session-system-prompt-spec.md`; it consumes episode artifacts produced by those sessions later.

## API Reference

### `runDreamingReplay({ episodeRoot, kg, wiki, capabilityProbe })`

Exported from `hive/lib/dreaming-replay.js`. Walks the episode corpus and emits local playbook-delta outputs for wiki/KG consumers.

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `episodeRoot` | string | `.pHive/episodes` | Root directory scanned for `*.yaml` episode files (recursive, alphabetical order) |
| `kg` | object \| null | `null` | Optional KG adapter; must implement `applyDelta(payload)` |
| `wiki` | object \| null | `null` | Optional wiki adapter; must implement `applyDelta(payload)` |
| `capabilityProbe` | async () → bool | `() => false` | Probe that returns `true` when the Dreaming capability is available |

**Return value**

```js
{ playbookDeltas: DreamDelta[], capabilityErr: null, timeoutErr?: true }
```

Returns `{ playbookDeltas: [], capabilityErr: null }` immediately when the capability probe returns `false`. Sets `timeoutErr: true` when the wall-clock budget (see Timeout below) is exceeded mid-run; partial `playbookDeltas` are still returned.

### Episode YAML schema (consumed fields)

Each `.pHive/episodes/**/*.yaml` file may contain:

| Field | Type | Description |
|-------|------|-------------|
| `playbook_delta` | object | Required to produce a delta; file is skipped when absent or non-object |
| `playbook_delta.title` | string | Free-text title for the delta |
| `playbook_delta.rationale` | string | Rationale string passed through to the delta output |
| `playbook_delta.wiki` | object | Wiki delta payload forwarded to the `wiki` adapter |
| `playbook_delta.kg` | object | KG delta payload forwarded to the `kg` adapter |
| `timestamp` | string | ISO-8601 timestamp recorded in `created_at` / `ended_at` of the dream envelope |
| `status` | string | Lifecycle status; defaults to `'completed'` when absent |

### Timeout

`dreaming.timeout_hours` in `hive.config.yaml` caps the total wall-clock time for a replay run. When absent or non-finite, the run is unlimited. Partial results with `timeoutErr: true` are returned when the budget is exceeded.

