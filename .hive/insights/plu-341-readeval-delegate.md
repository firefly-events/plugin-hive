# plu-341-readeval-delegate: Sharing parse logic across JS/TS module boundary

## What was non-obvious

The adapter (`index.ts`, TypeScript + tsx) can directly import from `index.mjs` (ESM JavaScript) using a relative path with the `.mjs` extension. The adapter runs via `npx tsx` which resolves `.mjs` imports correctly. No tsconfig or package.json changes needed.

## The factored helper pattern for cross-module logic

When two modules that can't share types have identical parse/validate logic, extract the shared piece as a pure function in the lower-level module (the one without framework-specific error types). Each caller wraps it in a try/catch and re-throws using its own error type:

- `index.mjs`: catches `Error`, re-throws as `dispatchError(...)` (plain object)
- `index.ts`: catches `Error`, re-throws as `new AdapterError(...)`

The shared helper throws a plain `Error` — no custom `.code` or framework coupling needed, since callers own the re-throw.

## Error message propagation

The helper's error message flows through the catch to both callers' re-throws. `dispatchError` in the dispatch module calls `sanitize(message, token)`, which still redacts any token that might appear in the error text. This sanitization happens at the re-throw site, not in the shared helper — keep helpers framework-agnostic.

## SQUAD_OUTCOME_VALUES ownership

The valid enum values (`action|no_action|failed`) now live only in `index.mjs` (inside `parseSquadActivityFromEntries`). The adapter's duplicate `SQUAD_OUTCOME_VALUES` constant was removed. If the enum ever changes, update only the helper.
