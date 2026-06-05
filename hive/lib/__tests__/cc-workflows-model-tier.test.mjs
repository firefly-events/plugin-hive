/**
 * Tests for hive/lib/cc-workflows-model-tier.mjs
 *
 * Covers all four precedence cases per AC:
 *   (a) override wins when persona has both base + override     → source: 'model_overrides'
 *   (b) base tier returned when only model_tiers assignment     → source: 'model_tiers'
 *   (c) default 'sonnet' + console.warn when persona unmapped  → source: 'default'
 *   (d) snapshot fixture for representative input              → byte-stable output
 *
 * Convention: node:test + node:assert/strict, __tests__ sibling dir
 * (matches hive/lib/multica-story-dispatch/__tests__/ pattern;
 *  story spec cites hive/lib/test/ but project convention wins per task instructions).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelTier } from '../cc-workflows-model-tier.mjs';

// ---------------------------------------------------------------------------
// Shared fixture config — mirrors the real hive.config.yaml structure
// ---------------------------------------------------------------------------
const baseConfig = {
  model_tiers: {
    opus: ['orchestrator', 'team-lead', 'architect'],
    sonnet: ['developer', 'researcher', 'tester', 'reviewer'],
    haiku: ['test-worker'],
  },
  model_overrides: {
    reviewer: 'opus',
    'peer-validator': 'opus',
  },
};

// ---------------------------------------------------------------------------
// (a) Override wins when persona has BOTH base-tier assignment AND an override
// ---------------------------------------------------------------------------
test('override wins: reviewer is in sonnet model_tiers but model_overrides promotes to opus', () => {
  const result = resolveModelTier('reviewer', { config: baseConfig });
  assert.equal(result.tier, 'opus');
  assert.equal(result.source, 'model_overrides');
});

test('override wins: peer-validator override returns opus regardless of tier map', () => {
  const config = {
    model_tiers: { sonnet: ['peer-validator'] },
    model_overrides: { 'peer-validator': 'opus' },
  };
  const result = resolveModelTier('peer-validator', { config });
  assert.equal(result.tier, 'opus');
  assert.equal(result.source, 'model_overrides');
});

// ---------------------------------------------------------------------------
// (b) Base tier returned when persona has ONLY a model_tiers assignment (no override)
// ---------------------------------------------------------------------------
test('base tier: developer maps to sonnet via model_tiers', () => {
  const result = resolveModelTier('developer', { config: baseConfig });
  assert.equal(result.tier, 'sonnet');
  assert.equal(result.source, 'model_tiers');
});

test('base tier: orchestrator maps to opus via model_tiers', () => {
  const result = resolveModelTier('orchestrator', { config: baseConfig });
  assert.equal(result.tier, 'opus');
  assert.equal(result.source, 'model_tiers');
});

test('base tier: test-worker maps to haiku via model_tiers', () => {
  const result = resolveModelTier('test-worker', { config: baseConfig });
  assert.equal(result.tier, 'haiku');
  assert.equal(result.source, 'model_tiers');
});

// ---------------------------------------------------------------------------
// (c) Default 'sonnet' + console.warn when persona is unmapped in both maps
// ---------------------------------------------------------------------------
test('default: unmapped persona returns tier=sonnet, source=default', () => {
  const result = resolveModelTier('unknown-persona', { config: baseConfig });
  assert.equal(result.tier, 'sonnet');
  assert.equal(result.source, 'default');
});

test('default: unmapped persona emits console.warn naming the persona', () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    resolveModelTier('ghost-agent', { config: baseConfig });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ghost-agent/);
});

test('default: empty config object still returns sonnet+default (no crash)', () => {
  const result = resolveModelTier('developer', { config: {} });
  assert.equal(result.tier, 'sonnet');
  assert.equal(result.source, 'default');
});

test('default: null/undefined ctx.config still returns sonnet+default (no crash)', () => {
  const result = resolveModelTier('developer', { config: null });
  assert.equal(result.tier, 'sonnet');
  assert.equal(result.source, 'default');
});

// ---------------------------------------------------------------------------
// Return-shape invariants — {tier, source} always present on all paths
// ---------------------------------------------------------------------------
test('return shape: all paths return exactly {tier, source} keys', () => {
  const cases = [
    resolveModelTier('reviewer', { config: baseConfig }),    // model_overrides path
    resolveModelTier('developer', { config: baseConfig }),   // model_tiers path
    resolveModelTier('nobody', { config: baseConfig }),      // default path
  ];
  for (const result of cases) {
    assert.ok(Object.hasOwn(result, 'tier'), 'missing tier key');
    assert.ok(Object.hasOwn(result, 'source'), 'missing source key');
    assert.equal(Object.keys(result).length, 2, 'extra keys on result');
  }
});

// ---------------------------------------------------------------------------
// (d) Snapshot fixture — byte-stable output for representative input
//
// The representative input mirrors the actual hive.config.yaml persona list
// (reviewer → opus override, developer → sonnet base, test-worker → haiku base,
// unmapped persona → sonnet default). This snapshot is intentionally verbose so
// any future change to tier/source values causes an immediate test failure.
// ---------------------------------------------------------------------------
test('snapshot: representative persona list produces byte-stable output', () => {
  const representativeConfig = {
    model_tiers: {
      opus: ['orchestrator', 'team-lead', 'architect', 'analyst', 'tpm'],
      sonnet: [
        'researcher', 'developer', 'frontend-developer', 'backend-developer',
        'tester', 'reviewer', 'pair-programmer', 'peer-validator',
        'ui-designer', 'technical-writer',
      ],
      haiku: ['test-worker'],
    },
    model_overrides: {
      reviewer: 'opus',
      'peer-validator': 'opus',
    },
  };

  const snapshot = {
    orchestrator: resolveModelTier('orchestrator', { config: representativeConfig }),
    developer: resolveModelTier('developer', { config: representativeConfig }),
    'test-worker': resolveModelTier('test-worker', { config: representativeConfig }),
    reviewer: resolveModelTier('reviewer', { config: representativeConfig }),
    'peer-validator': resolveModelTier('peer-validator', { config: representativeConfig }),
    tpm: resolveModelTier('tpm', { config: representativeConfig }),
    unmapped: resolveModelTier('unmapped-persona', { config: representativeConfig }),
  };

  // Byte-stable expectations
  assert.deepEqual(snapshot.orchestrator,    { tier: 'opus',   source: 'model_tiers' });
  assert.deepEqual(snapshot.developer,       { tier: 'sonnet', source: 'model_tiers' });
  assert.deepEqual(snapshot['test-worker'],  { tier: 'haiku',  source: 'model_tiers' });
  assert.deepEqual(snapshot.reviewer,        { tier: 'opus',   source: 'model_overrides' });
  assert.deepEqual(snapshot['peer-validator'], { tier: 'opus', source: 'model_overrides' });
  assert.deepEqual(snapshot.tpm,             { tier: 'opus',   source: 'model_tiers' });
  assert.deepEqual(snapshot.unmapped,        { tier: 'sonnet', source: 'default' });
});
