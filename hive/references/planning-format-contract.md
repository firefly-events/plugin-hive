# Planning Document Format Contract

This reference defines the content, image, and rendering conventions that govern all planning documents produced by Hive. It is the authoritative source for doc-type format decisions; skills and agents must follow it rather than invent local conventions.

---

## 1. Doc-Type Embedded Content Table

Each planning document type has a defined set of embedded content elements. The table below specifies what is required, optional, or excluded per type.

| Doc Type | Figures | Diagrams | Notes |
|----------|---------|----------|-------|
| **design-discussion** | Required — figure slots for concept illustrations | None required | Figure slots mark where wireframes or annotations will land; use `<figure data-placeholder="description">` until wireframes exist |
| **structured-outline** | Optional — figure slots where visual context aids understanding | Required — Mermaid dependency map showing story/component relationships | Dep map uses standard `graph TD`; figures are supplementary not mandatory |
| **horizontal-plan** | Not used | Required — Mermaid `graph TD` layer map | Diagram replaces prose for cross-layer dependency visualization |
| **vertical-plan** | Not used | Required — Mermaid overlay on top of horizontal-plan layer map | Overlay shows slice groupings; references horizontal-plan diagram by convention |
| **PRD** | As needed | As needed | **HTML-primary exception**: PRD is the only doc type where `.html` is the canonical output; markdown is the source but HTML is what gets read and shared |

---

## 2. Image Source Policy

Figures in planning documents follow a strict source-of-truth hierarchy. Do not generate images at runtime.

**Source priority:**
1. **Frame0 PNGs** at `state/wireframes/{epic-id}/{story-id}/` — use when available; reference by relative path.
2. **Placeholder element** — `<figure data-placeholder="description">` when no wireframe exists yet. The `description` attribute is a plain-language label of what the figure will show.

**Wireframe discovery protocol (mandatory before writing figure slots):**

1. Check `state/wireframes/{epic-id}/` for any existing wireframe files.
2. If wireframes exist for the story, reference them directly as `<figure>` with `src`.
3. If the directory is absent or contains no relevant files, use `<figure data-placeholder="description">` — never leave a figure slot empty and never generate an image.

No skill or agent may invoke an image-generation tool to fill a figure slot. Placeholders are intentional and will be replaced when wireframes are produced.

---

## 3. Mermaid Delimiter Convention

All Mermaid diagrams use standard fenced code blocks with the `mermaid` language tag:

~~~
```mermaid
graph TD
  A --> B
```
~~~

**No special wrapper elements.** Do not wrap Mermaid blocks in `<div>`, `<figure>`, custom directives, or any other container. The bare fenced block is the only supported form.

This applies uniformly across all doc types including horizontal-plan, vertical-plan, and structured-outline.

---

## 4. Sidecar HTML Generation Rule

**Markdown is canonical.** All planning documents are authored and stored as `.md` files. The markdown file is the source of truth.

**HTML sidecar** (`.html` sibling file) is generated automatically on skill write via `lib/html-sidecar-gen`. The following rules govern it:

- The `.html` sidecar is **not committed** by default — it is a local rendering artifact.
- Sidecar generation failure is **non-blocking**: log the error and continue. A missing sidecar does not fail the skill run.
- The sidecar is browser-only; agents read the markdown source directly.
- **PRD exception:** For PRD documents, the `.html` file is the canonical output (see Section 1). The PRD `.html` is committed alongside the markdown source.

---

## 5. Terminal Degradation Expectations

Planning documents must remain useful when rendered outside a full browser environment. The following degradation behavior is required:

| Element | Terminal / Plain Text Rendering |
|---------|--------------------------------|
| Markdown-embedded HTML (`<figure>`, `<div>`) | Degrades to readable markdown with visible raw tags — acceptable; `grep` works on the content |
| `<figure data-placeholder="...">` | Visible as a tagged placeholder — communicates intent even without rendering |
| Mermaid fenced blocks | Readable as plain text — the diagram source is human-legible ASCII; no special rendering needed |
| `.html` sidecar | Browser-only; absent in terminal — agents and CLI tools use the `.md` source |
| Mermaid diagrams (agent perspective) | Agents parse Mermaid the same as any ASCII — diagram is human-facing documentation, not agent instruction |

The test: a developer reading a planning doc in a terminal or code editor must be able to understand the document's intent without browser rendering.

---

## 6. Extension Notes

This contract is a living document. Future work must follow the extension rules below rather than restructuring existing sections.

**Adding new doc types (planned for S4/S5):**
- Add a row to the Doc-Type Embedded Content Table (Section 1).
- Do not change existing rows unless correcting an error.
- If the new doc type has a unique HTML rendering requirement, note it in the table's Notes column and add the PRD-style exception explicitly.

**PRD is the only HTML-canonical doc type.** All other doc types are markdown-canonical. Any future doc type that needs HTML-primary treatment requires an explicit decision and a new entry in this contract — it is not a default.

**Backward compatibility:** Changes to delimiter conventions (Section 3) or image source policy (Section 2) apply prospectively. Existing documents are not retroactively reformatted unless a migration story is planned.
