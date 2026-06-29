---
name: vertical-plan
description: Author a vertical planning slice plan — cut the horizontal layer map into minimum cross-stack increments that each produce a working, demo-able, commit-worthy state. Use when a large-scope /plan run needs its vertical plan after the horizontal scan.
---

# Hive Vertical Planning — Slice Plan

Take the horizontal layer map and **cut it into vertical slices** — minimum cross-stack
increments that each produce a working, demo-able, commit-worthy state. This is the
execution plan overlaid on the breadth map. Canonical structure:
[`hive/references/document-templates/vertical-plan.md`](../../../hive/references/document-templates/vertical-plan.md).
This skill makes its sections mandatory.

**Input:** the horizontal planning scan (layer map + per-layer requirements + cross-layer
dependencies) + design discussion + user feedback. `$ARGUMENTS` carries the epic id.

## When to use

- A large-scope `/plan` run has a horizontal scan and needs the vertical slice plan before the H/V review gate.

## Mandatory sections (produce in this order — see template for detail)

1. **Slicing Strategy** (~30 lines) — how the map is cut: what makes a slice, what the first slice proves, sequencing logic.
2. **Vertical Slice Plan** (~200–400 lines) — the ordered slices. For EACH slice (Step N): goal/what-works-after, layers touched, what is NOT yet included, verified-by, what the commit represents, dependencies. Slice 1 should be the thinnest end-to-end proof; mark any hard bail/gate explicitly.
3. **Overlay Diagram** (~30 lines) — slices overlaid on the horizontal layers (which slice touches which layer). Use a Mermaid `graph TD` block per `hive/references/planning-format-contract.md §3`. Include `accTitle` and `accDescr` directives at the top of each block (e.g. `accTitle: Overlay Diagram\naccDescr: Vertical slices overlaid on horizontal layers`).
4. **Deferred Items** (~30 lines) — what is explicitly out of the current slice plan and why.
5. **Risk by Slice** (~30 lines) — per-slice risk level + the dominant risk.
6. **Moldability Notes** (~20 lines) — where a slice can split or reorder without invalidating the rest.

## Completeness gate (do not skip)

All 6 sections present. Every slice in §2 carries goal + layers + verified-by + deps —
a slice missing its acceptance/verification signal is incomplete. Slice 1 must be a real
end-to-end increment, not a setup-only step. Cite real paths.

## Tone & style

Execution-focused. Each slice is independently shippable and demo-able. Describe the
working state after each slice, not just the tasks within it.

## Output

Write to `.pHive/epics/{epic-id}/docs/vertical-plan.md`.

After writing the markdown file, invoke the sidecar HTML generator to produce a `.html` sibling for browser preview:

```
python -m hive.lib.html_sidecar_gen ".pHive/epics/{epic-id}/docs/vertical-plan.md"
```

The generator is non-blocking — if it fails, log a warning and continue. The `.html` file is not committed to git by default (generated on-demand).

After writing the markdown file, record token metrics:

```
lib/doc-token-telemetry recordDocWrite({ docPath: ".pHive/epics/{epic-id}/docs/vertical-plan.md", epicId: "{epic-id}", docType: "vertical-plan", format: "md" })
```

The probe is non-blocking — if it fails, log a warning and continue.

## What this skill is NOT

- **Not the horizontal scan.** That maps all layers; this sequences executable increments.
- **Not story YAMLs.** Slices group into stories later via `story-writing`/the structured outline.
- **Not a layer-by-layer build.** Slices cut across the stack; never "do all of the backend, then all of the frontend".
