---
name: t3-is-closer-mirror-than-plan-mode-for-single-agent-atoms
description: When authoring a cc-workflows atom with ONE agent() call, mirror test-mode-cc-workflows (t-3), not plan-mode-cc-workflows.
applies_to: researcher
---

plan-mode-cc-workflows fans out one Workflow run per persona (serial); dr-3 runs FOUR
sequential agent() calls in one Workflow run. Neither matches a solo-dispatch atom.
test-mode-cc-workflows (t-3) is the canonical shape for a single agent() call inside
a single Workflow run — it maps directly to atoms like review-mode-cc-workflows (r-3)
where ONE reviewer is dispatched per trigger. Reference t-3's Step 1 brief-write,
opts.model wiring, and marker shape when implementing any new single-agent cc-workflows atom.
