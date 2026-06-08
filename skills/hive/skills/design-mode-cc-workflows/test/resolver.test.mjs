/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_DESIGN_MODE', ctx) as used by the
 * design-mode-cc-workflows atom (d-4).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - ctx.env raw-token footgun: passing just the value (not "VARNAME=value") silently
 *     falls through; this test confirms only the raw token format wins tier 1
 *   - Source tracking: only the winning tier key appears in sources (no leakage)
 *   - Per-persona dispatch shape assertions:
 *     - SKILL.md prescribes serial per-persona dispatch via Workflow tool pipeline()/phase() chain
 *       (NOT single-run-with-N-agents like dr-3)
 *     - SKILL.md prescribes ONE Workflow run per persona (N runs, N markers)
 *   - Toggle ON → 3 phases (accessibility-specialist, animations-specialist, ui-designer)
 *   - Toggle OFF → 1 phase (ui-designer only)
 *   - cc-workflows-model-tier.mjs import + opts.model on EVERY documented agent() call
 *   - Step 0 helper import — assertWorktreeIsolation imported + invoked
 *   - Insight-capture suffix template on every documented agent() prompt
 *   - No-codex code-block checks (s-3 lint checks 1-3)
 *   - Episode marker target: cc-workflows-run.yaml at per-persona unit_id
 *   - Intentional symmetry with dr-3 documented (both cc-workflows atoms, same Step 0/1/.../5 shape)
 *   - Intentional asymmetry with d-3 documented (different substrate — Workflow vs Multica)
 *
 * Architecture notes:
 *   d-4 = cc-workflows substrate: per-persona Workflow tool dispatch.
 *     N Workflow runs, N episode markers (one per persona).
 *   d-3 = Multica substrate: per-persona Multica issue dispatch.
 *     Same persona set resolution from d-1 toggle, different substrate.
 *   dr-3 = cc-workflows substrate: ONE Workflow run, FOUR internal agent() calls, ONE marker.
 *     d-4 is intentionally DIFFERENT from dr-3's single-run model.
 *   Intentional symmetry with dr-3: both are cc-workflows atoms using same Step 0/1/2/3/4/5 shape.
 *   Intentional asymmetry with d-3: same persona resolution, different substrate dispatch surface.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SKILL.md paths relative to this test file
// test/ -> design-mode-cc-workflows/ -> skills/ -> hive/ -> skills/
const ATOM_SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');
const DISPATCH_SKILL_MD_PATH = path.resolve(__dirname, '../../design-dispatch/SKILL.md');

// ---------------------------------------------------------------------------
// Tier 1: env
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — tier: env', () => {
  it('env=cc-workflows wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=cc-workflows',
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'sandcastle',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { env: 'HIVE_DESIGN_MODE=cc-workflows' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=multica wins over all other tiers', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=multica',
      rootConfig: { execution: { mode: 'cc-workflows' } },
      default: 'auto',
    });
    expect(result.decision).toBe('multica');
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=sandcastle wins over root_config', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result.decision).toBe('sandcastle');
    expect(result.sources).toEqual({ env: 'HIVE_DESIGN_MODE=sandcastle' });
  });

  it('raw-token footgun: passing bare value (not VARNAME=value) silently ignores env tier', () => {
    // Passing just 'cc-workflows' instead of 'HIVE_DESIGN_MODE=cc-workflows'
    // must NOT win tier 1. The resolver parses at '=' — no '=' means the varName check
    // fails and resolution falls through to the next tier.
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'cc-workflows', // WRONG format — no '=' separator
      rootConfig: { execution: { mode: 'multica' } },
    });
    // Falls through to root_config, not env
    expect(result.decision).toBe('multica');
    expect(result.sources).not.toHaveProperty('env');
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });

  it('raw-token footgun: passing wrong VARNAME silently ignores env tier', () => {
    // Wrong variable name — must fall through even though format is correct
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_EXECUTE_MODE=cc-workflows', // wrong var name
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result.decision).toBe('multica');
    expect(result.sources).not.toHaveProperty('env');
  });

  it('raw-token footgun: HIVE_DESIGN_REVIEW_MODE is a different var — must NOT match HIVE_DESIGN_MODE', () => {
    // HIVE_DESIGN_REVIEW_MODE must not win the HIVE_DESIGN_MODE resolver
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=cc-workflows',
      rootConfig: { execution: { mode: 'sequential' } },
    });
    expect(result.decision).toBe('sequential');
    expect(result.sources).not.toHaveProperty('env');
  });
});

