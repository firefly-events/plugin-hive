# Insights — dpt-4-wire-plan-and-provenance

## Wiring pattern: caller-supplied list vs. legacy fallback

The key design tension in Step 0.1 of planning-routing: the skill previously
self-assembled the roster using inline conditionals. The safe migration path was
NOT to remove the inline logic but to gate it behind "absent or empty caller
list" — so direct callers (anything other than /plan) keep working without
change. Only /plan is now required to pass a pre-assembled list.

This "caller-supplied wins; inline is legacy fallback" pattern will be reusable
whenever a sub-skill currently does selection that should migrate to a catalog.

## Provenance block placement in epic.yaml

`planning_team:` sits after `git_flow:` in the canonical field order:
`methodology → version_bump → git_flow → planning_team`. This keeps all
plan-time-resolved structural fields together and separates them from story
content fields. The overwrite-on-re-plan rule (not append) is important —
re-plans run new classification; old provenance is stale and misleading.

## Atomic boundary enforcement

The issue description stressed "no inline copy of classification logic in /plan."
The pattern that makes this hold: step 1 names the skill file explicitly and
stores the full output as `${classification_output}`, then passes
`${classification_output}.assembled_personas` to planning-routing. Any future
drift toward prose selection inside /plan is detectable by grepping for the
conditional keywords (architect, ui-designer) outside of the skill invocation
call.

## §6.4 vs §6.1 in story-yaml-schema.md

The `planning_team:` block was added as §6.4 (a sub-section of §6 Epic index),
not as a new top-level section. This keeps all epic.yaml documentation in one
place. The back-compat note (§6.4.4) is important because pre-dpt-4 epics have
no block and consumers must not fail silently or noisily on absence.
