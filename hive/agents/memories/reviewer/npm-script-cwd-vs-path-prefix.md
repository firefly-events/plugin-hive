---
name: npm-script-cwd-vs-path-prefix
description: Always verify npm script paths resolve from the package.json directory, not repo root
applies_to: reviewer
---

npm scripts run from the package.json dir as cwd. A `test:contract` script at
`hive/lib/package.json` written as `npx tsx --test hive/lib/task-tracking-dispatch/test/...`
would fail with "Could not find" because it resolves to
`hive/lib/hive/lib/task-tracking-dispatch/test/...`. The correct form is the relative
path from the package.json dir — `npx tsx --test task-tracking-dispatch/test/...` —
which is what `hive/lib/package.json` `test:contract` actually uses today. When a
review criterion says "run npm test from `<subdir>`", actually `cd <subdir> && npm test`
and check the exit code — passing tests when invoked manually from repo root do not
prove the npm wiring works.