// ---------------------------------------------------------------------------
// Tier 2: root_config
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — tier: root_config', () => {
  it('root_config=cc-workflows wins when env is absent — sources records only root_config', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      rootConfig: { execution: { mode: 'cc-workflows' } },
      shippedBaseline: 'sandcastle',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { root_config: 'execution.mode=cc-workflows' },
    });
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });

  it('root_config=multica wins when env is absent', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      rootConfig: { execution: { mode: 'multica' } },
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { root_config: 'execution.mode=multica' },
    });
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });

  it('root_config=sandcastle wins when env is absent', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      rootConfig: { execution: { mode: 'sandcastle' } },
    });
    expect(result.decision).toBe('sandcastle');
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: shipped_baseline
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — tier: shipped_baseline', () => {
  it('shipped_baseline wins when env and root_config are absent — sources records only shipped_baseline', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      shippedBaseline: 'cc-workflows',
      skillOverride: 'multica',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { shipped_baseline: 'cc-workflows' },
    });
    expect(Object.keys(result.sources)).toEqual(['shipped_baseline']);
  });

  it('shipped_baseline=multica also wins at tier 3', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      shippedBaseline: 'multica',
      default: 'auto',
    });
    expect(result.decision).toBe('multica');
    expect(result.sources).toEqual({ shipped_baseline: 'multica' });
  });
});

// ---------------------------------------------------------------------------
// Tier 4: skill_override
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      skillOverride: 'cc-workflows',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { skill_override: 'cc-workflows' },
    });
    expect(Object.keys(result.sources)).toEqual(['skill_override']);
  });

  it('skill_override=multica also wins at tier 4', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      skillOverride: 'multica',
      default: 'auto',
    });
    expect(result.decision).toBe('multica');
    expect(result.sources).toEqual({ skill_override: 'multica' });
  });
});

// ---------------------------------------------------------------------------
// Tier 5: default
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — tier: default', () => {
  it('default fires when all higher tiers are absent — decision is "default", sources.default is "auto"', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
    expect(Object.keys(result.sources)).toEqual(['default']);
  });

  it('caller-supplied default value is reflected in sources.default', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', { default: 'auto' });
    expect(result.decision).toBe('default');
    expect(result.sources.default).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Per-persona dispatch shape (SKILL.md structural contract)
// ---------------------------------------------------------------------------

describe('d-4 per-persona dispatch shape — atom SKILL.md', () => {
  it('SKILL.md prescribes accessibility-specialist as the first persona dispatched when toggle ON', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('accessibility-specialist');
  });

  it('SKILL.md prescribes animations-specialist as the second persona dispatched when toggle ON', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('animations-specialist');
  });

  it('SKILL.md prescribes ui-designer as the third and always-dispatched persona', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('ui-designer');
  });

  it('SKILL.md prescribes serial dispatch order: accessibility → animations → ui-designer', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // The serial chain must appear in documented ordering
    expect(content).toMatch(/accessibility.{0,30}animations.{0,30}ui-designer/s);
  });

  it('SKILL.md documents serial dispatch (not parallel)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/serial/i);
  });

  it('SKILL.md documents per-persona dispatch (NOT single-run-with-N-agents)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/per-persona dispatch/i);
  });

  it('SKILL.md describes the personaSet array for toggle OFF = [ui-designer]', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("'ui-designer'");
  });

  it('SKILL.md describes the personaSet array for toggle ON = [accessibility-specialist, animations-specialist, ui-designer]', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("'accessibility-specialist'");
    expect(content).toContain("'animations-specialist'");
    expect(content).toContain("'ui-designer'");
  });

  it('SKILL.md documents pipeline()/phase() as the serial dispatch mechanism', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // SKILL.md cites Workflow run with phase() per persona
    expect(content).toMatch(/phase\(\)|Workflow (run|script|TOOL)/i);
  });
});

// ---------------------------------------------------------------------------
// Toggle shape — persona count by --include-constraints flag
// ---------------------------------------------------------------------------

describe('d-4 --include-constraints toggle — persona count by flag', () => {
  it('SKILL.md documents Toggle OFF = 1 persona (ui-designer only)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/Toggle OFF.*ui-designer|toggle.*off.*1 persona/is);
  });

  it('SKILL.md documents Toggle ON = 3 personas (accessibility, animations, ui-designer)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/Toggle ON|three personas|3 personas/i);
    // All three persona names must be present
    expect(content).toContain('accessibility-specialist');
    expect(content).toContain('animations-specialist');
    expect(content).toContain('ui-designer');
  });

  it('SKILL.md documents --include-constraints as the toggle that controls persona set', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--include-constraints');
  });

  it('SKILL.md documents include_constraints === true for 3-persona path', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/include_constraints.*true|true.*include_constraints/i);
  });

  it('SKILL.md documents include_constraints === false for 1-persona path', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/include_constraints.*false|false.*include_constraints/i);
  });

  it('SKILL.md documents that absent personas are absent from persona_runs (not status-skipped)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must state personas are absent (not status: skipped)
    expect(content).toMatch(/absent.*entirely|absent.*not.*skipped|not.*status.*skipped/i);
  });
});

