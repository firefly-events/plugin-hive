---
name: cli-linter-fixture-patching
description: Test CLI linters that use hardcoded root paths by string-patching the script into a temp dir, not by exporting all internals.
applies_to: tester
---

When a linter script resolves its scope via a hardcoded PROJECT_ROOT / SKILLS_BASE (as in `hive/scripts/lint-cc-workflows-no-codex.mjs`), the test harness can
read the script source, regex-replace the base path constant with a temp dir, write the patched script to a tmpdir, and invoke it via `execSync`.
This avoids refactoring the implementation just to support tests, keeps fixture isolation clean (each test gets its own mkdtempSync subtree), and exercises
the real CLI exit-code contract rather than internal function returns. See `hive/scripts/test/lint-cc-workflows-no-codex.test.mjs` `runLintWithFixtures()` for the pattern.
