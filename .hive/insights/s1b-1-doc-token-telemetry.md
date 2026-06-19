# Insight: s1b-1-doc-token-telemetry

## @anthropic-ai/tokenizer is not in package.json

The package is `@anthropic-ai/sdk`, not `@anthropic-ai/tokenizer`. The tokenizer is a separate package that does not ship with the SDK. The fallback (char_count/4) activates every time in this repo. If accurate token counts matter later, add `@anthropic-ai/tokenizer` to package.json explicitly.

## state/ is already globally ignored

No `.gitignore` entry needed for `state/telemetry/` — the root `.gitignore` already ignores `state/` wholesale. The directory is created on first write via `fs.mkdirSync(..., { recursive: true })`.

## TELEMETRY_DIR is relative to CWD, not the module

`state/telemetry` resolves relative to `process.cwd()`, which is the repo root when skills invoke the lib from there. If a caller ever invokes from a different cwd, the path will be wrong. This is consistent with how `html-sidecar-gen.js` handles its output paths — both assume repo root as cwd.

## The note field is conditional

Only present when the fallback is used. Schema consumers must treat it as optional. The six required fields (ts, epic_id, doc_type, format, token_count, char_count, bytes) are always present.
