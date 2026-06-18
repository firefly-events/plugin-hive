# User Feedback — Design Discussion

**Epic:** `hive-composability-design`
**Date:** 2026-04-17
**Gate:** Plan skill Phase B step 5 (design-discussion review)

Scale assessment confirmed: **LARGE** → Phase B2 (H/V) + Phase B3 (structured outline) + Phase C (stories).

---

## Open Question Resolutions

**Q1. Effort-estimator thresholds — manual flag for now.**
Ship `--lite` as a manual flag first. Defer auto-promotion threshold work.
**However:** `--lite` MUST NOT apply when scope spans multiple epics or enters PRD territory. Add a hard refusal / guardrail for these cases. The refusal is not a threshold — it is a scope-class exclusion that must be detectable at plan time (before the routing decision at `skills/plan/SKILL.md:120-134`).

**Q2. User confirmation gate shape — TUI default, state-file configurable.**
Default gate implementation is a TUI prompt after design-discussion doc production. An additional path must exist where the gate writes a sign-off artifact to state (under the epic's `docs/` dir), so users can wire their own board, hook, or review workflow against that artifact. Configurable — not TUI-or-state, but TUI-and-optionally-state.

**Q3. `doc-token-telemetry` — parallel to Slice 1.**
Not a prerequisite. Slice 1 ships without measurement data; telemetry lands in the same sprint so data is available before Slices 4–5 revisit Decision #3.

**Q4. Markdown-embedded-HTML + sidecar pattern — confirmed as Slice 1 default.**
No flip to HTML-primary. Markdown canonical + generated `.html` sidecar following `state/brand/brand-guide.html` precedent. Measurement via `doc-token-telemetry` must beat this by a meaningful margin to flip in Slices 4+.

**Q5. Phase-scoped lifecycle config — match existing pattern.**
Use phase-keyed config: `planning.teammate_lifecycle`, `execution.teammate_lifecycle`. Follows the existing `planning.collaborative_review` pattern at `hive/hive.config.yaml:134-136`. No top-level key.

---

## Risks (§4) accepted as framed

All 6 risks carry forward into the structured outline and story-level risks. No reframing requested.

---

## Implications for Phase B2 (H/V planning)

- Slice 2 (lite mode) now has a sub-requirement: a **scope-class guard** that refuses `--lite` for multi-epic or PRD scope. This likely splits into its own story or lives as a clearly named sub-step of the lite-mode story.
- Slice 2 (lite mode) also has a sub-requirement for the **doc-production / collaborative-review separation** as a precondition for "design discussion is never skippable" being structurally enforced.
- Slice 2 or Slice 3 needs a **confirmation-gate story** with both TUI and write-to-state paths.
- Phase-scoped config key additions (`planning.teammate_lifecycle`, `execution.teammate_lifecycle`) land in Slice 6+ (Workstream B) but should appear on the horizontal layer map in the **config layer**.

The TPM produces H/V plans next with these resolutions in hand.
