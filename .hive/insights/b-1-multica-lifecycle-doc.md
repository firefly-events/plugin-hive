# Insights: b-1-multica-lifecycle-doc

## The "doc instead of feature" pattern is load-bearing

When a planned feature becomes moot (substrate already does it), the temptation is to
silently drop it. Resist. Future readers — including agents working in the same area —
will search for `teammate_lifecycle` or `respawn_per_task`, find nothing, and assume
the feature is upcoming rather than deliberately abandoned. A one-paragraph tombstone in
the right user-facing doc costs almost nothing and prevents that confusion permanently.

## Cross-reference the original intent, not just the outcome

The doc explains *why* Workstream B was dropped, not just that it was. This matters
because the reasoning ("substrate makes it moot") is non-obvious — a reader who only
sees "feature not built" can't tell whether it was forgotten, blocked, or superseded.
Naming the original design artifact (design-discussion.md) and the specific mechanism
that superseded it (Multica per-story dispatch) makes the decision legible without
requiring a git archaeology dig.

## README is the right doc target for lifecycle behavior

Operations-guide.md covers day-to-day workflow; hive/references/ covers schemas and
contracts. A "how agents are spawned" explanation belongs in README because that's where
users form their first mental model of execution. Cross-linking from the references
layer would reach the wrong audience (maintainers, not users). When story scope says
"Add (or cross-link to)" a note in README, prefer adding it directly if the content is
user-facing and short enough to not bloat the section.
