---
name: verify-fallback-paths
description: "reviewer must verify L0 fallback behavior is preserved when a new retrieval layer is added"
type: pattern
last_verified: 2026-04-06
ttl_days: 90
source: agent
---

When a new retrieval strategy is added, always test with the new layer
absent or disabled. The L0 baseline must produce identical output to
the pre-redesign system — regression in the fallback is the highest-
severity failure mode.
