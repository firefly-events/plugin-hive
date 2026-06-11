---
name: d4-design-mode-cc-workflows-per-persona-vs-single-run
description: When authoring a cc-workflows atom with no canonical workflow.yaml anchor, use per-persona Workflow runs (like plan-mode) not a single multi-agent run (like dr-3).
applies_to: developer
---

`design-mode-cc-workflows` has no `design.workflow.yaml` anchor. The correct shape is N
Workflow runs (one per persona) mirroring `plan-mode-cc-workflows`, NOT one Workflow run
with N agent() calls as in `design-review-mode-cc-workflows`. The deciding factor is whether
a canonical workflow.yaml specifies the step order — if absent, go per-persona. The
insight-capture block adds ~18 mandatory lines that push the file above the 330-360 target;
this is expected when the block is required by spec.
