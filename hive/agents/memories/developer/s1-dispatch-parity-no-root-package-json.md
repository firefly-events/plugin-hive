# s-1: dispatch-parity verify script — no root package.json + JSDoc glob gotcha

**Story:** s-1-dispatch-parity-matrix (substrate-coverage-and-test-cleanup)
**Date:** 2026-06-08

## No root package.json

This repo has NO root `package.json`. Any new npm scripts (e.g., `verify:dispatch-parity`) must go into `hive/lib/package.json`, alongside the existing `lint:cc-workflows` script. The story spec wording "add npm script to package.json" is ambiguous — always check for `hive/lib/package.json` first when adding hive-internal scripts.

## JSDoc block comment cannot contain `*/`

When writing an ESM Node script with a leading `/** ... */` JSDoc block, any glob pattern containing `*/` (e.g., `skills/hive/skills/*-mode-*/SKILL.md`) will **prematurely close** the block comment. Node 25's ESM parser surfaces this as a `SyntaxError: Unexpected identifier` on the next token after the glob pattern. Fix: replace glob patterns in JSDoc prose with descriptive text.

## Checker extracts ALL cited paths

The `verify-dispatch-parity.mjs` regex matches every `skills/hive/skills/*-mode-*/SKILL.md` path in the doc, including paths mentioned in prose (e.g., future-substrate notes). If a path is cited in prose it must be resolvable. Do not cite a non-existent path in any cell or note — the checker will fail on it.
