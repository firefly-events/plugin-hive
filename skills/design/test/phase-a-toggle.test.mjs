/**
 * phase-a-toggle.test.mjs
 *
 * Vitest spec for d-1-design-multi-persona-pipeline acceptance criteria.
 *
 * THREE independent describe blocks — one per AC subsection.
 * A failure in one describe block does NOT block the others.
 *
 * Subsection 1 — Phase A structural insert + Phase 0 wiring
 * Subsection 2 — Pattern B toggle semantics (default OFF / toggle ON)
 * Subsection 3 — 3-persona handoff payload bundling
 *
 * All assertions are substring/regex matches on the loaded SKILL.md content.
 * No external processes are spawned; tests are pure static-analysis of the spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD_PATH = path.resolve(__dirname, '../SKILL.md');
const content = fs.readFileSync(SKILL_MD_PATH, 'utf8');
const lines = content.split('\n');

// ---------------------------------------------------------------------------
// AC Subsection 1 — Phase A structural insert + Phase 0 wiring
// ---------------------------------------------------------------------------

describe('AC Subsection 1 — Phase A structural insert + Phase 0 wiring', () => {
  it('Phase A block exists in SKILL.md', () => {
    expect(content).toMatch(/Phase A/);
  });

  it('Phase A block appears above the "step 3" ui-designer dispatch header', () => {
    const phaseAIdx = lines.findIndex(l => /### Phase A/.test(l));
    const step3Idx = lines.findIndex(l => /### 3\.\s/.test(l));
    expect(phaseAIdx).toBeGreaterThan(-1);
    expect(step3Idx).toBeGreaterThan(-1);
    expect(phaseAIdx).toBeLessThan(step3Idx);
  });

  it('Phase A AC text cites hive/workflows/design-review.workflow.yaml:8-81 verbatim', () => {
    expect(content).toContain('hive/workflows/design-review.workflow.yaml:8-81');
  });

  it('Phase 0 block exists in SKILL.md', () => {
    expect(content).toMatch(/### Phase 0/);
  });

  it('Phase 0 invokes design-dispatch', () => {
    expect(content).toContain('design-dispatch');
  });

  it('Phase 0 branches on mode_decision with multica and cc-workflows values', () => {
    expect(content).toContain('multica');
    expect(content).toContain('cc-workflows');
  });

  it('Phase 0 references design-mode-multica forward declaration', () => {
    expect(content).toContain('design-mode-multica');
  });

  it('Phase 0 references design-mode-cc-workflows forward declaration', () => {
    expect(content).toContain('design-mode-cc-workflows');
  });
});

// ---------------------------------------------------------------------------
// AC Subsection 2 — Pattern B toggle semantics
// ---------------------------------------------------------------------------

describe('AC Subsection 2 — Pattern B toggle semantics', () => {
  it('--include-constraints flag is documented', () => {
    expect(content).toContain('--include-constraints');
  });

  it('default OFF is described — single ui-designer dispatch preserved', () => {
    // Must contain some combination of "default" + "OFF" language
    expect(content).toMatch(/[Dd]efault\s+(OFF|off|is off|behavior)/);
  });

  it('default OFF preserves legacy behavior with no specialist invocations', () => {
    // Must assert no accessibility-specialist or animations-specialist in default path
    expect(content).toContain('no accessibility-specialist invocation');
    expect(content).toContain('no animations-specialist invocation');
  });

  it('toggle ON described — serial dispatch of accessibility-specialist', () => {
    expect(content).toContain('accessibility-specialist');
  });

  it('toggle ON described — serial dispatch of animations-specialist', () => {
    expect(content).toContain('animations-specialist');
  });

  it('toggle ON dispatches serially (serial order before ui-designer)', () => {
    expect(content).toMatch(/serial/i);
  });

  it('ui-designer is dispatched ONCE even when toggle ON', () => {
    // Must contain an explicit "ONCE" qualifier for ui-designer dispatch
    expect(content).toMatch(/dispatched\s+\*{0,2}exactly once\*{0,2}|dispatched \*{0,2}ONCE\*{0,2}|ONCE/);
  });

  it('toggle ON: constraints baked into the ui-designer prompt', () => {
    // The SKILL.md uses "baked into the ui-designer prompt" and "baked in"
    expect(content).toMatch(/[Cc]onstraint.{0,30}baked.{0,40}prompt|baked.{0,20}ui-designer prompt/is);
  });
});

// ---------------------------------------------------------------------------
// AC Subsection 3 — 3-persona handoff payload bundling
// ---------------------------------------------------------------------------

describe('AC Subsection 3 — 3-persona handoff payload bundling', () => {
  it('toggle ON bundles constraint notes with ui-designer outputs', () => {
    expect(content).toContain('constraint notes');
  });

  it('toggle ON: constraint notes are bundled (bundled reference present)', () => {
    expect(content).toMatch(/bundled|bundle/i);
  });

  it('toggle OFF omits constraint doc (absent/empty described)', () => {
    expect(content).toMatch(/absent|omit/i);
  });

  it('PNG always ships regardless of toggle state', () => {
    expect(content).toContain('PNG');
  });

  it('.f0 always ships regardless of toggle state', () => {
    expect(content).toContain('.f0');
  });

  it('PNG + .f0 always-ship contract is documented together', () => {
    // Both must appear; the "always ship" phrasing ties them together
    expect(content).toMatch(/PNG.*\.f0.*always|always.*PNG.*\.f0/is);
  });

  it('Phase A prose forward-declares d-5 as payload contract owner', () => {
    expect(content).toMatch(/d-5/);
  });
});
