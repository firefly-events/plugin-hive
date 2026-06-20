# Insights — chs-3-release-flow-docs

## The `/hive:ship` entry was missing from README commands entirely

The README commands section listed every core workflow skill (kickoff through status) but had no `/hive:ship` entry at all. A new behavior in an unlisted command is invisible. When a command is added or substantially changed, the README commands list is the first place operators look — it must be kept in sync independently of the operations-guide.

## Operator-facing docs need the full authoring loop, not just the outcome

The operations guide originally described `/ship` as "generate release post + video script + post ideas" with no mention of the changelog authoring step. Operators running `/ship` for the first time would hit the draft → review → degraded-marker → write sequence with no preparation. The right framing: describe the gate structure (what the operator will see and decide) rather than just the final output.

## Degraded-source markers are a usability feature, not an implementation detail

The `<!-- degraded: sourced from … -->` annotation is the primary signal that tells operators which bullets need rewriting before they approve. If the docs don't name this pattern, operators will encounter unfamiliar HTML comments mid-review with no context. Naming it explicitly in the operations guide removes that confusion at the cost of one sentence.

## The Further Reading table is the operator's map — link canonical specs there

`changelog-entry-format.md` was already linked from the ship SKILL.md but not from the operations guide's Further Reading table. Operators who reach the release section of the ops guide won't naturally navigate to the skill file. A table entry closes that gap.
