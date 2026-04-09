---
name: design-for-actual-constraints-not-hypothetical
description: "architecture decisions must be grounded in the actual tech stack and existing codebase, not hypothetical best practices"
type: pitfall
last_verified: 2026-04-09
ttl_days: 180
source: agent
---

When designing a system, read the actual codebase first — existing patterns, naming conventions,
current data models. Recommending a new architecture that conflicts with the existing one (e.g.,
proposing event sourcing for a CRUD app, or a microservice split for a monolith with 2 engineers)
produces unimplementable stories. Ground every architectural decision in what's already there and
what the project's actual constraints allow (team size, timeline, ops capability).
