---
name: cross-skill-skillmd-path-resolution
description: When a dispatch skill test needs to doc-grep a *different* skill's SKILL.md, resolve the path from __dirname, not from the project root.
applies_to: tester
---

`review-dispatch/test/resolver.test.mjs` needed to read `skills/review/SKILL.md` for the scope_drift emit contract test. The correct relative path from `skills/hive/skills/review-dispatch/test/` up to the repo root is `../../../../../`, then down to `skills/review/SKILL.md`. Miscounting levels (e.g. 4 `../` instead of 5) silently reads the wrong file and the `toContain` assertions still pass if the file contains the matched string by coincidence. Always count segments and verify with an explicit `fs.existsSync` assertion or by running the test once against a deliberately wrong path to confirm it fails.
