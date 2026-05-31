import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadScenario } from '../load.mjs';

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
