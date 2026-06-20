---
name: marketing-campaign
description: Entry skill for the marketing team ceremony — changelog-driven launch campaign production. marketing-strategist derives a campaign brief from what shipped; marketing-copywriter and ad-creative produce copy and creative concepts. Output lands in .pHive/campaigns/<topic>/. Ends at a user-review gate. Delegates visual rendering to the shared visual-asset skill (b7). Callable standalone or invoked by /ship's post-release hook.
---

# Hive Marketing Campaign

Top-level entry skill for the marketing team. Produces a launch/announcement campaign from a changelog or freeform brief: the marketing-strategist derives positioning and a campaign brief from what just shipped, then marketing-copywriter and ad-creative produce copy and creative concepts from that brief. Output is a handoff package in `.pHive/campaigns/<topic>/` presented to the user for review.

**Primary use: post-release work.** This skill is changelog-driven — it reads what shipped and builds the campaign around it. It is NOT a pre-release planning tool.

**Input:** `$ARGUMENTS` is one of:

- `--from-ship <changelog-path>` — PRIMARY mode. Invoked by `/ship`'s post-release hook (b4) on consumer projects. The changelog entry is the strategist's source material.
- `<brief>` — Standalone/manual mode. A freeform brief or a changelog path provided directly by the user. Same ceremony runs.

Optional flags:

- `--topic <slug>` — explicit topic slug for the output directory (default: derived from the campaign subject)
- `--render-assets` — when set, invoke the visual-asset skill (b7) to render raster assets from the ad-creative's image-gen prompts after the creative pass. Default OFF: creative deliverables contain prompts only.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

**Kickoff gate override — standalone-usable.** `/marketing-campaign` is callable for ad-hoc post-ship campaigns and manual launches outside `/ship`. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults — write artifacts under `.pHive/campaigns/<topic>/`, create directories as needed. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

When invoked from `/ship` (via post-release hook), the ship preamble has already run; skip the warning and proceed.

**Consumer projects only.** This skill and the agents it dispatches are scoped to consumer-facing products. If the project profile indicates Hive's own internal development work, stop and tell the operator:

```text
/marketing-campaign: This skill is for consumer projects only. The current project appears to be a Hive-internal epic. If this is a mistake, check project-profile.yaml.
```

## Gate Check

No blocking gate beyond the consumer-scope check. Brand context (`.pHive/brand/brand-system.yaml`) is **preferred** but not required — if absent, the marketing-strategist applies general positioning heuristics and notes the gap in the brief.

## Process

### Phase 0 — Parse arguments and resolve topic slug

Parse `$ARGUMENTS`:

- **Mode detection:**
  - If the first token is `--from-ship`, the next token is the `changelog_path`. Set `source = "changelog"`.
  - Otherwise the full argument string is the `brief`. If the argument looks like a file path and the file exists and is a changelog/markdown file, treat it as `source = "changelog"` and `changelog_path = $ARGUMENTS`. Otherwise treat it as `source = "brief"` and `brief_text = $ARGUMENTS`.

- **Topic slug:** If `--topic <slug>` is present, use it verbatim. Otherwise:
  - For `source = "changelog"`: read the first heading or the product/feature name from the changelog entry and derive a kebab-case slug (e.g., `v2-12-launch`, `event-discovery-update`).
  - For `source = "brief"`: derive a kebab-case slug from the first ~3 meaningful words in the brief.

- **Output directory:** `.pHive/campaigns/<topic>/`. Create it (and parents) before writing artifacts.

- **Render assets flag:** `--render-assets` present → `render_assets = true`. Default `false`.

### Phase 1 — Marketing-strategist campaign brief

Read `hive/agents/marketing-strategist.md` in full. Spawn the marketing-strategist subagent with:

- The full persona
- **For `source = "changelog"`:** the full text of the changelog entry at `changelog_path`, framed as: "This is the release changelog. Derive a launch campaign from it — what shipped → why it matters → target audience → channels → message pillars."
- **For `source = "brief"`:** the freeform `brief_text`, framed as: "This is the campaign brief. Produce a campaign brief that defines positioning, audience segments, message pillars, channel mix, and handoffs for copy and creative."
- Brand context from `.pHive/brand/brand-system.yaml` if present, or a one-line note that it is absent.
- Output instruction: write the campaign brief to `.pHive/campaigns/<topic>/campaign-brief.md`. Use the standard Campaign Brief format defined in the marketing-strategist persona.

Wait for the strategist to complete and confirm the brief is written to `.pHive/campaigns/<topic>/campaign-brief.md` before proceeding.

### Phase 2 — Parallel copy and creative passes

After the campaign brief exists, dispatch marketing-copywriter and ad-creative **in parallel**. Both consume the same brief.

