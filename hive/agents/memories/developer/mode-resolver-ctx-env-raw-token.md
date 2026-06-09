---
name: mode-resolver-ctx-env-raw-token
description: Always pass ctx.env as a raw "VARNAME=value" token to resolveMode(), never just the value string.
applies_to: developer
---

`hive/lib/mode-resolver.mjs` line 75 parses `ctx.env` by splitting at `=` with `indexOf('=')`. If you pass `process.env.HIVE_TEST_MODE` directly (just the value, e.g. `'cc-workflows'`), there is no `=` in the string, so `eqIdx` is `-1` and the env tier is silently skipped — resolution falls through to config or default without any error. Always build the token explicitly: `ctx.env = \`HIVE_TEST_MODE=${process.env.HIVE_TEST_MODE}\`` before passing to `resolveMode`. This applies to all six varNames in the registry.
