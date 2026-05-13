# Episode: s7-warm-pool-placeholder

## Story
Warm-pool placeholder for future createSandbox optimization

## Agent
technical-writer

## Outcome
Created `hive/references/sandcastle-warm-pool-placeholder.md` — a doc-only
architecture note parking the Sandcastle `createSandbox()` warm-pool pattern
as deferred future work.

## Key decisions
- No provider-wrapper runtime change; `hive/lib/sandcastle-provider.js` is
  unchanged by this story.
- Trigger condition stated categorically ("measured cold-start cost becomes
  material") — no numeric threshold invented.
- `merge-validation-results.md` did not exist at time of authoring; citation
  was omitted per spec instructions.
- Future story shape sketch included: `sandcastle-pool.js` module + provider
  delegation + drain-on-close lifecycle.

## Non-goals documented
- V1 provider-wrapper runtime change
- YAML config surface for pool size
- Auto-tuning logic

## Insights
None — straightforward doc-only story with clear spec.
