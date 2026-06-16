# Insight: am-3-scenario-live-walk-mode

## The mode gate is mode-specific, not additive

`loadScenario` already has an explicit `if (doc.mode === 'implementation-walk')` branch
for the integrate-marker check. Adding a new mode (`live-walk`) requires only adding it
to `VALID_MODES` — the gate does not need to be updated, because it is an allowlist of
_what to check_, not an allowlist of _what to skip_.

If the pattern were inverted (a deny-list of modes exempt from the marker check), every
new mode would require an explicit exemption. The current pattern is safer for extension.

## Tests use Node's built-in test runner

No Jest / Vitest. Run with `node --test <file>`. Discovered by reading the test file
imports (`import { test } from 'node:test'`), not from package.json (which has no
scripts or devDependencies).
