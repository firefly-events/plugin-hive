# Logo Finalization Flow

Date: 2026-05-17
Status: reference (no code)
Related: `.pHive/research/ui-logo-approach-may2026.md`, `hive/references/ui-prompts/brand-system.md`

The `/logo-exploration` skill (epic `ui-logo-imagegen-integration`) ends with a human picking a winning **raster** mark from a contact sheet. A raster PNG is not a deliverable brand package. This doc covers what happens between "winner picked" and "brand package shipped" — the manual steps, the vectorization tools, the approval gate, and the final on-disk layout.

This entire flow is intentionally **outside the current epic**: Hive does not vectorize, package, or sign off on logos today. Future work is named in the last section.

---

## 1. End-to-end stage map

```
brand-system  →  /logo-exploration  →  [human picks winner]  →  vectorize  →  package  →  approval gate  →  .pHive/brand/logo/
   (Hive)            (Hive)               (human)             (external)   (human)     (human)            (final)
```

Stages 4-6 are manual / external. Hive does not gate or automate them in this epic.

---

## 2. Vectorization options (2026-05)

The winning raster needs to become a clean SVG before any final packaging. Quality varies sharply by mark complexity (geometric vs. organic, single-color vs. gradient, mark-only vs. wordmark). Pick the tool that fits the mark; do not assume one will dominate.

| Tool | Access | One-line pro | One-line con |
|------|--------|--------------|--------------|
| **Adobe Illustrator** (manual redraw) | Paid subscription, desktop | Highest-fidelity output because a designer is redrawing, not tracing | Slowest and most expensive; quality depends on the designer's skill |
| **Recraft** | Web app + API, paid tiers | Built for brand work, has vectorize + "make it editable" flows in one place | Output still needs cleanup for kerning and tight curves |
| **Vectorizer.ai** | Web app + API, per-image pricing | Best autotrace fidelity on clean raster input among the autotrace tools | Pure trace — gives no help with logical curve structure or layered components |
| **Vector Magic** | Web app + desktop, subscription | Strong on grainy or low-resolution raster sources | UI feels dated and the output often needs path-count pruning |
| **Inkscape autotrace** | Free, desktop | Free, scriptable, lives entirely on the local machine | Lowest fidelity of the listed options; usually a starting point, not a finish |

Rule of thumb: a designer-led Illustrator redraw is the only path that reliably produces shippable geometry on the first pass. Everything else expects a cleanup round.

---

## 3. Final brand-package layout

After vectorization and cleanup, the final assets live under `.pHive/brand/logo/`. This layout is the contract a downstream consumer (web build, social post generator, favicon emitter, print spec) should be able to rely on.

```
.pHive/brand/logo/
├── source/
│   ├── logo.svg                  # master vector, full color, primary lockup
│   └── logo.ai                   # optional Illustrator source if one exists
├── color/
│   ├── logo-color.svg
│   ├── logo-color@1x.png         # 512px wide
│   ├── logo-color@2x.png         # 1024px wide
│   └── logo-color@3x.png         # 1536px wide
├── mono/
│   ├── logo-black.svg
│   ├── logo-white.svg            # for dark backgrounds
│   └── logo-mono@1x.png          # black on transparent, 512px wide
├── favicon/
│   ├── favicon.ico               # multi-resolution (16, 32, 48)
│   ├── favicon-32.png
│   └── apple-touch-icon-180.png
├── social/
│   ├── social-1500x500.png       # Twitter/X header
│   ├── social-1200x630.png       # Open Graph / LinkedIn share
│   └── avatar-square-512.png
└── USAGE.md                      # clear-space, min size, do/don't, color values
```

Notes:

- Every PNG export is generated from the matching SVG so there is one source of truth per variant.
- `USAGE.md` is a plain-markdown brand-usage doc, not HTML. It belongs next to the assets, not in the brand guide.
- Filenames are kebab-case and never include the brand name — the directory is the namespace.

---

## 4. Manual approval gate

The approval gate sits between "package assembled" and "package committed to `.pHive/brand/logo/`". It is fully manual today.

**Who signs off:** the brand owner for the project. For solo projects this is the user. For team projects this is whoever owns the brand decision — usually the product or design lead, not the agent.

**What evidence the approver must see before signing off:**

1. The full `.pHive/brand/logo/` directory rendered in a single review HTML, showing each variant against both light and dark backgrounds.
2. A favicon preview at actual size (16, 32, 48 px) — favicons fail at small sizes more often than any other variant.
3. The mono variant tested on at least one photographic background (overlay legibility).
4. The social header tested with the safe-area bounds for the target platform overlaid.
5. A short written rationale tying the final mark back to the brand brief from `.pHive/brand/brand-system.yaml`.

**Form of sign-off:** a commit message on the PR that adds `.pHive/brand/logo/` containing the approver's name and the date. No separate ceremony, no separate tool. The commit is the artifact.

---

## 5. Future story (deferred, not in this epic)

**Proposed title:** Hive skill that wraps a vectorization API

**Scope sketch a future planner can pick up without re-researching:**

- New skill `/logo-vectorize` that takes a chosen raster from `.pHive/brand/logo-explorations/` and produces an SVG draft in `.pHive/brand/logo/source/`.
- Backend: start with a single hosted API (Recraft or Vectorizer.ai) behind a thin wrapper; do not try to abstract over multiple vendors on the first pass.
- Output is explicitly a **draft** — the skill must surface a clear "needs human cleanup" status, never claim the SVG is final.
- Out of scope for that story: brand-package assembly, favicon emission, social variant generation, the approval gate. Those remain manual.

This is deferred because vectorization quality is mark-dependent and a single API call rarely produces a shippable result. Wrapping it now would create a skill whose main output is "go fix this by hand," which is worse than no skill.

---

## 6. Re-audit cadence

This doc names specific 2026-vintage vendors. Re-audit the tools table annually — vectorization is an active product space and the right answer in 2027 may not be on this list.
