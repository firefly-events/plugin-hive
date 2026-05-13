# User Decisions — Phase B Gate (brand-system-2.0-update)

Date: 2026-05-12
Source: post-design-discussion review gate

## Locked decisions

### Q1 — Hero tagline (README.md:9)

**Locked:** `Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship.`

Rationale: strongest continuity with current cadence; preserves "disciplined" + "kickoff to ship"; cleanest user-intent expression.

### Q2 — Body-copy replacement (brand-guide.html:879-885)

**Locked:** `Builders direct work; Hive composes primitives.`

Rationale: clearest on the reframe; minor cadence trade-off acceptable for explicitness.

### Q3 — "Disciplined" in new tagline

**Locked: KEEP.**

Rationale: audit §5.5 retains discipline + composability as co-equal differentiators (`recommendation.md:239-241`).

### Q4 — Branch base

**Locked: new long-lived `develop` branch.**

Rationale: user-directed branching model change. `develop` becomes the integration target for ongoing feature work; main merges happen periodically for releases. `dev/hive-2.0` retires after PR #67 merges. This decision applies project-wide, not just Epic H.

Implications:
- After PR #67 (Hive 2.0) merges into main, create `develop` from main HEAD.
- Brand-system-2.0-update branch (`feat/brand-system-2.0-update`) gets rebased onto `develop`.
- All future feature branches use `develop` as base.
- Document this in a follow-up project memo update.

### Q5 — Asset exports (PNG/SVG) in scope?

**Locked: INCLUDE in H-02.**

Rationale: single coherent brand drop. Avoids stale asset-side positioning copy after brand-source rewrite.

## Story shape (3 stories, sequential)

- **H-01** — README.md:9 hero tagline reframe to locked Q1 wording; spot-check `## North Star` section coherence (low touch, already reframe-aligned).
- **H-02** — Brand-source rewrite (`.pHive/brand/{vision.md, brand-system.yaml, brand-guide.html}` in `/Users/don/Documents/plugin-hive/` worktree) using locked Q2 body copy + Q1-aligned positioning; **plus** asset re-export per Q5 (PNG/SVG that bake positioning copy); plus tracked `h-02-brand-diff-summary.md` for PR-visible delta record.
- **H-03** — Memo `project_oss_rollout_brand.md` Locked-decisions update + final grep verification (`grep -rln "director's chair"` returns only intentional historical-audit paths).

## Scale class

**SMALL** — Per /plan skill flow: design discussion → directly to stories (Phase C). Skip H/V planning and structured outline.

## Out of scope (reaffirmed)

- Logo redesign (locked 2026-04-30)
- Color palette change
- Typography change
- Voice cadence change
- Inspirations credit table edits
- Flayr dogfood narrative rewrite
- 2.0.0 CHANGELOG entry (already shipped via `f6a61e9`)
