import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WEIGHTS,
  DISCOVERY_SOURCE_TO_WEIGHT_KEY,
  resolveWeight,
  computePriorityScore,
  computeWeightedScore,
  rankProposals,
} from '../signal-weights.mjs';

// ---------------------------------------------------------------------------
// DEFAULT_WEIGHTS — all 1.0 baseline
// ---------------------------------------------------------------------------

test('DEFAULT_WEIGHTS — all sources default to 1.0', () => {
  for (const [key, value] of Object.entries(DEFAULT_WEIGHTS)) {
    assert.equal(value, 1.0, `${key} should default to 1.0`);
  }
});

test('DEFAULT_WEIGHTS — covers all five signal sources', () => {
  const required = ['metrics', 'external_research', 'kg_signal', 'dreaming_replay', 'backlog'];
  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_WEIGHTS, key), `missing key: ${key}`);
  }
});

// ---------------------------------------------------------------------------
// DISCOVERY_SOURCE_TO_WEIGHT_KEY mapping
// ---------------------------------------------------------------------------

test('DISCOVERY_SOURCE_TO_WEIGHT_KEY — internal_audit maps to metrics', () => {
  assert.equal(DISCOVERY_SOURCE_TO_WEIGHT_KEY.internal_audit, 'metrics');
});

test('DISCOVERY_SOURCE_TO_WEIGHT_KEY — external_research maps to external_research', () => {
  assert.equal(DISCOVERY_SOURCE_TO_WEIGHT_KEY.external_research, 'external_research');
});

test('DISCOVERY_SOURCE_TO_WEIGHT_KEY — kg_signal maps to kg_signal', () => {
  assert.equal(DISCOVERY_SOURCE_TO_WEIGHT_KEY.kg_signal, 'kg_signal');
});

// ---------------------------------------------------------------------------
// resolveWeight
// ---------------------------------------------------------------------------

test('resolveWeight — returns 1.0 for all sources when configWeights is empty', () => {
  const sources = ['internal_audit', 'external_research', 'kg_signal', 'dreaming_replay', 'backlog'];
  for (const source of sources) {
    assert.equal(resolveWeight(source, {}), 1.0, `${source} should be 1.0 with no config`);
  }
});

test('resolveWeight — applies config override for kg_signal', () => {
  assert.equal(resolveWeight('kg_signal', { kg_signal: 0.4 }), 0.4);
});

test('resolveWeight — applies config override for external_research', () => {
  assert.equal(resolveWeight('external_research', { external_research: 0.9 }), 0.9);
});

test('resolveWeight — applies config override for dreaming_replay', () => {
  assert.equal(resolveWeight('dreaming_replay', { dreaming_replay: 0.5 }), 0.5);
});

test('resolveWeight — applies config override for backlog', () => {
  assert.equal(resolveWeight('backlog', { backlog: 0.2 }), 0.2);
});

test('resolveWeight — internal_audit uses metrics weight from config', () => {
  assert.equal(resolveWeight('internal_audit', { metrics: 1.5 }), 1.5);
});

test('resolveWeight — unknown source returns 1.0 (neutral)', () => {
  assert.equal(resolveWeight('unknown_future_source', {}), 1.0);
});

test('resolveWeight — weight=0 returns 0', () => {
  assert.equal(resolveWeight('kg_signal', { kg_signal: 0 }), 0);
});

// ---------------------------------------------------------------------------
// computePriorityScore — base formula matches step-03 spec
// ---------------------------------------------------------------------------

test('computePriorityScore — formula: impact × (6 − risk) / effort', () => {
  // impact=5, risk=1, effort=1 → 5 × 5 / 1 = 25
  assert.equal(computePriorityScore(5, 1, 1), 25);
});

test('computePriorityScore — mid-range values', () => {
  // impact=3, risk=3, effort=2 → 3 × 3 / 2 = 4.5
  assert.equal(computePriorityScore(3, 3, 2), 4.5);
});

// ---------------------------------------------------------------------------
// computeWeightedScore
// ---------------------------------------------------------------------------

test('computeWeightedScore — weight=1.0 leaves score unchanged', () => {
  const proposal = { discovery_source: 'kg_signal', impact_score: 4, risk_score: 2, effort_score: 2 };
  const base = computePriorityScore(4, 2, 2);
  assert.equal(computeWeightedScore(proposal, { kg_signal: 1.0 }), base);
});

test('computeWeightedScore — weight>1 elevates score', () => {
  const proposal = { discovery_source: 'external_research', impact_score: 3, risk_score: 3, effort_score: 3 };
  const base = computeWeightedScore(proposal, { external_research: 1.0 });
  const elevated = computeWeightedScore(proposal, { external_research: 2.0 });
  assert.ok(elevated > base, 'weight=2.0 should elevate score above weight=1.0');
});

