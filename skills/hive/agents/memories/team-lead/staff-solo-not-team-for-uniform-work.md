---
name: staff-solo-not-team-for-uniform-work
description: "spawning a team for stories where all work is the same type wastes tokens and coordination overhead"
type: pitfall
last_verified: 2026-04-09
ttl_days: 180
source: agent
---

If a story only touches one domain (docs, config, YAML, or all-backend), handle it solo or
with a single specialist agent. The coordination overhead of a 3-agent team exceeds the value
when all three would be doing the same type of work. The staffing test: "Is there genuinely
different skill work that benefits from different agents?" If the answer is no, go solo.
