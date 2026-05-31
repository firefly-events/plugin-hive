---
name: adr
description: Author an Architecture Decision Record — one significant decision with context, the choice, consequences, and alternatives. Use when a specific technical decision needs to be recorded with its rationale.
---

# Hive ADR

Produce an **Architecture Decision Record**: a short, immutable document
capturing *one* significant technical decision and *why* it was made. Code shows
what; git shows when and who; the ADR preserves the why, which otherwise
evaporates.

**Input:** `$ARGUMENTS` (or upstream findings) describing the decision, the
forces that drove it, and the options considered.

## When to use

- A specific, consequential choice was made (a technology, a pattern, a boundary).
- Future readers will ask "why was it done this way?" and deserve a recorded answer.

For a whole solution design, use `architecture-doc`. For a unit of work, use
`story-writing`. ADRs are deliberately small — one decision each.

## Sections (produce in this order)

1. **Title** — the decision, stated plainly. "Use Multica as the task-tracking substrate".
2. **Status** — one of: proposed / accepted / superseded by ADR-NNN / deprecated.
3. **Context** — the forces at play: the problem, constraints, requirements, and what made a decision necessary now. No solution yet.
4. **Decision** — what was chosen, stated in active voice: "We will …".
5. **Consequences** — the results: what becomes easier, what becomes harder, what new obligations or risks the decision creates. Be honest about the downsides.
6. **Alternatives considered** — each option not taken, with a one-line *why not*.

## Tone & style

- Terse and factual. An ADR is a record, not an essay.
- Active voice for the decision ("We will adopt X").
- Capture trade-offs honestly — an ADR with no downsides is under-examined.

## Immutability

An accepted ADR is not edited. To change a decision, write a new ADR and set the
old one's status to *superseded by ADR-NNN*. This preserves the historical why.

## Output

One ADR per task. Default path: `docs/adr/NNNN-<kebab-title>.md` (zero-padded
sequence), or as the task specifies.

## What this skill is NOT

- **Not a design doc.** One decision, not a whole system — use `architecture-doc` for the latter.
- **Not mutable.** Supersede; do not rewrite accepted ADRs.
- **Not a status report.** It records a decision, not project progress.
