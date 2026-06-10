---
name: test-scenario-schema-no-extra-fields
description: Never add fields outside the canonical schema to scenario YAMLs — load.mjs rejects any unknown key outright.
applies_to: tester
---

The loader at `hive/lib/scenarios/load.mjs` validates strictly against
`hive/references/test-scenario-schema.md`. The only valid top-level keys are:
`id`, `title`, `description`, `mode`, `story`, `epic`, `preconditions`, `steps`, `postconditions`.
Legacy keys (`invocation`, `pre_conditions`, `expectations`, `sandcastle_mode_override`)
and any custom keys fail validation immediately. Similarly, `steps[]` entries accept
only `action`, `expected`, and `actor` — no extra fields. Always copy the existing
shape from `.pHive/test-scenarios/h-03-standup-format-slack-manual.yaml` before drafting new scenarios.
