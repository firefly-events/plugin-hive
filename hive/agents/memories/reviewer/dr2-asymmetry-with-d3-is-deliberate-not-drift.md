---
name: dr2-asymmetry-with-d3-is-deliberate-not-drift
description: When reviewing *-mode-multica atoms, check whether asymmetry with sibling atoms is the Q11-ruled intent before flagging it as inconsistency
applies_to: reviewer
---

dr-2 (design-review-mode-multica) intentionally diverges from d-3 (design-mode-multica) and plan-mode-multica: dr-2 is ONE Multica run with FOUR agent() calls and ONE episode marker; siblings fan out per-persona with one marker each. The architectural anchor is hive/workflows/design-review.workflow.yaml:8-81 — design-review has a canonical 4-step workflow file, /design does not. The Q11 ruling is recorded in .pHive/epics/substrate-coverage-and-test-cleanup/docs/outline-collab-review-record.md.

Before flagging "atom diverges from sibling shape" as a finding, look for a Q-number ruling in the epic docs/structured-outline. If the asymmetry is documented in three or more places in the atom (HTML comment, body prose, constraint table), it is signal not noise.
