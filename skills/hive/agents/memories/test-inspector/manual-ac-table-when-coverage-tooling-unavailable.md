---
name: manual-ac-table-when-coverage-tooling-unavailable
description: "when coverage tooling is unavailable, produce a manual acceptance-criteria coverage table rather than reporting 'tooling unavailable' and stopping"
type: pattern
last_verified: 2026-04-13
ttl_days: 90
source: agent
---

Coverage tooling (Istanbul, Jest --coverage, nyc, pytest-cov, etc.) is often absent or
misconfigured. When it's unavailable, do NOT report "coverage tooling not found" and stop.
The acceptance criteria coverage table is more valuable to the orchestrator than a percentage.

When coverage tooling is unavailable:

1. Read the story spec to extract every acceptance criterion (AC)
2. Read the test files in scope
3. For each AC, determine: does a test exist that directly validates it?
4. Produce this table manually:

```markdown
## Coverage Report — {epic-id} / {story-id}

### Automated Coverage
Coverage tooling unavailable — manual AC analysis performed instead.

### Acceptance Criteria Coverage
| # | Criterion | Test file | Test name | Status |
|---|-----------|-----------|-----------|--------|
| 1 | {AC text} | {path/to/test.ts} | {describe/it block} | covered |
| 2 | {AC text} | — | — | not covered |

### Gaps Remaining
- AC #{n}: {reason — no test found / test exists but doesn't assert the right behavior}

### Manual Analysis Notes
- Files inspected: {list}
- Test runner: {jest / pytest / mocha / unknown}
- Note: line and branch percentages unavailable without tooling; install {tool} for numeric coverage
```

Key rules:
- "covered" means a test directly asserts the behavior described in the AC — not just that
  a test exists in the same file
- "not covered" means no test asserts that specific behavior
- If a test partially covers an AC (e.g., happy path but not error path), mark it "partial"
  and note what's missing in Gaps Remaining

Never output just "Coverage tooling unavailable." That is not a report. It is a non-answer.
The manual AC table is always producible and is the orchestrator's primary signal.
