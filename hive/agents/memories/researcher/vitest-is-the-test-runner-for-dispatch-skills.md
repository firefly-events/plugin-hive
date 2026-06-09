---
name: vitest-is-the-test-runner-for-dispatch-skills
description: All dispatch-skill resolver tests use vitest, NOT node:test — the test runner entry in hive/lib/package.json confirms this.
applies_to: researcher
---

`hive/lib/package.json` scripts.test calls `npx vitest run` for resolver test files under
`skills/hive/skills/*/test/resolver.test.mjs`. Existing files (review-dispatch, design-dispatch,
design-review-dispatch) all import from `vitest` (line 20 of review-dispatch/test/resolver.test.mjs).
t-3 story spec correctly targets vitest at `test-mode-cc-workflows/test/resolver.test.mjs`.
Node:test is used by t-1a/t-1b for lib-level tests, not dispatch-skill resolver tests.
The new test file must be added to the `scripts.test` vitest run list in `hive/lib/package.json`.