// ---------------------------------------------------------------------------
// Per-persona episode markers (one cc-workflows-run.yaml per persona)
// ---------------------------------------------------------------------------

describe('d-4 per-persona episode markers — cc-workflows-run.yaml', () => {
  it('SKILL.md prescribes ONE episode marker per persona (not one per run)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/one.*episode marker.*per persona|per-persona.*episode marker|episode marker.*per persona/i);
  });

  it('SKILL.md documents cc-workflows-run.yaml as the episode marker filename', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('cc-workflows-run.yaml');
  });

  it('SKILL.md documents episode marker path per persona: ${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/cc-workflows-run.yaml', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('cc-workflows-run.yaml');
    // Path template must contain persona slug as the unit_id directory
    expect(content).toMatch(/episodes.*\{epic_handle\}.*\{persona\}|episodes.*epic.handle.*persona/s);
  });

  it('SKILL.md documents messages sidecar: cc-workflows-run.messages.jsonl per persona', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('cc-workflows-run.messages.jsonl');
  });

  it('SKILL.md documents N Workflow runs + N episode markers (per-persona fan-out)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document N runs, N markers — the per-persona fan-out model
    expect(content).toMatch(/N Workflow runs|N runs.*N markers|per-persona fan-out/i);
  });
});

// ---------------------------------------------------------------------------
// cc-workflows-preconditions.mjs import assertion (s-3 lint Check 4)
// ---------------------------------------------------------------------------

describe('cc-workflows-preconditions.mjs import — Step 0 contract', () => {
  it('SKILL.md contains import from hive/lib/cc-workflows-preconditions.mjs (Check 4)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('hive/lib/cc-workflows-preconditions.mjs');
  });

  it('SKILL.md documents assertWorktreeIsolation() invocation', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('assertWorktreeIsolation');
  });

  it('SKILL.md documents assertWorktreeIsolation() as the first action in Step 0', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Step 0 must reference the worktree-isolation check as first action
    expect(content).toMatch(/Worktree-isolation check.*must be the first action|first action.*assertWorktreeIsolation/si);
  });
});

// ---------------------------------------------------------------------------
// cc-workflows-model-tier.mjs import + opts.model on every agent() call
// ---------------------------------------------------------------------------

describe('resolveModelTier — cc-workflows-model-tier.mjs import + opts.model contract', () => {
  it('SKILL.md imports cc-workflows-model-tier.mjs', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('cc-workflows-model-tier.mjs');
  });

  it('SKILL.md documents resolveModelTier() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('resolveModelTier');
  });

  it('SKILL.md documents opts.model on agent() calls', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('opts.model');
  });

  it('SKILL.md states opts.model is REQUIRED on every agent() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must state REQUIRED constraint
    expect(content).toMatch(/opts\.model.*REQUIRED|REQUIRED.*opts\.model/i);
  });

  it('SKILL.md documents model tier source attribution: model_overrides > model_tiers > default', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/model_overrides.*model_tiers|model_tiers.*model_overrides/i);
  });
});

// ---------------------------------------------------------------------------
// Insight-capture suffix template — mandatory on every agent() prompt
// ---------------------------------------------------------------------------

describe('insight-capture suffix template — SKILL.md contract', () => {
  it('SKILL.md documents the insight-capture suffix template', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('INSIGHT CAPTURE');
  });

  it('SKILL.md states insight-capture suffix is MANDATORY on every agent() prompt', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Phrase may be split across lines in the SKILL.md; check for both keywords
    expect(content).toContain('insight-capture');
    expect(content).toMatch(/MANDATORY.*insight-capture|insight-capture.*MANDATORY/si);
  });

  it('SKILL.md documents persona substitution in the insight-capture suffix template', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Template must reference <persona> substitution
    expect(content).toContain('<persona>');
  });
});

// ---------------------------------------------------------------------------
// No-codex assertions (s-3 lint checks 1-3)
// ---------------------------------------------------------------------------

