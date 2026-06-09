---
name: design-review-multica-single-run-vs-per-persona
description: When researching dr-2, confirm the atom shape is ONE Multica run with 4 agent() calls, not 3 per-persona issues as in plan-mode-multica.
applies_to: researcher
---

dr-2 (design-review-mode-multica) intentionally diverges from plan-mode-multica's per-persona fan-out. The architectural anchor is `hive/workflows/design-review.workflow.yaml` — 4 steps in one workflow = 4 agent() calls inside ONE Multica issue/run. plan-mode-multica's per-persona shape (one issue per persona) does NOT apply here. The story spec and AC explicitly call this asymmetry with d-3 a design decision (Q11 resolved). Always verify whether a Multica atom mirrors a workflow.yaml (sequential 4-step → single run) or a planning cell (per-persona fan-out → multi-run). File reference: dr-2 story yaml `design_decisions` block.
