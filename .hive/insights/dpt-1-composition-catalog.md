# Insights — dpt-1-composition-catalog

## Composition vs Escalation split is load-bearing

The `planning_composition` section must live in the same file as the escalation Catalog
but must NOT reuse `placement` fields. The execute skill routes on `placement` +
`responds_with.type` — any composition entry that bleeds into that namespace would be
silently misrouted. The cross-reference note in the file exists precisely because the
two sections look similar but fire at different lifecycle points.

## project_gate: requires_ui scopes ui + accessibility together

Both `ui` and `accessibility` tags carry `project_gate: requires_ui`. This is
intentional: accessibility work only applies when there is a UI surface. A project
without UI has no accessible surfaces to review. Future tags that are conditionally
applicable should follow the same pattern rather than adding ad-hoc boolean flags.

## Persona resolution must be validated against hive/agents/*.md

Every name in `specialists` and `spine` must have a corresponding `.md` file under
`hive/agents/`. At time of writing all six specialist names + three spine names resolve
cleanly. When adding new work_type rows, verify the agent file exists before
committing — a missing agent silently breaks the planning-classification skill lookup.

## data → architect is intentional reuse

The `data` tag maps to `[architect]` rather than a dedicated data-architect persona.
This is a deliberate generalization: the architect persona owns data modeling scope
until a dedicated data-architect agent ships. Document this when that persona is added
so the `data` row gets updated.
