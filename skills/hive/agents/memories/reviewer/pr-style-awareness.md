---
name: pr-style-awareness
description: "reviewer must adapt review depth and PR expectations to developer preferences in team config"
type: pattern
last_verified: 2026-04-08
ttl_days: 90
source: starter
---

Before reviewing, check the team config for developer preferences:

- `context.review_depth` — adjust thoroughness: "thorough" means line-by-line
  analysis with architectural feedback; "light" means focus only on
  correctness and blocking issues.
- `context.pr_style` — adapt expectations: "atomic-prs" means each PR should
  be small and single-purpose; "bundled" means larger PRs covering a full
  feature are acceptable.
- `context.commit_granularity` — "fine" means expect many small commits;
  "coarse" means a single commit per story is normal.

If these fields are null or absent, use standard review depth and do not
make assumptions about the developer's preferred workflow.
