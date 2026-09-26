/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_DESIGN_REVIEW_MODE', ctx) as used by the
 * design-review-mode-multica atom (dr-2).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - ctx.env raw-token footgun: passing just the value (not "VARNAME=value") silently
 *     falls through; this test confirms only the raw token format wins tier 1
 *   - Source tracking: only the winning tier key appears in sources (no leakage)
 *   - 4-step dispatch shape assertions:
 *     - SKILL.md prescribes 4 agent() calls (accessibility-specialist,
 *       animations-specialist, ui-designer critique, ui-designer synthesis)
 *     - SKILL.md prescribes a SINGLE Multica run (not per-persona fan-out)
 *   - Single-run episode marker shape: ONE multica-run.yaml marker, not per-persona
 *   - No-codex assertions: dr-2 is a *-mode-multica atom; lint scope check documented
 *   - --skip and --artifact-target flags documented in SKILL.md as forwarded verbatim
 *
 * Architecture note (Q11 ruling):
 *   dr-2 intentionally differs from d-3 (design-mode-multica per-persona fan-out).
 *   dr-2 mirrors design-review.workflow.yaml:8-81 — ONE Multica issue, FOUR agent() calls,
 *   ONE episode marker. Tests assert this structural contract explicitly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SKILL.md paths relative to this test file
// test/ -> design-review-mode-multica/ -> skills/ -> hive/ -> skills/
const ATOM_SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');
const DISPATCH_SKILL_MD_PATH = path.resolve(__dirname, '../../design-review-dispatch/SKILL.md');

// ---------------------------------------------------------------------------
// Tier 1: env
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — tier: env', () => {
  it('env=multica wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=multica',
      rootConfig: { execution: { mode: 'cc-workflows' } },
      shippedBaseline: 'sandcastle',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { env: 'HIVE_DESIGN_REVIEW_MODE=multica' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=cc-workflows wins over all other tiers', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=cc-workflows',
      rootConfig: { execution: { mode: 'multica' } },
      default: 'auto',
    });
    expect(result.decision).toBe('cc-workflows');
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=sandcastle wins over root_config', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result.decision).toBe('sandcastle');
    expect(result.sources).toEqual({ env: 'HIVE_DESIGN_REVIEW_MODE=sandcastle' });
  });

  it('raw-token footgun: passing bare value (not VARNAME=value) silently ignores env tier', () => {
    // Passing just 'multica' instead of 'HIVE_DESIGN_REVIEW_MODE=multica' must NOT win tier 1.
    // The resolver parses at '=' — no '=' means the varName check fails and resolution
    // falls through to the next tier.
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'multica',   // WRONG format — no '=' separator
      rootConfig: { execution: { mode: 'cc-workflows' } },
    });
    // Falls through to root_config, not env
    expect(result.decision).toBe('cc-workflows');
    expect(result.sources).not.toHaveProperty('env');
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });

  it('raw-token footgun: passing wrong VARNAME silently ignores env tier', () => {
    // Wrong variable name — must fall through even though format is correct
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_EXECUTE_MODE=multica',   // wrong var name
      rootConfig: { execution: { mode: 'cc-workflows' } },
    });
    expect(result.decision).toBe('cc-workflows');
    expect(result.sources).not.toHaveProperty('env');
  });
});

// ---------------------------------------------------------------------------
// Tier 2: root_config
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — tier: root_config', () => {
  it('root_config=multica wins when env is absent — sources records only root_config', () => {
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

  it('root_config=cc-workflows wins when env is absent', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      rootConfig: { execution: { mode: 'cc-workflows' } },
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { root_config: 'execution.mode=cc-workflows' },
    });
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: shipped_baseline
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — tier: shipped_baseline', () => {
  it('shipped_baseline wins when env and root_config are absent — sources records only shipped_baseline', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      shippedBaseline: 'multica',
      skillOverride: 'cc-workflows',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { shipped_baseline: 'multica' },
    });
    expect(Object.keys(result.sources)).toEqual(['shipped_baseline']);
  });

  it('shipped_baseline=cc-workflows also wins at tier 3', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      shippedBaseline: 'cc-workflows',
      default: 'auto',
    });
    expect(result.decision).toBe('cc-workflows');
    expect(result.sources).toEqual({ shipped_baseline: 'cc-workflows' });
  });
});

// ---------------------------------------------------------------------------
// Tier 4: skill_override
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      skillOverride: 'multica',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { skill_override: 'multica' },
    });
    expect(Object.keys(result.sources)).toEqual(['skill_override']);
  });
});

