'use strict';

/**
 * Tests for the /design top-level skill contract.
 *
 * Story: se-2-design-top-level
 * Run:   node tests/design-skill-flow.test.js
 *
 * Design:
 *   /design SKILL.md and /plan SKILL.md are prose, not code. These tests are
 *   static-analysis contract checks — they read the two SKILL.md files as
 *   text and assert the acceptance-criteria contract is encoded in the
 *   prose. No mocking, no harness; just file-system reads.
 *
 * Covers:
 *   AC-1  Standalone invocation — /design SKILL.md frontmatter declares
 *         name: design and prose covers the .pHive/design/<topic>/ output
 *         path plus the handoff to /design-review.
 *   AC-2  Standalone-callable — /design explicitly handles the case where
 *         prior planning context is absent (warn-only kickoff posture).
 *   AC-3  /plan-delegated invocation — /plan Phase C step 16 (UI detection)
 *         contains an atomic Skill delegation to /design and is NOT a long
 *         inline wireframe-ceremony prose block (under ~40 lines).
 *   AC-4  Handoff-record shape — /design prose names .pHive/design/index.yaml
 *         and the brief_path / export_paths fields that /design-review reads.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DESIGN_SKILL_PATH = path.join(REPO_ROOT, 'skills', 'design', 'SKILL.md');
const PLAN_SKILL_PATH = path.join(REPO_ROOT, 'skills', 'plan', 'SKILL.md');
const DESIGN_REVIEW_SKILL_PATH = path.join(
  REPO_ROOT,
  'skills',
  'design-review',
  'SKILL.md',
);

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// AC-1: standalone /design produces wireframes at .pHive/design/<topic>/ and
// emits a design-review handoff record.
// ---------------------------------------------------------------------------

test('AC-1: skills/design/SKILL.md exists with name: design frontmatter', () => {
  assert.ok(
    fs.existsSync(DESIGN_SKILL_PATH),
    `Expected ${DESIGN_SKILL_PATH} to exist`,
  );
  const body = readFile(DESIGN_SKILL_PATH);
  assert.match(
    body,
    /^---\r?\nname: design\r?\n/m,
    '/design SKILL.md must declare name: design in YAML frontmatter',
  );
  assert.match(
    body,
    /^description: /m,
    '/design SKILL.md frontmatter must include a description field',
  );
});

test('AC-1: /design emits wireframes under .pHive/design/<topic>/', () => {
  const body = readFile(DESIGN_SKILL_PATH);
  assert.ok(
    body.includes('.pHive/design/<topic>/'),
    '/design SKILL.md must document the .pHive/design/<topic>/ output path',
  );
  // The skill must produce wireframe artifacts (PNG renditions per the
  // wireframe-protocol). Don't pin a specific filename — just confirm
  // the prose covers the produced-wireframes contract.
  assert.match(
    body,
    /wireframe/i,
    '/design SKILL.md must describe wireframe artifacts',
  );
});

test('AC-1: /design hands off to /design-review', () => {
  const body = readFile(DESIGN_SKILL_PATH);
  assert.match(
    body,
    /design-review/i,
    '/design SKILL.md must name /design-review as the downstream consumer',
  );
});

// ---------------------------------------------------------------------------
// AC-2: standalone-callable — /design works without prior planning context.
// ---------------------------------------------------------------------------

test('AC-2: /design explicitly supports standalone invocation', () => {
  const body = readFile(DESIGN_SKILL_PATH);
  assert.match(
    body,
    /standalone/i,
    '/design SKILL.md must explicitly cover standalone invocation',
  );
  // The standalone path must NOT hard-fail on the kickoff gate — it should
  // warn-and-proceed (like triage, standup) so /design is usable on fresh
  // repos and outside /plan.
  assert.match(
    body,
    /warn[- ]only|warn,? don'?t block|warn and proceed|proceeding with defaults/i,
    '/design SKILL.md must declare a warn-only (not hard-stop) kickoff posture',
  );
});

// ---------------------------------------------------------------------------
// AC-3: /plan delegates to /design via atomic external Skill call (not
// inline prose) at the UI-detection path.
// ---------------------------------------------------------------------------

test('AC-3: /plan UI-detection section delegates to /design via atomic Skill call', () => {
  const body = readFile(PLAN_SKILL_PATH);
  // Slice out the "UI Step Detection" section (from its heading to the next
  // ## heading or EOF). This is the section step 16 references — the
  // refactor target.
  const sectionMatch = body.match(/## UI Step Detection[\s\S]*?(?=\n## |\n?$)/);
  assert.ok(sectionMatch, '/plan must contain a "## UI Step Detection" section');
  const section = sectionMatch[0];

  // The section must name /design as the delegation target.
  assert.match(
    section,
    /\/design|skills\/design\/SKILL\.md/,
    '/plan UI Step Detection section must reference /design (or skills/design/SKILL.md)',
  );

  // The section must call out the atomic external-Skill-call pattern,
  // matching the existing pattern used for planning-routing and grill.
  assert.match(
    section,
    /atomic|external (Skill )?call|via Skill|Skill call/i,
    '/plan UI Step Detection section must describe an atomic external Skill call',
  );

  // The section must NOT be a long inline wireframe-ceremony prose block.
  // The refactor target is ≤ 40 lines (the original was ~45 lines of
  // inline detection + YAML + blocking-gate prose).
  const lineCount = section.split('\n').length;
  assert.ok(
    lineCount <= 40,
    `/plan UI Step Detection section must stay tight (<= 40 lines); was ${lineCount}`,
  );
});

test('AC-3: /plan step 16 references delegation to /design (not inline ceremony)', () => {
  const body = readFile(PLAN_SKILL_PATH);
  // Locate step 16 specifically — it must point to the UI Step Detection
  // section AND name /design as the delegation target.
  const step16Match = body.match(/^16\.[^\n]*Detect UI[^\n]*[\s\S]*?(?=^17\.)/m);
  assert.ok(step16Match, '/plan must contain a step 16 covering UI detection');
  const step16 = step16Match[0];
  assert.match(
    step16,
    /\/design|design.*skill|delegate/i,
    'Step 16 must signal delegation to /design (atomic external call)',
  );
});

// ---------------------------------------------------------------------------
// AC-4: the produced handoff record matches what /design-review consumes.
// ---------------------------------------------------------------------------

test('AC-4: /design handoff record shape matches /design-review consumer expectations', () => {
  const designBody = readFile(DESIGN_SKILL_PATH);
  const reviewBody = readFile(DESIGN_REVIEW_SKILL_PATH);

  // /design-review reads .pHive/design/index.yaml — /design must write it.
  assert.ok(
    reviewBody.includes('.pHive/design/index.yaml'),
    'pre-check: /design-review SKILL.md should reference .pHive/design/index.yaml',
  );
  assert.ok(
    designBody.includes('.pHive/design/index.yaml'),
    '/design SKILL.md must emit a handoff record at .pHive/design/index.yaml',
  );

  // /design-review consumes `brief_path` and `export_paths` entries —
  // /design must produce both fields.
  assert.match(
    designBody,
    /brief_path/,
    '/design handoff record must include brief_path (consumed by /design-review)',
  );
  assert.match(
    designBody,
    /export_paths/,
    '/design handoff record must include export_paths (consumed by /design-review)',
  );
});

// ---------------------------------------------------------------------------
// AC-3 follow-on: /design SKILL.md must also document the /plan-delegated
// invocation path so the two ends of the call agree.
// ---------------------------------------------------------------------------

test('AC-3 (mirror): /design documents the /plan-delegated invocation path', () => {
  const body = readFile(DESIGN_SKILL_PATH);
  assert.match(
    body,
    /--from-plan|from `\/plan`|delegated from \/plan|plan-delegated/i,
    '/design SKILL.md must describe how /plan delegates to it',
  );
});
