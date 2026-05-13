## Required placeholders

_None._

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
