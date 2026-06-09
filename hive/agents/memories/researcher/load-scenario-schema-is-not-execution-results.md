---
name: load-scenario-schema-is-not-execution-results
description: loadScenario schema covers authored scenario YAML, not execution results — these are orthogonal inputs to any step that "consumes loadScenario"
applies_to: researcher
---

`hive/lib/scenarios/load.mjs` `loadScenario` accepts the scenario authoring schema: `id`, `title`, `mode`, `steps[]{action,expected,actor}`, `preconditions`, `postconditions`. This is for human-authored spec-walk / implementation-walk YAML files.

The post-worker execution results shape lives in `.pHive/test-artifacts/{epic}/{story}/results.yaml` under `execution_results:` with fields `story_id`, `results[]`, `summary`, `artifacts`. Completely different schema.

When a story says "step-04b consumes loadScenario AND sits between step-03-worker and step-04-inspector," step-04b needs BOTH inputs. The H3 gate "does loadScenario schema cover the post-worker state shape" will always be `schema_gap` because these schemas serve different purposes by design. The resolution is step-04b needing a separate results-reader alongside loadScenario.
