---
name: measurable-acceptance-criteria-first
description: "acceptance criteria must be binary-testable before the story leaves analysis; vague criteria cause test disputes and scope creep"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

For each story, write acceptance criteria that are binary-testable: a passing or failing
test can be written against them without asking the author for clarification.

The test for a good criterion: can the tester write a test case from it without asking
a single question? If no, the criterion is too vague and must be rewritten.

Bad (vague):
- "The login form should handle errors gracefully"
- "Performance should be acceptable"

Good (binary-testable):
- "When credentials are invalid, the form displays 'Invalid email or password' below the email field within 500ms"
- "The API endpoint responds in < 200ms at p95 under 50 concurrent requests (load test)"

Rewrite procedure when a criterion is vague:
1. Ask: what specific state change or output proves this is satisfied?
2. Add the measurable threshold (time, count, string, HTTP status, etc.)
3. Add the observable location (which UI element, which log line, which API response field)
4. Add the trigger condition (what user action or system event causes it)

Vague criteria are not the user's fault — they are the analyst's output gap. Own the rewrite.
