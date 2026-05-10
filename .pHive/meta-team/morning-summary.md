# Hive Meta-Team — Nightly Cycle Report
**Cycle:** meta-2026-05-10 | **Date:** 2026-05-10 | **Verdict:** passed

## What Changed

- **hive/references/dreaming-integration.md** — Added `## API Reference` section documenting
  the `runDreamingReplay()` function signature (parameters: `episodeRoot`, `kg`, `wiki`,
  `capabilityProbe` with defaults), return shape (`{ playbookDeltas, capabilityErr, timeoutErr? }`),
  episode YAML consumed fields (`playbook_delta.*`, `timestamp`, `status`), and the
  `dreaming.timeout_hours` config key. File grew from 12 to 53 lines; STUB_DOC finding
  resolved. Content is derived from the implementation at `hive/lib/dreaming-replay.js`.

## What Was Found (Not Fixed This Cycle)

- **hive/references/hive-cloud-roadmap.md** (STUB_DOC, low) — 13-line self-described "S16 stub
  to close the forward reference". Flagged as `needs_human`; expanding it requires
  cloud-roadmap content from the product team. Deferred to a human-driven update.

## Metrics

- Findings: 2 | Proposals: 1 | Promoted: 1 | Reverted: 0
- Next cycle priority: hive-cloud-roadmap.md stub (needs_human — flag for product team)
- Commit: fbb0b153c6a602e2607d1bf12a19be21a3cf778e
- Rollback ref: d701c7d5670fe53bd2d2fcf46531c2b9de0889f5
- Regression watch: armed (window closes 2026-05-10T04:30:00Z)
