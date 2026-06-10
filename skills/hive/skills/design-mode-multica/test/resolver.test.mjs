/**
 * resolver.test.mjs
 *
 * Vitest spec for resolveMode('HIVE_DESIGN_MODE', ctx) as used by the
 * design-mode-multica atom (d-3).
 *
 * Covers:
 *   - 5 tier permutations (env, root_config, shipped_baseline, skill_override, default)
 *     — each asserts { decision, sources } with ONLY the winning tier in sources
 *   - ctx.env raw-token footgun: passing just the value (not "VARNAME=value") silently
 *     falls through; this test confirms only the raw token format wins tier 1
 *   - Source tracking: only the winning tier key appears in sources (no leakage)
 *   - Per-persona dispatch shape assertions:
 *     - SKILL.md prescribes serial per-persona dispatch (NOT single-run-with-N-agents like dr-2)
 *     - SKILL.md prescribes ONE issue per persona (3 when toggle ON, 1 when toggle OFF)
 *   - Per-persona episode markers: ONE multica-run.yaml marker per persona (NOT one total)
 *   - Toggle ON → 3 personas → 3 issues + 3 markers
 *   - Toggle OFF → 1 persona (ui-designer) → 1 issue + 1 marker
 *   - Q10 cited in SKILL.md ("one issue per persona" key phrase)
 *   - Intentional asymmetry with dr-2 documented (d-3 vs dr-2 contrast)
 *
 * Architecture note (Q10 resolution — design-discussion §6):
 *   d-3 intentionally differs from dr-2 (design-review-mode-multica single-run 4-step shape).
 *   d-3 = per-persona fan-out: N issues, N markers.
 *   dr-2 = ONE issue, FOUR internal agent() calls, ONE marker.
 *   Same Multica substrate, two atom shapes for two different upstream contracts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveMode } from '../../../../../hive/lib/mode-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SKILL.md path relative to this test file
// test/ -> design-mode-multica/ -> skills/ -> hive/ -> skills/
const ATOM_SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');
const DISPATCH_SKILL_MD_PATH = path.resolve(__dirname, '../../design-dispatch/SKILL.md');

// ---------------------------------------------------------------------------
// Tier 1: env
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — tier: env', () => {
  it('env=multica wins over all other tiers — sources records only env', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=multica',
      rootConfig: { execution: { mode: 'cc-workflows' } },
      shippedBaseline: 'sandcastle',
      skillOverride: 'sequential',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { env: 'HIVE_DESIGN_MODE=multica' },
    });
    // Only env key present — no leakage from lower tiers
    expect(Object.keys(result.sources)).toEqual(['env']);
  });

  it('env=cc-workflows wins over all other tiers', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=cc-workflows',
      rootConfig: { execution: { mode: 'multica' } },
      default: 'auto',
    });
    expect(result.decision).toBe('cc-workflows');
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
    // Passing just 'multica' instead of 'HIVE_DESIGN_MODE=multica' must NOT win tier 1.
    // The resolver parses at '=' — no '=' means the varName check fails and resolution
    // falls through to the next tier.
    const result = resolveMode('HIVE_DESIGN_MODE', {
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
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_EXECUTE_MODE=multica',   // wrong var name
      rootConfig: { execution: { mode: 'cc-workflows' } },
    });
    expect(result.decision).toBe('cc-workflows');
    expect(result.sources).not.toHaveProperty('env');
  });

  it('raw-token footgun: HIVE_DESIGN_REVIEW_MODE is a different var — must NOT match HIVE_DESIGN_MODE', () => {
    // HIVE_DESIGN_REVIEW_MODE must not win the HIVE_DESIGN_MODE resolver
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_REVIEW_MODE=multica',
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
  it('root_config=multica wins when env is absent — sources records only root_config', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
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
    const result = resolveMode('HIVE_DESIGN_MODE', {
      rootConfig: { execution: { mode: 'cc-workflows' } },
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'cc-workflows',
      sources: { root_config: 'execution.mode=cc-workflows' },
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
    const result = resolveMode('HIVE_DESIGN_MODE', {
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

describe('HIVE_DESIGN_MODE — tier: skill_override', () => {
  it('skill_override wins when env, root_config, and shipped_baseline are absent — sources records only skill_override', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      skillOverride: 'multica',
      default: 'auto',
    });
    expect(result).toEqual({
      decision: 'multica',
      sources: { skill_override: 'multica' },
    });
    expect(Object.keys(result.sources)).toEqual(['skill_override']);
  });

  it('skill_override=sandcastle wins at tier 4', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      skillOverride: 'sandcastle',
    });
    expect(result.decision).toBe('sandcastle');
    expect(Object.keys(result.sources)).toEqual(['skill_override']);
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

describe('d-3 per-persona dispatch shape — atom SKILL.md', () => {
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
    // The serial chain must appear in the documented ordering
    expect(content).toMatch(/accessibility.{0,30}animations.{0,30}ui-designer/s);
  });

  it('SKILL.md documents serial dispatch within team-cell (not parallel)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/serial/i);
  });

  it('SKILL.md documents per-persona dispatch (NOT single-run-with-N-agents)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must state per-persona dispatch explicitly
    expect(content).toMatch(/per-persona dispatch/i);
  });

  it('SKILL.md describes the personaSet array for toggle OFF = [ui-designer]', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("'ui-designer'");
  });

  it('SKILL.md describes the personaSet array for toggle ON = [accessibility-specialist, animations-specialist, ui-designer]', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // All three persona slugs in same section
    expect(content).toContain("'accessibility-specialist'");
    expect(content).toContain("'animations-specialist'");
    expect(content).toContain("'ui-designer'");
  });
});

// ---------------------------------------------------------------------------
// Toggle shape — persona count by --include-constraints flag
// ---------------------------------------------------------------------------

describe('d-3 --include-constraints toggle — persona and issue count', () => {
  it('SKILL.md documents Toggle OFF = 1 persona (ui-designer) → 1 issue → 1 marker', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Toggle OFF section must name ui-designer as the sole persona
    expect(content).toMatch(/Toggle OFF.*ui-designer|toggle.*off.*1 persona/is);
  });

  it('SKILL.md documents Toggle ON = 3 personas → 3 issues → 3 markers', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Toggle ON section must document three personas (three issues)
    expect(content).toMatch(/Toggle ON|three personas|3 issues/i);
    // All three persona names present
    expect(content).toContain('accessibility-specialist');
    expect(content).toContain('animations-specialist');
    expect(content).toContain('ui-designer');
  });

  it('SKILL.md documents --include-constraints as the toggle that controls persona set', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('--include-constraints');
  });

  it('SKILL.md explicitly states three Multica issues are created when toggle ON', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document 3 issues (not one bundled issue)
    expect(content).toMatch(/three.*issue|3 issues|one.*issue.*per.*persona/i);
  });
});

// ---------------------------------------------------------------------------
// Per-persona episode markers (one per persona, NOT one total)
// ---------------------------------------------------------------------------

describe('d-3 per-persona episode markers', () => {
  it('SKILL.md prescribes ONE episode marker per persona (not one per run)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/one.*episode marker.*per persona|per-persona.*episode marker|episode marker.*per persona/i);
  });

  it('SKILL.md documents multica-run.yaml as the marker filename', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('multica-run.yaml');
  });

  it('SKILL.md documents episode marker path: ${HIVE_STATE_DIR}/episodes/{epic_handle}/{persona}/multica-run.yaml', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Path template must contain persona slug as the unit_id directory
    expect(content).toContain('multica-run.yaml');
    expect(content).toMatch(/episodes.*\{epic_handle\}.*\{persona\}|episodes.*\{epic.handle\}.*persona/s);
  });

  it('SKILL.md documents messages sidecar path: multica-run.messages.jsonl per persona', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('multica-run.messages.jsonl');
  });

  it('SKILL.md cites writeMulticaRunEpisode with persona slug as storyId (unit_id)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // writeMulticaRunEpisode must be present and persona slug used as unit_id
    expect(content).toContain('writeMulticaRunEpisode');
  });
});

// ---------------------------------------------------------------------------
// Q10 resolution cited in SKILL.md (one issue per persona — locked)
// ---------------------------------------------------------------------------

describe('d-3 Q10 resolution — one issue per persona contract', () => {
  it('SKILL.md cites Q10 resolution: one issue per persona (key phrase present)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Q10 must be cited by name or by key phrase "one issue per persona"
    const hasQ10 = content.includes('Q10') || content.match(/one issue per persona/i);
    expect(hasQ10).toBeTruthy();
  });

  it('SKILL.md documents design-discussion §6 as the source of Q10 resolution', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must reference §6 or design-discussion alongside Q10
    const hasRef = content.match(/design-discussion.*Q10|Q10.*design-discussion|§6.*Q10|Q10.*§6/is);
    expect(hasRef).toBeTruthy();
  });

  it('SKILL.md explicitly forbids collapsing personas into a single bundled issue', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document "do NOT collapse" or equivalent prohibition
    expect(content).toMatch(/Do NOT collapse|not.*single.*bundled|one.*issue.*per.*persona.*locked/is);
  });

  it('SKILL.md constraint table documents ONE issue per persona (Q10 locked)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Constraint table must reference Q10 locked
    expect(content).toMatch(/Q10 locked|one issue per persona.*Q10/i);
  });
});

// ---------------------------------------------------------------------------
// Intentional asymmetry with dr-2 documented
// ---------------------------------------------------------------------------

describe('d-3 intentional asymmetry with dr-2', () => {
  it('SKILL.md references dr-2 or design-review-mode-multica as the contrasting atom', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const hasDr2Ref = content.includes('dr-2') || content.includes('design-review-mode-multica');
    expect(hasDr2Ref).toBe(true);
  });

  it('SKILL.md documents intentional asymmetry (asymmetry or "intentionally different")', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    const hasAsymmetry = content.match(/asymmetry|intentionally different|intentional.*differs/i);
    expect(hasAsymmetry).toBeTruthy();
  });

  it('SKILL.md contrasts d-3 per-persona fan-out with dr-2 single-run shape', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // Must document dr-2 as ONE issue with FOUR agent calls (or equivalent)
    const hasDr2Shape = content.match(/ONE Multica issue.*FOUR|single.{1,10}run.*four|one issue.*four agent/i)
      || content.match(/dr-2.*ONE.*FOUR|dr-2.*single.*four/i);
    expect(hasDr2Shape).toBeTruthy();
  });

  it('SKILL.md documents that d-3 uses N issues + N markers (per-persona fan-out)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // d-3 must document per-persona fan-out contrast with dr-2
    expect(content).toMatch(/per-persona fan-out|N issues.*N markers/i);
  });

  it('SKILL.md header comment documents the intentional asymmetry', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    // The HTML comment at the top of the SKILL.md must document asymmetry
    expect(content).toMatch(/<!-- .*[Ii]ntentional.*asymmetry|<!-- .*DO NOT conflate/s);
  });
});

// ---------------------------------------------------------------------------
// Phase 0c — 5-tier resolution SKILL.md documentation
// ---------------------------------------------------------------------------

describe('Phase 0c 5-tier resolution — SKILL.md documents resolveMode call', () => {
  it('SKILL.md documents resolveMode invocation with HIVE_DESIGN_MODE as varName', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain("resolveMode('HIVE_DESIGN_MODE'");
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
// Dispatch routing via design-dispatch (d-2)
// ---------------------------------------------------------------------------

describe('HIVE_DESIGN_MODE — dispatch routing via design-dispatch', () => {
  it('when decision is "multica", design-dispatch SKILL.md documents design-mode-multica as target', () => {
    const result = resolveMode('HIVE_DESIGN_MODE', {
      env: 'HIVE_DESIGN_MODE=multica',
    });
    expect(result.decision).toBe('multica');

    const dispatchSkillMd = fs.readFileSync(DISPATCH_SKILL_MD_PATH, 'utf8');
    expect(dispatchSkillMd).toContain('design-mode-multica');
  });
});

// ---------------------------------------------------------------------------
// Bootstrap gate and labels invariants
// ---------------------------------------------------------------------------

describe('d-3 bootstrap gate and labels invariants', () => {
  it('SKILL.md documents BOOTSTRAP_REQUIRED abort at Step 0', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('BOOTSTRAP_REQUIRED');
  });

  it('SKILL.md documents labels: [] matching execute-mode-multica convention', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('labels: []');
  });

  it('SKILL.md documents exit 1 with no fallback to inline design on bootstrap failure', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/Do NOT fall back|no.*fallback/i);
  });
});

// ---------------------------------------------------------------------------
// No-codex scope note — d-3 is a *-mode-multica atom
// ---------------------------------------------------------------------------

describe('no-codex scope — d-3 is a *-mode-multica atom', () => {
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
  // targets *-mode-cc-workflows/SKILL.md files only. d-3 is a *-mode-multica atom
  // and is OUT OF SCOPE for that lint script. The checks above cover the equivalent
  // constraints for the multica side. This mirrors the dr-2 scope note.
  it('SKILL.md uses multica-story-dispatch helpers (not cc-workflows-preconditions)', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('multica-story-dispatch');
    expect(content).not.toContain('assertWorktreeIsolation');
  });
});

// ---------------------------------------------------------------------------
// Mirror anchor — execute-mode-multica
// ---------------------------------------------------------------------------

describe('d-3 mirror anchor — execute-mode-multica', () => {
  it('SKILL.md cites execute-mode-multica as the mirror anchor', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toContain('execute-mode-multica');
  });

  it('SKILL.md comment block at top cites execute-mode-multica as mirror anchor', () => {
    const content = fs.readFileSync(ATOM_SKILL_MD_PATH, 'utf8');
    expect(content).toMatch(/<!-- Mirror anchor:.*execute-mode-multica/);
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
  // If file ends with an unclosed code fence, include the accumulated lines
  // so doc-grep tests scanning for forbidden patterns don't silently miss them.
  if (inBlock && blockLines.length > 0) {
    blocks.push(blockLines.join('\n'));
  }
  return blocks;
}