#### Phase 2a — marketing-copywriter copy pass

Read `hive/agents/marketing-copywriter.md` in full. Spawn the marketing-copywriter subagent with:

- The full persona
- The campaign brief at `.pHive/campaigns/<topic>/campaign-brief.md`
- Instruction: produce copy deliverables for all surfaces specified in the **→ marketing-copywriter (b2)** handoff section of the brief. Write output to `.pHive/campaigns/<topic>/copy-deliverables.md` using the standard Copy Deliverables format.

#### Phase 2b — ad-creative creative pass

Read `hive/agents/ad-creative.md` in full. Spawn the ad-creative subagent with:

- The full persona
- The campaign brief at `.pHive/campaigns/<topic>/campaign-brief.md`
- Instruction: produce creative concepts and image-gen prompts for all formats specified in the **→ ad-creative (b3)** handoff section of the brief. Write output to `.pHive/campaigns/<topic>/creative-deliverables.md` using the standard Creative Deliverables format. Do NOT render images inline — emit prompts only; rendering is handled downstream by the visual-asset skill (b7) if requested.

Wait for both Phase 2a and Phase 2b to complete before proceeding.

### Phase 3 — Visual asset rendering (conditional)

Only when `--render-assets` was set:

Parse the image-gen prompts from `.pHive/campaigns/<topic>/creative-deliverables.md`. For each **Asset Concepts & Image-Gen Prompts** entry, invoke the shared visual-asset skill (`skills/hive/skills/visual-asset/SKILL.md`) with:

- `prompt`: the verbatim image-gen prompt from the creative deliverable
- `medium`: `raster`
- `output_dir`: `.pHive/campaigns/<topic>/assets/`
- `name`: a kebab-case slug derived from the asset name (e.g., `instagram-hero-0`, `twitter-card-a`)
- `variants`: 1 (default; increase to 2 for entries explicitly marked as A/B variants)

Collect the returned asset records (paths + `fallback_used` flag). If `fallback_used` is true for any asset, note it in the handoff index so the reviewer knows which prompts need manual generation.

When `--render-assets` is NOT set, skip this phase. The creative deliverables document contains the image-gen prompts for manual or later use.

### Phase 4 — Write handoff summary

Write `.pHive/campaigns/<topic>/handoff.md`:

```markdown
# Campaign Handoff: <topic>

**Source:** changelog | brief
**Changelog:** <changelog_path or "N/A">
**Created:** <ISO 8601 timestamp>

## Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Campaign Brief | .pHive/campaigns/<topic>/campaign-brief.md | ready |
| Copy Deliverables | .pHive/campaigns/<topic>/copy-deliverables.md | ready |
| Creative Deliverables | .pHive/campaigns/<topic>/creative-deliverables.md | ready |
| Rendered Assets | .pHive/campaigns/<topic>/assets/ | <ready \| prompts-only \| partial (N fallbacks)> |

## Review Checklist

- [ ] Positioning and message pillars match what shipped
- [ ] Audience segments are accurate for this product
- [ ] Channel mix is appropriate for launch timing
- [ ] Copy variants are meaningfully differentiated
- [ ] Image-gen prompts (or rendered assets) match the visual direction
- [ ] No brand compliance gaps flagged in creative deliverables

## Next Steps

1. Review artifacts above
2. Edit copy or creative direction directly in the deliverable files
3. If assets were not rendered (`--render-assets` not set), submit the image-gen prompts from `creative-deliverables.md` to your image generation tool of choice, or re-run with `--render-assets`
4. Publish according to channel mix in the campaign brief
```

### Phase 5 — Register in campaign index

Update (or create) `.pHive/campaigns/index.yaml`. Append (or in-place update when `<topic>` already has an entry) one entry under `campaigns[]`:

```yaml
updated_at: "<ISO 8601 timestamp>"
campaigns:
  - topic: "<topic>"
    source: "changelog | brief"
    changelog_path: "<path or null>"
    artifacts:
      brief: ".pHive/campaigns/<topic>/campaign-brief.md"
      copy: ".pHive/campaigns/<topic>/copy-deliverables.md"
      creative: ".pHive/campaigns/<topic>/creative-deliverables.md"
      assets_dir: ".pHive/campaigns/<topic>/assets/"
      handoff: ".pHive/campaigns/<topic>/handoff.md"
    render_assets: true | false
    fallback_assets: <count of assets where fallback_used=true, or 0>
    status: "pending_review"
    created_at: "<ISO 8601 timestamp>"
```

When re-running against an existing `<topic>`, update the entry in-place (latest wins) and set `status: "pending_review"` — do not accumulate duplicate entries.

### Phase 6 — Present to user for review

