# Insights: plu-342-eval-serialization-test

## yamlScalar(null) returns bare `null`, not `"null"`

The `yamlScalar` helper in `episode-sync.mjs` short-circuits for `null`/`undefined` and returns the string `'null'` directly (valid YAML null scalar). Only non-null values go through `JSON.stringify(String(value))`, which would produce `"null"`. Tests checking null serialization must match `: null` (bare), not `: "null"` (quoted). The third test in this suite caught this.

## Using fs.mkdtemp for isolation without tmpDir cleanup races

Each test creates its own temp dir via `fs.mkdtemp` and registers `fs.rm(dir, { recursive: true })` in `t.after()`. This avoids shared state between tests and cleans up even on failure. One temp dir per test call site (not per loop iteration) means the `t.after` closes over the right variable.

## distill option: set to undefined to avoid mocking distill.mjs

`writeMulticaRunEpisode` only calls `runMulticaInsightDistill` when `distill` is truthy. Omitting the option entirely (leaving it `undefined`) is sufficient to skip the distill path in unit tests — no mock or stub needed.
