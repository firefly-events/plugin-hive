# HTML Preview Format for Brand & Design Artifacts

Shared reference for generating self-contained HTML previews of brand systems, design tokens, and logo concepts. Used by `brand-system`, `design-system`, and any future UI skill that needs to show visual output to the user.

---

## Why HTML

The user needs to **see** colors, fonts, and logos — not read about them in terminal text. HTML is:

- **Always available** — no external tools required, writes directly to disk
- **Portable** — renders in any browser, VSCode preview, or HTML viewer
- **Fast** — generates in seconds, no wireframing tool roundtrip
- **Interactive** — can include hover states, copy-to-clipboard, and swatch selection
- **Correct** — displays colors and fonts exactly as they'll render in production

HTML previews are **primary output** for visual artifacts. Frame0 wireframes are optional higher-fidelity alternatives, not replacements.

---

## File Conventions

| Artifact | HTML preview path |
|----------|-------------------|
| Brand system | `.pHive/brand/brand-guide.html` |
| Design tokens | `.pHive/brand/tokens-preview.html` |
| Logo concepts | `.pHive/brand/logo-concepts.html` |
| UI audit report | `.pHive/audits/ui-audit/{ts}/report.html` (optional) |

All HTML files must be **self-contained** — no external stylesheets, no JavaScript dependencies. Fonts load from Google Fonts CDN via `<link>` tags.

---

## HTML Structure Requirements

Every preview HTML file must have:

1. **Valid HTML5 doctype and structure** — `<!DOCTYPE html>`, `<html lang="en">`, `<head>`, `<body>`
2. **Meta viewport** — `<meta name="viewport" content="width=device-width, initial-scale=1">`
3. **Embedded CSS in `<style>` block** — no external stylesheets
4. **Google Fonts link** — for any brand typography that's available on Google Fonts
5. **Semantic HTML** — use `<section>`, `<header>`, `<h1>`–`<h3>`, `<article>` appropriately
6. **No JavaScript** — unless explicitly enabling copy-to-clipboard; keep it optional

---

## Brand Guide HTML Template

The brand guide preview has six sections matching the brand-system.yaml structure:

### Section 1: Brand Header

```html
<header class="brand-header">
  <h1 style="font-family: {heading_font}; font-weight: 700;">{Brand Name}</h1>
  <p class="personality-statement" style="font-family: {body_font};">
    {personality.statement}
  </p>
  <p class="tone">{personality.tone}</p>
</header>
```

### Section 2: Color Palette

One card per color. Each card is a large swatch (filled background in the color) with the text information below on a neutral background. Include a small "copy hex" button if practical.

```html
<section class="colors">
  <h2>Colors</h2>
  <div class="color-grid">
    <article class="color-card">
      <div class="swatch" style="background: {hex};"></div>
      <div class="color-info">
        <h3>{name}</h3>
        <dl>
          <dt>HEX</dt><dd><code>{hex}</code></dd>
          <dt>RGB</dt><dd><code>{rgb}</code></dd>
          <dt>CMYK</dt><dd><code>{cmyk}</code></dd>
          <dt>PMS</dt><dd><code>{pms}</code></dd>
        </dl>
        <p class="usage">{usage}</p>
      </div>
    </article>
    <!-- repeat for each color -->
  </div>
</section>
```

**Swatch sizing:** minimum 200×120px so the color is clearly visible.

**Accessibility note:** every color card should show a contrast indicator — is it AA-compliant against white and black? Compute the contrast ratio and display it.

### Section 3: Typography

Two columns (heading font + body font). Each column shows:

- Font name at 48px
- Each weight with "Aa" sample at 64px + weight name + usage note
- Sample sentence at body size
- Full type scale (all sizes from the brand-system scale array) using the font

```html
<section class="typography">
  <h2>Typography</h2>
  <div class="type-grid">
    <article class="type-column">
      <h3 style="font-family: '{heading_font}';">{heading_font}</h3>
      <p class="font-role">Display / Headings</p>
      <div class="weight-sample" style="font-family: '{heading_font}'; font-weight: 400;">
        <span class="big-aa">Aa</span>
        <span class="weight-label">Regular 400</span>
        <p class="sample">The quick brown fox jumps over the lazy dog</p>
      </div>
      <!-- repeat for each weight -->
      <div class="scale-samples">
        <!-- each scale value rendered with that font-size -->
        <p style="font-size: 40px;">Scale 40</p>
        <p style="font-size: 32px;">Scale 32</p>
        <!-- ... -->
      </div>
    </article>
    <!-- body_font column -->
  </div>
</section>
```

**Google Fonts link construction:** build a single `<link>` request with both fonts and all needed weights:

```html
<link href="https://fonts.googleapis.com/css2?family={heading_font}:wght@400;500;600;700&family={body_font}:wght@400;500;600;700&display=swap" rel="stylesheet">
```

URL-encode spaces as `+` in font names (e.g., "Playfair Display" → `Playfair+Display`).

**If the font is not on Google Fonts:** fall back to a close system font stack and add a note in the card that the font requires manual installation.

### Section 4: Logo Concepts (SVG)

Logos are rendered as **inline SVG** so they display without external files. Present multiple concepts side-by-side so the user can compare.

