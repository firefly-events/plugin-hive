# r-2: review/SKILL.md Phase 1 has TWO agents but r-2 dispatches ONE

Date: 2026-06-08
Story: r-2-review-mode-multica

## Finding

`skills/review/SKILL.md` Phase 1 Step 3 dispatches TWO sequential agents:
`researcher` (scope analysis) then `reviewer` (verdict). The r-2 atom's contract
says "solo (single) reviewer dispatch — ONE reviewer agent inside ONE Multica run."

This means r-2 assigns the Multica issue to the `reviewer` persona only. The brief
must instruct the reviewer to internally call `agent(researcher, ...)` for the
analysis step before running the critique — exactly the same pattern as
`design-review-mode-multica` (dr-2), where `ui-designer` runs 4 `agent()` calls
internally.

## Implication for developer

- resolveAgentUuidByName('reviewer') — NOT researcher
- Issue brief embeds researcher call as internal Step A; reviewer critique is Step B
- This differs from `test-mode-multica` (tester only, no prior subagent steps)
- The `scope_drift` emit in the atom fires AFTER the reviewer's verdict is rendered,
  capturing `extra_dimensions={'verdict': '<passed|needs_optimization|needs_revision>'}`.
  r-1 declares the obligation; r-2 actually calls emit_scope_drift.
