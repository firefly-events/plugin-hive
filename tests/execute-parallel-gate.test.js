'use strict';

/**
 * Tests for the parallel-dispatch gate (ed-7-execute-enforces-gate).
 *
 * Story: ed-7-execute-enforces-gate (exec-discipline-may2026)
 * Run:   node tests/execute-parallel-gate.test.js
 *
 * Design:
 *   skills/hive/skills/execute-dispatch/SKILL.md Step 1.5 (the gate) is
 *   prose, not code. These tests encode a fixture resolver that mirrors
 *   the spec's four checks so the gate logic can be exercised as a pure
 *   function with injected story sets. The fixture is NOT production
 *   code — it is a test seam mirroring the SKILL prose, exactly as
 *   tests/execute-dispatch-sandcastle.test.js does for Step 0.
 *
 * Covers (acceptance criteria from .pHive/epics/exec-discipline-may2026/
 * stories/ed-7-execute-enforces-gate.yaml):
 *   AC-1  3 sibling stories, parallel_allowed:true + bounded-slice +
 *         disjoint files_to_modify → fan out (mode unchanged)
 *   AC-2  2 bounded-slice stories with overlapping files_to_modify →
 *         downgrade to sequential, warning names both story IDs
 *   AC-3  story with parallel_allowed:true but missing rationale →
 *         malformed (refuse + warn)
 *   AC-4  audit-pass: read-only research swarm rationale passes cleanly
 *         (no false positives on the legitimate audit-pass annotation)
 *   AC-5  audit registry doc exists at the canonical path so the gate's
 *         warning link resolves
 *
 * Plus no-regression cases:
 *   - peer set size 1 → gate is a no-op
 *   - sequential mode_decision → gate is a no-op
 *   - mixed valid rationales (variation + read-only + bounded-slice)
 *     across a peer set → all pass
 *   - bounded-slice with empty files_to_modify → malformed
 *   - parallel_rationale value off-enum → malformed
 *   - parallel_allowed:false sibling in a fan-out set → refuses (default-
 *     serial: cannot mix serial and parallel in one tick)
 *   - three-way overlap names every participating story in violations
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Fixture: parallel-dispatch gate resolver mirroring execute-dispatch
// SKILL.md Step 1.5
// ---------------------------------------------------------------------------

const VALID_RATIONALES = new Set(['variation', 'read-only', 'bounded-slice']);

/**
 * Evaluate the ed-7 parallel-dispatch gate against a depth-0 peer set.
 *
 * Mirrors skills/hive/skills/execute-dispatch/SKILL.md Step 1.5:
 *   (1) parallel_allowed opt-in check
 *   (2) parallel_rationale shape check
 *   (3) bounded-slice files_to_modify declaration check
 *   (4) bounded-slice touch-set disjointness check
 *
 * @param {Array<object>} unblockedStories - depth-0 stories with id +
 *        parallel_allowed + parallel_rationale + (bounded-slice only)
 *        files_to_modify[]
 * @param {string} modeDecisionIn - mode resolved by Step 1
 *        ('team'|'team-cmux'|'sessions'|'sandcastle'|'sequential')
 * @returns {{ mode_decision: string, mode_reason: string,
 *             gate_violations: Array<{story_id: string, reason: string}>,
 *             warning: string|null }}
 */