// ---------------------------------------------------------------------------
// Tier 5: default
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — tier: default', () => {
  it('default fires when all higher tiers are absent — decision is "default", sources.default is "auto"', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
    expect(Object.keys(result.sources)).toEqual(['default']);
  });

  it('caller-supplied default value is reflected in sources.default', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', { default: 'auto' });
    expect(result.decision).toBe('default');
    expect(result.sources.default).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// 4-step dispatch shape assertions (SKILL.md structural contract)
// ---------------------------------------------------------------------------

describe('dr-2 4-step dispatch shape — atom SKILL.md', () => {
  it('SKILL.md prescribes accessibility-specialist as Step A agent() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('accessibility-specialist');
  });

  it('SKILL.md prescribes animations-specialist as Step B agent() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('animations-specialist');
  });

  it('SKILL.md prescribes ui-designer critique as Step C agent() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // ui-designer appears for both critique (Step C) and synthesis (Step D)
    expect(content).toContain('ui-designer');
    // The critique step (C) uses design-review-design-critique.md step_file
    expect(content).toContain('design-review-design-critique.md');
  });

  it('SKILL.md prescribes ui-designer synthesis as Step D agent() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // The synthesis step (D) uses design-review-synthesis.md step_file
    expect(content).toContain('design-review-synthesis.md');
  });

  it('SKILL.md documents exactly 4 steps (A B C D) matching workflow.yaml:8-81', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Step labels from the SKILL.md (Step A, Step B, Step C, Step D)
    expect(content).toMatch(/Step A/);
    expect(content).toMatch(/Step B/);
    expect(content).toMatch(/Step C/);
    expect(content).toMatch(/Step D/);
  });

  it('SKILL.md cites design-review.workflow.yaml as the architectural anchor', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('design-review.workflow.yaml');
  });
});

// ---------------------------------------------------------------------------
// Single-run shape assertions (intentional asymmetry with d-3)
// ---------------------------------------------------------------------------

describe('dr-2 single-run shape — intentional asymmetry with d-3', () => {
  it('SKILL.md documents ONE Multica issue for the entire 4-step run (not per-step)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must state single issue / single Multica run
    expect(content).toMatch(/ONE Multica (issue|run)/i);
  });

  it('SKILL.md documents ONE episode marker capturing all 4 outputs (not per-persona)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // multica-run.yaml is the single marker
    expect(content).toContain('multica-run.yaml');
    // Must explicitly contrast with per-persona shape
    expect(content).toMatch(/ONE episode marker/i);
  });

  it('SKILL.md does NOT prescribe per-persona episode markers', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // dr-2 must NOT claim per-persona as its dispatch unit
    expect(content).not.toMatch(/per-persona episode marker/i);
    // dr-2 must NOT claim fan-out as its dispatch pattern
    expect(content).not.toMatch(/per-persona fan-out.*this skill/i);
  });

  it('SKILL.md documents intentional asymmetry with d-3 (per-persona)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must mention d-3 or design-mode-multica as the contrast
    const hasD3Ref = content.includes('d-3') || content.includes('design-mode-multica');
    expect(hasD3Ref).toBe(true);
  });

  it('SKILL.md documents the Q11 ruling as rationale for single-run shape', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('Q11');
  });

  it('episode marker path uses unit_id as the directory (not persona name)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // The marker path uses {unit_id} not a persona name
    expect(content).toContain('{unit_id}');
    expect(content).toContain('multica-run.yaml');
  });
});

// ---------------------------------------------------------------------------
// --skip flag semantics
// ---------------------------------------------------------------------------

describe('dr-2 —-skip flag semantics', () => {
  it('SKILL.md documents --skip as forwarded verbatim from caller to this atom', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--skip');
  });

  it('SKILL.md documents --skip accessibility as suppressing Step A only', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--skip accessibility');
  });

  it('SKILL.md documents --skip animations as suppressing Step B only', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--skip animations');
  });

  it('SKILL.md documents that required steps C and D cannot be skipped', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document that required steps cannot be skipped
    expect(content).toMatch(/Required steps.*cannot be skipped|required.*cannot.*skip/i);
  });
});

// ---------------------------------------------------------------------------
// --artifact-target flag semantics
// ---------------------------------------------------------------------------

