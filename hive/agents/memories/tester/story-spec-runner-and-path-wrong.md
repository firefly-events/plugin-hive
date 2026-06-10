---
name: story-spec-runner-and-path-wrong
description: Story specs may say "vitest" and name a wrong test path — always verify against repo before writing tests.
applies_to: tester
---

`t-1a` story spec listed `hive/lib/scenarios/test/load.test.mjs` (no double-underscore, `test/` subdir)
and said "vitest" in the step description. Both are wrong. The repo uses `node:test` runner and
`__tests__/` convention at `hive/lib/scenarios/__tests__/load.test.mjs`. Always read the existing
test file and `package.json` before trusting the story's `files_to_modify` paths or framework names.
There is a pre-existing memory `project-uses-node-test-not-vitest.md` in tester memories confirming this.
