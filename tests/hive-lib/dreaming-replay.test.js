/**
 * Contract tests for hive/lib/dreaming-replay.js
 *
 * Story s16-b3-dreaming-replay-meta-optimize-fifth-source. TDD: written RED
 * before implementation.
 * Run: node tests/hive-lib/dreaming-replay.test.js
 *
 * Five cases:
 *   a) episode-walker reads fixture .pHive/episodes/ shape correctly
 *   b) playbook delta emission mirrors the Q3 Dreams envelope via a local adapter
 *   c) capability-skip returns no proposals and no surfaced error
 *   d) 5th source ranks alongside metrics, external research, kg_signal, backlog
 *   e) capability-skip propagates to the 5th source as [] without changing fallback
 *
 * Primary source:
 *   - https://platform.claude.com/docs/en/managed-agents/dreams
 *     (last checked 2026-05-09)
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_PATH = path.join(ROOT, 'hive', 'lib', 'dreaming-replay.js');
const SKILL_PATH = path.join(ROOT, 'skills', 'hive', 'skills', 'meta-optimize', 'SKILL.md');
const CONFIG_PATH = path.join(ROOT, 'hive', 'hive.config.yaml');
const DREAMING_REF_PATH = path.join(ROOT, 'hive', 'references', 'dreaming-integration.md');
const CLOUD_ROADMAP_PATH = path.join(ROOT, 'hive', 'references', 'hive-cloud-roadmap.md');
const SESSION_SPEC_PATH = path.join(ROOT, 'hive', 'references', 'session-system-prompt-spec.md');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'episodes');

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// Case (a): episode-walker
// ---------------------------------------------------------------------------
test('case a — episode-walker reads fixture episodes and preserves source ordering', async () => {
  const { runDreamingReplay } = loadModule();
  const wikiWrites = [];
  const kgWrites = [];

  const result = await runDreamingReplay({
    episodeRoot: FIXTURE_ROOT,
    capabilityProbe: async () => true,
    wiki: { applyDelta(delta) { wikiWrites.push(delta); } },
    kg: { applyDelta(delta) { kgWrites.push(delta); } },
  });

  assert.equal(result.capabilityErr, null);
  assert.equal(result.playbookDeltas.length, 2, 'two fixture deltas emitted');
  assert.deepEqual(
    result.playbookDeltas.map(delta => delta.source_episode),
    ['dreaming-session-a', 'dreaming-session-b'],
    'fixture order is deterministic by relative path'
  );
  assert.equal(wikiWrites.length, 2, 'wiki sink receives two deltas');
  assert.equal(kgWrites.length, 2, 'kg sink receives two deltas');
});

// ---------------------------------------------------------------------------
// Case (b): Q3-adapter shape
// ---------------------------------------------------------------------------
test('case b — playbook delta emission mirrors the fetched Dreams resource shape via local adapter fields', async () => {
  const { runDreamingReplay } = loadModule();

  const result = await runDreamingReplay({
    episodeRoot: FIXTURE_ROOT,
    capabilityProbe: async () => true,
  });

  const delta = result.playbookDeltas[0];
  assert.equal(delta.type, 'dream', 'adapter preserves the Dreams resource type');
  assert.equal(delta.status, 'completed');
  assert.deepEqual(delta.inputs, [
    { type: 'sessions', session_ids: ['dreaming-session-a'] },
  ]);
  assert.equal(delta.model.id, 'local-episode-walker');
  assert.equal(delta.session_id, 'dreaming-session-a');
  assert.equal(delta.created_at, '2026-05-08T22:00:00Z');
  assert.equal(delta.ended_at, '2026-05-08T22:00:00Z');
  assert.equal(delta.archived_at, null);
  assert.deepEqual(delta.usage, {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  });
  assert.equal(delta.error, null);
  assert.equal(delta.outputs.length, 1);
  assert.deepEqual(delta.outputs[0], {
    type: 'playbook_delta',
    title: 'Keep dreaming replay separate from session-end',
    rationale: 'Cross-session replay belongs in its own module and reuses episode evidence.',
    wiki: {
      slug: 'dreaming/separate-module',
      summary: 'Replay remains a cross-session adapter, not Phase D of session-end.',
    },
    kg: {
      subject: 'cwc-2026-integration',
      predicate: 'decided',
      object: 'dreaming-module-location=separate-module',
    },
  });
});

// ---------------------------------------------------------------------------
// Case (c): capability skip
// ---------------------------------------------------------------------------
test('case c — capability-skip activates when Dreaming is unreachable and returns no proposals with no surfaced error', async () => {
  const { runDreamingReplay } = loadModule();

  const result = await runDreamingReplay({
    episodeRoot: FIXTURE_ROOT,
    capabilityProbe: async () => false,
  });

  assert.deepEqual(result, { playbookDeltas: [], capabilityErr: null });
});

test('case c2 — timeout_hours aborts the walker and returns partial deltas with timeoutErr=true', async () => {
  const { runDreamingReplay } = loadModule();
  const originalReadFileSync = fs.readFileSync;
  const originalNow = Date.now;
  let nowCallCount = 0;

  fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
    if (path.resolve(filePath) === CONFIG_PATH) {
      return 'dreaming:\n  timeout_hours: 0.0001\n';
    }
    return originalReadFileSync.call(this, filePath, ...args);
  };

  Date.now = () => {
    nowCallCount += 1;
    return nowCallCount === 1 ? 0 : 1000;
  };

  try {
    const result = await runDreamingReplay({
      episodeRoot: FIXTURE_ROOT,
      capabilityProbe: async () => true,
    });

    assert.equal(result.timeoutErr, true);
    assert.equal(result.capabilityErr, null);
    assert.deepEqual(
      result.playbookDeltas.map(delta => delta.source_episode),
      ['dreaming-session-a'],
      'walker returns the partial delta set emitted before the timeout trips'
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    Date.now = originalNow;
  }
});

// ---------------------------------------------------------------------------
// Case (d): 5th source dispatch contract
// ---------------------------------------------------------------------------
test('case d — meta-optimize skill and config declare dreaming replay as the 5th source before backlog', () => {
  const skillText = readText(SKILL_PATH);
  const configText = readText(CONFIG_PATH);
  const dreamingRef = readText(DREAMING_REF_PATH);
  const cloudRoadmap = readText(CLOUD_ROADMAP_PATH);

  assert.match(
    skillText,
    /metrics → external research → kg_signal → dreaming_replay → backlog/,
    'routing precedence includes dreaming_replay before backlog'
  );
  assert.match(
    skillText,
    /Step 2d produced one or more `dreaming_replay` proposals/,
    'step-03 actionable inputs include the 5th source'
  );
  assert.match(
    skillText,
    /ALL five are empty: zero findings AND zero external candidates AND zero kg_signal AND zero dreaming_replay AND no usable metric signal/,
    'fallback gate expands from four to five sources'
  );
  assert.match(configText, /dreaming_source:/, 'config declares the dreaming source block');
  assert.match(configText, /timeout_hours:/, 'config declares dreaming timeout');
  assert.match(dreamingRef, /s11-c1-under-scheduler-step-metadata/, 'reference names s11 contract');
  assert.match(dreamingRef, /s12-c2-routines-acr-integration-refs/, 'reference names s12 doc');
  assert.match(cloudRoadmap, /architecture:stub-path/, 'cloud roadmap stub cites the cycle-state stub escalation');
});

// ---------------------------------------------------------------------------
// Case (e): 5th-source capability-skip propagation
// ---------------------------------------------------------------------------
test('case e — docs pin capability-skip as [] and the s4 forward-reference is closed by the roadmap stub', () => {
  const skillText = readText(SKILL_PATH);
  const dreamingRef = readText(DREAMING_REF_PATH);
  const sessionSpec = readText(SESSION_SPEC_PATH);
  const cloudRoadmap = readText(CLOUD_ROADMAP_PATH);

  assert.match(
    skillText,
    /If `meta_optimize\.dreaming_source\.enabled` is `false`, or dreaming replay capability-checks unavailable, step-02d returns `\[\]` and routing falls through unchanged/,
    'skill documents clean [] propagation'
  );
  assert.match(
    dreamingRef,
    /When Dreaming capability is unreachable or disabled, `runDreamingReplay\(\)` returns `\{ playbookDeltas: \[\], capabilityErr: null \}`/,
    'integration doc pins the skip return shape'
  );
  assert.match(sessionSpec, /See \[`hive-cloud-roadmap\.md`\]\(\.\/hive-cloud-roadmap\.md\) \(S16 stub\)/);
  assert.match(cloudRoadmap, /deferred A8/, 'stub closes the dangling pointer with deferred-A8 context');
});
