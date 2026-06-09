# Insight — d-3 design-mode-multica: mirror-anchor asymmetry as a deliberate atom-shape signal

**Story:** `d-3-design-mode-multica` (substrate-coverage-and-test-cleanup)
**Date:** 2026-06-08

## Non-obvious finding

When reviewing the `*-mode-multica` atom family, the **mirror anchor** chosen by
each atom is the single most load-bearing decision shaping the entire SKILL.md
prose — and the absence of a workflow.yaml anchor is itself a signal that
per-persona fan-out is the right shape.

- `dr-2` mirrors `design-review.workflow.yaml:8-81` (4-step canonical anchor exists)
  → ONE Multica issue, FOUR internal agent() calls, ONE marker
- `d-3` has **no** `design.workflow.yaml` (no canonical 4-step anchor exists)
  → MIRROR execute-mode-multica per-story precedent → N issues, N markers

The reviewer's first instinct on a "design via Multica" atom is to look for a
workflow.yaml anchor. When it doesn't exist, the temptation is to invent one.
**Don't.** The presence/absence of a workflow.yaml anchor is the architectural
signal: if present, mirror its step shape inside ONE issue; if absent, fan out
per-persona with N issues mirroring execute-mode-multica's per-story precedent.

Reviewing the SKILL.md prose against the **mirror anchor declared in its HTML
comment** is the most efficient verification path. If the atom's structural
choices don't match the anchor's structural choices, that's the bug — long
before checking individual API calls.

## Verification pattern for *-mode-multica atoms

1. Read the HTML comment at the top of SKILL.md — identify the mirror anchor.
2. Open the anchor file — confirm its dispatch shape (per-unit vs single-run).
3. Walk the atom's Step 1 personaSet/storySet definition.
4. Walk the atom's Step 2 dispatch loop — single createIssue or per-unit?
5. Walk the atom's marker write call — storyId argument = unit_id at marker path?
6. Confirm the constraint table row "Intentional asymmetry with {sibling atom}"
   exists and contrasts the two atom shapes verbatim.

This six-step walk catches shape-violation bugs in <90 seconds.

## Q10 resolution as forcing function

Story spec design_decisions explicitly resolved Q10 to "one issue per persona
by-default rather than gated". Without this explicit resolution, a reviewer could
reasonably ask "should we collapse to one bundled issue for operator UX?". With
the resolution locked in design-discussion §6, the reviewer's job is verifying
the SKILL.md cites Q10 verbatim AND the constraint table marks it locked. Both
present here (SKILL.md:160-161 + table row 481).

## Applies to

- Future `*-mode-multica` atom reviews — check mirror anchor first
- Sibling atom asymmetry verification across the multica substrate
