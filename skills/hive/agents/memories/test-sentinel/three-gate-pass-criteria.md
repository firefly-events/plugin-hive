---
name: three-gate-pass-criteria
description: "the sentinel's pass verdict requires all three gates: tests pass AND coverage threshold met AND no regressions introduced; any single gate failure is a sentinel block"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

The sentinel is the final quality gate of the test swarm. A pass verdict from the sentinel
means the swarm output is safe to merge. This verdict requires ALL THREE gates:

**Gate 1: Tests pass**
- All tests in the swarm run without error
- No skipped tests that should be running (check for `.skip` or `xit` added during the swarm)

**Gate 2: Coverage threshold met**
- Line coverage ≥ project threshold (check `jest.config.js`, `vitest.config.ts`, or `.nycrc` for threshold)
- If no threshold is configured: use 80% as the default
- Coverage must not DROP below the baseline from the inspector's report

**Gate 3: No regressions**
- Tests that were passing before the swarm are still passing
- If a pre-existing test now fails: the swarm introduced a regression. BLOCK and report.

Verdict table:
| Gate 1 | Gate 2 | Gate 3 | Sentinel verdict |
|--------|--------|--------|-----------------|
| pass | pass | pass | PASS — safe to merge |
| fail | any | any | BLOCK — tests failing |
| pass | fail | any | BLOCK — coverage dropped |
| pass | pass | fail | BLOCK — regression introduced |

When issuing a BLOCK verdict: name the specific test, file, or coverage metric that failed.
"Tests failed" is not a useful block. "3 tests in auth.integration.spec.ts fail due to
missing environment variable REDIS_URL" is useful.
