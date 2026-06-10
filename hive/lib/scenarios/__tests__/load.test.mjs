import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadScenario, loadResults } from '../load.mjs';

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'hive-scenario-load-'));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function writeScenario(dir, content) {
  const filePath = join(dir, 'scenario.yaml');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writeResults(dir, content) {
  const filePath = join(dir, 'results.yaml');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// Minimal valid execution_results fixture matching step-03-worker output schema
const VALID_RESULTS_YAML = `
execution_results:
  story_id: t-1a-scenario-loader-and-dag-retarget
  epic_id: substrate-coverage-and-test-cleanup
  executed_at: "2026-06-07T00:00:00Z"
  platform: "darwin"
  device: "macOS-arm64"
  results:
    - test_id: "tc-001"
      requirement_ref: "AC-1"
      status: pass
      duration_ms: 42
      started_at: "2026-06-07T00:00:00.000Z"
      finished_at: "2026-06-07T00:00:00.042Z"
  summary:
    total: 1
    passed: 1
    failed: 0
    skipped: 0
    total_duration_ms: 42
  artifacts:
    screenshots_dir: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1a-scenario-loader-and-dag-retarget/screenshots"
    logs_dir: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1a-scenario-loader-and-dag-retarget/logs"
    results_file: ".pHive/test-artifacts/substrate-coverage-and-test-cleanup/t-1a-scenario-loader-and-dag-retarget/results.yaml"
`;

test('accepts the canonical mode/steps scenario shape', () => {
  const dir = makeTmp();
  try {
    const filePath = writeScenario(dir, `
id: canonical-scenario
title: "Canonical scenario"
description: "Exercises the canonical loader contract"
mode: spec-walk
story: sample-story
epic: sample-epic
preconditions:
  - "Story spec is available"
steps:
  - action: "Read the story spec"
    expected: "Primary acceptance criterion is identified"
    actor: tester
postconditions:
  - "Verdict notes are ready"
`);

    const doc = loadScenario(filePath);
    assert.equal(doc.id, 'canonical-scenario');
    assert.equal(doc.mode, 'spec-walk');
    assert.deepEqual(doc.preconditions, ['Story spec is available']);
    assert.equal(doc.steps[0].action, 'Read the story spec');
    assert.equal(doc.steps[0].expected, 'Primary acceptance criterion is identified');
    assert.equal(doc.steps[0].actor, 'tester');
    assert.deepEqual(doc.postconditions, ['Verdict notes are ready']);
  } finally {
    cleanup(dir);
  }
});

test('rejects the legacy invocation/pre_conditions/expectations shape', () => {
  const dir = makeTmp();
  try {
    const filePath = writeScenario(dir, `
id: legacy-scenario
title: "Legacy scenario"
invocation:
  kind: command
  ref: echo ok
pre_conditions:
  - kind: file_exists
    ref: README.md
expectations:
  - kind: exit_status
    value: 0
timeout_seconds: 60
sandcastle_mode_override: shared
owner: tester
`);

    assert.throws(() => loadScenario(filePath), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.field, 'invocation');
      assert.match(err.message, /deprecated invocation\/pre_conditions\/expectations schema/);
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('loads every checked-in scenario fixture', () => {
  for (const filePath of [
    resolve('tests/scenarios/example.yaml'),
    resolve('.pHive/test-scenarios/h-03-standup-format-slack-manual.yaml'),
  ]) {
    const doc = loadScenario(filePath);
    assert.equal(typeof doc.id, 'string', `${filePath} should have an id`);
    assert.ok(Array.isArray(doc.steps), `${filePath} should have steps`);
    assert.ok(doc.steps.length > 0, `${filePath} should have at least one step`);
  }
});

// ─── AC-1: loadResults returns structured object matching worker contract ──────

test('loadResults returns execution_results envelope for valid worker output', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, VALID_RESULTS_YAML);
    const doc = loadResults(filePath);

    // Top-level shape: { execution_results: { ... } }
    assert.ok(doc && typeof doc === 'object', 'loadResults should return an object');
    assert.ok('execution_results' in doc, 'top-level key must be execution_results');

    const er = doc.execution_results;

    // Required scalar fields
    assert.equal(er.story_id, 't-1a-scenario-loader-and-dag-retarget', 'story_id');
    assert.equal(er.epic_id, 'substrate-coverage-and-test-cleanup', 'epic_id');
    assert.equal(er.executed_at, '2026-06-07T00:00:00Z', 'executed_at');
    assert.equal(er.platform, 'darwin', 'platform');
    assert.equal(er.device, 'macOS-arm64', 'device');
  } finally {
    cleanup(dir);
  }
});

test('loadResults parses results array with correct item shape', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, VALID_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    assert.ok(Array.isArray(er.results), 'results must be an array');
    assert.ok(er.results.length > 0, 'results must be non-empty');

    const item = er.results[0];
    assert.equal(item.test_id, 'tc-001');
    assert.equal(item.requirement_ref, 'AC-1');
    assert.equal(item.status, 'pass');
    assert.equal(item.duration_ms, 42);
    assert.equal(typeof item.started_at, 'string');
    assert.equal(typeof item.finished_at, 'string');
  } finally {
    cleanup(dir);
  }
});

test('loadResults parses summary and artifacts sub-objects', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, VALID_RESULTS_YAML);
    const { execution_results: er } = loadResults(filePath);

    // summary
    assert.equal(er.summary.total, 1);
    assert.equal(er.summary.passed, 1);
    assert.equal(er.summary.failed, 0);
    assert.equal(er.summary.skipped, 0);
    assert.equal(er.summary.total_duration_ms, 42);

    // artifacts
    assert.equal(typeof er.artifacts.screenshots_dir, 'string');
    assert.equal(typeof er.artifacts.logs_dir, 'string');
    assert.equal(typeof er.artifacts.results_file, 'string');
  } finally {
    cleanup(dir);
  }
});