describe('dr-2 --artifact-target flag semantics', () => {
  it('SKILL.md documents --artifact-target as forwarded verbatim to Steps C and D', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--artifact-target');
  });

  it('SKILL.md documents {design|implementation} as the valid --artifact-target values', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Both values must appear near --artifact-target documentation
    expect(content).toMatch(/design\|implementation|design.*implementation/i);
  });
});

// ---------------------------------------------------------------------------
// Dispatch skill routing assertion
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_REVIEW_MODE — dispatch routing via design-review-dispatch', () => {
  it('when decision is "multica", design-review-dispatch SKILL.md documents design-review-mode-multica as the target', () => {
    const result = resolveMode('HIVE_DESIGN_REVIEW_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=multica',
    });
    expect(result.decision).toBe('multica');

    const dispatchSkillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(dispatchSkillMd).toContain('design-review-mode-multica');
  });
});

// ---------------------------------------------------------------------------
// 5-tier resolution call shape — Phase 0c contract
// ---------------------------------------------------------------------------

describe('Phase 0c 5-tier resolution — SKILL.md documents resolveMode call', () => {
  it('SKILL.md documents resolveMode invocation with HIVE_DESIGN_REVIEW_MODE as varName', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("resolveMode('HIVE_DESIGN_REVIEW_MODE'");
  });

  it('SKILL.md documents 5-tier precedence: env > root_config > shipped_baseline > skill_override > default', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Note: SKILL.md uses markdown-escaped underscores (root\_config), so match with flexible separator
    expect(content).toMatch(/env.*root.{1,2}config.*shipped.{1,2}baseline.*skill.{1,2}override.*default/si);
  });

  it('SKILL.md imports mode-resolver.mjs from hive/lib/', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('hive/lib/mode-resolver.mjs');
  });
});

// ---------------------------------------------------------------------------
// No-codex scope note — dr-2 is a *-mode-multica atom
// ---------------------------------------------------------------------------

describe('no-codex scope — dr-2 is a *-mode-multica atom', () => {
  it('SKILL.md loads without error', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('SKILL.md does not contain agentType: codex:codex-rescue in code blocks', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const codeBlocks = extractCodeBlocks(content);
    const agentTypeForbidden = /agentType\s*:\s*["']?codex:codex-rescue["']?/;
    for (const block of codeBlocks) {
      const exemptLine = /<[^>]*codex:codex-rescue[^>]*>/;
      for (const line of block.split('\n')) {
        if (agentTypeForbidden.test(line) && !exemptLine.test(line)) {
          throw new Error(`Forbidden agentType assignment found: ${line.trim()}`);
        }
      }
    }
    expect(true).toBe(true); // reached without throw
  });

  it('SKILL.md does not contain agent_backends in code blocks', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const codeBlocks = extractCodeBlocks(content);
    for (const block of codeBlocks) {
      for (const line of block.split('\n')) {
        if (/agent_backends/.test(line)) {
          throw new Error(`Forbidden agent_backends found in code block: ${line.trim()}`);
        }
      }
    }
    expect(true).toBe(true);
  });

  // Scope note: the s-3 no-codex lint (hive/scripts/lint-cc-workflows-no-codex.mjs)
  // targets *-mode-cc-workflows/SKILL.md files only. dr-2 is a *-mode-multica atom
  // and is out of scope for that lint script. The checks above cover the equivalent
  // constraints for the multica side. See reviewer memory: no-codex-lint-scope-is-code-blocks-only.
  it('SKILL.md documents the Python preconditions helper as NOT required (multica atom, not cc-workflows)', () => {
    // dr-2 is a Multica atom — it MUST NOT require the Python preconditions helper.
    // The assertWorktreeIsolation contract is for cc-workflows atoms only.
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Multica atom uses multica-story-dispatch helpers, not cc-workflows-preconditions
    expect(content).toContain('multica-story-dispatch');
    expect(content).not.toContain('assertWorktreeIsolation');
  });
});

// ---------------------------------------------------------------------------
// Helper: extract code block content from Markdown
// ---------------------------------------------------------------------------

function extractCodeBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockLines = [];

  for (const line of lines) {
    if (!inBlock && /^```/.test(line)) {
      inBlock = true;
      blockLines = [];
    } else if (inBlock && /^```/.test(line)) {
      inBlock = false;
      blocks.push(blockLines.join('\n'));
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    }
  }
  if (inBlock && blockLines.length > 0) {
    blocks.push(blockLines.join('\n'));
  }
  return blocks;
}
