# d-3 tester insight: structural contract testing via SKILL.md grep

**Story:** d-3-design-mode-multica
**Date:** 2026-06-08

## Non-obvious finding

When testing a multica atom whose runtime behavior is inherently manual-only
(real Multica dispatch, real persona agents), the resolver test strategy is to
treat SKILL.md itself as the behavioral spec and grep it for structural contract
assertions. The SKILL.md IS the implementation for a prose-defined atom.

Key pattern (mirrors dr-2):
- 5-tier resolver tests use `resolveMode()` directly (pure unit tests).
- Per-persona shape tests use `fs.readFileSync(SKILL_MD_PATH, 'utf8')` + regex/includes.
- This avoids runtime stubs for Multica API calls that can't run in CI.

## d-3-specific pitfall

The toggle OFF path produces `persona_runs` with only the `ui-designer` entry —
accessibility-specialist and animations-specialist are **absent** (not
`status: skipped` — absent entirely). The smoke scenario test for toggle OFF must
assert `personas_absent_from_runs`, not `status: skipped`. Conflating absence
with skipped status is a subtle misread of the SKILL.md Step 4 contract.

## Also useful

The `HIVE_DESIGN_REVIEW_MODE` variable check (wrong var name footgun) is worth
adding as a distinct test case when d-3 and dr-2 share a test runner — the
prefixes are similar enough that a copy-paste env string would silently pass
the wrong resolver.
