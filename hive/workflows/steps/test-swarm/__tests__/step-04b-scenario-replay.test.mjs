/**
 * Tests for step-04b-scenario-replay contract.
 *
 * Story: t-1b-step-04b-and-rip-simulated-manual
 *
 * Coverage:
 *   (a) loadResults invocation with valid worker output — returns structured object
 *   (b) loadResults throws FILE_NOT_FOUND when results.yaml is missing
 *   (c) output shape that step-04b emits for validate-coverage consumption
 *   (d) workflow YAML DAG: scenario-replay exists with depends_on: [execute-platform-a]
 *   (e) workflow YAML DAG: validate-coverage depends_on scenario-replay (not execute-platform-a directly)
 *
 * Convention: node:test + node:assert/strict, __tests__ sibling dir
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadResults } from '../../../../lib/scenarios/load.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'hive-step04b-'));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function writeResults(dir, content) {
  const filePath = join(dir, 'results.yaml');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** Canonical minimal results fixture matching step-03-worker output schema */
const ALL_PASS_RESULTS_YAML = `
execution_results:
  story_id: t-1b-step-04b-and-rip-simulated-manual
  epic_id: substrate-coverage-and-test-cleanup
  executed_at: "2026-06-07T10:00:00Z"
  platform: "darwin"
  device: "macOS-arm64"
  results:
    - test_id: "tc-001"
      requirement_ref: "AC-1"
      status: pass
      duration_ms: 120
      started_at: "2026-06-07T10:00:00.000Z"
      finished_at: "2026-06-07T10:00:00.120Z"
    - test_id: "tc-002"
      requirement_ref: "AC-2"
      status: pass
      duration_ms: 88
      started_at: "2026-06-07T10:00:00.130Z"
      finished_at: "2026-06-07T10:00:00.218Z"
  summary:
    total: 2
    passed: 2
    failed: 0
    skipped: 0
    total_duration_ms: 208
  artifacts:
    screenshots_dir: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1b/screenshots"
    logs_dir: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1b/logs"
    results_file: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1b/results.yaml"
`;

/** Results fixture with one failing test — exercises partial_pass path */
const PARTIAL_PASS_RESULTS_YAML = `
execution_results:
  story_id: t-1b-step-04b-and-rip-simulated-manual
  epic_id: substrate-coverage-and-test-cleanup
  executed_at: "2026-06-07T10:00:00Z"
  platform: "darwin"
  device: "macOS-arm64"
  results:
    - test_id: "tc-001"
      requirement_ref: "AC-1"
      status: pass
      duration_ms: 120
      started_at: "2026-06-07T10:00:00.000Z"
      finished_at: "2026-06-07T10:00:00.120Z"
    - test_id: "tc-002"
      requirement_ref: "AC-2"
      status: fail
      duration_ms: 55
      started_at: "2026-06-07T10:00:00.130Z"
      finished_at: "2026-06-07T10:00:00.185Z"
      error: "Expected element to be visible, got hidden"
  summary:
    total: 2
    passed: 1
    failed: 1
    skipped: 0
    total_duration_ms: 175
  artifacts:
    screenshots_dir: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1b/screenshots"
    logs_dir: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1b/logs"
    results_file: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1b/results.yaml"
`;

// ─── (a) loadResults invocation with valid worker output ──────────────────────

test('step-04b: loadResults returns execution_results envelope for valid all-pass output', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, ALL_PASS_RESULTS_YAML);
    const doc = loadResults(filePath);

    assert.ok(doc && typeof doc === 'object', 'loadResults must return an object');
    assert.ok('execution_results' in doc, 'top-level key must be execution_results');

    const er = doc.execution_results;
    assert.equal(er.story_id, 't-1b-step-04b-and-rip-simulated-manual');
    assert.equal(er.epic_id, 'substrate-coverage-and-test-cleanup');
    assert.equal(er.platform, 'darwin');
    assert.equal(er.device, 'macOS-arm64');
    assert.equal(typeof er.executed_at, 'string', 'executed_at must be a string');
  } finally {
    cleanup(dir);
  }
});

test('step-04b: loadResults results array has correct item shape for all-pass fixture', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, ALL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    assert.ok(Array.isArray(er.results), 'results must be an array');
    assert.equal(er.results.length, 2, 'fixture has 2 results');

    const item = er.results[0];
    assert.equal(item.test_id, 'tc-001');
    assert.equal(item.requirement_ref, 'AC-1');
    assert.equal(item.status, 'pass');
    assert.equal(item.duration_ms, 120);
  } finally {
    cleanup(dir);
  }
});

test('step-04b: loadResults summary reflects correct pass counts for all-pass fixture', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, ALL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    // This is the data that step-04b uses to compute replay_status
    assert.equal(er.summary.total, 2);
    assert.equal(er.summary.passed, 2);
    assert.equal(er.summary.failed, 0);
    assert.equal(er.summary.skipped, 0);
    assert.equal(er.summary.total_duration_ms, 208);
  } finally {
    cleanup(dir);
  }
});

