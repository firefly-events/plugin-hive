# H-02 — Brand-source rewrite delta summary

Worktree: `/Users/don/Documents/plugin-hive/.pHive/brand/` (gitignored — local-only state)
Tracked summary path: `/Users/don/Documents/plugin-hive-ui-f/.pHive/epics/brand-system-2.0-update/docs/h-02-brand-diff-summary.md`
Date: 2026-05-12
Locked decisions source: `.pHive/epics/brand-system-2.0-update/docs/user-decisions-b1.md`

## Files touched (8)

| File | Anchors changed | Notes |
|---|---|---|
| `vision.md` | lines 9, 11, 27, 30-31, 63 (annotated as superseded), 65-71 (added option 8 + rewrote "Why this vision wins") | 102 → ~107 lines net |
| `brand-system.yaml` | lines 15 (positioning), 37 (usage), 153 (statement), 168 (house language) | 212 lines, no length change |
| `brand-guide.html` | lines 662 (positioning), 702 (usage), 833/841/849/857/1384 (typography samples), 879/882/885 (body copy), 1403 (sub-statement), 1414 (house language list) | 1,468 lines, no length change |
| `value-prop.md` | lines 5, 7 (positioning header), 19 (segment 1 JTBD), 34 (slash-commands bullet), 98 (marketing statement), 107 (onboarding statement) | 133 lines, no length change |
| `launch-blog.md` | line 67 (trajectory paragraph) | reframe-aligned trajectory section |
| `flayr-campaign-brief.md` | lines 37 (house language), 181 (LinkedIn surface draft), 274 (1200×675 card brief) | 3 substantive edits |
| `oss-rollout-playbook.md` | lines 93 (trajectory section), 167 (tweet 6 trajectory) | 2 edits |
| `tokens-preview.html` | lines 385 (color usage), 475/480/485/490/495/500/505+ (typography samples) | scoped replace via 4 replace_all calls |

## Anchor-by-anchor before/after

### vision.md
- **Line 9 (hero positioning):**
  - Before: `> **A director's chair for the agentic SDLC — disciplined swarms, kickoff to ship.**`
  - After: `> **Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship.**`
- **Line 11 (positioning bridge):**
  - Before: `...the director's chair is the role Hive gives builders *today*, on the way there.`
  - After: `...the composable substrate is what Hive provides *today*, with the builder doing the directing.`
- **Line 27 + 30-31 (current-stance/destination block):** rewritten to position the composable substrate as Hive's current stance. The "director-grade surface shipped" claim becomes "composable-substrate surface shipped (atoms, ceremonies, ABI, sandbox primitives)". The "emotionally legible" point becomes "user-directed substrate is a posture any builder can step into without surrendering authorship".
- **Line 63 (historical option 7):** annotated `Selected 2026-04-29, superseded 2026-05-12 (audit §5.5 reframe)`. Original text preserved as rejection-history record per the same pattern used for options 1-6.
- **Line 65-71 (new option 8 + Why this vision wins rewrite):** added option 8 documenting the locked Q1 wording with selection rationale; rewrote the five bullets in "Why this vision wins" to use the substrate-and-user-direction framing throughout.

### brand-system.yaml
- **Line 15 (`positioning:`):**
  - Before: `"A director's chair for the agentic SDLC — disciplined swarms, kickoff to ship."`
  - After: `"Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship."`
- **Line 37 (`usage:` for Night Jar):**
  - Before: `"Primary brand identity — headings, primary buttons, key UI surfaces. The director's chair. Inherited from Firefly."`
  - After: `"Primary brand identity — headings, primary buttons, key UI surfaces. Composable substrate accent. Inherited from Firefly."`
- **Line 153 (personality `statement:`):**
  - Before: `"Disciplined swarms. Director's chair. Built in production, shared in public."`
  - After: `"Composable substrate. User-directed. Built in production, shared in public."`
