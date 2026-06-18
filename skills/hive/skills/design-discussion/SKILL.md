---
name: design-discussion
description: Author a design discussion — turn raw research findings into a comprehensive, opinionated developer brain-dump that states what we're about to do, what worries us, and what's unknown. Use when a /plan run needs its design-discussion document before the design gate.
---

# Hive Design Discussion

Produce a **~200-line design discussion** from raw research findings. This is a
developer brain dump — informal, comprehensive, opinionated. The reader walks away
understanding what the agent thinks it's about to do, what worries it, and what it
doesn't know yet. Canonical structure:
[`hive/references/document-templates/design-discussion.md`](../../../hive/references/document-templates/design-discussion.md).
This skill makes its sections **mandatory**.

**Input:** raw research findings (including any `INCONSISTENCY_RISK_SIGNALS` block),
the original user request, and on a **revision pass** a grill-record from Phase A2 of
`/plan` (`.pHive/epics/{epic-id}/docs/grill-record.md`). `$ARGUMENTS` carries the epic id.

## When to use

- A `/plan` run has produced research findings and needs the design-discussion document before the design gate.
- A revision pass must fold a grill-record's resolved points back into the design discussion.

## Mandatory sections (produce in this order — see template for detail)

1. **What Are We Doing?** (~20 lines) — the requirement restated in the agent's own words.
2. **What I Found** (~40 lines) — the research findings that matter, with file/source citations.
3. **My Proposed Approach** (~40 lines) — the opinionated direction, with rationale.
4. **What Could Go Wrong** (~30 lines) — honest failure modes and worries.
5. **Dependencies and Constraints** (~20 lines) — what this rests on and must respect.
6. **Open Questions** (~20 lines) — unresolved items needing a decision (these surface at the design gate).
7. **Verification Strategy** (~20 lines) — how the resulting work will be proven correct.
8. **Scale Assessment** (~30 lines) — small / medium / large, with the reasoning that drives H/V vs straight-to-stories. End the block with a structured scope-class hint on its own line: `SCOPE_CLASS: single-epic | multi-epic | prd` (pick one; this feeds the scope-class guard in `/plan --lite`).

On a revision pass, add the grill-record consumption per the template (fold resolved
points in; do not silently drop contested items).

## Completeness gate (do not skip)

All 8 sections present and non-empty. **Open Questions** and **Scale Assessment** are
load-bearing (they drive the gate and the H/V decision) — never omit them. If research
didn't cover a section, write `[data not provided: <what>]` rather than dropping it.

## Tone & style

Informal but substantive — a real engineer thinking out loud. Opinionated where the
evidence supports it; honest about uncertainty. Cite the surface behind non-obvious claims.

**Prose discipline:** write the reasoning as paragraphs, not bullet fragments. Bullets are
for genuine lists only. A brain-dump that's wall-to-wall bullets reads as a checklist, not
thinking. (Prose-heavy planning docs are best authored by a Claude model — codex/code
models tend to bullet-dump.)

## Output

Write to `.pHive/epics/{epic-id}/docs/design-discussion.md`.

Where a design includes a visual (wireframe, diagram, or annotated screenshot), embed it using a `<figure>` slot. Place the slot on its own line between paragraphs so it degrades gracefully in terminal and grep is unaffected:

```html
<figure data-src="state/wireframes/{epic-id}/{story-id}/name.png" data-alt="Brief description">
  <!-- placeholder: Brief description -->
</figure>
```

Use `data-src` for a known Frame0 PNG path; use `data-placeholder="description"` (no `data-src`) when the image does not exist yet. Do not nest prose inside `<figure>`.

After writing the markdown file, invoke the sidecar HTML generator to produce a `.html` sibling for browser preview:

```
lib/html-sidecar-gen generateSidecar(".pHive/epics/{epic-id}/docs/design-discussion.md")
```

The generator is non-blocking — if it fails, log a warning and continue. The `.html` file is not committed to git by default (generated on-demand).

## What this skill is NOT

- **Not the research brief.** That structures findings; this reasons about what to do with them.
- **Not the structured outline.** This is breadth + opinion; `structured-outline` is the detailed blueprint.
- **Not a decision record.** It surfaces open questions for the gate; it does not lock them.
