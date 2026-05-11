---
name: design-system
description: Convert brand-system YAML into W3C Design Token JSON plus a visual HTML preview of the tokens in use. Gates on .pHive/brand/brand-system.yaml.
---

# Hive Design System

Convert a brand system into implementation-ready W3C Design Token JSON.

**Input:** `$ARGUMENTS` optionally contains additional token categories to generate beyond the defaults.

## Before Executing Any Skill

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

## Gate Check

Check `.pHive/brand/brand-system.yaml`:

1. Verify the file exists

If the check fails, display this message and **stop**:

> No brand system found. Run `/hive:brand-system` first to establish colors, typography, and spacing before generating design tokens.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Process

### 1. Read brand system

Read `.pHive/brand/brand-system.yaml` in full.

### 2. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full.

### 3. Spawn ui-designer for token generation

Spawn a subagent with the full ui-designer persona and this task:

```
Read .pHive/brand/brand-system.yaml.

Convert it to W3C Design Token format JSON and write to .pHive/brand/tokens.json.

See hive/references/design-token-spec.md for the canonical W3C Design Token spec. Produce W3C-format JSON tokens at .pHive/brand/tokens.json conforming to that spec.

After writing tokens.json, produce a visual HTML preview at .pHive/brand/tokens-preview.html showing the tokens IN USE (not as raw JSON):

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
  Source:   .pHive/brand/brand-system.yaml
  Tokens:   .pHive/brand/tokens.json
  Preview:  .pHive/brand/tokens-preview.html  ← OPEN THIS TO SEE TOKENS IN USE

Token categories generated:
  color         — {count} tokens
  typography    — {count} tokens
  spacing       — {count} tokens
  border-radius — {count} tokens

Compatible with: Tailwind CSS, Style Dictionary, Figma Token plugin, W3C Design Token importers.

To view:
  open .pHive/brand/tokens-preview.html

Next: Tokens are ready for frontend-developer to apply via Tailwind config or CSS custom properties.
```

## Key References

- `hive/references/html-preview-format.md` — HTML preview format for tokens-preview.html
- `hive/agents/ui-designer.md` — agent persona for token generation
- `hive/references/ui-skill-gates.md` — gate specification for design-system
- `.pHive/architecture/ui-team-skills-arch.md` — W3C token format specification
