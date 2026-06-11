---
name: dr2-workflow-anchor-asymmetry
description: When a workflow.yaml exists as an anchor, mirror its step shape in Multica (single-run), not per-persona fan-out.
applies_to: developer
---

design-review-mode-multica (dr-2) uses ONE Multica issue with FOUR agent() calls
and ONE episode marker because `hive/workflows/design-review.workflow.yaml` is the
canonical anchor. This is intentionally different from plan-mode-multica (d-3),
which uses per-persona fan-out because /design has no workflow.yaml. The Q11
ruling in `.pHive/epics/substrate-coverage-and-test-cleanup/docs/outline-collab-review-record.md`
locked this asymmetry. When implementing a Multica atom, always ask: "does a
workflow.yaml exist?" — if yes, mirror its step shape (single run), not the
per-persona pattern.
