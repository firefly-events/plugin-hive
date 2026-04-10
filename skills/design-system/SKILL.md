---
name: design-system
description: Convert brand-system YAML into W3C Design Token JSON plus a visual HTML preview of the tokens in use. Gates on state/brand/brand-system.yaml.
---

# Hive Design System

Convert a brand system into implementation-ready W3C Design Token JSON.

**Input:** `$ARGUMENTS` optionally contains additional token categories to generate beyond the defaults.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Gate Check

Check `state/brand/brand-system.yaml`:

1. Verify the file exists

If the check fails, display this message and **stop**:

> No brand system found. Run `/hive:brand-system` first to establish colors, typography, and spacing before generating design tokens.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Process

### 1. Read brand system

Read `state/brand/brand-system.yaml` in full.

### 2. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full.

### 3. Spawn ui-designer for token generation

Spawn a subagent with the full ui-designer persona and this task:

```
Read state/brand/brand-system.yaml.

Convert it to W3C Design Token format JSON and write to state/brand/tokens.json.

Use this structure (extend with all colors, all spacing values, all type scale entries):

{
  "color": {
    "primary": { "value": "{brand-system colors.primary.hex}", "type": "color" },
    "secondary": { "value": "{brand-system colors.secondary.hex}", "type": "color" },
    "neutral": { "value": "{brand-system colors.neutral.hex}", "type": "color" },
    "surface": { "value": "{brand-system colors.surface.hex}", "type": "color" }
  },
  "typography": {
    "font-heading": { "value": "{brand-system typography.heading_font}", "type": "fontFamily" },
    "font-body": { "value": "{brand-system typography.body_font}", "type": "fontFamily" },
    "scale-xs": { "value": "{scale[0]}px", "type": "dimension" },
    "scale-sm": { "value": "{scale[1]}px", "type": "dimension" },
    "scale-base": { "value": "{scale[2]}px", "type": "dimension" },
    "scale-lg": { "value": "{scale[3]}px", "type": "dimension" },
    "scale-xl": { "value": "{scale[4]}px", "type": "dimension" },
    "scale-2xl": { "value": "{scale[5]}px", "type": "dimension" },
    "scale-3xl": { "value": "{scale[6]}px", "type": "dimension" }
  },
  "spacing": {
    "1": { "value": "{spacing.scale[0]}px", "type": "dimension" },
    "2": { "value": "{spacing.scale[1]}px", "type": "dimension" },
    "3": { "value": "{spacing.scale[2]}px", "type": "dimension" },
    "4": { "value": "{spacing.scale[3]}px", "type": "dimension" },
    "6": { "value": "{spacing.scale[4]}px", "type": "dimension" },
    "8": { "value": "{spacing.scale[5]}px", "type": "dimension" },
    "12": { "value": "{spacing.scale[6]}px", "type": "dimension" },
    "16": { "value": "{spacing.scale[7]}px", "type": "dimension" }
  },
  "border-radius": {
    "small": { "value": "{radius.small}px", "type": "dimension" },
    "medium": { "value": "{radius.medium}px", "type": "dimension" },
    "large": { "value": "{radius.large}px", "type": "dimension" },
    "full": { "value": "{radius.full}px", "type": "dimension" }
  }
}

Rules:
- Use the actual values from brand-system.yaml (do not use placeholders in the output file)
- Valid JSON only — no comments, no trailing commas
- Use W3C Design Token spec: each token has "value" and "type" fields
- All dimension values must include "px" unit
- Include every entry from the brand system — do not omit any color or spacing step

After writing tokens.json, produce a visual HTML preview at state/brand/tokens-preview.html showing the tokens IN USE (not as raw JSON):

- Color tokens: swatches with token name + hex value + usage context
- Typography tokens: type scale demonstration rendering each scale-* token at its size
- Spacing tokens: visual row of boxes sized to each spacing value
- Border radius tokens: rounded corner demonstration
- Raw tokens.json embedded at the bottom in a collapsible <details> block for developers to copy

Read hive/references/html-preview-format.md for the HTML structure requirements, styling guidelines, and self-contained file rules (Google Fonts CDN, no external stylesheets, no JavaScript dependencies).
```

### 4. Report output

```
Design System Complete

Artifacts:
  Source:   state/brand/brand-system.yaml
  Tokens:   state/brand/tokens.json
  Preview:  state/brand/tokens-preview.html  ← OPEN THIS TO SEE TOKENS IN USE

Token categories generated:
  color         — {count} tokens
  typography    — {count} tokens
  spacing       — {count} tokens
  border-radius — {count} tokens

Compatible with: Tailwind CSS, Style Dictionary, Figma Token plugin, W3C Design Token importers.

To view:
  open state/brand/tokens-preview.html

Next: Tokens are ready for frontend-developer to apply via Tailwind config or CSS custom properties.
```

## Key References

- `hive/references/html-preview-format.md` — HTML preview format for tokens-preview.html
- `hive/agents/ui-designer.md` — agent persona for token generation
- `hive/references/ui-skill-gates.md` — gate specification for design-system
- `state/architecture/ui-team-skills-arch.md` — W3C token format specification
