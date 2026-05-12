# Episode: s3-dispatch-routing

**Story:** Route sandcastle as the fifth execute mode with field-source attribution
**Epic:** sandcastle-adoption-followon
**Status:** complete
**Commit:** ece1169

## Changes Made

- `skills/hive/skills/execute-dispatch/SKILL.md` — Added `sandcastle` to `mode_decision` enum; added `HIVE_EXECUTION_MODE` to Inputs; added `execution_mode` field to Step 0 resolver with env/config/default source tracking; added sandcastle early-exit before Step 1; extended telemetry line with `execution_mode={source}`; documented that `execution_mode=default` does NOT trigger the loud "fell to defaults" warning.
- `skills/execute/SKILL.md` — Patched Step 5 switch to add `sandcastle -> step 6d`; added step 6d block invoking `skills/hive/skills/execute-mode-sandcastle/SKILL.md`.
- `tests/execute-dispatch-sandcastle.test.js` — New test file (9 cases) covering env/config/default attribution, telemetry, no-regression for sessions/sequential, and unknown env value ignored.

## Acceptance Criteria Status

- [x] `HIVE_EXECUTION_MODE=sandcastle` → `mode_decision=sandcastle`, `field_sources.execution_mode=env`
- [x] Root config `execution.mode: sandcastle` (env unset) → `field_sources.execution_mode=config`
- [x] Neither env nor config → existing sessions/team/sequential behavior unchanged (regression tests AC-4, AC-4b, AC-5)
- [x] `skills/execute/SKILL.md` Step 5 switch contains `sandcastle -> step 6d` invoking `execute-mode-sandcastle`
- [x] Telemetry line includes `execution_mode={source}` in all cases

## Decisions Made

- Sandcastle gate placed at TOP of resolution, before sessions/team checks — it is an explicit override that short-circuits all other checks.
- `execution_mode=default` excluded from "fell to defaults" warning because default = normal non-sandcastle operation; including it would create noise for all existing users.
- Unknown `HIVE_EXECUTION_MODE` values are silently ignored (reserved for future modes), not errors.
- Test fixture encodes the SKILL.md prose logic as a pure function; no production JS module needed since dispatch is prose-driven.

## Notes for Reviewer

- The step 6d block references `skills/hive/skills/execute-mode-sandcastle/SKILL.md` which is authored by the sibling s3-execution-mode-skill task — that file must exist before the sandcastle mode can actually execute, but the dispatch routing is independent.
- `field_sources.execution_mode` is always present in the output (set to `default` on non-sandcastle paths) so callers can reliably check it without null guards.
