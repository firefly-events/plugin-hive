---
name: doc-contract-tests-read-skill-md
description: Use fs.readFileSync on SKILL.md to assert documented routing targets and flag pass-through clauses when the implementation is prose, not executable code.
applies_to: tester
---

Dispatch skills like design-dispatch and design-review-dispatch implement behavior as LLM-readable prose in SKILL.md, not as callable functions. The only testable surface for routing targets (e.g. `design-review-mode-multica`) and flag pass-through clauses (e.g. `--skip`, `--artifact-target`) is the SKILL.md text itself. Use `fs.readFileSync(SKILL_MD_PATH, 'utf8')` + `toContain` / `toMatch` assertions to lock the documented contract. See `skills/hive/skills/design-review-dispatch/test/resolver.test.mjs` atom-routing and flag-pass-through describe blocks for the pattern.
