# Canonical W3C Design Token Spec

Canonical W3C Design Token spec. Consumed by /design-system to convert .pHive/brand/brand-system.yaml into W3C-format JSON tokens.

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
