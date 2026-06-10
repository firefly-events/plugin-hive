---
name: horizontal-plan
description: Author a horizontal planning scan — a breadth-first layer map of what each architectural layer needs OVERALL to fulfill the requirement. Use when a large-scope /plan run needs its horizontal plan before vertical slicing.
---

# Hive Horizontal Planning Scan

Produce a **breadth-first layer map** from a design discussion and research findings —
what does each layer of the architecture need OVERALL to fulfill the requirement? The
output is a **map, not an execution plan**; vertical planning slices it next. Canonical
structure: [`hive/references/document-templates/horizontal-plan.md`](../../../hive/references/document-templates/horizontal-plan.md).
This skill makes its sections mandatory.

**Input:** the design-discussion document + research brief + user feedback on the design
discussion. `$ARGUMENTS` carries the epic id.

## When to use

- A large-scope `/plan` run has passed the design gate and needs the horizontal layer map before vertical slicing.

## Mandatory sections (produce in this order — see template for detail)

1. **Layer Inventory** (~30 lines) — every layer the requirement touches (backend, frontend, data, infra, etc.), one line each.
2. **Per-Layer Requirements** (~100–200 lines) — for EACH layer: responsibility, key files/seams (real paths), what it must do overall, dependencies. This is the bulk of the document.
3. **Cross-Layer Dependencies** (~50 lines) — how the layers depend on each other; the integration seams.
4. **Layer Map Diagram** (~30 lines) — an ASCII/textual map of the layers and their relationships.
5. **Scope Summary** (~20 lines) — overall LOC/complexity sense and which layers carry the most weight.

## Completeness gate (do not skip)

Every layer named in §1 must have a corresponding §2 entry — no orphaned or skipped
layers. All 5 sections present. Cite real file paths from the research, not invented ones.
If a layer is genuinely untouched, say so explicitly rather than omitting it.

## Tone & style

A breadth map, not a slice plan — describe what each layer needs overall, not the order
of execution (that's the vertical plan). Dense, scannable, evidence-backed.

## Output

Write to `.pHive/epics/{epic-id}/docs/horizontal-plan.md`.

## What this skill is NOT

- **Not the vertical plan.** This is breadth (all layers at once); `vertical-plan` is depth (executable slices).
- **Not the structured outline.** This maps layers; the outline operationalizes the whole plan.
- **Not implementation order.** No slices, no sequencing — that is the vertical plan's job.
