/**
 * Tests for hive/lib/cc-workflows-model-tier.mjs
 *
 * Covers all four precedence cases per AC:
 *   (a) override wins when persona has both base + override     → source: 'model_overrides'
 *   (b) base tier returned when only model_tiers assignment     → source: 'model_tiers'
 *   (c) default 'sonnet' + console.warn when persona unmapped  → source: 'default'
 *   (d) snapshot fixture for representative input              → byte-stable output
 *
 * Convention: vitest (matches mode-resolver.test.mjs + cc-workflows-preconditions.test.mjs);
 * package.json `npm test` runs `npx vitest run`, so node:test would never execute here.
 */
import { describe, expect, it } from 'vitest';
import { resolveModelTier } from '../cc-workflows-model-tier.mjs';

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

describe('resolveModelTier — model_overrides precedence', () => {
  it('reviewer is in sonnet model_tiers but model_overrides promotes to opus', () => {
    const result = resolveModelTier('reviewer', { config: baseConfig });
    expect(result.tier).toBe('opus');
    expect(result.source).toBe('model_overrides');
  });

  it('peer-validator override returns opus regardless of tier map', () => {
    const config = {
      model_tiers: { sonnet: ['peer-validator'] },
      model_overrides: { 'peer-validator': 'opus' },
    };
    const result = resolveModelTier('peer-validator', { config });
    expect(result.tier).toBe('opus');
    expect(result.source).toBe('model_overrides');
  });
});

describe('resolveModelTier — model_tiers base mapping', () => {
  it('developer maps to sonnet via model_tiers', () => {
    const result = resolveModelTier('developer', { config: baseConfig });
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('model_tiers');
  });

  it('orchestrator maps to opus via model_tiers', () => {
    const result = resolveModelTier('orchestrator', { config: baseConfig });
    expect(result.tier).toBe('opus');
    expect(result.source).toBe('model_tiers');
  });

  it('test-worker maps to haiku via model_tiers', () => {
    const result = resolveModelTier('test-worker', { config: baseConfig });
    expect(result.tier).toBe('haiku');
    expect(result.source).toBe('model_tiers');
  });
});

describe('resolveModelTier — default fallback', () => {
  it('unmapped persona returns tier=sonnet, source=default', () => {
    const result = resolveModelTier('unknown-persona', { config: baseConfig });
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('default');
  });

  it('unmapped persona emits console.warn naming the persona', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      resolveModelTier('ghost-agent', { config: baseConfig });
    } finally {
      console.warn = origWarn;
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ghost-agent/);
  });

  it('empty config object still returns sonnet+default (no crash)', () => {
    const result = resolveModelTier('developer', { config: {} });
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('default');
  });

  it('null/undefined ctx.config still returns sonnet+default (no crash)', () => {
    const result = resolveModelTier('developer', { config: null });
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('default');
  });
});

describe('resolveModelTier — return shape', () => {
  it('all paths return exactly {tier, source} keys', () => {
    const cases = [
      resolveModelTier('reviewer', { config: baseConfig }),
      resolveModelTier('developer', { config: baseConfig }),
      resolveModelTier('nobody', { config: baseConfig }),
    ];
    for (const result of cases) {
      expect(Object.hasOwn(result, 'tier')).toBe(true);
      expect(Object.hasOwn(result, 'source')).toBe(true);
      expect(Object.keys(result)).toHaveLength(2);
    }
  });
});

describe('resolveModelTier — snapshot', () => {
  it('representative persona list produces byte-stable output', () => {
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

    expect(snapshot.orchestrator).toEqual({ tier: 'opus',   source: 'model_tiers' });
    expect(snapshot.developer).toEqual({ tier: 'sonnet', source: 'model_tiers' });
    expect(snapshot['test-worker']).toEqual({ tier: 'haiku',  source: 'model_tiers' });
    expect(snapshot.reviewer).toEqual({ tier: 'opus',   source: 'model_overrides' });
    expect(snapshot['peer-validator']).toEqual({ tier: 'opus', source: 'model_overrides' });
    expect(snapshot.tpm).toEqual({ tier: 'opus',   source: 'model_tiers' });
    expect(snapshot.unmapped).toEqual({ tier: 'sonnet', source: 'default' });
  });
});