Print the handoff summary and artifact listing. Do NOT invoke any automated review skill or persona. Review is a human gate.

```text
CAMPAIGN READY FOR REVIEW: <topic>

Source: <changelog | brief>
<When source=changelog: Changelog: <changelog_path>>

Artifacts:
  Brief:     .pHive/campaigns/<topic>/campaign-brief.md
  Copy:      .pHive/campaigns/<topic>/copy-deliverables.md
  Creative:  .pHive/campaigns/<topic>/creative-deliverables.md
  <When --render-assets: Assets:    .pHive/campaigns/<topic>/assets/>
  Handoff:   .pHive/campaigns/<topic>/handoff.md
  Index:     .pHive/campaigns/index.yaml (entry: <topic>)

<When --render-assets and fallback_assets > 0:
  Note: <N> asset(s) used prompt fallback (openai-image MCP unavailable).
  Review prompt files in .pHive/campaigns/<topic>/assets/ for manual generation.>

Review the artifacts above. When ready, publish according to the channel mix in the campaign brief.
No automated review step — this is your gate.
```

When invoked from `/ship` via post-release hook (detectable by the `--from-ship` flag), suppress the "No automated review step" line — `/ship` controls the operator flow context.

## Artifact layout

```
.pHive/campaigns/<topic>/
  campaign-brief.md        # marketing-strategist output
  copy-deliverables.md     # marketing-copywriter output
  creative-deliverables.md # ad-creative output (concepts + image-gen prompts)
  handoff.md               # human-review checklist and artifact index
  assets/                  # rendered assets from b7 (only when --render-assets)
    <name>-0.png           # raster output (0-indexed)
    <name>-prompts.md      # fallback prompt files when openai-image MCP unavailable
```

## Invocation modes

**`--from-ship <changelog-path>` (primary).** The `/ship` skill's post-release hook (b4) invokes this mode on consumer projects after a successful ship action. The changelog entry is the strategist's source material — what shipped, why it matters, who cares, where to reach them.

**Standalone / manual.** Invoked directly by the operator with a freeform brief or a changelog path. No prior ship action required. Ad-hoc launch campaigns, mid-cycle announcements, and retroactive campaign creation all use this path.

Both modes run the same ceremony and produce identical artifacts. The only differences are the `source` field in the index entry and the suppressed operator note in Phase 6 output.

## What /marketing-campaign is NOT

- **Not a pre-release planning tool.** Campaign planning at story/epic time belongs in the epic brief. This skill is post-release.
- **Not a review skill.** No automated critique persona runs after Phase 2. The user reviews the artifacts — that is the gate.
- **Not a renderer.** Visual rendering is delegated to the visual-asset skill (b7). This skill does not embed Frame0 or image-gen calls directly.
- **Not a /ship replacement.** This skill handles the campaign artifact ceremony only. Release mechanics (version bump, artifact generation, story marking) remain in `/ship`.

## Atomic-skill invariants

- **Top-level skill** at `skills/marketing-campaign/SKILL.md` (auto-discovered).
- **Callable standalone** — no prior planning state required. Kickoff gate is warn-only.
- **Single handoff artifact per topic** — produces an entry in `.pHive/campaigns/index.yaml` per topic. Re-running overwrites the prior artifacts and updates the index entry in-place.
- **User-review gate** — skill ends by presenting artifacts to the user. No automated marketing-review persona or skill exists in v1. This is a maintainer decision (decision #4).
- **Rendering via b7 only** — when visual assets are requested (`--render-assets`), this skill delegates to `skills/hive/skills/visual-asset/SKILL.md` exclusively. No inline Frame0 or image-gen calls.
- **Parallel Phase 2** — copy and creative passes run concurrently; each reads the same campaign brief output by Phase 1.

## See also

- [`hive/agents/marketing-strategist.md`](../../hive/agents/marketing-strategist.md) — Phase 1 persona; produces the campaign brief
- [`hive/agents/marketing-copywriter.md`](../../hive/agents/marketing-copywriter.md) — Phase 2a persona; produces copy deliverables
- [`hive/agents/ad-creative.md`](../../hive/agents/ad-creative.md) — Phase 2b persona; produces creative concepts and image-gen prompts
- [`skills/hive/skills/visual-asset/SKILL.md`](../hive/skills/visual-asset/SKILL.md) — Phase 3 render skill (b7); invoked when `--render-assets` is set
- [`skills/ship/SKILL.md`](../ship/SKILL.md) — primary caller via post-release hook (b4); passes `--from-ship <changelog-path>`
- [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard preamble + warn-only gate posture
- [`skills/design/SKILL.md`](../design/SKILL.md) — structural analog; `/marketing-campaign` mirrors the `.pHive/<domain>/<topic>/` + `index.yaml` handoff pattern
