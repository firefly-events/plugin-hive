/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_REVIEW_MODE', ctx).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - Atom routing assertions:
 *     - when decision === 'multica', SKILL.md documents review-mode-multica as the downstream target
 *     - when decision === 'cc-workflows', SKILL.md documents review-mode-cc-workflows as the downstream target
 *   - scope_drift emit preservation: doc-grep test confirming skills/review/SKILL.md still references
 *     hive/lib/scope_drift.py and the emit call lives in the same logical position (Step 6 / review:complete)
 *   - Flag pass-through: --sequential is documented in SKILL.md as passed verbatim to the resolved mode atom
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');

// Path to skills/review/SKILL.md relative to this test file.
// Traversal from skills/hive/skills/review-dispatch/test/ up to the repo root,
// then down to skills/review/SKILL.md:
//   test/ -> review-dispatch/ -> skills/ -> hive/ -> skills/   (five `..` segments)
//   then  skills/review/SKILL.md
const REVIEW_SKILL_MD_PATH = path.resolve(__dirname, '../../../../../skills/review/SKILL.md');

// ---------------------------------------------------------------------------
// Tier permutations for varName='HIVE_REVIEW_MODE'
// ---------------------------------------------------------------------------

describe('HIVE_REVIEW_MODE — tier: env', () => {
  it('env wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'cc-workflows',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'sandcastle',
      sources: { env: 'HIVE_REVIEW_MODE=sandcastle' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });
});

describe('HIVE_REVIEW_MODE — tier: root_config', () => {
  it('root_config wins when env is absent — sources records only root_config', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
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

describe('HIVE_REVIEW_MODE — tier: shipped_baseline', () => {
  it('shipped_baseline wins when env and root_config are absent — sources records only shipped_baseline', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
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

describe('HIVE_REVIEW_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
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

describe('HIVE_REVIEW_MODE — tier: default', () => {
  it('default fires when all higher tiers are absent — decision is "default", sources.default is "auto"', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {});
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

describe('HIVE_REVIEW_MODE — atom routing: multica', () => {
  it('when decision is "multica", SKILL.md documents review-mode-multica as the downstream target', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=multica',
    });
    expect(result.decision).toBe('multica');

    // Confirm SKILL.md names review-mode-multica as the downstream atom for multica decisions
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('review-mode-multica');
  });
});

describe('HIVE_REVIEW_MODE — atom routing: cc-workflows', () => {
  it('when decision is "cc-workflows", SKILL.md documents review-mode-cc-workflows as the downstream target', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=cc-workflows',
    });
    expect(result.decision).toBe('cc-workflows');

    // Confirm SKILL.md names review-mode-cc-workflows as the downstream atom for cc-workflows decisions
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('review-mode-cc-workflows');
  });
});

// ---------------------------------------------------------------------------
// scope_drift emit preservation (documentation-contract test)
//
// Runtime spy on Python from vitest is impractical. Instead, verify the doc
// contract: skills/review/SKILL.md must still reference hive/lib/scope_drift.py
// and the emit call must carry the 'review:complete' phase label and the
// extra_dimensions verdict field — confirming the emit site has not been
// silently removed or merged into another location.
// ---------------------------------------------------------------------------

describe('scope_drift emit preservation — doc-grep contract', () => {
  it('skills/review/SKILL.md references hive/lib/scope_drift.py as the emit target', () => {
    const reviewSkillMd = fs.readFileSync(REVIEW_SKILL_MD_PATH, 'utf8');
    expect(reviewSkillMd).toContain('hive/lib/scope_drift.py');
  });

  it("skills/review/SKILL.md carries the 'review:complete' phase_label at the emit site", () => {
    const reviewSkillMd = fs.readFileSync(REVIEW_SKILL_MD_PATH, 'utf8');
    expect(reviewSkillMd).toContain('review:complete');
  });

  it("skills/review/SKILL.md includes extra_dimensions with 'verdict' key at the emit site", () => {
    const reviewSkillMd = fs.readFileSync(REVIEW_SKILL_MD_PATH, 'utf8');
    // The emit call must pass extra_dimensions={'verdict': ...}
    expect(reviewSkillMd).toMatch(/extra_dimensions.*verdict/s);
  });

  it('review-dispatch SKILL.md documents the scope_drift emit as one of exactly 3 sanctioned call sites', () => {
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    // Confirm the dispatch skill documents the 3-site constraint
    expect(skillMd).toMatch(/3 sanctioned/i);
  });
});

// ---------------------------------------------------------------------------
// Flag pass-through assertion
// ---------------------------------------------------------------------------

describe('HIVE_REVIEW_MODE — flag pass-through', () => {
  it('SKILL.md documents --sequential as a verbatim pass-through flag to the resolved mode atom', () => {
    const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf8');
    // SKILL.md must document --sequential flag pass-through
    expect(skillMd).toContain('--sequential');
    // The pass-through clause must describe forwarding verbatim (not consuming/stripping)
    expect(skillMd).toMatch(/pass[-\s]through/i);
  });
});