test('loadResults throws FILE_NOT_FOUND for missing file', () => {
  assert.throws(
    () => loadResults('/nonexistent/path/results.yaml'),
    (err) => {
      assert.equal(err.code, 'FILE_NOT_FOUND');
      return true;
    },
  );
});

test('loadResults throws VALIDATION_ERROR for unrecognized top-level field', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, `
execution_results:
  story_id: "test-story"
  epic_id: "test-epic"
  executed_at: "2026-06-07T00:00:00Z"
  platform: "darwin"
  device: "macOS-arm64"
  results:
    - test_id: "tc-001"
      requirement_ref: "AC-1"
      status: pass
      duration_ms: 42
      started_at: "2026-06-07T00:00:00.000Z"
      finished_at: "2026-06-07T00:00:00.042Z"
  summary:
    total: 1
    passed: 1
    failed: 0
    skipped: 0
    total_duration_ms: 42
  artifacts:
    screenshots_dir: "/tmp/ss"
    logs_dir: "/tmp/logs"
    results_file: "/tmp/results.yaml"
extra_field: should_not_be_here
`);
    assert.throws(
      () => loadResults(filePath),
      (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /unrecognized top-level field/);
        return true;
      },
    );
  } finally {
    cleanup(dir);
  }
});

test('loadResults throws VALIDATION_ERROR for invalid result status', () => {
  const dir = makeTmp();
  try {
    const filePath = writeResults(dir, `
execution_results:
  story_id: "test-story"
  epic_id: "test-epic"
  executed_at: "2026-06-07T00:00:00Z"
  platform: "darwin"
  device: "macOS-arm64"
  results:
    - test_id: "tc-001"
      requirement_ref: "AC-1"
      status: unknown
      duration_ms: 42
      started_at: "2026-06-07T00:00:00.000Z"
      finished_at: "2026-06-07T00:00:00.042Z"
  summary:
    total: 1
    passed: 0
    failed: 0
    skipped: 0
    total_duration_ms: 42
  artifacts:
    screenshots_dir: "/tmp/ss"
    logs_dir: "/tmp/logs"
    results_file: "/tmp/results.yaml"
`);
    assert.throws(
      () => loadResults(filePath),
      (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /status/);
        return true;
      },
    );
  } finally {
    cleanup(dir);
  }
});

// ─── AC-2: DAG retarget — validate-coverage depends on scenario-replay ────────
//
// History: t-1a originally retargeted validate-coverage from verify-baseline to
// execute-platform-a (sequencing the inspector downstream of the worker). t-1b
// then inserted step-04b-scenario-replay between them, so the final edge is
// validate-coverage → scenario-replay. This assertion tracks the post-t-1b state.

test('test-swarm workflow: validate-coverage depends_on scenario-replay', () => {
  const workflowPath = resolve('hive/workflows/test-swarm.workflow.yaml');
  const raw = readFileSync(workflowPath, 'utf8');

  // Find the validate-coverage step block and confirm its depends_on
  // Parse minimally: find the depends_on line(s) under validate-coverage
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
      // Hit a new step (next `- id:` at same indent level) — stop scanning
      if (/^\s*-\s+id:/.test(line) && !/validate-coverage/.test(line)) {
        break;
      }
      if (/^\s+depends_on:/.test(line)) {
        inDependsOn = true;
        continue;
      }
      if (inDependsOn) {
        // Collect list items
        const itemMatch = line.match(/^\s*-\s+(.+)/);
        if (itemMatch) {
          dependsOnValues.push(itemMatch[1].trim());
        } else if (!/^\s*$/.test(line) && !/^\s*#/.test(line)) {
          // Non-list-item, non-blank line ends the depends_on block
          if (!/^\s+/.test(line) || /^\s{0,6}[a-z]/.test(line)) {
            inDependsOn = false;
          }
        }
      }
    }
  }

  assert.ok(
    inValidateCoverage,
    'validate-coverage step must exist in test-swarm.workflow.yaml',
  );
  assert.ok(
    dependsOnValues.includes('scenario-replay'),
    `validate-coverage.depends_on must contain scenario-replay; got: [${dependsOnValues.join(', ')}]`,
  );
});

// ─── AC-3: Regression — existing authored-scenario flow still passes ──────────

test('loadScenario still accepts canonical spec-walk scenario (regression)', () => {
  const dir = makeTmp();
  try {
    const filePath = writeScenario(dir, `
id: regression-check
title: "Regression check"
mode: spec-walk
steps:
  - action: "Open the app"
    expected: "App is visible"
`);
    const doc = loadScenario(filePath);
    assert.equal(doc.id, 'regression-check');
    assert.equal(doc.mode, 'spec-walk');
    assert.equal(doc.steps.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('loadScenario rejects execution_results shaped YAML (wrong function contract)', () => {
  const dir = makeTmp();
  try {
    // Authored scenario flow MUST NOT accept execution_results YAML
    const filePath = writeScenario(dir, VALID_RESULTS_YAML);
    assert.throws(
      () => loadScenario(filePath),
      (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        // execution_results is an unrecognized top-level field for loadScenario
        assert.match(err.message, /unrecognized top-level field/);
        return true;
      },
    );
  } finally {
    cleanup(dir);
  }
});
