---
name: brand-system
description: Establish brand identity — colors, typography, spacing, logos, and a visual HTML brand guide. Produces .pHive/brand/brand-system.yaml and .pHive/brand/brand-guide.html for immediate visual review.
---

# Hive Brand System

Establish a complete brand identity for the project.

**Input:** `$ARGUMENTS` optionally contains brand direction hints (industry, tone, color preferences, existing logo paths).

## Before Executing Any Skill

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

## Gate Check

**No gate.** brand-system is always runnable — it is the first step in the brand chain.

## Process

### 1. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full. This is the agent you will spawn. The persona includes Frame0 CLI reference, tool discovery protocol, and output format.

### 2. Spawn ui-designer for brand creation

Read and cite `hive/references/ui-prompts/brand-system.md` as the canonical ui-designer task prompt.

Inject the following placeholder values before passing to the subagent: none.

Spawn a subagent with the full ui-designer persona (`hive/agents/ui-designer.md`) and the rendered prompt body.

### 3. Report output

After the subagent completes, report:

```
Brand System Complete

Artifacts:
  Data:         .pHive/brand/brand-system.yaml
  Visual guide: .pHive/brand/brand-guide.html  ← OPEN THIS TO SEE YOUR BRAND
  [if --with-frame0]
  Frame0 file:  .pHive/brand/brand-guide.f0
  PNG export:   .pHive/brand/brand-guide.png  [or: pending manual export]

Colors defined: {count}
  Primary:   {hex} — {name}
  Secondary: {hex} — {name}
  Neutral:   {hex} — {name}
  Surface:   {hex} — {name}

Typography: {heading_font} / {body_font}
Personality: {statement}

Logo concepts: {N} SVG concepts generated and rendered in brand-guide.html

To view:
  open .pHive/brand/brand-guide.html
or
  code .pHive/brand/brand-guide.html

Next: Review the HTML guide and confirm direction. Run /hive:design-system to generate implementation tokens from this brand system.
```

## Key References

- `hive/references/html-preview-format.md` — HTML preview structure, sections, SVG logo format, styling conventions
- `hive/agents/ui-designer.md` — ui-designer persona (Frame0 CLI reference, tool discovery)
- `hive/references/ui-skill-gates.md` — gate spec (brand-system: no gate)
- `.pHive/architecture/ui-team-skills-arch.md` — brand output format specification
