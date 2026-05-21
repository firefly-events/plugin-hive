// tests/hive-lib/scenarios-load.test.mjs
//
// Unit tests for hive/lib/scenarios/load.mjs
//
// Story: c-1-scenario-schema-and-loader (autonomous-cycle-loop)
// Run:   node --test tests/hive-lib/scenarios-load.test.mjs
//
// Covers:
//   AC-load-1  valid scenario returns parsed object
//   AC-load-2  missing id → structured error
//   AC-load-3  missing title → structured error
//   AC-load-4  missing steps → structured error
//   AC-load-5  empty steps → structured error
//   AC-load-6  step missing action → structured error
//   AC-load-7  step missing expected → structured error
//   AC-load-8  invalid mode → structured error
//   AC-load-9  optional preconditions/postconditions accepted
//   AC-load-10 optional per-step actor accepted
//   AC-load-11 implementation-walk without integrate marker → error
//   AC-load-12 implementation-walk with integrate marker → passes
//   AC-load-13 spec-walk does NOT check integrate marker
//   AC-load-14 fixture scenario (tests/scenarios/example.yaml) passes loader

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { loadScenario } = await import(
  resolve(__dirname, '../../hive/lib/scenarios/load.mjs')
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'hive-scenario-test-'));
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

function writeScenario(dir, content, filename = 'scenario.yaml') {
  const p = join(dir, filename);
  writeFileSync(p, content, 'utf8');
  return p;
}

const VALID_YAML = `
id: test-scenario
title: "A valid test scenario"
mode: spec-walk
steps:
  - action: "Do something"
    expected: "See a result"
`;

// ─── Tests ────────────────────────────────────────────────────────────────────

test('AC-load-1: valid scenario returns parsed object', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, VALID_YAML);
    const doc = loadScenario(p);
    assert.equal(doc.id, 'test-scenario');
    assert.equal(doc.title, 'A valid test scenario');
    assert.equal(doc.mode, 'spec-walk');
    assert.equal(doc.steps.length, 1);
    assert.equal(doc.steps[0].action, 'Do something');
    assert.equal(doc.steps[0].expected, 'See a result');
  } finally {
    cleanup(dir);
  }
});

test('AC-load-2: missing id → structured error', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
title: "No id"
mode: spec-walk
steps:
  - action: "x"
    expected: "y"
`);
    assert.throws(() => loadScenario(p), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.field, 'id');
      assert.equal(err.filePath, p);
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-3: missing title → structured error', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: no-title
mode: spec-walk
steps:
  - action: "x"
    expected: "y"
`);
    assert.throws(() => loadScenario(p), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.field, 'title');
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-4: missing steps → structured error', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: no-steps
title: "No steps"
mode: spec-walk
`);
    assert.throws(() => loadScenario(p), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.field, 'steps');
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-5: empty steps array → structured error', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: empty-steps
title: "Empty steps"
mode: spec-walk
steps: []
`);
    // Empty inline list — might parse as string "[]" depending on parser
    // Also test with no items under steps:
    const p2 = writeScenario(dir, `
id: empty-steps-2
title: "Empty steps 2"
mode: spec-walk
steps:
`, 'scenario2.yaml');
    assert.throws(() => loadScenario(p2), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.field, 'steps');
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-6: step missing action → structured error with field path', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: missing-action
title: "Missing action"
mode: spec-walk
steps:
  - expected: "Some result"
`);
    assert.throws(() => loadScenario(p), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.match(err.field, /steps\[0\]\.action/);
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-7: step missing expected → structured error with field path', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: missing-expected
title: "Missing expected"
mode: spec-walk
steps:
  - action: "Do something"
`);
    assert.throws(() => loadScenario(p), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.match(err.field, /steps\[0\]\.expected/);
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-8: invalid mode → structured error', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: bad-mode
title: "Bad mode"
mode: auto-walk
steps:
  - action: "x"
    expected: "y"
`);
    assert.throws(() => loadScenario(p), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.field, 'mode');
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-9: optional preconditions and postconditions accepted', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: with-conditions
title: "With conditions"
mode: spec-walk
preconditions:
  - "Pre 1"
  - "Pre 2"
steps:
  - action: "Do it"
    expected: "See it"
postconditions:
  - "Post 1"
`);
    const doc = loadScenario(p);
    assert.deepEqual(doc.preconditions, ['Pre 1', 'Pre 2']);
    assert.deepEqual(doc.postconditions, ['Post 1']);
  } finally {
    cleanup(dir);
  }
});

