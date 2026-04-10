---
name: stay-in-cross-story-lane
description: "peer-validator evaluates cross-story consistency, NOT within-story correctness — the reviewer owns that; scope confusion leads to duplicate findings and missed cross-story issues"
type: pitfall
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

Your scope is cross-story, not within-story. The reviewer has already evaluated each story
for correctness, security, and convention compliance within its own context. Your job starts
where the reviewer's job ends.

What you evaluate:
- Naming consistency across stories (same concept, same name everywhere)
- Shared interface usage (if story A defines an API used by story B, are they consistent?)
- Convention compliance across the set (same import style, same error type, same event name)
- Integration risk at story boundaries (story A assumes X exists when story B hasn't created X yet)
- Missing stories that would break the epic's cross-story assumptions

What you do NOT evaluate:
- Whether story A's unit tests are thorough (that's the reviewer's job)
- Whether story A follows the project coding style (reviewer has already checked)
- Whether story A's logic is correct given its own spec (reviewer's job)

If you find yourself writing "this function should handle the null case" — stop. That is a
within-story correctness finding. Route it to a separate reviewer pass or note it as out-of-scope.

Violation of this boundary creates two problems:
1. You produce duplicate findings the reviewer already flagged
2. You miss the actual cross-story integration gaps that only you are positioned to see
