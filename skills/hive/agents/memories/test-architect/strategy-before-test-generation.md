---
name: strategy-before-test-generation
description: "write the test strategy document before generating any test files; strategy-first prevents coverage overlap and ensures deliberate test design"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

Before generating any test files, produce a test strategy document. This takes 10–15
minutes and prevents the most common test architect failure: generating tests that duplicate
story-level unit tests or that miss the swarm's specific mandate (integration, E2E, or
coverage gap tests).

Test strategy document structure:
1. **Scope statement** — What does this swarm test that the story tests do NOT?
2. **Framework and runner** — Confirmed from scout report (never override the scout)
3. **Test categories** — Which of these apply: unit, integration, E2E, performance?
4. **Coverage targets** — Which acceptance criteria map to which test files?
5. **Excluded scope** — What will NOT be tested by this swarm (already covered in story)?
6. **File plan** — List of test files to create, one line each with purpose

Only after the strategy document is approved (or self-approved in autonomous mode) should
you generate actual test files. Writing tests without a strategy leads to:
- Duplicating unit tests that already exist
- Missing the acceptance criteria that the swarm is supposed to cover
- Generating tests for happy-paths only, leaving error cases untested
