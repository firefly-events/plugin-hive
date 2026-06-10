---
name: story-spec-test-path-inconsistency
description: Verify test file paths in story specs against actual codebase convention before following them.
applies_to: developer
---

Story t-1a listed `hive/lib/scenarios/test/load.test.mjs` (single-underscore `test/` subdirectory) and called out "vitest". The actual test file lives at `hive/lib/scenarios/__tests__/load.test.mjs` (double-underscore `__tests__/`) and uses Node.js built-in `node:test`. Always `ls` the module's directory before trusting `files_to_modify` paths — the canonical path is ground truth.
