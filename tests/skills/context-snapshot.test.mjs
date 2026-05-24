/**
 * Integration tests for skills/context-snapshot/run.mjs
 *
 * Covers all CLI flags and the unknown-flag failure path.
 * Run: node --test tests/skills/context-snapshot.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'skills', 'context-snapshot', 'run.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(args, env = {}) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// Build a minimal .pHive structure in a temp dir and return its path.
function buildMinimalFixture() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctx-skill-'));
  mkdirSync(path.join(tmp, '.git'), { recursive: true });
  writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(path.join(tmp, '.pHive'), { recursive: true });
  return tmp;
}

// Build fixture with one epic and one story.
function buildEpicFixture() {
  const tmp = buildMinimalFixture();
  mkdirSync(path.join(tmp, '.pHive', 'epics', 'my-epic', 'stories'), { recursive: true });
  writeFileSync(
    path.join(tmp, '.pHive', 'epics', 'my-epic', 'epic.yaml'),
    'id: my-epic\ntitle: My Epic\nmethodology: classic\n',
  );
  writeFileSync(
    path.join(tmp, '.pHive', 'epics', 'my-epic', 'stories', 's-01.yaml'),
    'id: s-01\nepic: my-epic\ntitle: "Story one"\nstatus: pending\ncomplexity: low\ndepends_on: []\nsteps:\n  - id: implement\n    description: Do it\n    agent: developer\n',
  );
  return tmp;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('--schema-version prints 1 and exits 0', () => {
  const result = run(['--schema-version']);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  assert.equal(result.stdout.trim(), '1');
});

test('unknown flag exits non-zero and prints usage', () => {
  const result = run(['--bogus-flag']);
  assert.notEqual(result.status, 0, 'expected non-zero exit for unknown flag');
  assert.ok(
    result.stderr.includes('unknown flag') || result.stderr.includes('Usage'),
    `expected usage in stderr, got: ${result.stderr}`,
  );
});

test('default invocation emits valid JSON with schema_version 1', { timeout: 90000 }, () => {
  const tmp = buildMinimalFixture();
  try {
    // Override REPO_ROOT by running a wrapper that sets stateDir to tmp.
    // We spawn the runner directly but override HOME to avoid reading real .pHive.
    // Since run.mjs uses REPO_ROOT derived from __dirname, we test against the real repo.
    // For isolation, test the composer output shape via the runner against real repo.
    const result = run([]);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.ok(parsed.generated_at, 'missing generated_at');
    assert.ok(Array.isArray(parsed.epics), 'epics not array');
    assert.ok(Array.isArray(parsed.stories), 'stories not array');
    assert.ok(Array.isArray(parsed.episodes_recent), 'episodes_recent not array');
    assert.ok(Array.isArray(parsed.triage_open), 'triage_open not array');
    assert.ok(Array.isArray(parsed.metrics_health), 'metrics_health not array');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--epic filter narrows epics array', () => {
  const result = run(['--epic', 'hermes-integration-mvp']);
  assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.epics.every(e => e.id === 'hermes-integration-mvp'),
    'epic filter leaked other epics',
  );
  assert.ok(
    parsed.stories.every(s => s.epic_id === 'hermes-integration-mvp'),
    'epic filter leaked other stories',
  );
});

test('--write persists byte-identical content to .pHive/context-snapshot.json', { timeout: 90000 }, () => {
  // Run --write against the real repo root; verify file is written.
  const outPath = path.join(REPO_ROOT, '.pHive', 'context-snapshot.json');
  // Clean up before test so we know the file was written by this run.
  try { rmSync(outPath, { force: true }); } catch { /* ok */ }

  try {
    const result = run(['--write']);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    assert.ok(existsSync(outPath), '.pHive/context-snapshot.json not created');
    const fileContent = readFileSync(outPath, 'utf8');
    assert.equal(fileContent, result.stdout, '--write content differs from stdout');
  } finally {
    try { rmSync(outPath, { force: true }); } catch { /* ok */ }
  }
});

test('--epic with --write filters and persists', { timeout: 90000 }, () => {
  const outPath = path.join(REPO_ROOT, '.pHive', 'context-snapshot.json');
  try { rmSync(outPath, { force: true }); } catch { /* ok */ }

  try {
    const result = run(['--epic', 'hermes-integration-mvp', '--write']);
    assert.equal(result.status, 0, `exit non-zero\nstderr: ${result.stderr}`);
    assert.ok(existsSync(outPath), '.pHive/context-snapshot.json not created');
    const parsed = JSON.parse(result.stdout);
    assert.ok(
      parsed.epics.every(e => e.id === 'hermes-integration-mvp'),
      'epic filter not applied',
    );
    const fileContent = readFileSync(outPath, 'utf8');
    assert.equal(fileContent, result.stdout, 'file content differs from stdout');
  } finally {
    try { rmSync(outPath, { force: true }); } catch { /* ok */ }
  }
});
