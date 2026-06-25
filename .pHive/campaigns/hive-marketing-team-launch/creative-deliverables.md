## Creative Deliverables: Hive Marketing Team Launch

> **Flayr template used:** `generateImage` (one 16:9 LinkedIn hero). No other templates.
> **Note:** `hive/references/flayr-prompt-templates.md` not found in repo at execution time. Prompt structure follows the `generateImage` schema described in the issue brief (PLU-439). `.pHive/brand/brand-system.yaml` also absent — brand tokens sourced from `hive/references/brand-system-schema.yaml` schema defaults. Tokens match brief spec; no conflict.

---

### Creative Concept

**"The Pipeline That Ships Marketing"**
Theme: Three autonomous agent cards, wired in sequence, doing the job a marketing hire would do — automatically, from a changelog.
Mood: Precise, dark, electric, minimal, technical-confident
Narrative arc: The viewer sees a dark workspace with three glowing cards in a left-to-right chain. Each card is an agent doing a real job. The flow arrow says: this runs. The viewer feels: "I didn't know Hive did this." They do: check the changelog.
Visual approach: Typographic / diagrammatic — no photography, no illustration, no stock

---

### Art Direction

- Color palette: Background near-black (`#1C1F26`), card faces `#2C2F36`, card borders and flow arrow `#3B5BDB` (primary blue), label text `#F8F9FA` (surface), secondary label text `#495057` (neutral)
- Typography direction: Inter Bold (700) for agent name labels; Inter Medium (500) for role descriptors below each name; Inter Regular (400) for any supporting micro-copy
- Composition rule: Three agent cards in horizontal row, centered vertically on a 16:9 canvas. Left card = `marketing-strategist`, center = `marketing-copywriter`, right = `ad-creative`. Thin `#3B5BDB` flow arrows connect card right-edge to card left-edge. Hive wordmark or logo mark anchored bottom-right, 32px clear space. No headline text on the image — the card labels carry the message.
- Imagery style: Flat UI card components on dark background, glowing border treatment (1px solid `#3B5BDB` with 8px `#3B5BDB` box-shadow blur at 30% opacity), no gradients except subtle vignette on background edges

---

### Asset Concepts & Image-Gen Prompts

**Hero — LinkedIn 16:9 (1920×1080px)**
Concept: Three glowing agent cards in a left-to-right workflow chain on a near-black background. Each card shows the agent name in Inter Bold white and a one-line role descriptor below in Inter Medium gray. Flow arrows in Hive blue connect them. Clean, typographic, no stock-photo feel.

Image-gen prompt (paste into Flayr `generateImage`):

```
generateImage:
  template: linkedin-hero-16x9
  dimensions: "1920x1080"
  style: flat-ui-diagram
  prompt: |
    Dark workspace UI diagram on a near-black background (#1C1F26). Three rounded-rectangle agent cards arranged in a horizontal row, centered on the canvas. Each card is dark (#2C2F36) with a 1px solid border and subtle outer glow in Hive primary blue (#3B5BDB, 8px blur, 30% opacity). Cards are connected left-to-right by thin single-line arrows in #3B5BDB with small arrowheads.

    Card 1 (leftmost):
    - Label (Inter Bold 700, white #F8F9FA, 20px): "marketing-strategist"
    - Sublabel (Inter Medium 500, #8A919E, 13px): "positioning · brief · pillars"

    Card 2 (center):
    - Label (Inter Bold 700, white #F8F9FA, 20px): "marketing-copywriter"
    - Sublabel (Inter Medium 500, #8A919E, 13px): "linkedin copy · hooks · CTA"

    Card 3 (rightmost):
    - Label (Inter Bold 700, white #F8F9FA, 20px): "ad-creative"
    - Sublabel (Inter Medium 500, #8A919E, 13px): "hero image · visual concept"

    Hive wordmark in Inter Bold 600, white (#F8F9FA), 16px, anchored bottom-right with 32px padding. Subtle dark radial vignette on background edges. No photography. No stock imagery. No decorative elements beyond the cards and arrows. Technical, minimal, precise.
  aspect_ratio: "16:9"
  platform: linkedin
  safe_zone: "5% all edges"
  focal_point: "horizontal center, vertical center"
  output_format: png
  brand_tokens:
    primary: "#3B5BDB"
    neutral: "#495057"
    surface: "#F8F9FA"
    font_family: "Inter"
```

