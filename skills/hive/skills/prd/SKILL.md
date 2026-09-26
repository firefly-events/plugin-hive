---
name: prd
description: Author a Product Requirements Document (PRD) — produce a full HTML document with sectioned layout, inline Mermaid architecture diagrams, and <figure> elements for UI wireframes. HTML is canonical for PRD (exception to markdown-default). Use when a large-scope epic needs a PRD before planning begins, or when SCOPE_CLASS is "prd".
---

# Hive PRD Skill

Produce a **Product Requirements Document** as a full HTML artifact. PRD is the only
Hive document type where HTML is canonical — see
`hive/references/planning-format-contract.md §4` for the contract. The `.md` sidecar
is the inverse-direction fallback generated after the HTML is written.

**Input:** raw research findings, the original user request, and any prior design gate
output. `$ARGUMENTS` carries the epic id.

## When to use

- A `/plan` run finds `SCOPE_CLASS: prd` in the design discussion Scale Assessment.
- The user explicitly requests a PRD for a new product surface or large initiative.
- A structured outline alone is insufficient to capture product-level requirements
  (user personas, non-functional requirements, success metrics, Go/No-Go criteria).

## Mandatory sections (produce in this order)

Write each section as a named `<section id="...">` block inside `<div class="content">`.
Include a `<nav>` table of contents that links to each section id.

1. **`#summary` — Executive Summary** (~20 lines)
   What the product is, why now, and what success looks like. Three to five sentences of
   clear product intent followed by a bullet list of the top three outcomes.

2. **`#problem` — Problem Statement** (~30 lines)
   The gap or pain being addressed. Who experiences it, how often, and what the current
   workaround costs. Cite research sources for non-obvious claims.

3. **`#goals` — Goals and Non-Goals** (~20 lines)
   Two-column structure: Goals (in scope, measurable) and Non-Goals (explicitly excluded).
   Each goal maps to a success metric in §8.

4. **`#users` — User Personas and Use Cases** (~40 lines)
   Named personas (2–4) with role, context, and primary need. Each persona has 1–3
   primary use cases. Where a UI flow exists, embed a `<figure>` slot per §5 of the
   planning-format-contract.

5. **`#requirements` — Functional Requirements** (~60 lines)
   Numbered requirements grouped by persona or feature area. Each requirement is a
   single declarative sentence: "The system shall…". Mark priority: P0 (must-have),
   P1 (should-have), P2 (nice-to-have).

6. **`#nfr` — Non-Functional Requirements** (~30 lines)
   Performance, reliability, security, scalability, and accessibility constraints. Each
   NFR states the metric and measurement method.

7. **`#architecture` — Technical Architecture** (~50 lines)
   High-level component diagram as an inline Mermaid block (use `graph TD`). Prose
   description of key components, data flows, and integration points. Reference
   `hive/references/planning-format-contract.md §3` for Mermaid delimiter convention.

   Embed the diagram directly in the HTML as:
   ```html
   <div class="mermaid">
   graph TD
     A[Component A] --> B[Component B]
   </div>
   ```

8. **`#metrics` — Success Metrics** (~20 lines)
   Each metric maps to a Goal from §3. Format: metric name, baseline, target, measurement
   method, and review cadence.

9. **`#risks` — Risks and Mitigations** (~30 lines)
   Table: Risk | Severity (H/M/L) | Likelihood (H/M/L) | Mitigation | Owner.
   Narrative paragraph for each High-severity risk.

10. **`#dependencies` — Dependencies and Constraints** (~20 lines)
    External systems, teams, or decisions this PRD depends on. Flag any blocking
    dependencies with `[BLOCKING]`.

11. **`#timeline` — Timeline and Milestones** (~20 lines)
    Phased rollout plan. Each milestone: name, deliverable, and success criterion.
    Not a story-level breakdown — that belongs in structured-outline.

12. **`#decisions` — Open Decisions** (~20 lines)
    Decisions not yet locked that gate implementation. Each leads with a recommended
    default + rationale + override condition. `★`-flag decisions that need explicit
    sign-off before work begins.

## HTML document structure

Write the PRD as a complete `<!DOCTYPE html>` document. Use `hive.lib.html_sidecar_gen`'s
CSS and Mermaid initialization patterns for visual consistency with other Hive HTML
sidecars, or replicate the same structure directly:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRD: {epic title}</title>
  <style>/* same CSS as hive.lib.html_sidecar_gen CSS constant */</style>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
  </script>
</head>
<body>
  <div class="content">
    <nav>
      <h2>Contents</h2>
      <ul>
        <li><a href="#summary">Executive Summary</a></li>
        <!-- ... -->
      </ul>
    </nav>
    <section id="summary"><h1>Executive Summary</h1>...</section>
    <!-- ... remaining sections ... -->
  </div>
</body>
</html>
```

## Figure slots

Follow the wireframe discovery protocol in `hive/references/planning-format-contract.md §5`.
Check `state/wireframes/{epic-id}/` before writing any `<figure>`. Use
`<figure data-placeholder="...">` when no approved wireframe exists. Place each `<figure>`
inside the relevant `<section>` immediately after the prose it illustrates.

## Completeness gate (do not skip)

All 12 sections must be present and non-empty. `#requirements` (§5), `#architecture`
(§7), and `#decisions` (§12) are the most commonly dropped — they are required. Target
**~350–450 lines of HTML source**. Write "data not provided: [what's missing]" inside a
section rather than omitting it — a visible gap is a signal, not a defect.

## Output

1. Write the HTML file:
   ```
   .pHive/epics/{epic-id}/docs/prd.html
   ```

2. Generate the markdown sidecar (inverse direction).

   ```python
   from hive.lib.html_sidecar_gen import generate_markdown_sidecar
   generate_markdown_sidecar('.pHive/epics/{epic-id}/docs/prd.html')
   # produces .pHive/epics/{epic-id}/docs/prd.md
   ```
   Non-blocking — log a warning and continue if it fails.

3. Record token metrics:
   ```
   lib/doc-token-telemetry recordDocWrite({ docPath: ".pHive/epics/{epic-id}/docs/prd.html", epicId: "{epic-id}", docType: "prd", format: "html" })
   ```

Both `.html` and `.md` are committed to git for PRDs (unlike other doc-type sidecars which
are gitignored). See `hive/references/planning-format-contract.md §4` for the full
PRD-exception contract.

## What this skill is NOT

- **Not a structured outline.** The PRD defines *what* and *why*; structured-outline
  defines *how* in implementation detail.
- **Not story YAML.** PRD feeds structured-outline which feeds story decomposition.
- **Not a design discussion.** Design discussion is the agent's working notes;
  PRD is the stakeholder-facing requirements artifact.
