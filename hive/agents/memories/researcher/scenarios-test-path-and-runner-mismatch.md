---
name: scenarios-test-path-and-runner-mismatch
description: Story spec files_to_modify cites wrong test path and wrong runner for hive/lib/scenarios tests
applies_to: researcher
---

The story spec t-1a lists `hive/lib/scenarios/test/load.test.mjs` and says "vitest" but the actual convention is `hive/lib/scenarios/__tests__/load.test.mjs` using Node's built-in `node:test` runner (verified at line 1: `import { test } from 'node:test'`). No `test/` subdirectory exists — only `__tests__/`. Developer implementing t-1a should add the new test case to `__tests__/load.test.mjs`, not create a new file at `test/`. Spec path is wrong; trust the codebase.
