import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daysBetween,
  classifyMemoryRecord,
  findRecentFeedbackMemories,
} from '../feedback-memory-finder.mjs';

const NOW = '2026-06-09T20:00:00Z';

function makeRecord(over = {}) {
  return {
    path: '/Users/don/.claude/projects/-hive/memory/feedback_test_thing.md',
    mtimeIso: '2026-06-09T15:00:00Z',
    frontmatter: {
      name: 'feedback_test_thing',
      description: 'Something to remember',
      metadata: { type: 'feedback' },
    },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// daysBetween (local copy in this module — keep coverage here too)
// ---------------------------------------------------------------------------

test('daysBetween — positive for an earlier mtime', () => {
  assert.equal(daysBetween('2026-06-08T20:00:00Z', NOW), 1);
});

test('daysBetween — null on invalid input', () => {
  assert.equal(daysBetween('not a date', NOW), null);
});

// ---------------------------------------------------------------------------
// classifyMemoryRecord
// ---------------------------------------------------------------------------

test('classifyMemoryRecord — null when path is not a feedback_*.md file', () => {
  const r = makeRecord({ path: '/path/to/project_thing.md' });
  assert.equal(classifyMemoryRecord(r, NOW), null);
});

test('classifyMemoryRecord — null when path has no filename component', () => {
  const r = makeRecord({ path: '' });
  assert.equal(classifyMemoryRecord(r, NOW), null);
});

test('classifyMemoryRecord — null when path is non-md', () => {
  const r = makeRecord({ path: '/x/feedback_foo.txt' });
  assert.equal(classifyMemoryRecord(r, NOW), null);
});

test('classifyMemoryRecord — null when older than windowDays', () => {
  const r = makeRecord({ mtimeIso: '2026-05-30T20:00:00Z' }); // 10d old
  assert.equal(classifyMemoryRecord(r, NOW), null);
});

test('classifyMemoryRecord — null when mtimeIso missing or invalid', () => {
  assert.equal(classifyMemoryRecord(makeRecord({ mtimeIso: undefined }), NOW), null);
  assert.equal(classifyMemoryRecord(makeRecord({ mtimeIso: 'banana' }), NOW), null);
});

test('classifyMemoryRecord — very-fresh when written within 1d', () => {
  const r = makeRecord({ mtimeIso: '2026-06-09T15:00:00Z' });
  assert.equal(classifyMemoryRecord(r, NOW), 'very-fresh');
});

test('classifyMemoryRecord — fresh when within 7d but past 1d', () => {
  const r = makeRecord({ mtimeIso: '2026-06-05T20:00:00Z' });
  assert.equal(classifyMemoryRecord(r, NOW), 'fresh');
});

test('classifyMemoryRecord — exactly at windowDays boundary still emits', () => {
  const r = makeRecord({ mtimeIso: '2026-06-02T20:00:00Z' });
  assert.equal(classifyMemoryRecord(r, NOW), 'fresh');
});

test('classifyMemoryRecord — future-mtime is ignored (negative age)', () => {
  const r = makeRecord({ mtimeIso: '2026-06-10T20:00:00Z' });
  assert.equal(classifyMemoryRecord(r, NOW), null);
});

test('classifyMemoryRecord — custom windowDays and veryFreshDays', () => {
  const r = makeRecord({ mtimeIso: '2026-06-07T00:00:00Z' });
  assert.equal(classifyMemoryRecord(r, NOW, { windowDays: 2 }), null);
  assert.equal(classifyMemoryRecord(r, NOW, { windowDays: 5 }), 'fresh');
  assert.equal(classifyMemoryRecord(r, NOW, { veryFreshDays: 5 }), 'very-fresh');
});

// ---------------------------------------------------------------------------
// findRecentFeedbackMemories
// ---------------------------------------------------------------------------

test('findRecentFeedbackMemories — throws when caller forgets nowIso', () => {
  assert.throws(() => findRecentFeedbackMemories([]), /nowIso/);
});

test('findRecentFeedbackMemories — empty / non-array inputs return empty', () => {
  assert.deepEqual(findRecentFeedbackMemories([], { nowIso: NOW }), []);
  assert.deepEqual(findRecentFeedbackMemories(null, { nowIso: NOW }), []);
  assert.deepEqual(findRecentFeedbackMemories(undefined, { nowIso: NOW }), []);
});

test('findRecentFeedbackMemories — emits one finding per fresh record', () => {
  const records = [
    makeRecord({
      path: '/x/feedback_writer_model_downgrade.md',
      mtimeIso: '2026-06-09T15:00:00Z',
      frontmatter: { name: 'feedback_writer_model_downgrade', description: 'Writer agent downgrade scrutiny' },
    }),
    makeRecord({
      path: '/x/feedback_squad_spike.md',
      mtimeIso: '2026-06-08T16:56:00Z',
      frontmatter: { name: 'feedback_squad_spike', description: 'Squad spike misread' },
    }),
    makeRecord({
      path: '/x/feedback_old.md',
      mtimeIso: '2026-05-01T00:00:00Z',
    }),
    makeRecord({
      path: '/x/project_ignored.md',
      mtimeIso: '2026-06-09T15:00:00Z',
    }),
  ];
  const findings = findRecentFeedbackMemories(records, { nowIso: NOW });
  assert.equal(findings.length, 2);
  // very-fresh (high) sorts first
  assert.equal(findings[0].evidence.memory_slug, 'feedback_writer_model_downgrade');
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[1].evidence.memory_slug, 'feedback_squad_spike');
  assert.equal(findings[1].severity, 'medium');
});

test('findRecentFeedbackMemories — finding shape carries path, slug, age, frontmatter desc', () => {
  // 2 days old → bucket 'fresh' (veryFreshDays=1)
  const r = makeRecord({
    path: '/x/feedback_hot_thing.md',
    mtimeIso: '2026-06-07T20:00:00Z',
    frontmatter: { name: 'feedback_hot_thing', description: 'Why this matters' },
  });
  const [f] = findRecentFeedbackMemories([r], { nowIso: NOW });
  assert.equal(f.id, 'finding-feedback-feedback_hot_thing');
  assert.equal(f.category, 'RECENT_FEEDBACK_MEMORY');
  assert.equal(f.location, 'memory:feedback_hot_thing');
  assert.equal(f.evidence.memory_path, '/x/feedback_hot_thing.md');
  assert.equal(f.evidence.memory_slug, 'feedback_hot_thing');
  assert.equal(f.evidence.age_days, 2);
  assert.equal(f.evidence.bucket, 'fresh');
  assert.equal(f.severity, 'medium');
  assert.equal(f.evidence.frontmatter_description, 'Why this matters');
});

test('findRecentFeedbackMemories — falls back to filename slug when frontmatter absent', () => {
  const r = makeRecord({
    path: '/x/feedback_no_frontmatter.md',
    mtimeIso: '2026-06-09T15:00:00Z',
    frontmatter: undefined,
  });
  const [f] = findRecentFeedbackMemories([r], { nowIso: NOW });
  assert.equal(f.evidence.memory_slug, 'feedback_no_frontmatter');
});

test('findRecentFeedbackMemories — description truncated to 100 chars', () => {
  const r = makeRecord({
    mtimeIso: '2026-06-09T15:00:00Z',
    frontmatter: { name: 'feedback_long', description: 'x'.repeat(500) },
  });
  const [f] = findRecentFeedbackMemories([r], { nowIso: NOW });
  // description in the human description string is truncated; frontmatter_description preserved fully
  assert.ok(f.description.length < 500);
  assert.equal(f.evidence.frontmatter_description.length, 500);
});
