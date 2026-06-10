/**
 * mode-resolver.test.mjs
 *
 * Vitest spec covering:
 *   - One test per tier (env, root_config, shipped_baseline, skill_override, default)
 *   - Precedence cascade (multiple tiers set → highest wins; sources records only resolving tier)
 *   - Resolver-name registry (all 6 HIVE_*_MODE names accepted)
 *   - Snapshot test: loads mode-resolver-execute-dispatch.snapshot.json and asserts
 *     byte-equivalent { decision, sources } for each of the 17 entries
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SNAPSHOTS = require('./mode-resolver-execute-dispatch.snapshot.json');

// ---------------------------------------------------------------------------
// Tier tests — one test per tier
// ---------------------------------------------------------------------------

describe('tier: env', () => {
  it('returns the env value and records sources.env when env token matches varName and is a recognized mode', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      env: 'HIVE_EXECUTE_MODE=sandcastle',
    });
    expect(result).toEqual({
      decision: 'sandcastle',
      sources: { env: 'HIVE_EXECUTE_MODE=sandcastle' },
    });
  });

  it('ignores env token with unrecognized mode value and falls through', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      env: 'HIVE_EXECUTE_MODE=not-a-mode',
      rootConfig: { execution: { mode: 'multica' } },
    });
    // env value unrecognized → falls to root_config
    expect(result).toEqual({
      decision: 'multica',
      sources: { root_config: 'execution.mode=multica' },
    });
  });
});

describe('tier: root_config', () => {
  it('returns the root_config mode and records sources.root_config when env absent', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { root_config: 'execution.mode=multica' },
    });
  });
});

describe('tier: shipped_baseline', () => {
  it('returns the shippedBaseline value and records sources.shipped_baseline when higher tiers absent', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      shippedBaseline: 'sandcastle',
    });
    expect(result).toEqual({
      decision: 'sandcastle',
      sources: { shipped_baseline: 'sandcastle' },
    });
  });
});

describe('tier: skill_override', () => {
  it('returns the skillOverride value and records sources.skill_override when higher tiers absent', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      skillOverride: 'multica',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { skill_override: 'multica' },
    });
  });
});

describe('tier: default', () => {
  it('returns decision="default" and sources.default="auto" when all tiers are empty', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
  });

  it('uses caller-supplied default when provided and all other tiers absent', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', { default: 'sequential' });
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'sequential' },
    });
  });
});

// ---------------------------------------------------------------------------
// Precedence cascade — highest tier wins, sources records ONLY the resolving tier
// ---------------------------------------------------------------------------

describe('precedence cascade', () => {
  it('env beats root_config: when both set, env wins and sources has only env', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      env: 'HIVE_EXECUTE_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result.decision).toBe('sandcastle');
    expect(result.sources).toEqual({ env: 'HIVE_EXECUTE_MODE=sandcastle' });
    expect(result.sources.root_config).toBeUndefined();
  });

  it('root_config beats shipped_baseline: when both set, root_config wins', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'sandcastle',
    });
    expect(result.decision).toBe('multica');
    expect(result.sources).toEqual({ root_config: 'execution.mode=multica' });
    expect(result.sources.shipped_baseline).toBeUndefined();
  });

  it('shipped_baseline beats skill_override: when both set, shipped_baseline wins', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      shippedBaseline: 'sandcastle',
      skillOverride: 'multica',
    });
    expect(result.decision).toBe('sandcastle');
    expect(result.sources).toEqual({ shipped_baseline: 'sandcastle' });
    expect(result.sources.skill_override).toBeUndefined();
  });

  it('skill_override beats default: when skillOverride set but no higher tiers, skill_override wins', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      skillOverride: 'cc-workflows',
      default: 'auto',
    });
    expect(result.decision).toBe('cc-workflows');
    expect(result.sources).toEqual({ skill_override: 'cc-workflows' });
    expect(result.sources.default).toBeUndefined();
  });

  it('all tiers set: env wins over all others, sources records only env', () => {
    const result = resolveMode('HIVE_EXECUTE_MODE', {
      env: 'HIVE_EXECUTE_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'multica',
      skillOverride: 'multica',
      default: 'sequential',
    });
    expect(result.decision).toBe('sandcastle');
    expect(Object.keys(result.sources)).toEqual(['env']);
  });
});

// ---------------------------------------------------------------------------
// Resolver-name registry — all 6 HIVE_*_MODE names accepted
// ---------------------------------------------------------------------------

describe('resolver-name registry', () => {
  const ALL_VAR_NAMES = [
    'HIVE_PLAN_MODE',
    'HIVE_EXECUTE_MODE',
    'HIVE_TEST_MODE',
    'HIVE_DESIGN_MODE',
    'HIVE_DESIGN_REVIEW_MODE',
    'HIVE_REVIEW_MODE',
  ];

  for (const varName of ALL_VAR_NAMES) {
    it(`accepts ${varName} and resolves via env tier`, () => {
      const result = resolveMode(varName, {
        env: `${varName}=multica`,
      });
      expect(result).toEqual({
        decision: 'multica',
        sources: { env: `${varName}=multica` },
      });
    });
  }

  it('accepts an unrecognized varName and falls through to default', () => {
    const result = resolveMode('HIVE_FUTURE_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
  });
});

// ---------------------------------------------------------------------------
// Snapshot test — byte-equivalent { decision, sources } for all 17 fixtures
// ---------------------------------------------------------------------------

describe('snapshot parity: mode-resolver-execute-dispatch.snapshot.json', () => {
  it('all 17 snapshot fixtures produce byte-equivalent { decision, sources }', () => {
    for (const fixture of SNAPSHOTS) {
      const result = resolveMode(fixture.varName, fixture.ctx);
      expect(result).toEqual(fixture.expected);
    }
    expect(SNAPSHOTS).toHaveLength(17);
  });

  // Individual fixture tests for precise failure attribution
  SNAPSHOTS.forEach((fixture, idx) => {
    const label = `fixture[${idx}] ${fixture.varName} ctx=${JSON.stringify(fixture.ctx)}`;
    it(label, () => {
      const result = resolveMode(fixture.varName, fixture.ctx);
      expect(result).toEqual(fixture.expected);
    });
  });
});
