/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_DESIGN_REVIEW_MODE', ctx).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - Atom routing assertions:
 *     - when decision === 'multica', SKILL.md documents design-review-mode-multica as the downstream target
 *     - when decision === 'cc-workflows', SKILL.md documents design-review-mode-cc-workflows as the downstream target
 *   - Flag pass-through: --skip and --artifact-target are documented in SKILL.md as passed verbatim
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');

// ---------------------------------------------------------------------------
// Tier permutations for varName='HIVE_DESIGN_REVIEW_MODE'
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — tier: env', () => {
  it('env wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'cc-workflows',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'sandcastle',
      sources: { env: 'HIVE_DESIGN_REVIEW_MODE=sandcastle' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });
});

describe('HIVE_DESIGN_REVIEW_MODE — tier: root_config', () => {
  it('root_config wins when env is absent — sources records only root_config', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'cc-workflows',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { root_config: 'execution.mode=multica' },
    });
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });
});

describe('HIVE_DESIGN_REVIEW_MODE — tier: shipped_baseline', () => {
  it('shipped_baseline wins when env and root_config are absent — sources records only shipped_baseline', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      shippedBaseline: 'cc-workflows',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { shipped_baseline: 'cc-workflows' },
    });
    expect(Object.keys(result.sources)).toEqual(['shipped_baseline']);
  });
});

describe('HIVE_DESIGN_REVIEW_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      skillOverride: 'sandcastle',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'sandcastle',
      sources: { skill_override: 'sandcastle' },
    });
    expect(Object.keys(result.sources)).toEqual(['skill_override']);
  });
});

describe('HIVE_DESIGN_REVIEW_MODE — tier: default', () => {
  it('default fires when all higher tiers are absent — decision is "default", sources.default is "auto"', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
    expect(Object.keys(result.sources)).toEqual(['default']);
  });
});

// ---------------------------------------------------------------------------
// Atom routing assertions
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — atom routing: multica', () => {
  it('when decision is "multica", SKILL.md documents design-review-mode-multica as the downstream target', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=multica',
    });
    expect(result.decision).toBe('multica');

    // Confirm SKILL.md names design-review-mode-multica as the downstream atom for multica decisions
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('design-review-mode-multica');
  });
});

describe('HIVE_DESIGN_REVIEW_MODE — atom routing: cc-workflows', () => {
  it('when decision is "cc-workflows", SKILL.md documents design-review-mode-cc-workflows as the downstream target', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=cc-workflows',
    });
    expect(result.decision).toBe('cc-workflows');

    // Confirm SKILL.md names design-review-mode-cc-workflows as the downstream atom for cc-workflows decisions
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('design-review-mode-cc-workflows');
  });
});

// ---------------------------------------------------------------------------
// Flag pass-through assertion
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — flag pass-through', () => {
  it('SKILL.md documents --skip and --artifact-target as verbatim pass-through flags to the resolved mode atom', () => {
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    // SKILL.md must document --skip flag pass-through
    expect(skillMd).toContain('--skip');
    // SKILL.md must document --artifact-target flag pass-through
    expect(skillMd).toContain('--artifact-target');
    // The pass-through clause must describe forwarding verbatim (not consuming/stripping)
    expect(skillMd).toMatch(/pass[-\s]through/i);
  });
});
