# Episode: s1-redaction-wrapper

**Story:** s1-redaction-wrapper (sandcastle-adoption-followon)
**Date:** 2026-05-12
**Commit SHA:** 0f37723
**Branch:** feat/sandcastle-adoption-followon

## Files Touched

| File | Action |
|------|--------|
| `hive/lib/sandcastle-log-redaction.js` | Created — redaction module (109 lines) |
| `tests/hive-lib/sandcastle-log-redaction.test.js` | Created — 22 tests (260 lines) |

## Test Results

```
22 tests, 22 pass, 0 fail
node tests/hive-lib/sandcastle-log-redaction.test.js
```

One intermediate failure fixed: `RE_JSON_KV` character class `[a-zA-Z0-9]*` did not match underscore, so `SOME_API_KEY` failed the JSON form test. Fixed by widening to `[a-zA-Z0-9_]*`.

## Security Sidecar Verdict

`passed` — no critical findings. Three informational notes:
1. Module-level `/g` regex constants safe for `.replace()` pattern; flag if `.exec()` usage added later.
2. `String()` coercion for non-string chunks is safe; error path covers any throw.
3. V1 scope gaps (base64, PEM, lower-case env dump) acknowledged in module header.

## AC Coverage

| AC | Status |
|----|--------|
| OPENAI_API_KEY argv form masked | passing test |
| ANTHROPIC_API_KEY, FOO_TOKEN, BAR_KEY masked | passing tests |
| Provider wrapping ordered before construction | addressed by synchronous pure-function design (S2 owns provider wiring) |
| No sidecar-compatible redaction span claims | confirmed — no span emission in module |
| No fake secret literals in fixtures | confirmed — all test values use synthetic values |
| Authorization: Bearer form masked (case-insensitive) | passing tests |
| JSON api_key/openai_api_key form masked | passing tests |
| Wrapper installable before sandcastle import | passing test (no-side-effects-on-import) |
| Non-string chunk → [REDACTION_ERROR], no propagation | passing tests |
