---
name: avoid-coverage-overlap-with-story-tests
description: "do not duplicate unit-level tests the story tester already wrote; the test swarm's mandate is coverage gaps and integration paths, not re-testing individual functions"
type: pitfall
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

The test swarm's value is in testing what the story-level tester could NOT: cross-story
integration paths, end-to-end user flows, and acceptance criteria that span multiple
components. If you regenerate unit tests for individual functions the story tester already
covered, you waste the swarm's budget and produce zero additional coverage value.

How to check for overlap before generating tests:
1. Read the story's existing test files (identified by the scout)
2. Note which functions, branches, and behaviors are already tested
3. In your test strategy: explicitly list what is EXCLUDED because it's already covered

What the test swarm should generate (swarm-appropriate tests):
- Integration tests: does service A communicate correctly with service B?
- E2E tests: does the user flow from login to checkout complete successfully?
- Coverage gap tests: which acceptance criteria have no test at all? Write those.
- Regression tests: were there bugs in prior cycles? Write tests that would have caught them.

What the test swarm should NOT generate:
- `describe('validateEmail', ...)` if the story tester already wrote that
- Any test that could be run in isolation without the full system running

Signal that you're duplicating: if your test file imports and tests a single isolated function
that is already tested in the story's test suite, stop and redirect to integration scope.
