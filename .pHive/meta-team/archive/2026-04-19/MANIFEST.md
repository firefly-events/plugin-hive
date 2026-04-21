# Archive Manifest

## What was archived

Archive date: 2026-04-19

- `.pHive/meta-team/archive/2026-04-19/cycle-state.yaml` — copy of `.pHive/meta-team/cycle-state.yaml` preserved on 2026-04-19; 486 lines, 21803 bytes.
- `.pHive/meta-team/archive/2026-04-19/ledger.yaml` — copy of `.pHive/meta-team/ledger.yaml` preserved on 2026-04-19; 80 lines, 5321 bytes.
- `.pHive/meta-team/archive/2026-04-19/queue.yaml` — copy of `.pHive/meta-team/queue.yaml` preserved on 2026-04-19; 84 lines, 4270 bytes.

## Why

These files are the legacy meta-team control-plane records preserved as evidence while the meta-improvement-system epic resets authority. Per structured outline Part 4, Phase S3, the archive keeps the old state available for historical reference while the active control plane is rewritten in Slice S4.

## Integrity caveat: `commit: TBD`

`ledger.yaml` contains a preserved cycle entry at `cycle_id: meta-2026-04-13` with `commit: TBD`. Per user decision Q-new-D, this historical integrity break is preserved as-is rather than rewritten out of history. Downstream consumers reading the archived ledger must treat that entry's `commit` field as unreliable.

## Live-state reset

As of A1.5 (2026-04-21), the live `.pHive/meta-team/cycle-state.yaml`,
`.pHive/meta-team/ledger.yaml`, and `.pHive/meta-team/queue.yaml` files
have been deleted. The authoritative record of those files is this
archive. Subsequent slices (S4+) introduce the new control-plane
artifacts; see `.pHive/epics/meta-improvement-system/docs/` for the
current plan.

## Source of authority

- Structured outline: Part 4, Phase S3 (`A1.1` archive scope; `A1.6` integrity-note allowance).
- User decisions: Q9 (archive rather than delete legacy meta-team assets).
- User decisions: Q-new-D (preserve and flag the historical `commit: TBD` break).
