/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_REVIEW_MODE', ctx) as used by the
 * review-mode-cc-workflows atom (r-3).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - ctx.env raw-token footgun: passing just the value (not "VARNAME=value") silently
 *     falls through; this test confirms only the raw token format wins tier 1
 *   - Source tracking: only the winning tier key appears in sources (no leakage)
 *   - Solo dispatch shape assertions:
 *     - SKILL.md prescribes ONE reviewer agent (solo reviewer pattern — NOT panel-mode)
 *     - SKILL.md prescribes ONE Workflow run with ONE internal agent() call
 *   - cc-workflows-preconditions.mjs helper import present (Check 4 — s-3 lint)
 *   - cc-workflows-model-tier.mjs import + opts.model on every agent() call
 *   - insight-capture suffix template on every agent() prompt
 *   - No-codex assertions: checks 1-3 from s-3 lint (no agentType, no codex:codex-rescue,
 *     no agent_backends in code blocks)
 *   - ONE cc-workflows-run.yaml episode marker (not per-persona)
 *   - scope_drift_observed: true in marker (atom owns emit at review:complete)
 *   - --sequential flag accepted verbatim (no-op for single-agent dispatch)
 *
 * Architecture note:
 *   r-3 mirrors test-mode-cc-workflows (single-run, single-agent) more closely than
 *   design-review-mode-cc-workflows (4-step shape). ONE Workflow TOOL run, ONE reviewer
 *   agent() call, ONE cc-workflows-run.yaml marker. Panel-mode is explicitly DEFERRED
 *   per Decision Point 2. r-3 is the cc-workflows mirror of r-2 (review-mode-multica).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SKILL.md paths relative to this test file
// test/ -> review-mode-cc-workflows/ -> skills/ -> hive/ -> skills/
const ATOM_SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');
const DISPATCH_SKILL_MD_PATH = path.resolve(__dirname, '../../review-dispatch/SKILL.md');

// ---------------------------------------------------------------------------
// Tier 1: env
// ---------------------------------------------------------------------------

describe('HIVE_REVIEW_MODE — tier: env', () => {
  it('env=cc-workflows wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=cc-workflows',
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'sandcastle',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { env: 'HIVE_REVIEW_MODE=cc-workflows' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=multica wins over all other tiers', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=multica',
      rootConfig: { execution: { mode: 'cc-workflows' } },
      default: 'auto',
    });
    expect(result.decision).toBe('multica');
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=sandcastle wins over root_config', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=sandcastle',
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result.decision).toBe('sandcastle');
    expect(result.sources).toEqual({ env: 'HIVE_REVIEW_MODE=sandcastle' });
  });

  it('raw-token footgun: passing bare value (not VARNAME=value) silently ignores env tier', () => {
    // Passing just 'cc-workflows' instead of 'HIVE_REVIEW_MODE=cc-workflows'
    // must NOT win tier 1. The resolver parses at '=' — no '=' means the varName check
    // fails and resolution falls through to the next tier.
    const result = resolveMode('HIVE_REVIEW_MODE', {
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
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_EXECUTE_MODE=cc-workflows', // wrong var name
      rootConfig: { execution: { mode: 'multica' } },
    });
    expect(result.decision).toBe('multica');
    expect(result.sources).not.toHaveProperty('env');
  });
});

// ---------------------------------------------------------------------------
// Tier 2: root_config
// ---------------------------------------------------------------------------

