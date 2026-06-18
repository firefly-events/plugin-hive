---
name: al-3-untracked-runtime-sweep
description: "Predicate-first design for safe artifact eviction — active-state check before age check prevents data loss."
type: pattern
agent: developer
last_verified: 2026-06-18
ttl_days: 180
source: agent
---

## Predicate-before-age is the only safe eviction order

The sweep checks `is_active(predicate, path)` BEFORE comparing age. This is intentional. Age alone will silently evict an artifact that happens to be old but still in use (e.g. a suspended DAG run that has not been touched in 35 days). Always gate on active-state first; threshold is a secondary pruning step.

## Separate "consumed" convention for metrics streams

No built-in consumed marker exists in the metrics JSONL format. The predicate uses a `.consumed` sidecar file (`<stream>.jsonl.consumed`) as the consumed signal. Any future writer that finishes consuming a stream file must write this sidecar. If the sidecar convention changes, `metrics_stream_not_consumed` in `predicates.py` is the single place to update.

## DAG run directories, not run_state.yaml files, are the eviction unit

The planner matches globs at the run directory level (`runs/*`), not at the `run_state.yaml` level. The predicate receives the directory path and opens `run_state.yaml` inside it. Trying to match `runs/*/run_state.yaml` would evict only the YAML file and leave the rest of the run directory orphaned.

## `shutil.move` is sufficient; no need for atomic rename across devices

`shutil.move` falls back to copy+delete when src and dest are on different filesystems (common when evicting to OS temp on macOS where `/tmp` is a ramdisk overlay). This is acceptable for eviction — transient cleanup, not durable archival (D1/D4). Do not replace with `os.rename`, which raises `OSError` on cross-device moves.

## `hard_exclude=True` entries must be listed in the registry for documentation value

Even though the planner skips them, declaring hard-excluded classes explicitly (e.g., team-memories) documents intent and prevents future contributors from accidentally adding a glob that overlaps those paths. The planner skips them in one early-exit branch (`if entry.hard_exclude: continue`).

## `never-active` predicate for truly age-only classes

Context snapshots and scratch outputs have no meaningful active-state signal. Using `"never-active"` as the predicate name makes the intent explicit: once old enough, always evictable. Avoid using `"always"` or leaving `active_predicate` empty — the field is required and the predicate name is the documentation.