- **Line 168 (voice_guideline `do:` house-language bullet):**
  - Before: `"Use 'director's chair' / 'swarm' / 'kickoff to ship' as house language. Reuse, don't paraphrase."`
  - After: `"Use 'composable substrate' / 'user-directed' / 'kickoff to ship' as house language. Reuse, don't paraphrase. 'Disciplined' survives per audit §5.5 co-equal-differentiator decision."`

### brand-guide.html
- **Line 662 (`<p class="positioning">`):**
  - Before: `A director's chair for the agentic SDLC — disciplined swarms, kickoff to ship.`
  - After: `Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship.`
- **Line 702 (`<p class="usage">`):**
  - Before: `Primary brand identity — headings, primary buttons, key UI surfaces. The director's chair.`
  - After: `Primary brand identity — headings, primary buttons, key UI surfaces. Composable substrate accent.`
- **Lines 833, 841, 849, 857, 1384 (typography sample text):**
  - Before: `Disciplined swarms, kickoff to ship.`
  - After: `User-directed, disciplined, kickoff to ship.`
- **Lines 879, 882, 885 (typography body/UI label/caption samples):**
  - Before: `Body — every builder a director.` / `UI label — every builder a director.` / `Caption — every builder a director.`
  - After: `Body — Builders direct work; Hive composes primitives.` / `UI label — Builders direct work; Hive composes primitives.` / `Caption — Builders direct work; Hive composes primitives.`
- **Line 1403 (sub-statement quote):**
  - Before: `"Disciplined swarms. Director's chair. Built in production, shared in public."`
  - After: `"Composable substrate. User-directed. Built in production, shared in public."`
- **Line 1414 (house language list item):**
  - Before: `Reuse house language: <em>director's chair</em>, <em>swarm</em>, <em>kickoff to ship</em>.`
  - After: `Reuse house language: <em>composable substrate</em>, <em>user-directed</em>, <em>kickoff to ship</em>. <em>Disciplined</em> survives per audit §5.5.`

### value-prop.md
- **Lines 5, 7 (positioning header + framing bridge):** updated to "Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship." and "User-directed today, lights-on tomorrow."
- **Line 19 (segment 1 JTBD):** "stay in the director's chair, not in the weeds" → "direct the work, not be in the weeds writing every prompt".
- **Line 34 (slash-commands bullet):** "so the human stays in the director's chair" → "so the human keeps direction".
- **Line 98 (marketing statement):** "Hive — a director's chair for the agentic SDLC." → "Hive — composable substrate for the agentic SDLC."
- **Line 107 (onboarding statement):** "You're in the director's chair — Hive does the rest." → "You direct the work; Hive composes the primitives."

### launch-blog.md
- **Line 67 (trajectory paragraph):** "the director's chair — the role of calling the shots, running ceremonies, steering the swarm at gates. The lights-on factory is where we're going. The director's chair is what Hive gives builders right now" → "the composable substrate — ceremonies, gates, agents, memory, ABI, sandbox primitives you assemble and direct. The lights-on factory is where we're going. The composable substrate is what Hive provides right now, with the builder doing the directing".

### flayr-campaign-brief.md
- **Line 37 (DO house-language bullet):** "Use 'director's chair', 'swarm', 'kickoff to ship'" → "Use 'composable substrate', 'user-directed', 'kickoff to ship' ... 'Disciplined' survives per audit §5.5."
- **Line 181 (LinkedIn surface draft):** "For builders who want to stay in the director's chair." → "For builders who want to direct the work, not write every prompt."
- **Line 274 (1200×675 card composition brief):** "A director's chair for the agentic SDLC." → "Composable substrate for the agentic SDLC."

### oss-rollout-playbook.md
- **Line 93 (launch-blog section trajectory):** "director's chair today, lights-on factory tomorrow" → "composable substrate today (user-directed), lights-on factory tomorrow".
- **Line 167 (tweet 6 trajectory):** "Director's chair today. Lights-on factory tomorrow. We're not there yet." → "Composable substrate today. Lights-on factory tomorrow. You direct; we compose. We're not there yet."

