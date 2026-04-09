---
name: surface-risks-not-just-the-happy-path
description: "architecture documents must name specific risks, not just describe the intended design"
type: pattern
last_verified: 2026-04-09
ttl_days: 90
source: agent
---

An architecture doc that only describes what will work is incomplete. For each major decision,
name the top risk: what could go wrong, what assumption could be wrong, what makes this fragile.
Risk surfacing is the primary value the architect provides to the dev team — they can implement
from a spec, but they can't anticipate architecture-level risks without the architect's read.
Include a dedicated "Risks and mitigations" section in every design document.
