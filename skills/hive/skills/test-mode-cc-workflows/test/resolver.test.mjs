/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_TEST_MODE', ctx).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - ctx.env raw-token footgun: passing just the value (not "VARNAME=value") silently
 *     falls through; this test suite confirms only the raw token format wins tier 1
 *   - Atom routing assertions:
 *     - when decision === 'cc-workflows', test-dispatch SKILL.md routes to test-mode-cc-workflows
 *     - when decision === 'multica', test-dispatch SKILL.md routes to test-mode-multica
 *   - No-codex assertions: test-mode-cc-workflows/SKILL.md must not contain agentType
 *     literal, codex:codex-rescue, or agent_backends in code blocks; must contain
 *     hive/lib/cc-workflows-preconditions.mjs helper import
 *   - Structural mirror assertion: test-dispatch SKILL.md documents Steps 0/1/2
 *     matching execute-dispatch structural anchor
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SKILL.md paths relative to this test file
// test/ -> test-mode-cc-workflows -> skills -> hive -> skills
const ATOM_SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');
const DISPATCH_SKILL_MD_PATH = path.resolve(__dirname, '../../test-dispatch/SKILL.md');

// ---------------------------------------------------------------------------
// Tier permutations for varName='HIVE_TEST_MODE'
// ---------------------------------------------------------------------------

describe('HIVE_TEST_MODE — tier: env', () => {
  it('env wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
      env: 'HIVE_TEST_MODE=cc-workflows',
      rootConfig: { execution: { mode: 'multica' } },
      shippedBaseline: 'sandcastle',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { env: 'HIVE_TEST_MODE=cc-workflows' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=multica also wins over all other tiers', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
      env: 'HIVE_TEST_MODE=multica',
      rootConfig: { execution: { mode: 'cc-workflows' } },
      default: 'auto',
    });
    expect(result.decision).toBe('multica');
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('raw-token footgun: passing bare value (not VARNAME=value) silently ignores env tier', () => {
    // Passing just 'cc-workflows' instead of 'HIVE_TEST_MODE=cc-workflows' must NOT win tier 1
    // — the resolver parses at '=' and the varName check would fail (no '=' in token).
    // It should fall through to next tier.
    const result = resolveMode('HIVE_TEST_MODE', {
      env: 'cc-workflows',   // WRONG format — no '=' separator
      rootConfig: { execution: { mode: 'multica' } },
    });
    // Falls through to root_config, not env
    expect(result.decision).toBe('multica');
    expect(result.sources).not.toHaveProperty('env');
    expect(Object.keys(result.sources)).toEqual(['root_config']);
  });
});

