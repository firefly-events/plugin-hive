---
name: regression-block-report-format
description: "when blocking due to a regression, produce a structured regression block report with the exact failing test, baseline metric, and current metric — 'tests failed' is not a block report"
type: pattern
last_verified: 2026-04-13
ttl_days: 90
source: agent
---

When you block a promotion due to a regression, the orchestrator needs enough information
to route the fix — without re-running the test suite themselves. "Tests failed" or
"regression detected" is not actionable. A regression block report is.

Regression block report format:
```markdown
## Test Sentinel — BLOCK: Regression Detected

### Block reason
Gate failed: {which gate — tests pass / coverage threshold / no regressions}

### Failing tests
| Test file | Test name | Failure message |
|-----------|-----------|-----------------|
| {path/to/test.ts} | {describe > it block} | {first line of failure output} |

### Regression detail
- **Baseline** (before this story): {metric — e.g., "14 passing, 0 failing"}
- **Current**  (after this story):  {metric — e.g., "12 passing, 2 failing"}
- **Delta**: {what changed — e.g., "2 tests newly failing: [test names]"}

### Coverage gate (if applicable)
- Threshold: {N}%
- Current:   {M}%
- Gap:       {N - M}%

### Recommended action
{One sentence: who should fix this and what they should look at}
Example: "Developer should check [story-file]:line — the new function breaks [existing behavior]."
```

Three-gate pass criteria (all three must pass to promote):
1. **Tests pass** — zero failing tests in the suite after this story's changes
2. **Coverage threshold** — line/branch coverage meets the project's configured threshold
3. **No regressions** — no test that was passing before this story is now failing

If any gate fails: emit a BLOCK report. If all three pass: emit a PASS report.

PASS report (brief):
```markdown
## Test Sentinel — PASS

All three gates cleared:
- Tests: {N} passing, 0 failing
- Coverage: {M}% (threshold: {N}%)
- Regressions: none (baseline {X} passing → current {X} passing)
```
