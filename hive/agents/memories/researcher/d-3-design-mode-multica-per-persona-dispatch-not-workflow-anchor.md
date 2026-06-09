---
name: d-3-design-mode-multica-per-persona-dispatch-not-workflow-anchor
description: d-3 uses per-persona dispatch (N issues, N markers) because /design has no workflow.yaml anchor — dr-2 uses single-run because design-review.workflow.yaml is the anchor. The asymmetry is intentional and symmetry-checked in every atom's constraint table.
applies_to: researcher
---

d-3 (design-mode-multica) per-persona dispatch is NOT due to a workflow.yaml anchor (there is none for /design).
The shape is inherited from execute-mode-multica's per-story pattern: dispatch unit = persona, one issue per persona, one episode marker per persona.

Key distinction to remember when researching future design-* atoms:
- Workflow.yaml exists → single-Multica-run with N agent() calls (dr-2 shape)
- No workflow.yaml → per-persona fan-out matching execute-mode-multica (d-3 shape)

Toggle ON (--include-constraints): 3 personas × 1 issue = 3 issues, 3 episode markers.
Toggle OFF: 1 persona (ui-designer) × 1 issue = 1 issue, 1 episode marker.

Q10 design-discussion §6 resolved "by-default" (not gated): one issue per persona. The risk note in the story yaml acknowledges that 3 issues per call may feel heavy for operators — the mitigation is a moldability note (reversible post-ship config), not a default-to-single-issue choice.

Vitest resolver test path pattern: skills/hive/skills/<atom>/test/resolver.test.mjs — confirmed from design-dispatch, review-mode-multica, design-review-mode-multica precedent.
