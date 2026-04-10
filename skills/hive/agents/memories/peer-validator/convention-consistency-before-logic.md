---
name: convention-consistency-before-logic
description: "run naming and convention checks before logic and integration checks; conventions are mechanical to verify and catch the most cross-story issues"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

Run cross-story checks in this order — don't jump straight to logic or integration:

1. **Naming consistency** — Does the same concept have the same name across all stories?
   Check: entity names, event names, error types, API route names, enum values.
   These are mechanical to verify and have the highest catch rate.

2. **Import / interface consistency** — If multiple stories reference the same module or
   function, do they import it the same way? Are the function signatures compatible?

3. **Convention compliance** — Same file structure, same test patterns, same error-handling
   approach across stories? Spot-check 2–3 examples per story, not exhaustive.

4. **Integration dependencies** — Does story B depend on something story A produces?
   If so: is A scheduled before B? Does A's output match B's expected input shape?

5. **Unmapped risk** — Are there any assumptions in the epic that no story explicitly
   covers? (E.g., "user is authenticated" assumed everywhere but no story sets that up.)

Stop at the first category that finds issues. Fix the naming before hunting for integration
risks — naming errors often reveal integration risks automatically. A consistent naming pass
across 10 stories takes 5 minutes and prevents 80% of cross-story ambiguities.
