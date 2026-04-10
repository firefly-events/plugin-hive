---
name: working-state-invariant
description: "every vertical slice must leave the product in a working, verifiable state — never a non-working intermediate"
type: pattern
last_verified: 2026-04-09
ttl_days: 90
source: agent
---

The core invariant of vertical planning: each slice's WHAT WORKS statement must describe something
that can be verified and demoed right now, with what's been built so far. A slice that produces
working backend but no frontend path to exercise it is incomplete — it can't be verified.
The first slice should use dummy/fixture data to prove the concept with minimal integration risk.
If a slice can't be verified without completing the next slice, merge them or redefine the boundary.
