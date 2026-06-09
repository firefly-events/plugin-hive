# Memory: JSDoc block comments break vitest/vite import analysis in .test.mjs files

**Story:** s-1-dispatch-parity-matrix (substrate-coverage-and-test-cleanup)
**Date:** 2026-06-08

## Finding

Multi-line JSDoc block comments (`/** ... */`) cause vitest to fail with:

```
Error: Failed to parse source for import analysis because the content contains invalid JS syntax.
Plugin: vite:import-analysis
```

This happens because vite's import analysis parser misinterprets certain patterns inside block comments — particularly regular expression literals containing `/` characters, glob-style patterns, or `*/` sequences anywhere in the comment body.

## Affected pattern

Any `.test.mjs` file in this repo that uses JSDoc doc-comments for functions will hit this. The lint-cc-workflows-no-codex.test.mjs file avoided this by using no JSDoc.

## Fix

Replace all `/** ... */` block comments with `//` line comments. Example:

```js
// Before (breaks):
/**
 * Parse the main matrix rows.
 * Returns an array of { orchestrator, default, multica, ccWorkflows }.
 */
function parseMainMatrixRows() { ... }

// After (works):
// Parse the main matrix rows.
// Returns an array of { orchestrator, default, multica, ccWorkflows }.
function parseMainMatrixRows() { ... }
```

## Rule

Use `//` line comments in all vitest test files in this project. Do not use `/** */` JSDoc comments, even for helper functions. This is consistent with the established lint-cc-workflows-no-codex.test.mjs pattern.