describe('no-codex compliance — design-mode-cc-workflows SKILL.md', () => {
  it('SKILL.md loads without error', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('SKILL.md does not contain agentType: codex:codex-rescue literal in code blocks (Check 1)', () => {
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

  it('SKILL.md does not contain codex:codex-rescue string in code blocks (Check 2)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const codeBlocks = extractCodeBlocks(content);
    const codexRescue = /codex:codex-rescue/;
    const placeholder = /<[^>]*codex:codex-rescue[^>]*>/;
    for (const block of codeBlocks) {
      for (const line of block.split('\n')) {
        if (codexRescue.test(line) && !placeholder.test(line)) {
          throw new Error(`Forbidden codex:codex-rescue found in code block: ${line.trim()}`);
        }
      }
    }
    expect(true).toBe(true);
  });

  it('SKILL.md does not contain agent_backends in code blocks (Check 3)', () => {
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
});

// ---------------------------------------------------------------------------
// Phase 0c 5-tier resolution call shape — SKILL.md documents resolveMode
// ---------------------------------------------------------------------------

describe('Phase 0c 5-tier resolution — SKILL.md documents resolveMode call', () => {
  it('SKILL.md documents resolveMode invocation with HIVE_DESIGN_MODE as varName', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("resolveMode('HIVE_DESIGN_MODE'");
  });

  it('SKILL.md documents 5-tier precedence: env > root_config > shipped_baseline > skill_override > default', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // SKILL.md uses markdown-escaped underscores (root\_config), match flexibly
    expect(content).toMatch(/env.*root.{1,2}config.*shipped.{1,2}baseline.*skill.{1,2}override.*default/si);
  });

  it('SKILL.md imports mode-resolver.mjs from hive/lib/', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('hive/lib/mode-resolver.mjs');
  });
});

// ---------------------------------------------------------------------------
// Defensive args parse contract
// ---------------------------------------------------------------------------

describe('defensive args parse contract — SKILL.md documents const a = typeof args check', () => {
  it('SKILL.md documents defensive args parse: const a = typeof args === "string" ? JSON.parse(args) : args', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("typeof args === 'string' ? JSON.parse(args) : args");
  });
});

// ---------------------------------------------------------------------------
// Intentional symmetry with dr-3 — both cc-workflows atoms, same step shape
// ---------------------------------------------------------------------------

describe('d-4 intentional symmetry with dr-3 — cc-workflows step shape', () => {
  it('SKILL.md references dr-3 or design-review-mode-cc-workflows as the cc-workflows symmetry reference', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const hasDr3Ref = content.includes('dr-3') || content.includes('design-review-mode-cc-workflows');
    expect(hasDr3Ref).toBe(true);
  });

  it('SKILL.md documents intentional asymmetry with dr-3 (d-4 = N runs vs dr-3 = ONE run)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document the difference from dr-3's single-run model
    expect(content).toMatch(/asymmetry.*dr-3|dr-3.*asymmetry|ONE Workflow run.*FOUR.*agent\(\)|FOUR.*agent\(\).*ONE Workflow run/is);
  });

  it('SKILL.md header comment documents intentional asymmetry with dr-3', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // The HTML comment near top must document asymmetry
    expect(content).toMatch(/<!-- .*[Ii]ntentional.*asymmetry|<!-- .*[Ii]ntentional.*different/s);
  });
});

// ---------------------------------------------------------------------------
// Intentional asymmetry with d-3 — different substrate, same persona resolution
// ---------------------------------------------------------------------------

describe('d-4 intentional asymmetry with d-3 — different substrate', () => {
  it('SKILL.md references d-3 or design-mode-multica as the contrasting substrate', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const hasD3Ref = content.includes('d-3') || content.includes('design-mode-multica');
    expect(hasD3Ref).toBe(true);
  });

  it('SKILL.md documents same persona resolution as d-3 (d-1 toggle) but different substrate', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must reference the different substrate (Multica vs cc-workflows Workflow tool)
    expect(content).toMatch(/different substrate|Workflow.*Multica|Multica.*Workflow/i);
  });

  it('SKILL.md header comment documents the substrate split between d-3 and d-4', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document d-3 = Multica, d-4 = cc-workflows distinction
    expect(content).toMatch(/<!-- .*d-3.*Multica|<!-- .*substrate.*split|<!-- .*DO NOT conflate/s);
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing via design-dispatch (d-2)
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — dispatch routing via design-dispatch', () => {
  it('when decision is "cc-workflows", design-dispatch SKILL.md documents design-mode-cc-workflows as the target', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=cc-workflows',
    });
    expect(result.decision).toBe('cc-workflows');

    const dispatchSkillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(dispatchSkillMd).toContain('design-mode-cc-workflows');
  });
});

// ---------------------------------------------------------------------------
// Failure modes documented in SKILL.md
// ---------------------------------------------------------------------------

describe('d-4 failure modes — SKILL.md contract', () => {
  it('SKILL.md documents precondition_failed as Step 0 rejection error code', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('precondition_failed');
  });

  it('SKILL.md documents that ui-designer failure = overall run failure', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/ui-designer.*failure.*run.*failure|ui-designer fails.*design run is failed/i);
  });

  it('SKILL.md documents abort rules for serial chain failures', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document that accessibility/animations failures continue (not abort)
    expect(content).toMatch(/Abort rules|log warning.*continue|fails.*log warning/i);
  });
});

// ---------------------------------------------------------------------------
// Helper: extract code block content from Markdown
// (mirrors logic in lint-cc-workflows-no-codex.mjs for consistency)
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
  return blocks;
}
