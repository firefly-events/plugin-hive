import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composeContextSnapshot } from '../../hive/lib/context-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir;

function setup() {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ctx-snapshot-'));
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
}

function write(relPath, content) {
  const abs = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function initGit() {
  // Stub a bare .git so git commands don't walk up to the real repo.
  // We create HEAD directly so `git rev-parse --abbrev-ref HEAD` returns
  // 'main' from the detached HEAD fallback path — actual git state is not
  // needed for these unit tests.
  mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildFullFixture() {
  initGit();

  // epic.yaml
  write('.pHive/epics/test-epic/epic.yaml', [
    'name: test-epic',
    'title: Test Epic',
    'methodology: classic',
  ].join('\n'));

  // cycle-state
  write('.pHive/cycle-state/test-epic.yaml', [
    'epic: test-epic',
    'phase: execution',
    'branch: feat/test-epic',
  ].join('\n'));

  // story with metric
  write('.pHive/epics/test-epic/stories/s-01-alpha.yaml', [
    'id: s-01-alpha',
    'epic: test-epic',
    'title: "Alpha story"',
    'status: pending',
    'complexity: medium',
    'depends_on: []',
    '',
    'steps:',
    '  - id: implement',
    '    description: Do the thing',
    '    agent: developer',
    '',
    'metric:',
    '  applies: true',
    '  name: hive.test.latency_ms',
    '  direction: down',
    '  unit: ms',
    '  baseline: null',
  ].join('\n'));

  // story without metric
  write('.pHive/epics/test-epic/stories/s-02-beta.yaml', [
    'id: s-02-beta',
    'epic: test-epic',
    'title: "Beta story"',
    'status: pending',
    'complexity: low',
    'depends_on: [s-01-alpha]',
    '',
    'steps:',
    '  - id: implement',
    '    description: Follow-up',
    '    agent: developer',
  ].join('\n'));

  // episode markers for s-01-alpha
  write('.pHive/episodes/test-epic/s-01-alpha/implement.yaml', [
    'step_id: implement',
    'status: completed',
    'story_id: s-01-alpha',
    'epic: test-epic',
  ].join('\n'));

  // triage queue
  write('.pHive/triage/queue.yaml', [
    'version: 1',
    'items:',
    '  - id: t-001',
    '    state: inbox',
    '    kind: bug',
    '    title: "Something broken"',
    '    reporter: alice@example.com',
    '    priority: null',
    '  - id: t-002',
    '    state: closed',
    '    kind: feature',
    '    title: "Old closed item"',
    '    reporter: bob@example.com',
    '    priority: null',
  ].join('\n'));
}

function buildEmptyFixture() {
  initGit();
  // .pHive exists but has no epics, episodes, or triage
  mkdirSync(path.join(tmpDir, '.pHive'), { recursive: true });
}

function buildMissingTriageFixture() {
  initGit();
  write('.pHive/epics/epic-a/epic.yaml', 'name: epic-a\ntitle: Epic A\nmethodology: classic\n');
  write('.pHive/epics/epic-a/stories/s-01.yaml', [
    'id: s-01',
    'epic: epic-a',
    'title: "Story one"',
    'status: pending',
    'complexity: low',
    'depends_on: []',
    '',
    'steps:',
    '  - id: implement',
    '    description: Go',
    '    agent: developer',
  ].join('\n'));
  // No .pHive/triage/queue.yaml
}

function buildMissingMetricsFixture() {
  initGit();
  write('.pHive/epics/epic-b/epic.yaml', 'name: epic-b\ntitle: Epic B\nmethodology: classic\n');
  write('.pHive/epics/epic-b/stories/s-01.yaml', [
    'id: s-01',
    'epic: epic-b',
    'title: "No metric story"',
    'status: pending',
    'complexity: medium',
    'depends_on: []',
    '',
    'steps:',
    '  - id: implement',
    '    description: Go',
    '    agent: developer',
    // No metric: block
  ].join('\n'));
  write('.pHive/triage/queue.yaml', 'version: 1\nitems: []\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('full fixture — schema_version is 1', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.equal(snap.schema_version, 1);
  } finally {
    teardown();
  }
});

test('full fixture — has generated_at ISO string', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.match(snap.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    teardown();
  }
});

