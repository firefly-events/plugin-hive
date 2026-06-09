---
name: vitest-root-for-cross-dir-tests
description: When test files live outside the vitest working directory, pass --root to vitest to resolve them.
applies_to: developer
---

Vitest resolves test-file arguments relative to its project root (the cwd where `npx vitest` runs). A relative `../scripts/test/foo.test.mjs` path silently matches nothing and exits code 1 with "No test files found." Pass `--root <parent-dir>` to expand the root — then use root-relative paths in the file list. In this repo, `hive/lib/package.json` runs vitest with `--root ..` so `scripts/test/` files resolve correctly alongside `lib/test/` files.