test('step-04b: loadResults parses partial_pass fixture with failing result', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, PARTIAL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    assert.equal(er.summary.passed, 1);
    assert.equal(er.summary.failed, 1);

    const failedItem = er.results.find((r) => r.status === 'fail');
    assert.ok(failedItem, 'must have a failing result item');
    assert.equal(failedItem.test_id, 'tc-002');
    assert.equal(typeof failedItem.error, 'string', 'error field must be a string for failed tests');
  } finally {
    cleanup(dir);
  }
});

// ─── (b) Missing results.yaml — step-04b gating behavior ─────────────────────

test('step-04b: loadResults throws FILE_NOT_FOUND when results.yaml is absent', () => {
  const missingPath = '/nonexistent/path/results.yaml';

  assert.throws(
    () => loadResults(missingPath),
    (err) => {
      assert.equal(err.code, 'FILE_NOT_FOUND', 'error code must be FILE_NOT_FOUND');
      assert.ok(err.message.includes('Cannot read results file'), 'message must describe the failure');
      assert.equal(err.filePath, missingPath, 'error.filePath must match the requested path');
      return true;
    },
  );
});

test('step-04b: loadResults throws FILE_NOT_FOUND for an empty-string path', () => {
  assert.throws(
    () => loadResults(''),
    (err) => {
      assert.equal(err.code, 'FILE_NOT_FOUND', 'error code must be FILE_NOT_FOUND');
      assert.ok(err.message.includes('Cannot read results file'), 'message must describe the failure');
      return true;
    },
  );
});

// ─── (c) Output shape consumed by validate-coverage ──────────────────────────
//
// step-04b emits a replay_summary struct. The fields below are what
// validate-coverage (step-04-inspector) reads per the step-04b CONTRACT section.

test('step-04b: artifacts shape from loadResults matches replay_summary.artifacts contract', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, ALL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    // validate-coverage reads artifacts.screenshots_dir and artifacts.results_file
    assert.ok(typeof er.artifacts.screenshots_dir === 'string' && er.artifacts.screenshots_dir.length > 0,
      'artifacts.screenshots_dir must be a non-empty string');
    assert.ok(typeof er.artifacts.logs_dir === 'string' && er.artifacts.logs_dir.length > 0,
      'artifacts.logs_dir must be a non-empty string');
    assert.ok(typeof er.artifacts.results_file === 'string' && er.artifacts.results_file.length > 0,
      'artifacts.results_file must be a non-empty string');
  } finally {
    cleanup(dir);
  }
});

test('step-04b: replay_status all_pass condition — summary.failed == 0', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, ALL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    // This is the logic step-04b uses to derive replay_status: all_pass
    const replayStatus = er.summary.failed === 0 ? 'all_pass'
      : er.summary.failed > 0 && er.summary.passed > 0 ? 'partial_pass'
      : er.summary.failed > 0 && er.summary.passed === 0 ? 'all_fail'
      : er.summary.total === er.summary.skipped ? 'all_skipped'
      : 'unknown';

    assert.equal(replayStatus, 'all_pass',
      'fixture with failed=0 must yield replay_status: all_pass');
  } finally {
    cleanup(dir);
  }
});

test('step-04b: replay_status partial_pass condition — failed > 0 and passed > 0', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, PARTIAL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    const replayStatus = er.summary.failed === 0 ? 'all_pass'
      : er.summary.failed > 0 && er.summary.passed > 0 ? 'partial_pass'
      : er.summary.failed > 0 && er.summary.passed === 0 ? 'all_fail'
      : er.summary.total === er.summary.skipped ? 'all_skipped'
      : 'unknown';

    assert.equal(replayStatus, 'partial_pass',
      'fixture with failed=1 and passed=1 must yield replay_status: partial_pass');
  } finally {
    cleanup(dir);
  }
});

test('step-04b: failed_test_ids derived from results with status==fail', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, PARTIAL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    // This is how step-04b computes failed_test_ids for file-bugs (step-05-sentinel)
    const failedTestIds = er.results
      .filter((r) => r.status === 'fail')
      .map((r) => r.test_id);

    assert.deepEqual(failedTestIds, ['tc-002'],
      'failed_test_ids must list exactly the failed test IDs');
  } finally {
    cleanup(dir);
  }
});

test('step-04b: failed_test_ids is empty list when replay_status is all_pass', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, ALL_PASS_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    const failedTestIds = er.results
      .filter((r) => r.status === 'fail')
      .map((r) => r.test_id);

    assert.deepEqual(failedTestIds, [],
      'failed_test_ids must be empty when all tests pass');
  } finally {
    cleanup(dir);
  }
});

// ─── (d) Workflow YAML DAG: scenario-replay step exists with correct depends_on ─

test('workflow DAG: scenario-replay step exists in test-swarm.workflow.yaml', () => {
  const workflowPath = resolve('hive/workflows/test-swarm.workflow.yaml');
  const raw = readFileSync(workflowPath, 'utf8');

  const hasStep = /^\s*-\s+id:\s+scenario-replay\s*$/m.test(raw);
  assert.ok(hasStep, 'scenario-replay step must exist in test-swarm.workflow.yaml');
});

