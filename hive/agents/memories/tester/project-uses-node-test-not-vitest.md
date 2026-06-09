---
name: project-uses-node-test-not-vitest
description: Use node:test (not vitest) for task-tracking-dispatch tests; research briefs may cite vitest but the project's package.json test script uses --import tsx with node --test.
applies_to: tester
---

The dispatch package at `hive/lib/task-tracking-dispatch/package.json` runs `node --test --import tsx '**/*.test.ts'`. The test framework is node:test, not vitest. Research briefs generated outside the codebase may say "vitest mocks/spies (vi.fn)" — ignore that and match `dispatch.test.ts` patterns instead. The tsx binary is not in the worktree; find it at `/Users/don/Documents/WorkFlow/project-hive/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/esm/index.mjs` and invoke with `node --test --import <that path> <test-file>`.
