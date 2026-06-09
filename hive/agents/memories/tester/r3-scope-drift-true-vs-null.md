---
name: r3-scope-drift-true-vs-null
description: r-3 (cc-workflows) sets scope_drift_observed: true; r-2 (multica) sets null — check which atom owns the emit before asserting.
applies_to: tester
---

The r-2 (review-mode-multica) and r-3 (review-mode-cc-workflows) atoms have opposite scope_drift_observed values in their episode markers: r-2 sets null (emit preserved by r-1, not owned here) while r-3 sets true (reviewer agent dispatched inside the Workflow TOOL owns the emit at review:complete). When writing resolver tests for *-mode-* atoms, read the emit contract section of the target SKILL.md first — the ownership model differs by substrate. Asserting the wrong value (null vs true) on the wrong atom will silently pass if the SKILL.md is not re-read. Cite skills/hive/skills/review-mode-cc-workflows/SKILL.md §scope_drift and skills/hive/skills/review-mode-multica/SKILL.md §scope_drift for the contrast.
