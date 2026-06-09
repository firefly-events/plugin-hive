# d-1: Phase A toggle tests use static analysis on SKILL.md, not runtime dispatch

**Story:** d-1-design-multi-persona-pipeline  
**Date:** 2026-06-08

## Finding

The d-1 test suite (phase-a-toggle.test.mjs) verifies a SKILL.md prose specification, not executable code. The correct test strategy is to read the SKILL.md file once at module load time and assert substring/regex matches — identical to the doc-contract pattern used by design-dispatch, review-dispatch, and other resolver tests in this codebase.

The 3-describe-block independence requirement is structurally satisfied by writing three separate `describe()` calls with no shared mutable state and no cross-block imports. Each describe block loads from the same `content` constant (read once), so there is zero coupling: a failure in Subsection 2 cannot prevent Subsection 3 from running.

## Non-obvious pitfall

The exact wording in SKILL.md matters for substring assertions. The implementation used "Constraint notes are baked into the ui-designer prompt" (from the Optional flags section) and "constraints baked in" (from Phase A step (c) header). The test initially asserted `'constraints baked into the prompt'` which missed both forms. The fix was a regex: `/[Cc]onstraint.{0,30}baked.{0,40}prompt|baked.{0,20}ui-designer prompt/is`. When testing SKILL.md prose, prefer regex with modest wildcards over exact-substring to tolerate minor author phrasing variation.

## When to apply

Any story that verifies SKILL.md doc-contract correctness (as opposed to code behavior) should use this static-analysis pattern. It is faster, deterministic, and requires no mock setup.
