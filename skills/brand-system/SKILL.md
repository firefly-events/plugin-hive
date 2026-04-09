---
name: brand-system
description: Establish brand identity — colors, typography, spacing, and visual style guide. Produces state/brand/brand-system.yaml and a visual brand guide PNG via Frame0.
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

**Part 2: Visual brand style guide**

Run three-tier tool discovery before proceeding:

1. Check Frame0 CLI: `which cli-anything-frame-zero`
2. Check live mode: attempt `cli-anything-frame-zero --live status` (succeeds if Frame0 desktop app is running)

**Tier 1 — CLI available AND live mode active:**
- Create `state/brand/brand-guide.f0` using the Frame0 CLI
- Export PNG directly: `cli-anything-frame-zero --live export page --page PAGE_ID --format png --output state/brand/brand-guide.png`
- Both `.f0` and `.png` artifacts are produced

**Tier 2 — CLI available, NO live mode:**
- Create `state/brand/brand-guide.f0` using the Frame0 CLI
- Produce the export command for the user to run manually:
  ```
  cli-anything-frame-zero --live export page --page PAGE_ID --format png --output state/brand/brand-guide.png
  ```
- Note in output: "brand-guide.f0 created. Open Frame0 desktop app and run the export command above to generate brand-guide.png."

**Tier 3 — No Frame0 CLI:**
- Produce `state/brand/brand-system.yaml` only
- Note: "Visual brand guide skipped — Frame0 CLI not found. Install Frame0 or run `/hive:brand-system` in an environment where `cli-anything-frame-zero` is available."

**Brand guide layout specification (for Tiers 1 and 2):**

Use a single-page layout on a 1440×900 desktop frame. Section placement:

| Section | Position | Content |
|---------|----------|---------|
| **Logo variations** | top-left quadrant | Primary logo, secondary logo, submark, favicon. If no logo assets exist, use text placeholders in heading font: "{Brand Name} — Primary", "{Brand Name} — Mark", etc. |
| **Color palette** | top-right quadrant | One swatch per brand color (100×100px filled rect). Below each swatch: color name, HEX, RGB, CMYK, PMS values in small text |
| **Typography weight matrix** | middle band | Two columns (heading_font, body_font). Each weight shown as: weight name + "Aa" sample at 32px + sample sentence ("The quick brown fox...") + usage note |
| **Logo on backgrounds** | bottom-left quadrant | Primary logo text placed on a filled rect of each brand color. Confirms contrast and legibility |
| **Design elements** | bottom-right quadrant | Spacing scale: row of filled rects sized to scale values (4, 8, 12, 16, 24, 32, 48, 64px). Border radius samples: four rects with small/medium/large/full radius |
| **Brand personality** | bottom strip | Personality statement in display text (32px bold), tone adjectives below (16px medium) |

---

### 3. Report output

After the subagent completes, report:

```
Brand System Complete

Artifacts:
  Data:   state/brand/brand-system.yaml
  Guide:  state/brand/brand-guide.f0   [or: "not generated — Frame0 CLI unavailable"]
          state/brand/brand-guide.png  [or: "pending — run export command" | "not generated"]

Colors defined: {count}
  Primary:   {hex} — {name}
  Secondary: {hex} — {name}
  Neutral:   {hex} — {name}
  Surface:   {hex} — {name}

Typography: {heading_font} / {body_font}
Personality: {statement}

Next: Run /hive:design-system to generate implementation tokens from this brand system.
```

## Key References

- `hive/agents/ui-designer.md` — ui-designer persona (Frame0 CLI reference, tool discovery)
- `hive/references/ui-skill-gates.md` — gate spec (brand-system: no gate)
- `state/architecture/ui-team-skills-arch.md` — brand output format specification
