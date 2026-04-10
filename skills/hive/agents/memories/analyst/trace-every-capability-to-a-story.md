---
name: trace-every-capability-to-a-story
description: "every distinct capability in the original requirement must map to at least one story; unmapped capabilities are GAPs that must be flagged"
type: pitfall
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

After decomposing requirements into stories, always run a traceability pass: read the
original requirement line by line and verify each distinct capability appears in at least
one story's acceptance criteria.

If any capability is unmapped: add it to the gap list with the label `CAPABILITY_GAP`.
Do NOT silently omit it. Do NOT fold it into an existing story without noting the addition.
Surface it explicitly: "This capability was in the requirement but has no story covering it."

The traceability pass prevents the most expensive kind of miss: implementing everything the
team agreed to while skipping something the user actually wanted. These gaps surface during
user acceptance testing, not during development, and they always cost more to fix late.

Protocol:
1. List all distinct capabilities from the original requirement (bullet or numbered list)
2. For each capability, write the story ID that covers it (or "NONE — CAPABILITY_GAP")
3. Flag any CAPABILITY_GAP items in the requirements document before delivering it
4. If the gap list is non-empty, surface it to the orchestrator before the plan is approved
