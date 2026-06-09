---
name: dispatch-mirror-doc-contract-tests
description: When reviewing dispatch skills that mirror a sibling, verify scope_drift / phase-label / extra_dimensions documentation contracts are enforced via doc-grep tests rather than runtime assertions
applies_to: reviewer
---

review-dispatch mirrors design-review-dispatch but the scope_drift emit lives in skills/review/SKILL.md (Python helper, not the dispatch atom). The resolver.test.mjs uses doc-grep against both SKILL.md files (path traversal `../../../../../skills/review/SKILL.md`) to assert the contract — runtime Python spying from vitest is impractical. When verifying r-1 style stories, confirm the test reads BOTH the dispatch SKILL.md and the consumer SKILL.md, not just one.
