---
name: brand-system
description: Establish brand identity — colors, typography, spacing, logos, and a visual HTML brand guide. Produces state/brand/brand-system.yaml and state/brand/brand-guide.html for immediate visual review.
---

# Hive Brand System

Establish a complete brand identity for the project.

**Input:** `$ARGUMENTS` optionally contains brand direction hints (industry, tone, color preferences, existing logo paths).

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Gate Check

**No gate.** brand-system is always runnable — it is the first step in the brand chain.

## Process

### 1. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full. This is the agent you will spawn. The persona includes Frame0 CLI reference, tool discovery protocol, and output format.

### 2. Spawn ui-designer for brand creation

Spawn a subagent with the full ui-designer persona and this task:

---

**Task for ui-designer:**

You are creating a complete brand system for this project. Your output has two parts:

**Part 1: brand-system.yaml (required)**

Produce a structured brand system and write it to `state/brand/brand-system.yaml`. Use this exact schema:

```yaml
# state/brand/brand-system.yaml
colors:
  primary:
    name: "Color Name"
    hex: "#3B5BDB"
    rgb: "rgb(59, 91, 219)"
    cmyk: "cmyk(73, 58, 0, 14)"
    pms: "PMS 2726 C"
    usage: "Primary actions, CTAs, key UI elements"
  secondary:
    name: "Color Name"
    hex: "#F03E3E"
    rgb: "rgb(240, 62, 62)"
    cmyk: "cmyk(0, 74, 74, 6)"
    pms: "PMS 185 C"
    usage: "Accent, alerts, destructive actions"
  neutral:
    name: "Color Name"
    hex: "#495057"
    rgb: "rgb(73, 80, 87)"
    cmyk: "cmyk(16, 8, 0, 66)"
    pms: "PMS Cool Gray 10 C"
    usage: "Body text, secondary content"
  surface:
    name: "Color Name"
    hex: "#F8F9FA"
    rgb: "rgb(248, 249, 250)"
    cmyk: "cmyk(1, 0, 0, 2)"
    pms: "PMS 9120 C"
    usage: "Backgrounds, cards, containers"
typography:
  heading_font: "Inter"
  body_font: "Inter"
  scale: [12, 14, 16, 20, 24, 32, 40]
  weights:
    - weight: 400
      name: "Regular"
      usage: "Body text, captions"
    - weight: 500
      name: "Medium"
      usage: "Labels, navigation items"
    - weight: 600
      name: "SemiBold"
      usage: "Subheadings, emphasis"
    - weight: 700
      name: "Bold"
      usage: "Headings, CTAs"
  usage_guidance: "Use heading_font for all display text; body_font for all reading text"
spacing:
  base: 4          # px, 4-point grid
  scale: [4, 8, 12, 16, 24, 32, 48, 64]
radius:
  small: 4
  medium: 8
  large: 16
  full: 9999
personality:
  statement: "One sentence describing the brand's core character"
  tone: "Adjectives: e.g., confident, approachable, precise"
  voice_principles:
    - "Principle 1"
    - "Principle 2"
    - "Principle 3"
```

Derive colors from the project context (existing code, product name, industry, user-provided hints). If no hints are given, establish a professional, accessible palette with all four WCAG-compliant roles (primary, secondary, neutral, surface).

**Part 2: Visual HTML brand guide (PRIMARY OUTPUT)**

Produce a self-contained HTML brand guide at `state/brand/brand-guide.html`. **Read `hive/references/html-preview-format.md` in full before generating the HTML** — it specifies the structure, sections, styling conventions, and logo SVG requirements.

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

---

### 3. Report output

After the subagent completes, report:

```
Brand System Complete

Artifacts:
  Data:         state/brand/brand-system.yaml
  Visual guide: state/brand/brand-guide.html  ← OPEN THIS TO SEE YOUR BRAND
  [if --with-frame0]
  Frame0 file:  state/brand/brand-guide.f0
  PNG export:   state/brand/brand-guide.png  [or: pending manual export]

Colors defined: {count}
  Primary:   {hex} — {name}
  Secondary: {hex} — {name}
  Neutral:   {hex} — {name}
  Surface:   {hex} — {name}

Typography: {heading_font} / {body_font}
Personality: {statement}

Logo concepts: {N} SVG concepts generated and rendered in brand-guide.html

To view:
  open state/brand/brand-guide.html
or
  code state/brand/brand-guide.html

Next: Review the HTML guide and confirm direction. Run /hive:design-system to generate implementation tokens from this brand system.
```

## Key References

- `hive/references/html-preview-format.md` — HTML preview structure, sections, SVG logo format, styling conventions
- `hive/agents/ui-designer.md` — ui-designer persona (Frame0 CLI reference, tool discovery)
- `hive/references/ui-skill-gates.md` — gate spec (brand-system: no gate)
- `state/architecture/ui-team-skills-arch.md` — brand output format specification
