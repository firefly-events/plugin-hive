---
name: r3-scope-drift-observed-vs-null
description: Use scope_drift_observed=true (not null) in cc-workflows review atom markers because the atom OWNS the emit contract, unlike Multica atoms that merely confirm it.
applies_to: developer
---

r-2 (review-mode-multica) sets `scope_drift_observed: null` because the Multica atom confirms
the r-1 emit obligation exists but does NOT itself call the emit — the reviewer agent inside the
Multica issue does. r-3 (review-mode-cc-workflows) sets `scope_drift_observed: true` because the
Workflow TOOL result contains the verdict proving the emit fired inside the agent's prompt-driven
run. The difference: Multica atoms observe through cycle-state; cc-workflows atoms can verify from
the structured result payload. Mirror r-2's `null` only when your substrate cannot confirm the emit.