describe('HIVE_REVIEW_MODE — tier: root_config', () => {
  it('root_config=cc-workflows wins when env is absent — sources records only root_config', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
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
    const result = resolveMode('HIVE_REVIEW_MODE', {
      rootConfig: { execution: { mode: 'multica' } },
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { root_config: 'execution.mode=multica' },
    });
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: shipped_baseline
// ---------------------------------------------------------------------------

describe('HIVE_REVIEW_MODE — tier: shipped_baseline', () => {
  it('shipped_baseline wins when env and root_config are absent — sources records only shipped_baseline', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
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
    const result = resolveMode('HIVE_REVIEW_MODE', {
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

describe('HIVE_REVIEW_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
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
    const result = resolveMode('HIVE_REVIEW_MODE', {
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

describe('HIVE_REVIEW_MODE — tier: default', () => {
  it('default fires when all higher tiers are absent — decision is "default", sources.default is "auto"', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
    expect(Object.keys(result.sources)).toEqual(['default']);
  });

  it('caller-supplied default value is reflected in sources.default', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', { default: 'auto' });
    expect(result.decision).toBe('default');
    expect(result.sources.default).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Solo dispatch shape assertions (SKILL.md structural contract)
// ---------------------------------------------------------------------------

describe('r-3 solo reviewer dispatch shape — atom SKILL.md', () => {
  it('SKILL.md prescribes exactly ONE reviewer agent (solo reviewer pattern)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document a single reviewer, not a panel
    expect(content).toContain('reviewer');
    // Must explicitly state SOLO reviewer
    expect(content).toMatch(/SOLO reviewer/i);
  });

  it('SKILL.md documents ONE Workflow run for the entire review (not per-persona fan-out)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must state single Workflow run with ONE agent() call
    expect(content).toMatch(/ONE Workflow (run|script|TOOL)/i);
  });

  it('SKILL.md explicitly defers panel-mode (multi-reviewer)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Panel-mode is explicitly DEFERRED — Decision Point 2
    expect(content).toMatch(/[Pp]anel.mode.*[Dd]eferred|[Dd]eferred.*[Pp]anel.mode/i);
  });

  it('SKILL.md documents that reviewer runs the solo reviewer pattern from skills/review/SKILL.md', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // The dispatched reviewer follows skills/review/SKILL.md Phase 1
    expect(content).toContain('skills/review/SKILL.md');
  });

  it('SKILL.md documents that --sequential flag is accepted verbatim and is no-op for single-agent', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--sequential');
    // Must document it as no-op for single-agent dispatch
    expect(content).toMatch(/no.op.*single.agent|single.agent.*no.op/i);
  });
});

// ---------------------------------------------------------------------------
// Episode marker shape — ONE cc-workflows-run.yaml per review unit
// ---------------------------------------------------------------------------

describe('r-3 episode marker shape — ONE cc-workflows-run.yaml per review unit', () => {
  it('SKILL.md documents cc-workflows-run.yaml as the episode marker filename', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('cc-workflows-run.yaml');
  });

  it('SKILL.md documents {unit_id} as the episode marker directory (not persona name)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('{unit_id}');
  });

  it('SKILL.md documents completion_kind: doc-verdict', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('doc-verdict');
  });

  it('SKILL.md does NOT prescribe per-persona episode markers', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // r-3 must NOT claim per-persona as its dispatch unit
    expect(content).not.toMatch(/per-persona episode marker/i);
    // r-3 must NOT claim per-persona fan-out
    expect(content).not.toMatch(/per-persona fan-out.*this skill/i);
  });
});

// ---------------------------------------------------------------------------
// scope_drift emit — atom OWNS the emit at review:complete
// ---------------------------------------------------------------------------

describe('r-3 scope_drift contract — atom owns emit at review:complete', () => {
  it('SKILL.md documents scope_drift_observed: true in the episode marker', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('scope_drift_observed');
    // true value documented — atom owns the emit
    expect(content).toMatch(/scope_drift_observed.*true/i);
  });

  it('SKILL.md documents review:complete as the scope_drift phase_label', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('review:complete');
  });

  it('SKILL.md documents scope_drift emit contract with phase_label review:complete', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must have a scope_drift emit contract section
    expect(content).toMatch(/scope.drift.*emit.*contract|emit.*scope.drift/i);
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

  it('SKILL.md documents assertWorktreeIsolation() call', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('assertWorktreeIsolation');
  });

  it('SKILL.md documents assertWorktreeIsolation() as Step 0 first action', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Step 0 section should reference both the import and the call
    expect(content).toMatch(/Step 0[\s\S]{0,500}assertWorktreeIsolation/);
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

  it('SKILL.md documents resolveModelTier() call for reviewer persona', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("resolveModelTier('reviewer'");
  });

  it('SKILL.md documents opts.model on agent() calls', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // At least one opts.model reference must appear (Step 1 model tier section)
    expect(content).toContain('opts.model');
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

  it('SKILL.md states insight-capture suffix is MANDATORY on each agent() prompt', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('insight-capture suffix');
  });
});

// ---------------------------------------------------------------------------
// No-codex assertions (s-3 lint checks 1-3)
// ---------------------------------------------------------------------------

describe('no-codex compliance — review-mode-cc-workflows SKILL.md', () => {
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
// Dispatch skill routing assertion
// ---------------------------------------------------------------------------

describe('HIVE_REVIEW_MODE — dispatch routing via review-dispatch', () => {
  it('when decision is "cc-workflows", review-dispatch SKILL.md documents review-mode-cc-workflows as the target', () => {
    const result = resolveMode('HIVE_REVIEW_MODE', {
      env: 'HIVE_REVIEW_MODE=cc-workflows',
    });
    expect(result.decision).toBe('cc-workflows');

    const dispatchSkillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(dispatchSkillMd).toContain('review-mode-cc-workflows');
  });
});

// ---------------------------------------------------------------------------
// Phase 0c 5-tier resolution call shape — SKILL.md documents resolveMode
// ---------------------------------------------------------------------------

describe('Phase 0c 5-tier resolution — SKILL.md documents resolveMode call', () => {
  it('SKILL.md documents resolveMode invocation with HIVE_REVIEW_MODE as varName', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("resolveMode('HIVE_REVIEW_MODE'");
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
  if (inBlock && blockLines.length > 0) {
    blocks.push(blockLines.join('\n'));
  }
  return blocks;
}
