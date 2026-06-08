/**
 * wireframe-handoff-payload.test.mjs
 *
 * Vitest spec for d-5-wireframe-artifact-handoff acceptance criteria.
 *
 * FIVE independent describe blocks — one per AC subsection.
 * A failure in one describe block does NOT block the others.
 *
 * All assertions are substring/regex matches on the loaded wireframe-protocol.md content.
 * No external processes are spawned; tests are pure static-analysis of the spec doc.
 *
 * Subsection 1 — Payload contract — 3 minimum fields
 * Subsection 2 — Posture — extensible-minimum
 * Subsection 3 — Toggle-conditional constraint doc bundling
 * Subsection 4 — Field-named vs file-glob discipline
 * Subsection 5 — Cross-references — d-1 producer + d-3/d-4 consumers
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_MD_PATH = path.resolve(__dirname, '../../../hive/references/wireframe-protocol.md');
const content = fs.readFileSync(PROTOCOL_MD_PATH, 'utf8');

// ---------------------------------------------------------------------------
// AC Subsection 1 — Payload contract — 3 minimum fields
// ---------------------------------------------------------------------------

describe('Payload contract — 3 minimum fields', () => {
  it('section heading "## Handoff Payload Contract" is present', () => {
    expect(content).toContain('## Handoff Payload Contract');
  });

  it('wireframe.png field is listed', () => {
    expect(content).toContain('wireframe.png');
  });

  it('wireframe.f0 field is listed', () => {
    expect(content).toContain('wireframe.f0');
  });

  it('constraints.md field is listed', () => {
    expect(content).toContain('constraints.md');
  });

  it('PNG + .f0 noted as always present', () => {
    expect(content).toMatch(/always present/i);
  });

  it('constraints.md noted as toggle-conditional (present when --include-constraints)', () => {
    // Must mention toggle-conditional nature: "present when" or "--include-constraints" near "constraints"
    const hasTogglePresent = /present when/.test(content);
    const hasIncludeConstraints = /--include-constraints/.test(content);
    expect(hasTogglePresent || hasIncludeConstraints).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC Subsection 2 — Posture — extensible-minimum
// ---------------------------------------------------------------------------

describe('Posture — extensible-minimum', () => {
  it('substring "extensible-minimum" is present', () => {
    expect(content).toContain('extensible-minimum');
  });

  it('posture statement explicitly says additional fields allowed (add-only or additional fields)', () => {
    const hasAddOnly = /add-only/.test(content);
    const hasAdditionalFields = /additional fields/.test(content);
    expect(hasAddOnly || hasAdditionalFields).toBe(true);
  });

  it('TPM escalation cite is present (outline-collab-review-record or TPM)', () => {
    const hasCollab = /outline-collab-review-record/.test(content);
    const hasTPM = /TPM/.test(content);
    expect(hasCollab || hasTPM).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC Subsection 3 — Toggle-conditional constraint doc bundling
// ---------------------------------------------------------------------------

describe('Toggle-conditional constraint doc bundling', () => {
  it('toggle-ON path is documented (toggle + present + constraints)', () => {
    // The payload-contract section must document that constraints.md is present when toggle is ON
    const hasToggleOn = /--include-constraints[^.]*is[^.]*ON|flag is ON|toggle is ON|include-constraints.*present/is.test(content);
    const hasConstraintsPresent = /constraints\.md.*present|present.*constraints\.md/is.test(content);
    expect(hasToggleOn || hasConstraintsPresent).toBe(true);
  });

  it('toggle-OFF path documented — absent or empty, PNG + .f0 still ship', () => {
    const hasAbsent = /absent/.test(content);
    const hasEmpty = /empty/.test(content);
    expect(hasAbsent || hasEmpty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC Subsection 4 — Field-named vs file-glob discipline
// ---------------------------------------------------------------------------

describe('Field-named vs file-glob discipline', () => {
  it('substring "field-named" is present', () => {
    expect(content).toContain('field-named');
  });

  it('rationale for field-naming over file-glob (leak or working state) is present', () => {
    const hasLeak = /leak/.test(content);
    const hasWorkingState = /working state/.test(content);
    expect(hasLeak || hasWorkingState).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC Subsection 5 — Cross-references — d-1 producer + d-3/d-4 consumers
// ---------------------------------------------------------------------------

describe('Cross-references — d-1 producer + d-3/d-4 consumers', () => {
  it('d-1 is forward-referenced (d-1 or Phase A)', () => {
    const hasd1 = /d-1/.test(content);
    const hasPhaseA = /Phase A/.test(content);
    expect(hasd1 || hasPhaseA).toBe(true);
  });

  it('cc-workflows substrate is noted as a consumer', () => {
    expect(content).toContain('cc-workflows');
  });

  it('multica substrate is noted as a consumer', () => {
    expect(content).toContain('multica');
  });
});
