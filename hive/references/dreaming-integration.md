# Dreaming Integration

This document defines the S16 local adapter contract for cross-session replay.

- Binding decision: per `.pHive/cycle-state/cwc-2026-integration.yaml`, `dreaming-module-location` is `separate-module`; `hive/lib/dreaming-replay.js` is invoked by a Routines-scheduled job and does not extend `hive/lib/session-end.js` with Phase D.
- Trigger references: `s11-c1-under-scheduler-step-metadata` and `s12-c2-routines-acr-integration-refs` are named here as the parallel-session trigger surface; this slice does not wait for their runtime landing.
- Q3 primary source: `https://platform.claude.com/docs/en/managed-agents/dreams` (last checked `2026-05-09`). Public Dreams is a managed-agents async resource over `memory_store` + optional `sessions` inputs, returning a `dream` resource with `inputs[]`, `outputs[]`, lifecycle status, usage, and error fields.
- Local adapter rule: Hive replays `.pHive/episodes/**/*.yaml` as local pseudo-sessions. `runDreamingReplay()` mirrors the public Dreams envelope where practical, then places a local `outputs[0].type: playbook_delta` payload carrying wiki/KG deltas.
- Capability skip: live Dreaming preview access is intentionally not verified in this slice. When Dreaming capability is unreachable or disabled, `runDreamingReplay()` returns `{ playbookDeltas: [], capabilityErr: null }`.
- Proposal source contract: meta-optimize consumes dreaming replay as the fifth ranked source after `kg_signal` and before backlog. A capability skip propagates as `[]`; the other four sources remain unaffected.
- Output intent: the replay module is cross-session only. It does not change per-session substrate semantics from `hive/references/session-system-prompt-spec.md`; it consumes episode artifacts produced by those sessions later.

## Module Interface

`hive/lib/dreaming-replay.js` exports one function:

```js
runDreamingReplay({ episodeRoot, kg, wiki, capabilityProbe })
```

**Parameters** (all optional):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `episodeRoot` | `.pHive/episodes` | Root directory scanned recursively for `.yaml` episode files |
| `kg` | `null` | Knowledge-graph instance; must expose `applyDelta(delta)` if provided |
| `wiki` | `null` | Wiki instance; must expose `applyDelta(delta)` if provided |
| `capabilityProbe` | `async () => false` | Async predicate — return `true` to enable replay; default always skips |

**Return value:**

```js
{
  playbookDeltas: DreamAdapterDelta[],  // one entry per episode with a playbook_delta key
  capabilityErr: null,                  // always null in current implementation
  timeoutErr?: true,                    // present when dreaming.timeout_hours elapsed
}
```

Each `DreamAdapterDelta` mirrors the public Dreams envelope shape:

```js
{
  type: 'dream',
  source_episode: string,           // relative path of the episode file (no extension)
  status: string,                   // episode.status or 'completed'
  inputs: [{ type: 'sessions', session_ids: [string] }],
  outputs: [{
    type: 'playbook_delta',
    title: string,
    rationale: string,
    wiki: object,                   // episode.playbook_delta.wiki (empty object if absent)
    kg: object,                     // episode.playbook_delta.kg (empty object if absent)
  }],
  model: { id: 'local-episode-walker' },
  usage: { input_tokens: 0, output_tokens: 0, ... },  // always zero for local replay
}
```

**Configuration:** `hive.config.yaml → dreaming.timeout_hours` (float, optional). When set, replay stops after the specified wall-clock hours and returns with `timeoutErr: true`. Omitting the key or setting a non-positive value disables the timeout.