// NOTE: skills/hive/skills/test-dispatch/SKILL.md documents `test.mode` as the
// per-varName root-config key for HIVE_TEST_MODE. The resolver currently reads
// `execution.mode` for every varName (single-key fallback) and a per-varName
// extension is queued as follow-on work. Once that extension lands, swap the
// rootConfig structures below from `execution: { mode: ... }` to
// `test: { mode: ... }` and update the sources string to `test.mode=...`.
describe('HIVE_TEST_MODE — tier: root_config', () => {
  it('root_config wins when env is absent — sources records only root_config', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
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
    const result = resolveMode('HIVE_TEST_MODE', {
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

describe('HIVE_TEST_MODE — tier: shipped_baseline', () => {
  it('shipped_baseline wins when env and root_config are absent — sources records only shipped_baseline', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
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

describe('HIVE_TEST_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
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

describe('HIVE_TEST_MODE — tier: default', () => {
  it('default fires when all higher tiers are absent — decision is "default", sources.default is "auto"', () => {
    const result = resolveMode('HIVE_TEST_MODE', {});
    expect(result).toEqual({
      decision: 'default',
      sources: { default: 'auto' },
    });
    expect(Object.keys(result.sources)).toEqual(['default']);
  });

  it('caller-supplied default value is reflected in sources.default', () => {
    const result = resolveMode('HIVE_TEST_MODE', { default: 'auto' });
    expect(result.decision).toBe('default');
    // sources.default carries the caller-supplied value
    expect(result.sources.default).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Atom routing assertions
// ---------------------------------------------------------------------------

describe('HIVE_TEST_MODE — atom routing: cc-workflows', () => {
  it('when decision is "cc-workflows", test-dispatch SKILL.md documents test-mode-cc-workflows as the downstream target', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
      env: 'HIVE_TEST_MODE=cc-workflows',
    });
    expect(result.decision).toBe('cc-workflows');

    const dispatchSkillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(dispatchSkillMd).toContain('test-mode-cc-workflows');
  });
});

describe('HIVE_TEST_MODE — atom routing: multica', () => {
  it('when decision is "multica", test-dispatch SKILL.md documents test-mode-multica as the downstream target', () => {
    const result = resolveMode('HIVE_TEST_MODE', {
      env: 'HIVE_TEST_MODE=multica',
    });
    expect(result.decision).toBe('multica');

    const dispatchSkillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(dispatchSkillMd).toContain('test-mode-multica');
  });
});

// ---------------------------------------------------------------------------
// No-codex assertions (documentation-contract tests)
// ---------------------------------------------------------------------------

describe('no-codex compliance — test-mode-cc-workflows SKILL.md', () => {
  let atomContent;

  it('loads atom SKILL.md without error', () => {
    atomContent = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(atomContent.length).toBeGreaterThan(0);
  });

  it('SKILL.md contains hive/lib/cc-workflows-preconditions.mjs helper import (Check 4)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('hive/lib/cc-workflows-preconditions.mjs');
  });

  it('SKILL.md does not contain agentType: codex:codex-rescue literal in code blocks (Check 1)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Extract code blocks and check for the forbidden pattern
    const codeBlocks = extractCodeBlocks(content);
    const agentTypeForbidden = /agentType\s*:\s*["']?codex:codex-rescue["']?/;
    for (const block of codeBlocks) {
      // angle-bracket placeholders like <default | codex:codex-rescue> are exempt
      const exemptLine = /<[^>]*codex:codex-rescue[^>]*>/;
      const lines = block.split('\n');
      for (const line of lines) {
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
      const lines = block.split('\n');
      for (const line of lines) {
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
    const agentBackends = /agent_backends/;
    for (const block of codeBlocks) {
      const lines = block.split('\n');
      for (const line of lines) {
        if (agentBackends.test(line)) {
          throw new Error(`Forbidden agent_backends found in code block: ${line.trim()}`);
        }
      }
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structural mirror assertion — test-dispatch mirrors execute-dispatch Step 0/1/2
// ---------------------------------------------------------------------------

describe('test-dispatch structural mirror — execute-dispatch Step 0/1/2', () => {
  it('test-dispatch SKILL.md documents Step 0 (Resolve Fields with Source Tracking)', () => {
    const skillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('Step 0');
    // Must document resolveMode invocation
    expect(skillMd).toContain("resolveMode('HIVE_TEST_MODE'");
  });

  it('test-dispatch SKILL.md documents Step 1 (Resolve Mode Decision and Dispatch)', () => {
    const skillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('Step 1');
  });

  it('test-dispatch SKILL.md documents Step 2 (Return)', () => {
    const skillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('Step 2');
    // Must return {mode_decision, sources}
    expect(skillMd).toContain('mode_decision');
    expect(skillMd).toContain('sources');
  });

  it('test-dispatch SKILL.md cites execute-dispatch as the structural mirror anchor', () => {
    const skillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(skillMd).toContain('execute-dispatch');
  });

  it('test-dispatch SKILL.md documents 5-tier precedence: env > root config > shipped baseline > skill override > default', () => {
    const skillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(skillMd).toMatch(/env.*root.config.*shipped.baseline.*skill.override.*default/si);
  });
});

// ---------------------------------------------------------------------------
// Per-scenario dispatch granularity assertion
// ---------------------------------------------------------------------------

describe('per-scenario dispatch granularity — test-mode-cc-workflows atom', () => {
  it('atom SKILL.md documents per-scenario dispatch (not per-persona)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('per-scenario');
    // Must NOT claim per-persona as the dispatch unit
    expect(content).not.toMatch(/dispatch granularity is per-persona/i);
  });

  it('atom SKILL.md documents episode marker path using story_id (scenario as unit)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Marker path must use story_id as the directory (not persona)
    expect(content).toContain('cc-workflows-run.yaml');
    expect(content).toContain('{story_id}');
  });

  it('atom SKILL.md requires assertWorktreeIsolation() call at Step 0', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('assertWorktreeIsolation');
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