test('full fixture — epics list has one entry', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.equal(snap.epics.length, 1);
    assert.equal(snap.epics[0].id, 'test-epic');
    assert.equal(snap.epics[0].story_count, 2);
    assert.equal(snap.epics[0].phase, 'execution');
  } finally {
    teardown();
  }
});

test('full fixture — stories use deriveStoryStatus (not raw YAML status)', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    const alpha = snap.stories.find(s => s.story_id === 's-01-alpha');
    // Episode marker shows implement=completed but terminal step is last in steps list
    // deriveStoryStatus returns completed when terminal step has completed marker
    assert.ok(['completed', 'in_progress'].includes(alpha.status),
      `Expected derived status, got ${alpha.status}`);
    // beta depends on alpha and has no markers — should be blocked or pending
    const beta = snap.stories.find(s => s.story_id === 's-02-beta');
    assert.ok(['blocked', 'pending'].includes(beta.status),
      `Expected blocked or pending, got ${beta.status}`);
  } finally {
    teardown();
  }
});

test('full fixture — episodes_recent has markers for alpha', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    const ep = snap.episodes_recent.find(
      e => e.story_id === 's-01-alpha' && e.epic_id === 'test-epic'
    );
    assert.ok(ep, 'episode entry missing for s-01-alpha');
    assert.equal(ep.markers.length, 1);
    assert.equal(ep.markers[0].step_id, 'implement');
    assert.equal(ep.markers[0].status, 'completed');
  } finally {
    teardown();
  }
});

test('full fixture — triage_open excludes closed items', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.equal(snap.triage_open.length, 1);
    assert.equal(snap.triage_open[0].id, 't-001');
    assert.equal(snap.triage_open[0].state, 'inbox');
  } finally {
    teardown();
  }
});

test('full fixture — metrics_health includes story with metric block only', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    // s-01-alpha has metric, s-02-beta does not
    assert.equal(snap.metrics_health.length, 1);
    const m = snap.metrics_health[0];
    assert.equal(m.story_id, 's-01-alpha');
    assert.equal(m.applies, true);
    assert.ok(m.metric);
    assert.equal(m.metric.name, 'hive.test.latency_ms');
  } finally {
    teardown();
  }
});

test('full fixture — epic filter scopes all lists', (t) => {
  setup();
  try {
    buildFullFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir, epic: 'test-epic' });
    assert.ok(snap.epics.every(e => e.id === 'test-epic'));
    assert.ok(snap.stories.every(s => s.epic_id === 'test-epic'));
    assert.ok(snap.episodes_recent.every(e => e.epic_id === 'test-epic'));
    assert.ok(snap.metrics_health.every(m => m.epic_id === 'test-epic'));
  } finally {
    teardown();
  }
});

test('empty fixture — all arrays are empty, no throw', (t) => {
  setup();
  try {
    buildEmptyFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.equal(snap.schema_version, 1);
    assert.deepEqual(snap.epics, []);
    assert.deepEqual(snap.stories, []);
    assert.deepEqual(snap.episodes_recent, []);
    assert.deepEqual(snap.triage_open, []);
    assert.deepEqual(snap.metrics_health, []);
  } finally {
    teardown();
  }
});

test('missing triage — triage_open is empty array, no throw', (t) => {
  setup();
  try {
    buildMissingTriageFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.deepEqual(snap.triage_open, []);
    assert.equal(snap.stories.length, 1);
  } finally {
    teardown();
  }
});

test('missing metrics — metrics_health is empty array, no throw', (t) => {
  setup();
  try {
    buildMissingMetricsFixture();
    const snap = composeContextSnapshot({ stateDir: tmpDir });
    assert.deepEqual(snap.metrics_health, []);
    assert.equal(snap.stories.length, 1);
  } finally {
    teardown();
  }
});

test('episodeLimit caps markers per story', (t) => {
  setup();
  try {
    buildFullFixture();
    // Add extra markers
    for (let i = 2; i <= 8; i++) {
      write(`.pHive/episodes/test-epic/s-01-alpha/step-${i}.yaml`,
        `step_id: step-${i}\nstatus: completed\n`);
    }
    const snap = composeContextSnapshot({ stateDir: tmpDir, episodeLimit: 3 });
    const ep = snap.episodes_recent.find(e => e.story_id === 's-01-alpha');
    assert.ok(ep);
    assert.ok(ep.markers.length <= 3, `Expected ≤3 markers, got ${ep.markers.length}`);
  } finally {
    teardown();
  }
});
