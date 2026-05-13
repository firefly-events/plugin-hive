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

Read and cite `hive/references/ui-prompts/design-system.md` as the canonical ui-designer task prompt.

Inject the following placeholder values before passing to the subagent: none.

Spawn a subagent with the full ui-designer persona (`hive/agents/ui-designer.md`) and the rendered prompt body.

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
