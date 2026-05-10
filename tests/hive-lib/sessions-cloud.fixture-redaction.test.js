/**
 * Redaction guard for committed sessions-cloud fixture bytes.
 *
 * Run: node tests/hive-lib/sessions-cloud.fixture-redaction.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'sessions-cloud');
const RECORDING_PATH = path.join(FIXTURE_DIR, 'session-recording.ndjson');
const PROTECTED_PATTERNS = [
  { label: 'Bearer', regex: /\bBearer\s+[A-Za-z0-9._-]+\b/ },
  { label: 'sk-', regex: /\bsk-[A-Za-z0-9_-]+\b/ },
  { label: 'agent_', regex: /\bagent_[A-Za-z0-9_-]+\b/ },
  { label: 'env_', regex: /\benv_[A-Za-z0-9_-]+\b/ },
  { label: 'Authorization', regex: /Authorization/i },
  { label: 'x-api-key', regex: /x-api-key/i },
  { label: 'x-request-id', regex: /x-request-id/i },
  { label: 'environment_id', regex: /environment_id/i },
  { label: 'account_id', regex: /account_id/i },
  { label: 'response.id', regex: /response\.id/i },
];
const FREE_TEXT_KEYS = new Set(['text', 'body', 'message', 'result', 'response_body']);

function walkFiles(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.name === 'README.md') continue;
    output.push(fullPath);
  }
  return output;
}

function findFreeText(value, keyPath = '$') {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    const key = keyPath.split('.').pop();
    if (FREE_TEXT_KEYS.has(key)) return keyPath;
    return null;
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const hit = findFreeText(value[index], `${keyPath}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value)) {
    const hit = findFreeText(nested, `${keyPath}.${key}`);
    if (hit) return hit;
  }
  return null;
}

test('committed sessions-cloud fixture bytes are redacted', (t) => {
  if (!fs.existsSync(RECORDING_PATH)) {
    t.skip('pre-condition: maintainer-fixture-absent');
    return;
  }

  const files = walkFiles(FIXTURE_DIR);
  assert.ok(files.length > 0, 'fixture directory must contain committed sessions-cloud bytes');

  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath, 'utf8');
    for (const pattern of PROTECTED_PATTERNS) {
      assert.doesNotMatch(
        bytes,
        pattern.regex,
        `protected token-shape ${pattern.label} found in fixture bytes: ${path.relative(FIXTURE_DIR, filePath)}`,
      );
    }

    if (filePath === RECORDING_PATH) {
      const lines = bytes.split(/\r?\n/).filter(Boolean);
      for (let index = 1; index < lines.length; index++) {
        const record = JSON.parse(lines[index]);
        const freeTextPath = findFreeText(record);
        assert.equal(
          freeTextPath,
          null,
          `free-text response body found at ${freeTextPath} in ${path.relative(FIXTURE_DIR, filePath)} line ${index + 1}`,
        );
      }
    }
  }
});