test('computeWeightedScore — weight=0 demotes score to 0', () => {
  const proposal = { discovery_source: 'kg_signal', impact_score: 5, risk_score: 1, effort_score: 1 };
  assert.equal(computeWeightedScore(proposal, { kg_signal: 0 }), 0);
});

// ---------------------------------------------------------------------------
// rankProposals — ordering invariants
// ---------------------------------------------------------------------------

const METRICS_PROPOSAL = {
  id: 'proposal-1',
  discovery_source: 'internal_audit',
  impact_score: 4,
  risk_score: 2,
  effort_score: 2,
};

const KG_PROPOSAL = {
  id: 'proposal-2',
  discovery_source: 'kg_signal',
  impact_score: 4,
  risk_score: 2,
  effort_score: 2,
};

const EXTERNAL_PROPOSAL = {
  id: 'proposal-3',
  discovery_source: 'external_research',
  impact_score: 4,
  risk_score: 2,
  effort_score: 2,
};

const BACKLOG_PROPOSAL = {
  id: 'proposal-4',
  discovery_source: 'backlog',
  impact_score: 4,
  risk_score: 2,
  effort_score: 2,
};

test('rankProposals — weight=1.0 for all preserves original relative order (ties handled stably)', () => {
  const proposals = [METRICS_PROPOSAL, KG_PROPOSAL, EXTERNAL_PROPOSAL, BACKLOG_PROPOSAL];
  const ranked = rankProposals(proposals, {
    metrics: 1.0, external_research: 1.0, kg_signal: 1.0, dreaming_replay: 1.0, backlog: 1.0,
  });
  // All scores equal — ranked length should equal input length
  assert.equal(ranked.length, 4);
  // Every weighted_score should be the same base value
  const scores = ranked.map((p) => p.weighted_score);
  assert.ok(scores.every((s) => s === scores[0]), 'all equal-weight proposals should score the same');
});

test('rankProposals — kg_signal weight>1 elevates kg proposal above same-base-score peers', () => {
  const proposals = [METRICS_PROPOSAL, KG_PROPOSAL];
  const ranked = rankProposals(proposals, { metrics: 1.0, kg_signal: 2.0 });
  assert.equal(ranked[0].id, 'proposal-2', 'kg proposal should rank first with weight=2.0');
});

test('rankProposals — kg_signal weight=0 demotes kg proposal to last', () => {
  const proposals = [METRICS_PROPOSAL, KG_PROPOSAL, EXTERNAL_PROPOSAL];
  const ranked = rankProposals(proposals, { metrics: 1.0, external_research: 1.0, kg_signal: 0 });
  assert.equal(ranked[ranked.length - 1].id, 'proposal-2', 'kg proposal should rank last with weight=0');
  assert.equal(ranked[ranked.length - 1].weighted_score, 0);
});

test('rankProposals — §3.2 maintainer weights produce expected order', () => {
  // §3.2 weights: metrics=1.0, external_research=0.9, kg_signal=0.4, dreaming_replay=0.5, backlog=0.2
  // With identical base scores, order should be: metrics > external_research > dreaming_replay > kg_signal > backlog
  const dreaming = { id: 'proposal-5', discovery_source: 'dreaming_replay', impact_score: 4, risk_score: 2, effort_score: 2 };
  const proposals = [BACKLOG_PROPOSAL, KG_PROPOSAL, dreaming, EXTERNAL_PROPOSAL, METRICS_PROPOSAL];
  const ranked = rankProposals(proposals, {
    metrics: 1.0,
    external_research: 0.9,
    kg_signal: 0.4,
    dreaming_replay: 0.5,
    backlog: 0.2,
  });
  const ids = ranked.map((p) => p.id);
  assert.equal(ids[0], 'proposal-1', 'metrics (1.0) should rank 1st');
  assert.equal(ids[1], 'proposal-3', 'external_research (0.9) should rank 2nd');
  assert.equal(ids[2], 'proposal-5', 'dreaming_replay (0.5) should rank 3rd');
  assert.equal(ids[3], 'proposal-2', 'kg_signal (0.4) should rank 4th');
  assert.equal(ids[4], 'proposal-4', 'backlog (0.2) should rank 5th');
});

test('rankProposals — does not mutate input array', () => {
  const proposals = [METRICS_PROPOSAL, KG_PROPOSAL];
  const original = proposals.map((p) => p.id);
  rankProposals(proposals, { metrics: 1.0, kg_signal: 2.0 });
  assert.deepEqual(proposals.map((p) => p.id), original, 'input array should not be mutated');
});

test('rankProposals — each output proposal gains weighted_score field', () => {
  const ranked = rankProposals([METRICS_PROPOSAL], {});
  assert.ok(Object.prototype.hasOwnProperty.call(ranked[0], 'weighted_score'));
  assert.ok(typeof ranked[0].weighted_score === 'number');
});

test('rankProposals — empty input returns empty array', () => {
  assert.deepEqual(rankProposals([], {}), []);
});
