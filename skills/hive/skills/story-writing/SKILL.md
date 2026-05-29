---
name: story-writing
description: Author a user story spec — narrative, acceptance criteria, and scope boundaries. Use when the writer must turn a requirement or feature request into a well-formed story document.
---

# Hive Story Writing

Turn a raw requirement, feature request, or analyst output into a precise,
testable **user story** document. The story communicates *who* needs *what* and
*why*, with acceptance criteria a tester or reviewer can verify without asking
follow-up questions.

**Input:** `$ARGUMENTS` (or upstream analyst/researcher findings) describing the
desired capability, its motivation, and any known constraints.

## When to use

- A requirement needs to become an actionable, testable unit of work.
- Acceptance criteria must be made explicit before planning or dispatch.
- A vague feature ask ("add export") needs a concrete, bounded definition.

Do not use for multi-story decomposition (that is planning) or for architecture
decisions (use `architecture-doc` / `adr`).

## Sections (produce in this order)

1. **Title** — imperative, specific. "Export saved filters as JSON", not "Export feature".
2. **Narrative** — one line in the form: *As a `<role>`, I want `<capability>`, so that `<outcome>`.* The outcome is the *why*, not a restatement of the capability.
3. **Context** — 2-4 sentences: the problem today, why it matters now, any constraint the implementer must respect. No solution design.
4. **Acceptance criteria** — a numbered list of verifiable statements. Prefer Given/When/Then for behavioural criteria. Each must be objectively checkable; avoid "works well" / "is fast" without a measure.
5. **Out of scope** — bullets naming what this story deliberately does NOT cover, to prevent scope creep.
6. **Dependencies** — other stories, services, or data this depends on, or "none".

## Tone & style

- Reader is the implementer and the tester. Write so they never have to guess.
- Concrete over abstract: name the entity, the surface, the format.
- No solutioning in Context or Narrative — acceptance criteria constrain *behaviour*, not implementation.

## Output

Write one story document per task. Default path: the location named in the task;
if unspecified, `.pHive/epics/{epic-id}/docs/stories/{story-id}.md`.

## What this skill is NOT

- **Not a YAML story spec.** This produces the human-readable story document; the structured `.pHive` story YAML is authored by planning, not here.
- **Not decomposition.** One story per task. Splitting an epic into stories is planning's job.
- **Not design.** Acceptance criteria describe observable behaviour, not architecture.
