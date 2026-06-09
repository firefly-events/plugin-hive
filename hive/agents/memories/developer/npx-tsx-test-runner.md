---
name: npx-tsx-test-runner
description: Use `npx tsx --test <file>` to run node:test files that import TypeScript modules; avoid --import with bare specifiers.
applies_to: developer
---

When running `node:test` files that dynamically `import` `.ts` files (like `index.ts`), `--import tsx` fails with ERR_MODULE_NOT_FOUND because `tsx` is not in the project's local `node_modules`. The reliable invocation is `npx tsx --test <file>` — tsx ships its own test runner integration and resolves its own loader internally. This applies to `hive/lib/task-tracking-dispatch/test/*.mjs` and any future `node:test` contracts in this codebase. In `package.json` scripts use `"test:contract": "npx tsx --test <file>"`.
