---
name: d4-design-mode-cc-workflows-toggle-dispatch-asymmetry
description: d-4 uses per-persona Workflow runs (not a single bundled run); d-3 uses per-persona Multica issues — same persona resolution, different dispatch surface
applies_to: researcher
---

When researching cc-workflows atoms that mirror a Multica atom, the dispatch surface differs even when the persona set resolution is identical. d-3 (design-mode-multica) creates one Multica issue per persona; d-4 (design-mode-cc-workflows) creates one Workflow run per persona — not one bundled run with N agent() calls. Contrast this with dr-3 (design-review-mode-cc-workflows), which bundles all 4 agent() calls into ONE run. The deciding factor is whether a canonical workflow.yaml anchor exists: dr-3 follows design-review.workflow.yaml:8-81; d-4 has no such anchor and mirrors plan-mode-cc-workflows's per-persona fan-out instead.
