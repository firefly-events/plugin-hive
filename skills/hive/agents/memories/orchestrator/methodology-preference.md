---
name: methodology-preference
description: "orchestrator must read developer methodology preference from hive.config.yaml before assigning workflow"
type: pattern
last_verified: 2026-04-08
ttl_days: 90
source: starter
---

Before assigning a methodology to a story or team, read
`hive.config.yaml → execution.default_methodology`. This value was
set during developer discovery (Phase 2b-ii) based on the developer's
stated preference and project signals.

Valid values: `classic`, `tdd`, `bdd`. If null, default to `classic`.

When generating team configs, propagate this value to the team's
`methodology` field. Individual stories can override if explicitly
requested, but the default should match what the developer chose.
