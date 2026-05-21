'use strict';

/**
 * Sandcastle log-line redaction helpers.
 *
 * Masks secret values in text emitted by (or adjacent to) @ai-hero/sandcastle
 * before the text reaches stdout, stderr, or file logger sinks. This module is
 * pure-synchronous and stateless — it can be required and installed BEFORE any
 * `require('@ai-hero/sandcastle')` call so that sandcastle startup log lines are
 * already sanitised.
 *
 * Four redaction forms are covered:
 *
 *  1. Argv/env form     OPENAI_API_KEY=sk-test          → OPENAI_API_KEY=[REDACTED]
 *                       FOO_TOKEN=value                 → FOO_TOKEN=[REDACTED]
 *                       BAR_KEY=value                   → BAR_KEY=[REDACTED]
 *
 *  2. Bearer header     Authorization: Bearer sk-test   → Authorization: Bearer [REDACTED]
 *                       (case-insensitive Authorization)
 *
 *  3. JSON key-value    "api_key": "sk-test"            → "api_key": "[REDACTED]"
 *                       "openai_api_key": "sk-test"     → "openai_api_key": "[REDACTED]"
 *                       "SOME_TOKEN": "value"           → "SOME_TOKEN": "[REDACTED]"
 *                       "X-API-Key": "sk-test"          → "X-API-Key": "[REDACTED]"
 *                       "X-Auth-Token": "value"         → "X-Auth-Token": "[REDACTED]"
 *                       Matches any key whose name ends in _KEY/_TOKEN or
 *                       -KEY/-TOKEN (hyphen-separated HTTP-header style), or
 *                       is api_key / apiKey / openai_api_key style.
 *
 *  4. HTTP header line  X-API-Key: sk-test               → X-API-Key: [REDACTED]
 *                       Api-Key: secret                  → Api-Key: [REDACTED]
 *                       X-Auth-Token: value              → X-Auth-Token: [REDACTED]
 *                       Matches a header name ending in -Key, -Token, or
 *                       -Secret on its own line (case-insensitive). Avoids
 *                       matching the Authorization-Bearer form (handled by 2).
 *
 * Out of scope for V1: base64-encoded inline secrets, multiline PEM blobs,
 * printenv/env dump output. These gaps are documented in the S5 adoption guide.
 */

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

/** Form 1: VAR_NAME=value (argv / env assignment form) */
const RE_ARGV = /\b([A-Z0-9_]*(?:API_KEY|TOKEN|_KEY))=([^\s"'`]+)/gi;

/**
 * Form 2: Authorization: Bearer <token>
 * Case-insensitive on "Authorization" and "Bearer".
 */
const RE_BEARER = /(Authorization\s*:\s*Bearer\s+)([^\s"'`,\]}\n]+)/gi;

/**
 * Form 3: JSON "key": "value" where key is a secrets-looking name.
 *
 * Key-name pattern accepts either underscore-separated or hyphen-separated
 * tail: `_key|_token|_secret|-key|-token|-secret`. With the /i flag this also covers
 * `_Key`/`-Key`/`-KEY` etc. Matching keeps both separator forms so HTTP-
 * header-style names (X-API-Key, X-Auth-Token) emitted in JSON dumps are
 * caught alongside Python/JSON-snake-case names (api_key, openai_api_key).
 * Value must be a non-empty JSON string.
 */
const RE_JSON_KV =
  /("(?:[a-zA-Z0-9_-]*(?:[_-]key|[_-]token|[_-]secret)|api[_-]?(?:key|secret)|openai[_-]?api[_-]?(?:key|secret))")\s*:\s*"((?:\\.|[^"\\])*)"/gi;

/**
 * Form 4: Bare HTTP header line — `Header-Name: value`.
 *
 * Anchored to the start of a line (multiline flag) and only fires when the
 * header name ends in `-Key`, `-Token`, or `-Secret`. Generic enough to
 * cover X-API-Key / X-Auth-Token / Api-Key / X-Client-Secret without
 * matching arbitrary header lines. Skips matches that come from inside a
 * JSON string (preceded by `"`) — those go through RE_JSON_KV instead.
 */
const RE_HEADER_LINE =
  /(^|[\n\r])([ \t]*(?!["'])[a-zA-Z][a-zA-Z0-9-]*(?:-key|-token|-secret)\s*:\s*)(?:"([^"\\\n]+)"|([^\s"'`,\]}\n]+))/gim;

// ---------------------------------------------------------------------------
// Core redact function
// ---------------------------------------------------------------------------

/**
 * Redact secret values from a single log line string.
 *
 * @param {string} line — any stringifiable value; if the input cannot be
 *   coerced to a meaningful string (e.g. a raw Buffer, object, undefined)
 *   the function still succeeds by calling String(line) first.
 * @returns {string} — line with secret values replaced by [REDACTED]
 */
function redactSandcastleLogLine(line) {
  let s = String(line);
  // Apply all four forms in order; each uses /g so all occurrences are hit.
  // Order matters: RE_BEARER runs before RE_HEADER_LINE so Authorization:
  // Bearer never falls through to the generic header-line form (Bearer
  // tokens get the "Bearer " literal preserved, header-line form would
  // strip it).
  s = s.replace(RE_ARGV, '$1=[REDACTED]');
  s = s.replace(RE_BEARER, '$1[REDACTED]');
  s = s.replace(RE_JSON_KV, '$1: "[REDACTED]"');
  s = s.replace(RE_HEADER_LINE, (_m, p1, p2, quoted, _unquoted) =>
    p1 + p2 + (quoted !== undefined ? '"[REDACTED]"' : '[REDACTED]')
  );
  return s;
}

// ---------------------------------------------------------------------------
// Logger wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a Sandcastle-compatible logger function so that every chunk it receives
 * is redacted before being forwarded.
 *
 * Install this wrapper BEFORE requiring @ai-hero/sandcastle so that even
 * sandcastle's startup log lines are sanitised.
 *
 * Error path: if redactSandcastleLogLine throws for any reason (e.g. an exotic
 * chunk type that String() cannot handle), the wrapper catches the exception,
 * emits a safe `[REDACTION_ERROR]` placeholder to the underlying logger, and
 * returns — it never propagates the exception to the caller.
 *
 * @param {Function} logger — receives a string; e.g. (msg) => console.log(msg)
 * @returns {Function} — drop-in replacement that redacts before forwarding
 */
function wrapSandcastleLogger(logger) {
  return function redactingLogger(chunk) {
    let redacted;
    try {
      redacted = redactSandcastleLogLine(chunk);
    } catch (_err) {
      redacted = '[REDACTION_ERROR]';
    }
    logger(redacted);
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { redactSandcastleLogLine, wrapSandcastleLogger };
