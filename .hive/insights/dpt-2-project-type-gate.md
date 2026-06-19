# dpt-2-project-type-gate — Implementation Insights

## Absent-field semantics are load-bearing

The story's "absent = unknown → conservative default" contract is not just a footnote —
it is the consuming skill's (dpt-3) primary escape hatch. When writing gate logic, treat
a missing `has_ui` as a signal to fall back to tech-stack heuristics rather than a hard
false or a crash. Encoding this in the schema doc (SKILL.md) rather than only in dpt-3
ensures future profile writers understand the contract without chasing down consumers.

## project_type > has_ui in expressive power

`has_ui` is a derived bool for the immediate gate need. `project_type` is the richer
enum for future gates (`requires_service`, etc.). When adding new gates, model them
against `project_type` first; only add a new bool field when the gate logic truly
cannot be expressed as a `project_type` predicate.

## Re-kickoff idempotency

The SKILL.md re-kickoff clause (show existing values, ask keep-or-change) mirrors the
existing `ship_target` pattern. Keep these two flows consistent — any change to how
one handles re-kickoff should be mirrored in the other to avoid user confusion.

## Branch worktree conflict

The epic branch `feat/dynamic-planning-team` was locked by a parallel worktree. Work
on the daemon-created branch and push with `git push origin HEAD:feat/dynamic-planning-team`
after rebasing on origin. This is the correct pattern for same-branch parallel dispatch;
the integration contract's retry loop handles the non-fast-forward case.