```html
<section class="logos">
  <h2>Logo Concepts</h2>
  <div class="logo-grid">
    <article class="logo-card">
      <h3>Concept 1: {name}</h3>
      <div class="logo-display" style="background: {background color};">
        <svg viewBox="0 0 240 80" width="240" height="80">
          <!-- SVG paths, text, shapes for this logo concept -->
        </svg>
      </div>
      <p class="concept-description">{one-line description of the concept}</p>
    </article>
    <!-- repeat for each concept, 3-5 concepts is ideal -->
  </div>
  <h3>Background Variants</h3>
  <div class="logo-bg-grid">
    <!-- For the selected/primary concept, show it on each brand color background -->
  </div>
</section>
```

**For text-based lettermark logos:** use SVG `<text>` elements with the brand typography:

```html
<svg viewBox="0 0 240 80" width="240" height="80">
  <text x="120" y="56" text-anchor="middle"
        font-family="{heading_font}" font-weight="700" font-size="56"
        fill="{primary color}">
    {Brand Name}
  </text>
</svg>
```

**For logos with a mark:** combine `<g>`, `<path>`, `<circle>`, or `<rect>` elements with the text. Keep the SVG viewBox consistent (suggested: `0 0 240 80` for horizontal, `0 0 120 120` for square).

**Generate 3-5 logo concepts minimum.** Vary the approach: pure wordmark, wordmark + symbol, monogram/lettermark, abstract mark + text, badge/enclosed. This gives the user real options to react to.

### Section 5: Spacing & Radius Scales

```html
<section class="spacing">
  <h2>Spacing Scale</h2>
  <div class="spacing-row">
    <!-- For each value in spacing.scale, render a filled rect sized to that value -->
    <div class="spacing-sample">
      <div class="box" style="width: {value}px; height: {value}px; background: {primary};"></div>
      <span class="label">{value}px</span>
    </div>
    <!-- ... -->
  </div>

  <h2>Border Radius</h2>
  <div class="radius-row">
    <div class="radius-sample">
      <div class="box" style="border-radius: {small}px;">small</div>
    </div>
    <!-- medium, large, full -->
  </div>
</section>
```

### Section 6: Brand in Context

Show 2-3 mini UI mockups that use the brand — a button, a card, a small hero section — so the user sees the brand working together. This is critical: colors and fonts look different in isolation vs. composition.

```html
<section class="context">
  <h2>Brand in Context</h2>

  <!-- Button examples -->
  <div class="example-buttons">
    <button style="background: {primary}; color: white; padding: 12px 24px;
                   font-family: '{body_font}'; font-weight: 600; border: none;
                   border-radius: {radius.medium}px;">
      Primary Action
    </button>
    <button style="background: transparent; color: {primary}; padding: 12px 24px;
                   font-family: '{body_font}'; font-weight: 600;
                   border: 2px solid {primary}; border-radius: {radius.medium}px;">
      Secondary
    </button>
  </div>

  <!-- Card example -->
  <div class="example-card" style="background: {surface}; padding: 24px;
                                    border-radius: {radius.large}px; max-width: 400px;">
    <h3 style="font-family: '{heading_font}'; color: {neutral};">Card Title</h3>
    <p style="font-family: '{body_font}'; color: {neutral};">
      Example card content demonstrating how the brand applies to common UI patterns.
    </p>
    <button style="background: {primary}; color: white; ...">Action</button>
  </div>
</section>
```

---

## Styling Guidelines

The preview HTML's own styling (not the brand content itself) should be minimal and clean — dark text on light background, generous whitespace, sans-serif system fonts for the preview chrome so brand typography stands out.

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
  margin: 0;
  padding: 40px;
}

section {
  background: white;
  padding: 32px;
  margin-bottom: 24px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

h2 {
  margin: 0 0 24px 0;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #666;
}

code {
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 12px;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}

.color-grid, .type-grid, .logo-grid {
  display: grid;
  gap: 24px;
}

.color-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.type-grid { grid-template-columns: 1fr 1fr; }
.logo-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
```

---

## Design Tokens HTML Preview

For `design-system` skill output, the HTML preview shows the tokens **in use** rather than as raw data:

- Color tokens → swatches matching the brand guide (simpler layout, just token name + swatch + hex)
- Typography tokens → type scale demonstration (render each `scale-*` token at its size)
- Spacing tokens → visual spacing demonstration (row of boxes)
- Border radius tokens → rounded corner demonstration

Include the raw `tokens.json` at the bottom in a collapsible `<details>` element so developers can copy it. Do NOT dump raw JSON in the main viewing area — the point is visual validation.

---

## Usage Instructions in Report Output

When a skill generates an HTML preview, the report output must include:

```
Visual Preview:
  .pHive/brand/brand-guide.html

  Open in your browser:
    open .pHive/brand/brand-guide.html
  Or preview in VSCode:
    code .pHive/brand/brand-guide.html
```

Do not ask the user to open the file — show them the command they can run.

---

## Do Not

- Do NOT rely on JavaScript frameworks (React, Vue, etc.) — preview HTML must be static
- Do NOT use external CSS files or JS libraries — everything inline except Google Fonts
- Do NOT embed huge base64 images — use SVG for graphics
- Do NOT omit the `<meta charset="utf-8">` tag — colors with special characters (PMS names) will break
- Do NOT skip the contrast indicators on color cards — accessibility is non-negotiable
- Do NOT dump tokens.json or brand-system.yaml into a `<pre>` block as the primary content — the point is visual preview, not data dump
