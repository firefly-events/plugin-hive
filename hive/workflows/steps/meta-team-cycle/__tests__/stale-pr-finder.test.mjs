import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daysBetween,
  classifyPr,
  findStalePrs,
} from '../stale-pr-finder.mjs';

const NOW = '2026-06-09T20:00:00Z';

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

test('daysBetween — returns positive days for an earlier timestamp', () => {
  assert.equal(daysBetween('2026-06-02T20:00:00Z', NOW), 7);
});

test('daysBetween — returns 0 for the same timestamp', () => {
  assert.equal(daysBetween(NOW, NOW), 0);
});

test('daysBetween — returns null for invalid input', () => {
  assert.equal(daysBetween('not a date', NOW), null);
  assert.equal(daysBetween(NOW, 'also not a date'), null);
});

// ---------------------------------------------------------------------------
// classifyPr fixtures
// ---------------------------------------------------------------------------

function makePr(over = {}) {
  return {
    number: 100,
    title: 'A PR',
    headRefName: 'feat/foo',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    reviewDecision: null,
    reviewRequests: [],
    isDraft: false,
    state: 'OPEN',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// classifyPr
// ---------------------------------------------------------------------------

test('classifyPr — null for fresh PR (≤7d since update)', () => {
  const pr = makePr({ updatedAt: '2026-06-08T20:00:00Z' });
  assert.equal(classifyPr(pr, NOW), null);
});

test('classifyPr — null for draft PR', () => {
  const pr = makePr({ isDraft: true });
  assert.equal(classifyPr(pr, NOW), null);
});

test('classifyPr — null for closed/merged PR', () => {
  assert.equal(classifyPr(makePr({ state: 'CLOSED' }), NOW), null);
  assert.equal(classifyPr(makePr({ state: 'MERGED' }), NOW), null);
});

test('classifyPr — null when neither updatedAt nor createdAt present', () => {
  const pr = makePr({ updatedAt: null, createdAt: null });
  assert.equal(classifyPr(pr, NOW), null);
});

test('classifyPr — watch tier when 8+d but no reviewer assigned', () => {
  const pr = makePr({
    updatedAt: '2026-06-01T00:00:00Z',
    reviewDecision: null,
    reviewRequests: [],
  });
  const result = classifyPr(pr, NOW);
  assert.equal(result.tier, 'watch');
});

test('classifyPr — medium tier when 8d AND outstanding review request', () => {
  const pr = makePr({
    updatedAt: '2026-06-01T00:00:00Z',
    reviewRequests: [{ login: 'reviewer' }],
  });
  const result = classifyPr(pr, NOW);
  assert.equal(result.tier, 'medium');
});

test('classifyPr — medium tier when 8d AND reviewDecision REVIEW_REQUIRED', () => {
  const pr = makePr({
    updatedAt: '2026-06-01T00:00:00Z',
    reviewDecision: 'REVIEW_REQUIRED',
  });
  const result = classifyPr(pr, NOW);
  assert.equal(result.tier, 'medium');
});

test('classifyPr — critical tier when 15+d AND outstanding review request', () => {
  const pr = makePr({
    updatedAt: '2026-05-25T20:00:00Z',
    reviewRequests: [{ login: 'reviewer' }],
  });
  const result = classifyPr(pr, NOW);
  assert.equal(result.tier, 'critical');
});

test('classifyPr — critical tier requires reviewer attached; 15d without reviewer stays watch', () => {
  const pr = makePr({
    updatedAt: '2026-05-25T20:00:00Z',
    reviewDecision: null,
    reviewRequests: [],
  });
  const result = classifyPr(pr, NOW);
  assert.equal(result.tier, 'watch');
});

test('classifyPr — custom staleDays/criticalDays override', () => {
  const pr = makePr({
    updatedAt: '2026-06-06T20:00:00Z',
    reviewRequests: [{ login: 'reviewer' }],
  });
  const lenient = classifyPr(pr, NOW, { staleDays: 14 });
  assert.equal(lenient, null);
  const strict = classifyPr(pr, NOW, { staleDays: 2 });
  assert.equal(strict.tier, 'medium');
});

// ---------------------------------------------------------------------------
// findStalePrs
// ---------------------------------------------------------------------------

test('findStalePrs — throws when caller forgets nowIso', () => {
  assert.throws(() => findStalePrs([]), /nowIso/);
});

test('findStalePrs — empty input returns empty findings', () => {
  assert.deepEqual(findStalePrs([], { nowIso: NOW }), []);
});

test('findStalePrs — emits one finding per stale PR with severity mapping', () => {
  const prs = [
    makePr({
      number: 200,
      title: 'critical PR',
      updatedAt: '2026-05-25T00:00:00Z',
      reviewRequests: [{ login: 'r' }],
    }),
    makePr({
      number: 201,
      title: 'medium PR',
      updatedAt: '2026-06-01T00:00:00Z',
      reviewRequests: [{ login: 'r' }],
    }),
    makePr({
      number: 202,
      title: 'watch PR',
      updatedAt: '2026-06-01T00:00:00Z',
    }),
    makePr({
      number: 203,
      title: 'fresh',
      updatedAt: '2026-06-09T00:00:00Z',
    }),
  ];
  const findings = findStalePrs(prs, { nowIso: NOW });
  assert.equal(findings.length, 3);
  // sort: severity-desc, then age-desc within tier
  assert.equal(findings[0].evidence.pr_number, 200);
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[1].evidence.pr_number, 201);
  assert.equal(findings[1].severity, 'medium');
  assert.equal(findings[2].evidence.pr_number, 202);
  assert.equal(findings[2].severity, 'low');
});

test('findStalePrs — finding shape carries pr_number, head_ref, age, tier', () => {
  const prs = [
    makePr({
      number: 300,
      title: 'stuck PR',
      headRefName: 'feat/abc',
      updatedAt: '2026-05-30T20:00:00Z',
      reviewRequests: [{ login: 'r' }],
    }),
  ];
  const [f] = findStalePrs(prs, { nowIso: NOW });
  assert.equal(f.id, 'finding-stale-pr-300');
  assert.equal(f.category, 'STALE_OPEN_PR');
  assert.equal(f.location, 'branch:feat/abc');
  assert.equal(f.evidence.pr_number, 300);
  assert.equal(f.evidence.head_ref, 'feat/abc');
  assert.equal(f.evidence.age_days, 10);
  assert.equal(f.evidence.tier, 'medium');
  assert.equal(f.evidence.outstanding_review_requests, 1);
});

test('findStalePrs — when head ref missing falls back to pr:<number> location', () => {
  const prs = [
    makePr({
      number: 400,
      headRefName: null,
      updatedAt: '2026-05-30T00:00:00Z',
      reviewRequests: [{ login: 'r' }],
    }),
  ];
  const [f] = findStalePrs(prs, { nowIso: NOW });
  assert.equal(f.location, 'pr:400');
});

test('findStalePrs — drafts and closed PRs filtered out before findings emit', () => {
  const prs = [
    makePr({ number: 500, isDraft: true, updatedAt: '2026-05-01T00:00:00Z' }),
    makePr({ number: 501, state: 'CLOSED', updatedAt: '2026-05-01T00:00:00Z' }),
    makePr({ number: 502, state: 'MERGED', updatedAt: '2026-05-01T00:00:00Z' }),
  ];
  const findings = findStalePrs(prs, { nowIso: NOW });
  assert.deepEqual(findings, []);
});

test('findStalePrs — non-array input returns empty findings (defensive)', () => {
  assert.deepEqual(findStalePrs(null, { nowIso: NOW }), []);
  assert.deepEqual(findStalePrs(undefined, { nowIso: NOW }), []);
  assert.deepEqual(findStalePrs({}, { nowIso: NOW }), []);
});