test('workflow DAG: scenario-replay.depends_on contains execute-platform-a', () => {
  const workflowPath = resolve('hive/workflows/test-swarm.workflow.yaml');
  const raw = readFileSync(workflowPath, 'utf8');
  const lines = raw.split('\n');

  let inScenarioReplay = false;
  let inDependsOn = false;
  const dependsOnValues = [];
  let foundStep = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*-\s+id:\s+scenario-replay\s*$/.test(line)) {
      inScenarioReplay = true;
      inDependsOn = false;
      dependsOnValues.length = 0;
      foundStep = true;
      continue;
    }

    if (inScenarioReplay) {
      // Hit a new step — stop
      if (/^\s*-\s+id:/.test(line) && !/scenario-replay/.test(line)) break;
      if (/^\s+depends_on:/.test(line)) {
        inDependsOn = true;
        continue;
      }
      if (inDependsOn) {
        const itemMatch = line.match(/^\s*-\s+(.+)/);
        if (itemMatch) {
          dependsOnValues.push(itemMatch[1].trim());
        } else if (!/^\s*$/.test(line) && !/^\s*#/.test(line)) {
          if (/^\s{0,8}[a-z]/.test(line)) inDependsOn = false;
        }
      }
    }
  }

  assert.ok(foundStep, 'scenario-replay step must be found');
  assert.ok(
    dependsOnValues.includes('execute-platform-a'),
    `scenario-replay.depends_on must include execute-platform-a; got: [${dependsOnValues.join(', ')}]`,
  );
});

test('workflow DAG: scenario-replay step_file points to step-04b-scenario-replay.md', () => {
  const workflowPath = resolve('hive/workflows/test-swarm.workflow.yaml');
  const raw = readFileSync(workflowPath, 'utf8');

  assert.ok(
    raw.includes('step-04b-scenario-replay.md'),
    'scenario-replay step must reference step_file: step-04b-scenario-replay.md',
  );
});

// ─── (e) validate-coverage depends_on scenario-replay (not execute-platform-a directly) ─

test('workflow DAG: validate-coverage depends_on scenario-replay', () => {
  const workflowPath = resolve('hive/workflows/test-swarm.workflow.yaml');
  const raw = readFileSync(workflowPath, 'utf8');
  const lines = raw.split('\n');

  let inValidateCoverage = false;
  let inDependsOn = false;
  const dependsOnValues = [];
  let foundStep = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*-\s+id:\s+validate-coverage\s*$/.test(line)) {
      inValidateCoverage = true;
      inDependsOn = false;
      dependsOnValues.length = 0;
      foundStep = true;
      continue;
    }

    if (inValidateCoverage) {
      if (/^\s*-\s+id:/.test(line) && !/validate-coverage/.test(line)) break;
      if (/^\s+depends_on:/.test(line)) {
        inDependsOn = true;
        continue;
      }
      if (inDependsOn) {
        const itemMatch = line.match(/^\s*-\s+(.+)/);
        if (itemMatch) {
          dependsOnValues.push(itemMatch[1].trim());
        } else if (!/^\s*$/.test(line) && !/^\s*#/.test(line)) {
          if (/^\s{0,8}[a-z]/.test(line)) inDependsOn = false;
        }
      }
    }
  }

  assert.ok(foundStep, 'validate-coverage step must exist in test-swarm.workflow.yaml');
  assert.ok(
    dependsOnValues.includes('scenario-replay'),
    `validate-coverage.depends_on must contain scenario-replay; got: [${dependsOnValues.join(', ')}]`,
  );
});

test('workflow DAG: validate-coverage does NOT directly depend on execute-platform-a', () => {
  const workflowPath = resolve('hive/workflows/test-swarm.workflow.yaml');
  const raw = readFileSync(workflowPath, 'utf8');
  const lines = raw.split('\n');

  let inValidateCoverage = false;
  let inDependsOn = false;
  const dependsOnValues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*-\s+id:\s+validate-coverage\s*$/.test(line)) {
      inValidateCoverage = true;
      inDependsOn = false;
      dependsOnValues.length = 0;
      continue;
    }

    if (inValidateCoverage) {
      if (/^\s*-\s+id:/.test(line) && !/validate-coverage/.test(line)) break;
      if (/^\s+depends_on:/.test(line)) {
        inDependsOn = true;
        continue;
      }
      if (inDependsOn) {
        const itemMatch = line.match(/^\s*-\s+(.+)/);
        if (itemMatch) {
          dependsOnValues.push(itemMatch[1].trim());
        } else if (!/^\s*$/.test(line) && !/^\s*#/.test(line)) {
          if (/^\s{0,8}[a-z]/.test(line)) inDependsOn = false;
        }
      }
    }
  }

  assert.ok(
    !dependsOnValues.includes('execute-platform-a'),
    `validate-coverage must NOT directly depend on execute-platform-a after t-1b; got: [${dependsOnValues.join(', ')}]`,
  );
});