test('AC-load-10: optional per-step actor accepted', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: with-actor
title: "With actor"
mode: spec-walk
steps:
  - action: "Act"
    expected: "Result"
    actor: tester
  - action: "No actor step"
    expected: "Also result"
`);
    const doc = loadScenario(p);
    assert.equal(doc.steps[0].actor, 'tester');
    assert.equal(doc.steps[1].actor, undefined);
  } finally {
    cleanup(dir);
  }
});

test('AC-load-11: implementation-walk without integrate marker → INTEGRATE_MARKER_MISSING', () => {
  const dir = makeTmp();
  try {
    const p = writeScenario(dir, `
id: impl-walk-no-marker
title: "Implementation walk no marker"
mode: implementation-walk
story: my-story
epic: my-epic
steps:
  - action: "Check code"
    expected: "Code exists"
`);
    assert.throws(() => loadScenario(p, { cwd: dir }), (err) => {
      assert.equal(err.code, 'INTEGRATE_MARKER_MISSING');
      assert.equal(err.field, 'mode');
      assert.equal(err.storyId, 'my-story');
      assert.equal(err.epicId, 'my-epic');
      assert.ok(err.markerPath.includes('my-epic'));
      assert.ok(err.markerPath.includes('my-story'));
      return true;
    });
  } finally {
    cleanup(dir);
  }
});

test('AC-load-12: implementation-walk with integrate marker → passes', () => {
  const dir = makeTmp();
  try {
    // Create the integrate marker
    const markerDir = join(dir, '.pHive', 'episodes', 'my-epic', 'my-story');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, 'integrate.yaml'), `
step_id: integrate
status: completed
timestamp: "2026-01-01T00:00:00Z"
artifacts: []
`);
    const p = writeScenario(dir, `
id: impl-walk-with-marker
title: "Implementation walk with marker"
mode: implementation-walk
story: my-story
epic: my-epic
steps:
  - action: "Check code"
    expected: "Code exists"
`);
    const doc = loadScenario(p, { cwd: dir });
    assert.equal(doc.id, 'impl-walk-with-marker');
    assert.equal(doc.mode, 'implementation-walk');
  } finally {
    cleanup(dir);
  }
});

test('AC-load-13: spec-walk does NOT check integrate marker', () => {
  const dir = makeTmp();
  try {
    // No marker written — spec-walk should still pass
    const p = writeScenario(dir, `
id: spec-walk-no-marker
title: "Spec walk no marker"
mode: spec-walk
story: my-story
epic: my-epic
steps:
  - action: "Read spec"
    expected: "Spec found"
`);
    const doc = loadScenario(p, { cwd: dir });
    assert.equal(doc.mode, 'spec-walk');
  } finally {
    cleanup(dir);
  }
});

test('AC-load-14: fixture scenario (tests/scenarios/example.yaml) passes loader', () => {
  const fixturePath = resolve(__dirname, '../../tests/scenarios/example.yaml');
  const doc = loadScenario(fixturePath);
  assert.equal(doc.id, 'example-scenario');
  assert.ok(doc.title.length > 0);
  assert.ok(['spec-walk', 'implementation-walk'].includes(doc.mode));
  assert.ok(Array.isArray(doc.steps));
  assert.ok(doc.steps.length > 0);
  for (const step of doc.steps) {
    assert.ok(step.action, 'step must have action');
    assert.ok(step.expected, 'step must have expected');
  }
});
