# Architecture Decision Records (ADRs)

Long-form rationale for decisions that shape the codebase. Numbered
sequentially. The format is intentionally light — capture the
**decision**, the **why**, and enough **context** that a future
maintainer (or a future model) can tell whether the conditions that
led to the decision still hold.

## When to write one

Write an ADR when:

- A choice has cross-cutting consequences (touches multiple modules,
  workflows, or agent personas) AND
- The reasoning isn't obvious from the diff (architectural tradeoff,
  rejected alternatives, future-rollback contingencies) AND
- Future readers will reasonably ask "why was this done?"

A bug fix doesn't need one. A refactor that re-organizes within an
existing pattern doesn't need one. A typed runtime cutover, an opt-in
mechanism, a cross-workflow migration path, or a rejection of an
expressed-but-tempting alternative — those need one.

## File-naming convention

`hive/decisions/0NN-<slug>.md` where `0NN` is the next available
zero-padded three-digit sequence number and `<slug>` is a short
kebab-case identifier (10-30 chars).

Examples:
- `001-executor-cutover.md`
- `002-config-shipping-policy.md` (hypothetical)
- `010-knowledge-graph-schema.md` (hypothetical)

Numbers are NEVER reused even if an ADR is later superseded.
A superseding ADR carries a new number and the older ADR is updated
with a `superseded_by:` field in its frontmatter.

## Frontmatter

```markdown
---
date: YYYY-MM-DD                          # decision date, not file-creation
decision: One-sentence statement.         # what was decided
status: accepted | superseded | deprecated
epic: <epic-id-or-context>                # optional: link to the work
superseded_by: 0NN-<slug>.md              # optional: forward link
---
```

## Body sections (recommended)

The 4-section shape is recommended but not required:

1. **Context** — what problem prompted this; what constraints applied
2. **Decision** — what was decided; alternatives that were rejected
3. **Consequences** — what this enables; what it costs; rollback path
4. **References** — links to canonical sources (memories, prior ADRs,
   external docs, related epics)

For complex rollouts (cutover sequences, phased migrations), include
a chronological **Rollout history** subsection so future readers see
the order of operations without git-archaeology.

## Maintenance

- ADRs are append-only at the file system level. Don't edit
  `001-executor-cutover.md` to reflect a later change — write
  `00N-<followup>.md` and add a `superseded_by:` link to the original.
- One exception: typo fixes and clarifications that don't change the
  decision are fine inline.
- A periodic sweep (yearly is plenty) confirms the `status:` field
  still matches reality. ADRs with `status: accepted` for a decision
  the codebase no longer follows should be marked `deprecated` even
  if no replacement ADR exists.
