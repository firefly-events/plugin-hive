---
name: test-scenario-folded-scalar-pitfall
description: Verify test-scenario YAMLs against loadScenario, not just human-eye review — the in-house YAML parser misreads folded scalars containing literal "key:" tokens.
applies_to: reviewer
---

When reviewing a test-scenario YAML, run loadScenario against it before voting pass. The in-house parser in hive/lib/scenarios/load.mjs does NOT understand `>` folded scalars; if the indented content under `action:` or `expected:` contains literal "id: foo" or "status: bar" tokens, they are misread as nested sub-keys and the loader throws VALIDATION_ERROR `unrecognized field 'steps[N].id'`. The file looks fine to a human but fails the schema contract. Found in t-1b review 2026-06-07 (.pHive/test-scenarios/t-1b-step-04b-and-rip-simulated-manual.yaml step 7 expected: block).

Quick check: `node -e "import('./hive/lib/scenarios/load.mjs').then(m => m.loadScenario('PATH'))"` should print no error.
