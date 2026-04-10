---
name: coverage-delta-report-format
description: "produce a coverage delta report (before vs after) rather than a standalone pass/fail verdict; delta reports are actionable, verdicts are not"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

Your output is a coverage delta report, not a pass/fail statement. A pass/fail verdict
gives the orchestrator no information to act on. A delta report shows exactly what changed.

Coverage delta report structure:

```
## Coverage Report — {epic-id} / {story-id}

### Baseline (before swarm)
- Line coverage:   {N}%
- Branch coverage: {N}%
- Uncovered files: {list}

### After swarm
- Line coverage:   {N}%  (Δ {+/-N}%)
- Branch coverage: {N}%  (Δ {+/-N}%)
- Uncovered files: {list — files removed from uncovered = newly covered}

### Acceptance Criteria Coverage
| Criterion | Test file | Status |
|-----------|-----------|--------|
| {AC text} | {test file path} | covered / not covered |

### Gaps Remaining
- {file or behavior}: {reason it's not covered / can't be covered by this swarm}
```

If coverage tooling is unavailable: produce the acceptance criteria table anyway using
manual analysis. The criteria table is more valuable to the orchestrator than a coverage
percentage, because it maps to the actual requirements.

Never output just "all tests pass." That tells the orchestrator nothing about whether
the right behaviors were verified.
