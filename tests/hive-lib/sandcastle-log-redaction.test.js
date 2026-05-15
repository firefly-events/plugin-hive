'use strict';

/**
 * Tests for hive/lib/sandcastle-log-redaction.js
 *
 * Story: s1-redaction-wrapper (sandcastle-adoption-followon)
 * Run:   node tests/hive-lib/sandcastle-log-redaction.test.js
 *
 * Covers all ACs:
 *  1. Argv form  — OPENAI_API_KEY, ANTHROPIC_API_KEY, *_TOKEN, *_KEY
 *  2. Bearer header form — Authorization: Bearer <value> (case-insensitive)
 *  3. JSON key-value form — "api_key": "val", "openai_api_key": "val", camelCase
 *  4. Error path — non-string chunk → [REDACTION_ERROR], no throw
 *  5. Wrapped logger — multi-chunk; each chunk emitted redacted
 *  6. Before-first-import guarantee — module is pure synchronous, no side effects
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_PATH = path.join(ROOT, 'hive', 'lib', 'sandcastle-log-redaction.js');

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

// ---------------------------------------------------------------------------
// AC 1 — Argv / env-assignment form
// ---------------------------------------------------------------------------

test('argv form — OPENAI_API_KEY value is masked, variable name preserved', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('podman run -e OPENAI_API_KEY=sk-test-1234');
  assert.match(result, /OPENAI_API_KEY=\[REDACTED\]/);
  assert.doesNotMatch(result, /sk-test-1234/);
});

test('argv form — ANTHROPIC_API_KEY value is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('-e ANTHROPIC_API_KEY=ant-secret-xyz');
  assert.match(result, /ANTHROPIC_API_KEY=\[REDACTED\]/);
  assert.doesNotMatch(result, /ant-secret-xyz/);
});

test('argv form — wildcard *_TOKEN value is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('env FOO_TOKEN=tok-abc123 bar');
  assert.match(result, /FOO_TOKEN=\[REDACTED\]/);
  assert.doesNotMatch(result, /tok-abc123/);
});

test('argv form — wildcard *_KEY value is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('BAR_KEY=some-secret-key run');
  assert.match(result, /BAR_KEY=\[REDACTED\]/);
  assert.doesNotMatch(result, /some-secret-key/);
});

test('argv form — multiple secrets in same line, all masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine(
    'podman run -e OPENAI_API_KEY=sk-abc -e FOO_TOKEN=tok-xyz image'
  );
  assert.match(result, /OPENAI_API_KEY=\[REDACTED\]/);
  assert.match(result, /FOO_TOKEN=\[REDACTED\]/);
  assert.doesNotMatch(result, /sk-abc/);
  assert.doesNotMatch(result, /tok-xyz/);
});

test('argv form — non-secret env var is NOT masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('NODE_ENV=production');
  assert.equal(result, 'NODE_ENV=production');
});

// ---------------------------------------------------------------------------
// AC 2 — Bearer header form
// ---------------------------------------------------------------------------

test('bearer form — Authorization: Bearer value masked, header name preserved', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('Authorization: Bearer sk-test-bearer-value');
  assert.match(result, /Authorization: Bearer \[REDACTED\]/);
  assert.doesNotMatch(result, /sk-test-bearer-value/);
});

test('bearer form — case-insensitive Authorization header matched', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('authorization: bearer my-secret-token-99');
  // Case-insensitive: header name case is preserved from input
  assert.doesNotMatch(result, /my-secret-token-99/);
  assert.match(result, /\[REDACTED\]/);
});

test('bearer form — mixed-case Authorization: BEARER matched', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('AUTHORIZATION: BEARER secret-val');
  assert.doesNotMatch(result, /secret-val/);
  assert.match(result, /\[REDACTED\]/);
});

// ---------------------------------------------------------------------------
// AC 3 — JSON key-value form
// ---------------------------------------------------------------------------

test('json form — "api_key": "value" masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('"api_key": "sk-json-test"');
  assert.match(result, /"api_key": "\[REDACTED\]"/);
  assert.doesNotMatch(result, /sk-json-test/);
});

test('json form — "openai_api_key": "value" masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('"openai_api_key": "sk-openai-123"');
  assert.match(result, /"openai_api_key": "\[REDACTED\]"/);
  assert.doesNotMatch(result, /sk-openai-123/);
});

test('json form — key ending in _KEY masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('"SOME_API_KEY": "value-abc"');
  assert.doesNotMatch(result, /value-abc/);
  assert.match(result, /\[REDACTED\]/);
});

test('json form — key ending in _TOKEN masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('"ACCESS_TOKEN": "tok-12345"');
  assert.doesNotMatch(result, /tok-12345/);
  assert.match(result, /\[REDACTED\]/);
});

test('json form — apiKey camelCase masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('"apiKey": "camel-secret-value"');
  assert.doesNotMatch(result, /camel-secret-value/);
  assert.match(result, /\[REDACTED\]/);
});

test('json form — non-secret key is NOT masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('"name": "my-project"');
  assert.equal(result, '"name": "my-project"');
});

// ---------------------------------------------------------------------------
// AC 4 — Error path: non-string chunk
// ---------------------------------------------------------------------------

test('error path — Buffer chunk returns [REDACTION_ERROR], does not throw', () => {
  const { redactSandcastleLogLine } = loadModule();
  // Simulate a pathological input: override String() indirectly via object
  // with a toString that throws.
  const badChunk = {
    toString() { throw new Error('toString exploded'); }
  };
  // redactSandcastleLogLine calls String(line) — for a Buffer or normal object
  // this works fine and returns a string. But wrapSandcastleLogger must catch
  // throws inside redactSandcastleLogLine. Test both:
  // a) pure call on a normal non-string: Buffer coerces via String(), no throw.
  const bufResult = redactSandcastleLogLine(Buffer.from('OPENAI_API_KEY=sk-test'));
  assert.match(bufResult, /OPENAI_API_KEY=\[REDACTED\]/);

  // b) wrapSandcastleLogger catches exceptions from redact and emits placeholder.
  const { wrapSandcastleLogger } = loadModule();
  const collected = [];
  const wrapped = wrapSandcastleLogger((msg) => collected.push(msg));
  // Should not throw
  assert.doesNotThrow(() => wrapped(badChunk));
  assert.equal(collected.length, 1);
  assert.equal(collected[0], '[REDACTION_ERROR]');
});

test('error path — undefined chunk does not throw, returns string', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine(undefined);
  assert.equal(typeof result, 'string');
  assert.equal(result, 'undefined');
});

test('error path — null chunk does not throw, returns string', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine(null);
  assert.equal(typeof result, 'string');
  assert.equal(result, 'null');
});

// ---------------------------------------------------------------------------
// AC 5 — wrapSandcastleLogger: multi-chunk, all redacted
// ---------------------------------------------------------------------------

test('wrapSandcastleLogger — all forwarded chunks are redacted', () => {
  const { wrapSandcastleLogger } = loadModule();
  const received = [];
  const baseLogger = (msg) => received.push(msg);
  const wrapped = wrapSandcastleLogger(baseLogger);

  wrapped('plain log line');
  wrapped('podman run -e OPENAI_API_KEY=sk-multi-1');
  wrapped('Authorization: Bearer tok-multi-2');
  wrapped('"api_key": "json-secret-3"');

  assert.equal(received.length, 4);
  assert.equal(received[0], 'plain log line');
  assert.match(received[1], /OPENAI_API_KEY=\[REDACTED\]/);
  assert.doesNotMatch(received[1], /sk-multi-1/);
  assert.match(received[2], /\[REDACTED\]/);
  assert.doesNotMatch(received[2], /tok-multi-2/);
  assert.match(received[3], /\[REDACTED\]/);
  assert.doesNotMatch(received[3], /json-secret-3/);
});

test('wrapSandcastleLogger — exception in redact is swallowed, placeholder emitted', () => {
  const { wrapSandcastleLogger } = loadModule();
  const received = [];
  const wrapped = wrapSandcastleLogger((msg) => received.push(msg));
  const throwingChunk = { toString() { throw new Error('boom'); } };
  assert.doesNotThrow(() => wrapped(throwingChunk));
  assert.equal(received[0], '[REDACTION_ERROR]');
});

// ---------------------------------------------------------------------------
// AC 6 — Before-first-import guarantee (unit-level)
// ---------------------------------------------------------------------------

test('module is pure synchronous — require() has no side effects on process.stdout/stderr', () => {
  // Capture stdout/stderr write calls during require
  const stdoutWrites = [];
  const stderrWrites = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (...args) => { stdoutWrites.push(args[0]); return origOut(...args); };
  process.stderr.write = (...args) => { stderrWrites.push(args[0]); return origErr(...args); };

  try {
    // Re-require the module fresh
    delete require.cache[require.resolve(MODULE_PATH)];
    require(MODULE_PATH);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }

  assert.equal(stdoutWrites.length, 0, 'Module must not write to stdout on import');
  assert.equal(stderrWrites.length, 0, 'Module must not write to stderr on import');
});

test('module exports are synchronous functions — installable before any require', () => {
  // This validates the wrapper is a synchronous pure function reference
  // that can be assigned before @ai-hero/sandcastle is loaded.
  const mod = loadModule();
  assert.equal(typeof mod.redactSandcastleLogLine, 'function');
  assert.equal(typeof mod.wrapSandcastleLogger, 'function');
  // Calling wrapSandcastleLogger does not require sandcastle to be present
  const wrapped = mod.wrapSandcastleLogger((_msg) => {});
  assert.equal(typeof wrapped, 'function');
});

// ---------------------------------------------------------------------------
// AC 7 — Hyphenated header names (carried follow-on from s4 validation)
//
// Both forms are covered: JSON-serialised header dicts and bare HTTP
// header lines. The pre-fix regex used a `\b`-anchored underscore-only
// key pattern; hyphens broke word-boundary matching so X-API-KEY passed
// through unredacted. See cycle-state follow_ups for the carryover note.
// ---------------------------------------------------------------------------

test('JSON form — hyphenated header name "X-API-Key" is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('{"X-API-Key": "sk-test-leak"}');
  assert.doesNotMatch(result, /sk-test-leak/);
  assert.match(result, /"X-API-Key":\s*"\[REDACTED\]"/);
});

test('JSON form — hyphenated header name "X-Auth-Token" is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('{"X-Auth-Token": "bearer-leak-1"}');
  assert.doesNotMatch(result, /bearer-leak-1/);
  assert.match(result, /"X-Auth-Token":\s*"\[REDACTED\]"/);
});

test('JSON form — mixed-case hyphenated "Api-Key" is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('{"Api-Key": "leak-2"}');
  assert.doesNotMatch(result, /leak-2/);
  assert.match(result, /"Api-Key":\s*"\[REDACTED\]"/);
});

test('JSON form — underscore form still masked after regex widening', () => {
  // Regression guard: widening to accept hyphens must not break the
  // existing underscore-separated path.
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('{"openai_api_key": "underscore-leak"}');
  assert.doesNotMatch(result, /underscore-leak/);
  assert.match(result, /"openai_api_key":\s*"\[REDACTED\]"/);
});

test('Header-line form — "X-API-Key: <value>" is masked, header name preserved', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('X-API-Key: sk-test-headerleak');
  assert.doesNotMatch(result, /sk-test-headerleak/);
  assert.match(result, /^X-API-Key:\s*\[REDACTED\]$/);
});

test('Header-line form — "X-Auth-Token: <value>" is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('X-Auth-Token: leak-token-3');
  assert.doesNotMatch(result, /leak-token-3/);
  assert.match(result, /X-Auth-Token:\s*\[REDACTED\]/);
});

test('Header-line form — "X-Client-Secret: <value>" is masked', () => {
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('X-Client-Secret: hush-leak-4');
  assert.doesNotMatch(result, /hush-leak-4/);
  assert.match(result, /X-Client-Secret:\s*\[REDACTED\]/);
});

test('Header-line form — multi-line log preserves non-secret context', () => {
  const { redactSandcastleLogLine } = loadModule();
  const input = [
    'POST /v1/responses HTTP/1.1',
    'Host: api.openai.com',
    'X-API-Key: sk-leakable-5',
    'Content-Type: application/json',
  ].join('\n');
  const result = redactSandcastleLogLine(input);
  assert.doesNotMatch(result, /sk-leakable-5/);
  assert.match(result, /X-API-Key:\s*\[REDACTED\]/);
  // Non-secret lines must pass through unchanged.
  assert.match(result, /POST \/v1\/responses HTTP\/1\.1/);
  assert.match(result, /Host: api\.openai\.com/);
  assert.match(result, /Content-Type: application\/json/);
});

test('Header-line form — does NOT match Authorization: Bearer (handled by AC 2)', () => {
  // Regression guard: the Authorization-Bearer form has its own dedicated
  // regex that preserves the literal "Bearer " prefix. The header-line
  // form must not double-fire on this input or it would strip "Bearer ".
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('Authorization: Bearer sk-test-bearer-6');
  assert.doesNotMatch(result, /sk-test-bearer-6/);
  // The "Bearer " literal must survive — proves RE_BEARER fired, not RE_HEADER_LINE.
  assert.match(result, /Authorization:\s*Bearer\s+\[REDACTED\]/);
});

test('Header-line form — does NOT match generic non-secret headers (Content-Type, Host)', () => {
  // Negative coverage: avoid over-aggressive matching that would strip
  // unrelated headers. Only header names ending in -Key/-Token/-Secret
  // should be redacted.
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine([
    'Content-Type: application/json',
    'Host: api.example.com',
    'User-Agent: codex/0.129',
  ].join('\n'));
  assert.match(result, /Content-Type: application\/json/);
  assert.match(result, /Host: api\.example\.com/);
  assert.match(result, /User-Agent: codex\/0\.129/);
  assert.doesNotMatch(result, /\[REDACTED\]/);
});

test('Header-line form — does NOT match JSON-embedded hyphenated key (handled by RE_JSON_KV)', () => {
  // Regression guard: a JSON-embedded `"X-API-Key": "..."` must be caught
  // by the JSON form (preserves quotes) and NOT also captured by the
  // bare-header form, which would corrupt the JSON shape.
  const { redactSandcastleLogLine } = loadModule();
  const result = redactSandcastleLogLine('{"X-API-Key": "sk-test-7"}');
  assert.doesNotMatch(result, /sk-test-7/);
  // Quoted form preserved: "X-API-Key": "[REDACTED]"
  assert.match(result, /"X-API-Key":\s*"\[REDACTED\]"/);
  // The bare form would emit `X-API-Key: [REDACTED]"}` which destroys JSON
  // quotes. Assert that does NOT appear.
  assert.doesNotMatch(result, /X-API-Key:\s*\[REDACTED\]"/);
});
