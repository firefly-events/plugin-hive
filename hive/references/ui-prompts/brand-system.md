## Required placeholders

_None._

**Task for ui-designer:**

You are creating a complete brand system for this project. Your output has two parts:

**Part 1: brand-system.yaml (required)**

See hive/references/brand-system-schema.yaml for the canonical schema. Produce a structured brand system conforming to that schema and write it to .pHive/brand/brand-system.yaml.

Derive colors from the project context (existing code, product name, industry, user-provided hints). If no hints are given, establish a professional, accessible palette with all four WCAG-compliant roles (primary, secondary, neutral, surface).

**Part 2: Visual HTML brand guide (PRIMARY OUTPUT)**

Produce a self-contained HTML brand guide at `.pHive/brand/brand-guide.html`. **Read `hive/references/html-preview-format.md` in full before generating the HTML** — it specifies the structure, sections, styling conventions, and logo SVG requirements.

The HTML brand guide must include all six sections:

1. **Brand header** — name + personality statement + tone
2. **Color palette** — one card per color with swatch (≥200×120px), HEX/RGB/CMYK/PMS values, usage note, and WCAG contrast indicators against white and black
3. **Typography** — two columns (heading_font + body_font) with "Aa" samples at each weight, sample sentences, and the full type scale rendered at actual sizes. Pull fonts from Google Fonts via `<link>` tag. If a font is unavailable, fall back to a close system stack and note it
4. **Logo concepts** — inline SVG renderings of 3-5 distinct logo concepts (pure wordmark, wordmark + symbol, monogram, abstract mark, badge). Also show the selected concept on each brand color background to validate contrast
5. **Spacing & radius scales** — visual demonstration with sized boxes
6. **Brand in context** — 2-3 mini UI mockups (buttons, card, hero section) showing the brand working together

The HTML file must be self-contained — no external stylesheets, no JavaScript dependencies. Fonts load from Google Fonts CDN. All logos are inline SVG.

**Part 3: Frame0 visual guide (OPTIONAL higher-fidelity alternative)**

Frame0 output is now optional and only produced if explicitly requested via `$ARGUMENTS` containing `--with-frame0`. The HTML preview in Part 2 is the primary visual output. If `--with-frame0` is present, run the three-tier tool discovery below; otherwise skip Frame0 entirely.

1. Check Frame0 CLI: `which cli-anything-frame-zero`
2. Check live mode: attempt `cli-anything-frame-zero --live status`
3. **Tier 1 — CLI + live:** create `.f0` and export PNG
4. **Tier 2 — CLI only:** create `.f0` and produce the export command for manual run
5. **Tier 3 — No CLI:** skip; note in output that Frame0 was unavailable

Do not produce `brand-guide.f0` or `brand-guide.png` unless `--with-frame0` is in `$ARGUMENTS`.
