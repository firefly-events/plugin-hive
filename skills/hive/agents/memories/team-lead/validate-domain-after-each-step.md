---
name: validate-domain-after-each-step
description: "check domain compliance after every implementation step, not just at review"
type: pattern
last_verified: 2026-04-09
ttl_days: 90
source: agent
---

Domain violations compound. After each implement or optimize step, read the agent's output,
list every file it modified, and verify each against the agent's write-allowed domain from
the team config. Don't wait for the reviewer to catch violations — by then multiple steps
have built on the violation, making it expensive to unwind. Catch it step-by-step.
