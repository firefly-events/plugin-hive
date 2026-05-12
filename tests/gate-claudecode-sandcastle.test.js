'use strict';

/**
 * Tests for gate-claudecode-sandcastle audit gate
 *
 * Story: s6-issue-191-defer-marker (sandcastle-adoption-followon)
 * Run:   node tests/gate-claudecode-sandcastle.test.js
 *
 * Covers:
 *   AC-1  Blocked fixture: imports sandcastle + calls claudeCode() → gate FAILS
 *   AC-2  Allowed fixture: imports sandcastle + calls codex() → gate PASSES
 *   AC-3  Null fixture: does not touch sandcastle → gate PASSES
 *   AC-4  Codex-path is not blocked even when sandcastle is imported
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GATE_SCRIPT = path.resolve(__dirname, '../hive/scripts/gate-claudecode-sandcastle.mjs');

/**
 * Write fixture files to a temp dir, run the gate against it, return exit code.
 * @param {Record<string, string>} files  filename → content
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
function runGate(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-sc-191-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(process.execPath, [GATE_SCRIPT, '--root', dir], {
        encoding: 'utf8',
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
    }
    return { exitCode, stdout, stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * BLOCKED: imports sandcastle AND calls claudeCode()
 * This is the pattern forbidden by issue #191 watch.
 */
const FIXTURE_BLOCKED = `
import { createSandbox } from 'sandcastle';

async function run() {
  const sb = await createSandbox({ provider: claudeCode({ model: 'claude-opus-4-5' }) });
  await sb.execute('console.log("hello")');
}
`;

/**
 * ALLOWED (Codex path): imports sandcastle AND calls codex()
 * Codex-path Sandcastle wiring must NOT be blocked.
 */
const FIXTURE_ALLOWED_CODEX = `
import { createSandbox } from 'sandcastle';

async function run() {
  const sb = await createSandbox({ provider: codex({ model: 'o3' }) });
  await sb.execute('console.log("hello from codex path")');
}
`;

/**
 * NULL: does not touch sandcastle at all — must pass.
 */
const FIXTURE_NULL = `
import { something } from 'some-other-lib';

function doWork() {
  return claudeCode({ model: 'claude-opus-4-5' });
}
`;

/**
 * REQUIRE-style blocked variant (CommonJS import + claudeCode call)
 */
const FIXTURE_BLOCKED_REQUIRE = `
const { createSandbox } = require('sandcastle');

async function run() {
  const sb = await createSandbox({ provider: claudeCode({ model: 'claude-opus-4-5' }) });
}
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('AC-1: blocked fixture (sandcastle import + claudeCode call) → gate fails (exit 1)', () => {
  const result = runGate({ 'blocked.mjs': FIXTURE_BLOCKED });
  assert.equal(result.exitCode, 1, 'gate must exit non-zero for blocked fixture');
  assert.ok(
    result.stderr.includes('FAIL'),
    `stderr should contain FAIL, got: ${result.stderr}`
  );
  assert.ok(
    result.stderr.includes('#191'),
    `stderr should mention issue #191, got: ${result.stderr}`
  );
});

test('AC-2: allowed fixture (sandcastle import + codex call) → gate passes (exit 0)', () => {
  const result = runGate({ 'allowed.mjs': FIXTURE_ALLOWED_CODEX });
  assert.equal(result.exitCode, 0, 'Codex-path Sandcastle must not be blocked');
  assert.ok(
    result.stdout.includes('PASS'),
    `stdout should contain PASS, got: ${result.stdout}`
  );
});

test('AC-3: null fixture (no sandcastle import) → gate passes (exit 0)', () => {
  const result = runGate({ 'no-sandcastle.js': FIXTURE_NULL });
  assert.equal(result.exitCode, 0, 'file without sandcastle import must not be flagged');
  assert.ok(result.stdout.includes('PASS'));
});

test('AC-4: Codex-path not blocked even alongside null file', () => {
  const result = runGate({
    'allowed.mjs': FIXTURE_ALLOWED_CODEX,
    'other.js': FIXTURE_NULL,
  });
  assert.equal(result.exitCode, 0, 'Codex-path + unrelated file must pass together');
});

test('AC-1b: require-style blocked fixture → gate fails', () => {
  const result = runGate({ 'blocked-cjs.js': FIXTURE_BLOCKED_REQUIRE });
  assert.equal(result.exitCode, 1, 'CJS require-style blocked fixture must fail');
  assert.ok(result.stderr.includes('FAIL'));
});

test('AC-1c: mixed dir — one blocked file causes overall gate failure', () => {
  const result = runGate({
    'allowed.mjs': FIXTURE_ALLOWED_CODEX,
    'blocked.mjs': FIXTURE_BLOCKED,
    'other.js': FIXTURE_NULL,
  });
  assert.equal(result.exitCode, 1, 'single blocked file in mixed dir must fail overall');
});

test('AC-2b: empty dir → gate passes', () => {
  const result = runGate({});
  assert.equal(result.exitCode, 0, 'empty directory must pass');
});