function runParallelGate(unblockedStories, modeDecisionIn) {
  const FAN_OUT_MODES = new Set(['team', 'team-cmux', 'sessions', 'sandcastle']);

  // Precondition: gate only runs on fan-out modes with > 1 peer.
  if (!FAN_OUT_MODES.has(modeDecisionIn) || unblockedStories.length <= 1) {
    return {
      mode_decision: modeDecisionIn,
      mode_reason: 'gate-not-applicable',
      gate_violations: [],
      warning: null,
    };
  }

  const violations = [];

  // (1) parallel_allowed opt-in check.
  for (const story of unblockedStories) {
    if (story.parallel_allowed !== true) {
      violations.push({
        story_id: story.id,
        reason: 'parallel_allowed-missing-or-false',
      });
    }
  }

  // (2) parallel_rationale shape check — only for stories that did opt in.
  for (const story of unblockedStories) {
    if (story.parallel_allowed !== true) continue;
    if (!VALID_RATIONALES.has(story.parallel_rationale)) {
      violations.push({
        story_id: story.id,
        reason: 'parallel_rationale-malformed',
      });
    }
  }

  // (3) bounded-slice touch-set declaration check.
  const boundedSliceStories = unblockedStories.filter(
    (s) => s.parallel_allowed === true && s.parallel_rationale === 'bounded-slice'
  );

  for (const story of boundedSliceStories) {
    const ftm = story.files_to_modify;
    const isMalformed =
      !Array.isArray(ftm) ||
      ftm.length === 0 ||
      ftm.some((entry) => !entry || typeof entry.file !== 'string' || entry.file.length === 0);
    if (isMalformed) {
      violations.push({
        story_id: story.id,
        reason: 'bounded-slice-missing-files_to_modify',
      });
    }
  }

  // (4) bounded-slice disjointness check — pairwise intersection across
  //     the bounded-slice subset that DID declare a non-empty touch-set.
  const wellDeclaredBoundedSlice = boundedSliceStories.filter(
    (s) =>
      Array.isArray(s.files_to_modify) &&
      s.files_to_modify.length > 0 &&
      s.files_to_modify.every((e) => e && typeof e.file === 'string' && e.file.length > 0)
  );

  for (let i = 0; i < wellDeclaredBoundedSlice.length; i++) {
    for (let j = i + 1; j < wellDeclaredBoundedSlice.length; j++) {
      const a = wellDeclaredBoundedSlice[i];
      const b = wellDeclaredBoundedSlice[j];
      const aSet = new Set(a.files_to_modify.map((e) => e.file));
      const overlap = b.files_to_modify
        .map((e) => e.file)
        .filter((f) => aSet.has(f));
      if (overlap.length > 0) {
        const overlapStr = overlap.join(',');
        violations.push({
          story_id: a.id,
          reason: `bounded-slice-overlap:${overlapStr}:${b.id}`,
        });
        violations.push({
          story_id: b.id,
          reason: `bounded-slice-overlap:${overlapStr}:${a.id}`,
        });
      }
    }
  }

  if (violations.length === 0) {
    return {
      mode_decision: modeDecisionIn,
      mode_reason: 'team-checks-pass',
      gate_violations: [],
      warning: null,
    };
  }

  const lines = [
    'WARNING: parallel-dispatch gate refused — falling back to sequential. Offending stories:',
    ...violations.map((v) => `  - ${v.story_id}: ${v.reason}`),
    'Fix by editing planning emission (/plan Phase C step 13) or correcting the story YAML; see hive/references/parallel-call-sites.md and hive/references/story-yaml-schema.md §4.',
  ];

  return {
    mode_decision: 'sequential',
    mode_reason: 'parallel-gate-refused',
    gate_violations: violations,
    warning: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const threeDisjointBoundedSlice = [
  {
    id: 'story-alpha',
    parallel_allowed: true,
    parallel_rationale: 'bounded-slice',
    files_to_modify: [
      { file: 'src/alpha/index.ts', change: 'add hook' },
      { file: 'src/alpha/types.ts', change: 'add type' },
    ],
  },
  {
    id: 'story-beta',
    parallel_allowed: true,
    parallel_rationale: 'bounded-slice',
    files_to_modify: [{ file: 'src/beta/index.ts', change: 'add hook' }],
  },
  {
    id: 'story-gamma',
    parallel_allowed: true,
    parallel_rationale: 'bounded-slice',
    files_to_modify: [{ file: 'src/gamma/index.ts', change: 'add hook' }],
  },
];

const twoOverlappingBoundedSlice = [
  {
    id: 'story-foo',
    parallel_allowed: true,
    parallel_rationale: 'bounded-slice',
    files_to_modify: [{ file: 'skills/plan/SKILL.md', change: 'edit phase C' }],
  },
  {
    id: 'story-bar',
    parallel_allowed: true,
    parallel_rationale: 'bounded-slice',
    files_to_modify: [{ file: 'skills/plan/SKILL.md', change: 'edit phase D' }],
  },
];

const oneMalformedNoRationale = [
  {
    id: 'story-rationale-ok',
    parallel_allowed: true,
    parallel_rationale: 'read-only',
  },
  {
    id: 'story-no-rationale',
    parallel_allowed: true,
    // parallel_rationale intentionally missing
  },
];

const readOnlyResearchSwarm = [
  {
    id: 'story-audit-skill-tokens',
    parallel_allowed: true,
    parallel_rationale: 'read-only',
  },
  {
    id: 'story-audit-memory-shape',
    parallel_allowed: true,
    parallel_rationale: 'read-only',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('AC-1: 3 disjoint bounded-slice peers fan out as auto-spawned teammates', () => {
  const result = runParallelGate(threeDisjointBoundedSlice, 'team');
  assert.equal(result.mode_decision, 'team', 'mode preserved');
  assert.equal(result.gate_violations.length, 0, 'no violations');
  assert.equal(result.warning, null, 'no warning emitted');
});

test('AC-2: overlapping bounded-slice peers → sequential, warning names both story IDs', () => {
  const result = runParallelGate(twoOverlappingBoundedSlice, 'team');
  assert.equal(result.mode_decision, 'sequential', 'downgraded to sequential');
  assert.equal(result.mode_reason, 'parallel-gate-refused');
  // Both stories must appear in violations.
  const ids = result.gate_violations.map((v) => v.story_id).sort();
  assert.deepEqual(ids, ['story-bar', 'story-foo'], 'both story IDs listed');
  // Reason carries the overlapping path.
  for (const v of result.gate_violations) {
    assert.match(v.reason, /bounded-slice-overlap:skills\/plan\/SKILL\.md:/);
  }
  // Warning string names both IDs.
  assert.ok(result.warning.includes('story-foo'), 'warning names story-foo');
  assert.ok(result.warning.includes('story-bar'), 'warning names story-bar');
  assert.ok(
    result.warning.includes('skills/plan/SKILL.md'),
    'warning names overlapping path'
  );
});

test('AC-3: parallel_allowed:true without parallel_rationale → malformed (refuse + warn)', () => {
  const result = runParallelGate(oneMalformedNoRationale, 'team');
  assert.equal(result.mode_decision, 'sequential');
  assert.equal(result.mode_reason, 'parallel-gate-refused');
  const offender = result.gate_violations.find(
    (v) => v.story_id === 'story-no-rationale'
  );
  assert.ok(offender, 'story-no-rationale flagged');
  assert.equal(offender.reason, 'parallel_rationale-malformed');
  assert.ok(
    result.warning.includes('story-no-rationale'),
    'warning names offender'
  );
});

test('AC-4 (audit pass): read-only research swarm passes cleanly', () => {
  const result = runParallelGate(readOnlyResearchSwarm, 'team');
  assert.equal(result.mode_decision, 'team', 'mode preserved');
  assert.equal(result.gate_violations.length, 0, 'no false positives');
});

test('AC-5: audit registry doc exists at the canonical path', () => {
  const registryPath = path.resolve(
    __dirname,
    '..',
    'hive',
    'references',
    'parallel-call-sites.md'
  );
  assert.ok(
    fs.existsSync(registryPath),
    `audit registry doc missing at ${registryPath}`
  );
  const content = fs.readFileSync(registryPath, 'utf8');
  // Sanity: registry mentions all four in-scope dispatch sites.
  for (const expected of [
    'execute:team',
    'execute:team-cmux',
    'execute:sessions',
    'execute:sandcastle',
  ]) {
    assert.ok(
      content.includes(expected),
      `registry should list in-scope site ${expected}`
    );
  }
  // And it documents the gate's behavior on refusal.
  assert.ok(
    content.includes('parallel-gate-refused') ||
      content.includes('Step 1.5'),
    'registry references the gate'
  );
});

// ---------------------------------------------------------------------------
// No-regression cases
// ---------------------------------------------------------------------------

test('no-op: peer set size 1 → gate skips', () => {
  const result = runParallelGate(
    [threeDisjointBoundedSlice[0]],
    'team'
  );
  assert.equal(result.mode_decision, 'team');
  assert.equal(result.gate_violations.length, 0);
  assert.equal(result.warning, null);
});

test('no-op: mode_decision=sequential → gate skips', () => {
  const result = runParallelGate(twoOverlappingBoundedSlice, 'sequential');
  // Even with overlapping bounded-slice peers, sequential mode never
  // triggers the gate — there is no fan-out to refuse.
  assert.equal(result.mode_decision, 'sequential');
  assert.equal(result.gate_violations.length, 0);
});

test('mixed valid rationales (variation + read-only + bounded-slice) → all pass', () => {
  const stories = [
    {
      id: 'story-variation',
      parallel_allowed: true,
      parallel_rationale: 'variation',
    },
    {
      id: 'story-readonly',
      parallel_allowed: true,
      parallel_rationale: 'read-only',
    },
    {
      id: 'story-bounded',
      parallel_allowed: true,
      parallel_rationale: 'bounded-slice',
      files_to_modify: [{ file: 'src/unique-path.ts', change: 'add hook' }],
    },
  ];
  const result = runParallelGate(stories, 'team');
  assert.equal(result.mode_decision, 'team');
  assert.equal(result.gate_violations.length, 0);
});

test('bounded-slice with empty files_to_modify → malformed', () => {
  const stories = [
    {
      id: 'story-empty-touch-set',
      parallel_allowed: true,
      parallel_rationale: 'bounded-slice',
      files_to_modify: [],
    },
    {
      id: 'story-fine',
      parallel_allowed: true,
      parallel_rationale: 'read-only',
    },
  ];
  const result = runParallelGate(stories, 'team');
  assert.equal(result.mode_decision, 'sequential');
  const offender = result.gate_violations.find(
    (v) => v.story_id === 'story-empty-touch-set'
  );
  assert.ok(offender);
  assert.equal(offender.reason, 'bounded-slice-missing-files_to_modify');
});

test('bounded-slice with missing files_to_modify field → malformed', () => {
  const stories = [
    {
      id: 'story-no-touch-set',
      parallel_allowed: true,
      parallel_rationale: 'bounded-slice',
      // files_to_modify intentionally absent
    },
    {
      id: 'story-fine',
      parallel_allowed: true,
      parallel_rationale: 'read-only',
    },
  ];
  const result = runParallelGate(stories, 'team');
  assert.equal(result.mode_decision, 'sequential');
  const offender = result.gate_violations.find(
    (v) => v.story_id === 'story-no-touch-set'
  );
  assert.ok(offender);
  assert.equal(offender.reason, 'bounded-slice-missing-files_to_modify');
});

test('off-enum parallel_rationale → malformed', () => {
  const stories = [
    {
      id: 'story-bad-rationale',
      parallel_allowed: true,
      parallel_rationale: 'should-be-safe', // not in enum
    },
    {
      id: 'story-fine',
      parallel_allowed: true,
      parallel_rationale: 'read-only',
    },
  ];
  const result = runParallelGate(stories, 'team');
  assert.equal(result.mode_decision, 'sequential');
  const offender = result.gate_violations.find(
    (v) => v.story_id === 'story-bad-rationale'
  );
  assert.ok(offender);
  assert.equal(offender.reason, 'parallel_rationale-malformed');
});

test('parallel_allowed:false sibling in fan-out set → refuses', () => {
  const stories = [
    {
      id: 'story-parallel',
      parallel_allowed: true,
      parallel_rationale: 'read-only',
    },
    {
      id: 'story-serial-sibling',
      parallel_allowed: false,
      // a story that should not be fanned out together with a parallel peer
    },
  ];
  const result = runParallelGate(stories, 'team');
  assert.equal(result.mode_decision, 'sequential');
  const offender = result.gate_violations.find(
    (v) => v.story_id === 'story-serial-sibling'
  );
  assert.ok(offender);
  assert.equal(offender.reason, 'parallel_allowed-missing-or-false');
});

test('three-way bounded-slice overlap names every participating story', () => {
  const stories = [
    {
      id: 'story-x',
      parallel_allowed: true,
      parallel_rationale: 'bounded-slice',
      files_to_modify: [{ file: 'shared.md', change: 'A' }],
    },
    {
      id: 'story-y',
      parallel_allowed: true,
      parallel_rationale: 'bounded-slice',
      files_to_modify: [{ file: 'shared.md', change: 'B' }],
    },
    {
      id: 'story-z',
      parallel_allowed: true,
      parallel_rationale: 'bounded-slice',
      files_to_modify: [{ file: 'shared.md', change: 'C' }],
    },
  ];
  const result = runParallelGate(stories, 'team');
  assert.equal(result.mode_decision, 'sequential');
  const offenderIds = new Set(result.gate_violations.map((v) => v.story_id));
  assert.ok(offenderIds.has('story-x'));
  assert.ok(offenderIds.has('story-y'));
  assert.ok(offenderIds.has('story-z'));
});

test('gate also applies to mode_decision=team-cmux', () => {
  const result = runParallelGate(twoOverlappingBoundedSlice, 'team-cmux');
  assert.equal(result.mode_decision, 'sequential');
  assert.equal(result.mode_reason, 'parallel-gate-refused');
});

test('gate also applies to mode_decision=sessions', () => {
  const result = runParallelGate(twoOverlappingBoundedSlice, 'sessions');
  assert.equal(result.mode_decision, 'sequential');
  assert.equal(result.mode_reason, 'parallel-gate-refused');
});

test('gate also applies to mode_decision=sandcastle', () => {
  const result = runParallelGate(twoOverlappingBoundedSlice, 'sandcastle');
  assert.equal(result.mode_decision, 'sequential');
  assert.equal(result.mode_reason, 'parallel-gate-refused');
});
