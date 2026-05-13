# Security Review — s1-redaction-wrapper

**Story:** s1-redaction-wrapper (sandcastle-adoption-followon)
**Reviewer persona:** security-reviewer
**Date:** 2026-05-12
**Files reviewed:**
- `hive/lib/sandcastle-log-redaction.js`
- `tests/hive-lib/sandcastle-log-redaction.test.js`

---

## Security Review Verdict: passed

---

## Findings

### Critical

None.

### Informational

- **[secrets]** `hive/lib/sandcastle-log-redaction.js:36` — `RE_ARGV` uses `/g` flag on a module-level regex constant. In Node.js, stateful `/g` regexes called via `.replace()` reset `lastIndex` implicitly, so this is safe for the `.replace()` call pattern used here. However, if a future caller uses `.exec()` or `.test()` on these exported-internal constants, `lastIndex` stickiness could cause skipped matches. The constants are not exported, so the risk is confined to this module.
  **Suggestion:** No immediate action required. If regex constants are ever refactored to be reused with `.exec()`/`.test()`, convert to factory functions returning a fresh regex per call.

- **[input-validation]** `hive/lib/sandcastle-log-redaction.js:65` — `String(line)` coercion can produce `"[object Object]"` for arbitrary objects, which is safe for the redaction use case (no secret material would survive coercion to that string). The error-path in `wrapSandcastleLogger` also catches any throw, so the surface is fully bounded.
  **Suggestion:** Already handled by the error path. Informational only.

- **[secrets]** `hive/lib/sandcastle-log-redaction.js` (V1 scope gap) — Three out-of-scope patterns are acknowledged in the module header but not caught: base64-encoded secrets, multiline PEM blobs, and `printenv`-style `KEY=VALUE` dump output (lower-case keys). These are pre-acknowledged gaps. They do not represent a regression over the baseline (no redaction at all), and the module comment correctly documents them.
  **Suggestion:** Track in S5 adoption guide as V1 known gaps. Consider adding a `RE_LOWER_ARGV` in V2 for `key=value` lower-case forms if Sandcastle debug output evolves.

- **[secrets]** `tests/hive-lib/sandcastle-log-redaction.test.js` — Test fixtures use synthetic fake secrets (`sk-test`, `sk-test-1234`, `tok-abc123`, etc.). No real API key material is present. The `doesNotMatch` assertions confirm values do not survive redaction.
  **Suggestion:** Well done. Fake-value-only fixture discipline should be maintained in all future redaction tests.

---

## Summary

The module is a pure string-transformation utility with no I/O, no external dependencies, no user-controlled input paths, and no secret material in source. The three-form regex coverage (argv, bearer, JSON) closes the known Sandcastle log-leak vectors identified in the spike. The error-path in `wrapSandcastleLogger` prevents any redaction failure from propagating as an exception into provider construction. No critical findings. The V1 scope gaps (base64, PEM, lower-case env dump) are acknowledged in the module header and do not block integration.
