---
name: architecture-doc
description: Author a technical design / architecture document — context, proposed design, alternatives, risks. Use when a non-trivial change or system needs a written design before implementation.
---

# Hive Architecture Doc

Produce a **technical design document** that lets a reviewer understand the
shape of a solution — and the reasoning behind it — without reading code. The
document covers the problem, the proposed design, the alternatives weighed, and
the consequences.

**Input:** `$ARGUMENTS` (or upstream architect/researcher findings) describing
the problem, goals, constraints, and any candidate approaches.

## When to use

- A feature or system is large or risky enough to warrant design-before-build.
- Multiple approaches exist and the choice needs to be justified and recorded.
- Cross-component or cross-team work needs a shared reference.

For a single discrete decision with alternatives, prefer `adr` (lighter weight).
For a per-story unit of work, use `story-writing`.

## Sections (produce in this order)

1. **Title & status** — what is being designed; status (draft / under review / accepted).
2. **Context & goals** — the problem, the forces (constraints, requirements, deadlines), and explicit goals.
3. **Non-goals** — what this design intentionally does not address. Bounds the scope.
4. **Proposed design** — the recommended approach. Describe components, responsibilities, and how they interact. Include a data/flow sketch (text or Mermaid) when it aids clarity.
5. **Alternatives considered** — each rejected option with a one-line *why not*. Shows the decision was reasoned, not defaulted.
6. **Risks & trade-offs** — what could go wrong, what gets harder, mitigations.
7. **Rollout / migration** — how it ships: phases, flags, backfill, reversibility. "Big bang" only if justified.
8. **Open questions** — unresolved items needing a decision, or "none".

## Tone & style

- Audience is an engineer reviewing the approach. Precise, justified, no marketing.
- Every significant choice carries a *why*. Assertions without rationale are gaps.
- Diagrams as Mermaid fenced blocks; keep them small and legible.

## Output

One design document per task. Default path: as named in the task; if unspecified,
`.pHive/epics/{epic-id}/docs/architecture.md`.

## What this skill is NOT

- **Not an ADR.** ADRs record one decision; this documents a whole design. If the input is a single choice with alternatives, use `adr`.
- **Not implementation.** Describe structure and rationale, not line-level code.
- **Not a story.** Acceptance criteria belong in `story-writing`.