### tokens-preview.html
- **Line 385 (color usage for Night Jar):** "The director's chair." → "Composable substrate accent."
- **Lines 475/480 (type-scale sample text):** "Disciplined swarms. Director's chair. Built in production, shared in public." → "Composable substrate. User-directed. Built in production, shared in public."
- **Lines 485/490 (shorter type samples):** "Disciplined swarms. Director's chair." → "Composable substrate. User-directed."
- **Lines 495/500 (shortest type samples):** "Disciplined swarms." → "Composable substrate."
- **Line 505+ (40px+ type samples):** "Director's chair." → "User-directed."

## Final wider grep result (post-edit)

Command run from `/Users/don/Documents/plugin-hive/.pHive/brand/`:

```bash
grep -irnE "director's chair|disciplined swarm|directs swarms|every builder a director" \
  --include='*.md' --include='*.yaml' --include='*.html' --include='*.json'
```

Returns 3 hits — all in `vision.md` historical "vision options considered" list (lines 61, 62, 63):
- Line 61: option 5 (rejected) — uses "disciplined swarm" inside the rejection rationale; intentional history.
- Line 62: option 6 (considered + bypassed) — uses "disciplined swarm" describing the beekeeper-metaphor frame; intentional history.
- Line 63: option 7 (selected → superseded) — explicit "superseded 2026-05-12 (audit §5.5 reframe)" annotation; intentional history.

**All three are intentional retentions** — they document the option-set considered + rejected during vision drafting. They are rejection-history records, not active brand positioning. The active brand positioning lives in the new option 8 (line 65), in the rewritten paragraph above the table (line 11), and in the rewritten "Why this vision wins" section (lines 67-71).

## Intentional retentions (summary)

| File | Lines | Reason |
|---|---|---|
| `vision.md` | 61 | Rejected option 5 — "disciplined swarm of AI specialists shipping software end-to-end" — historical rejection record |
| `vision.md` | 62 | Considered option 6 — beekeeper metaphor, also references "disciplined swarm" — historical record |
| `vision.md` | 63 | Selected option 7 — original "director's chair" wording — annotated as superseded 2026-05-12 |
| `vision.md` | 24 (table row) | "Director" as the builder's role label in the user-trajectory table — fine under the reframe (the user IS the director; Hive composes the substrate they direct) |

## Asset re-exports — DEFERRED

Asset regeneration (PNG/SVG that bake positioning copy: 1200×675 Twitter, 1200×627 LinkedIn, 1200×1200 cards per `oss-rollout-playbook.md` image-gen briefs) is **deferred to a separate follow-on** per the H-02 risk-mitigation language. Reason:

- Local export tooling not detected during the brand-source edit pass. No `frame0` or `design-system` CLI on PATH; no export script in `/Users/don/Documents/plugin-hive/.pHive/brand/`.
- The image-gen briefs in `oss-rollout-playbook.md` reference an external image-gen pipeline (likely Frame0 + Firefly's parent-brand tooling) rather than a one-shot npm-installable command.

Tracking: opening this as a follow-on item rather than a blocker. The text-source rewrite is complete; assets remain on the prior wording until the export pipeline is invoked. Recommend doing this as part of the next visual-fidelity pass (or rolling it into the OSS-rollout launch-day asset bake).

## Invariants preserved (verified)

- Brand name: **Hive** — unchanged
- Logo: Concept 4 hex with adjacent cells + Concept 5 firefly-in-hex co-brand — unchanged
- Color palette: Firefly inheritance + Hive White — unchanged
- Typography: Montserrat + JetBrains Mono — unchanged
- Voice cadence: builder-to-builder, postmortem-cadenced, generous credit, no launch-hype — unchanged (the `voice_guideline:` section in `brand-system.yaml` was not touched apart from the single house-language bullet update; "personality.tone" + all `voice_principles` + `dont:` block left intact)
- Inspirations credit (IndyDevDan, QRISPY, BMAD, archon, Karpathy) — unchanged
- Flayr dogfood narrative — unchanged in `oss-rollout-playbook.md` body sections (only trajectory + tweet 6 touched)
- Audit §5.5 retention: "disciplined" survives in the new tagline + house-language guidance as the co-equal differentiator alongside composability