Brand notes:
- Logo/wordmark: bottom-right, Inter Bold, 32px clear space minimum
- Safe zone: 5% all edges (96px horizontal, 54px vertical at 1920×1080)
- Required brand elements: Hive wordmark; `#3B5BDB` accent must appear on arrows and card borders
- No red (#F03E3E secondary) in this asset — reserved for alerts; wrong tone for launch

---

### Variant Concepts

**Variant B — "One Command" (motion-implied)**
Concept: Same dark canvas, same three cards, but a terminal-style `hive /ship --campaign` command appears at top-left as monospace code. An animated-style dashed line (static, implying motion) flows from the command down and right into the first agent card, then through the chain. Adds a "trigger" narrative: you type one thing, the pipeline runs.

Image-gen prompt (Variant B — paste into Flayr `generateImage`):

```
generateImage:
  template: linkedin-hero-16x9
  dimensions: "1920x1080"
  style: flat-ui-diagram
  prompt: |
    Dark workspace on near-black (#1C1F26). Top-left quadrant shows a terminal input block in monospace font (JetBrains Mono or similar), white text (#F8F9FA), reading: "hive /ship --campaign". Below and right of the terminal block, a dashed #3B5BDB line curves into the first of three agent cards arranged horizontally across the lower two-thirds of the canvas.

    Three rounded-rectangle cards (same style: dark #2C2F36 fill, #3B5BDB 1px border + subtle glow):
    Card 1: "marketing-strategist" / "positioning · brief · pillars"
    Card 2: "marketing-copywriter" / "linkedin copy · hooks · CTA"
    Card 3: "ad-creative" / "hero image · visual concept"

    Solid #3B5BDB flow arrows connect cards left-to-right. Hive wordmark bottom-right, Inter Bold 600, 16px, 32px clear space. No photography. Technical, minimal.
  aspect_ratio: "16:9"
  platform: linkedin
  safe_zone: "5% all edges"
  focal_point: "center"
  output_format: png
  brand_tokens:
    primary: "#3B5BDB"
    neutral: "#495057"
    surface: "#F8F9FA"
    font_family: "Inter"
```

Meaningful conceptual difference from primary: Variant A is "here is the team"; Variant B is "here is the trigger that starts the team." Variant A is stronger for awareness posts; Variant B is stronger if the copy leans into the `/ship --campaign` flag.

---

### Platform Notes

- **LinkedIn (16:9 hero):** Safe zone 5% all edges (96px H, 54px V at 1920×1080). LinkedIn compresses images — use flat colors, avoid fine gradients below 4px detail. Focal point center-canvas ensures the card trio survives mobile crop (LinkedIn mobile may letterbox to 4:3 in feed). Hive wordmark bottom-right is inside safe zone and survives crop.

---

### Creative Notes

- **Flayr template file missing:** `hive/references/flayr-prompt-templates.md` was not present in the repo. Prompt structure above uses the `generateImage` key/schema described in PLU-439. If Flayr uses a different top-level key or field names, the inner `prompt:` content is the authoritative input — it is self-contained and executable without the wrapper.
- **Brand token source:** `brand-system-schema.yaml` defaults used (no `.pHive/brand/brand-system.yaml` found). Tokens match the brief exactly; no deviation.
- **No copy on the hero:** Deliberately. LinkedIn compresses text in images; card labels are large enough to render cleanly. Marketing-copywriter (b2) owns all caption copy — this asset is visual-only.
- **Recommendation to marketing-copywriter (b2):** If Variant B is selected, the caption should open with the `/ship --campaign` flag as the hook — the image and caption will reinforce each other. If Variant A is selected, open with the "marketing team" concept; the caption should name the three agents explicitly since the image shows them.
