---
name: never-assume-test-runner
description: "never assume the test runner based on language or file extension; always verify from package.json, config files, or explicit project documentation"
type: pitfall
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

Assuming the test runner based on language is one of the most common test swarm failures.

Wrong assumptions to avoid:
- "It's a JavaScript project, so it uses Jest" → it might use Vitest, Mocha, or AVA
- "It's a Python project, so it uses pytest" → it might use unittest or nose
- "There are `.test.ts` files, so it's Jest" → Vitest uses identical file naming
- "The scripts say `npm test`, so I know the runner" → npm test might delegate to anything

The cost of getting this wrong: the test-architect generates tests for the wrong framework,
producing invalid syntax and zero passing tests. The entire test swarm run fails.

The fix is always the same: read the config first. If `jest.config.js` exists and
`vitest.config.ts` also exists, the project is in migration — check which one the
`npm test` script actually calls. When in doubt, record both and flag the ambiguity:
`test_framework: unclear — both jest.config.js and vitest.config.ts present; npm test calls: {actual}`

Never proceed to the architect step with an ambiguous test framework.
