---
name: stale-dag-test-after-dag-retarget
description: When a DAG edge is retargeted across two sibling stories, the first story's DAG test becomes stale — do not fix it in the second story's test phase.
applies_to: tester
---

t-1a authored a test in hive/lib/scenarios/__tests__/load.test.mjs asserting that validate-coverage depends_on execute-platform-a. t-1b then retargeted that edge to go through scenario-replay. The t-1a test now fails against the final codebase. This is a legitimate cross-story sequencing artifact. Do NOT silently modify the prior story's test file to paper over it — document the staleness in the episode marker notes and let the developer reconcile. The new story's tests should assert the final correct state (scenario-replay intermediary) independently.
