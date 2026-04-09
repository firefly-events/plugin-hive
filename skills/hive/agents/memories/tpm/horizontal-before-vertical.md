---
name: horizontal-before-vertical
description: "always complete the horizontal scan before drawing vertical slice boundaries"
type: pattern
last_verified: 2026-04-09
ttl_days: 90
source: agent
---

Vertical slicing without a horizontal scan leads to missed dependencies discovered mid-implementation.
Complete the horizontal layer map (all layers, all items, all cross-layer dependencies) before drawing
any slice boundaries. Cross-layer dependencies are the primary input to slice boundary decisions —
you can't know where to cut without knowing what depends on what. The overlay diagram (vertical
slice columns on the horizontal map) is the artifact that proves the slicing is sound.
