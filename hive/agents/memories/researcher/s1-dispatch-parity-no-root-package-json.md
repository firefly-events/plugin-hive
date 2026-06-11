---
name: s1-dispatch-parity-no-root-package-json
description: For dispatch-parity story — no root package.json exists; npm scripts must go into hive/lib/package.json, not root.
applies_to: researcher
---

The repo has NO root `package.json`. Any `npm run` scripts for CI-runnable checkers (e.g.,
`verify:dispatch-parity`) must be added to `hive/lib/package.json` (where `lint:cc-workflows`
already lives), NOT a root package.json. Story spec says `package.json change: add npm script` —
this means `hive/lib/package.json`. The verify-dispatch-parity.mjs script itself lives at
`hive/scripts/verify-dispatch-parity.mjs` (sibling to `lint-cc-workflows-no-codex.mjs`),
matching the existing scripts pattern.
