'use strict';

/**
 * Tests for skills/write-skill (scaffold-only).
 *
 * Story: se-1-write-skill (skill-ergo-may2026)
 * Run:   node --test tests/write-skill-scaffold.test.js
 *
 * /write-skill is a prose skill — its "invocation" is the operator + Claude
 * reading SKILL.md and applying its Process section. We can't run the prose
 * end-to-end from a test, but we CAN enforce:
 *
 *   1. The scaffold artifacts exist and have the structure the skill's
 *      acceptance criteria describe.
 *   2. The skill's prose actually encodes the required behaviors (inline
 *      clarifying questions, collision handling with rename default,
 *      scope cap on scaffold-only).
 *   3. The template, when rendered against 3 fixture briefs, produces a
 *      SKILL.md that the skill-registry pattern (lowercase `name:` in
 *      frontmatter) can load.
 *
 * Covers (per story se-1 acceptance criteria):
 *   AC-1  brief w/ name + problem + 2 triggers → scaffold has required
 *         frontmatter + seeded process section
 *   AC-2  brief missing triggers → SKILL.md prose specifies inline
 *         numbered clarifying-question behavior
 *   AC-3  name collision → SKILL.md prose specifies warn + rename-default
 *   AC-4  produced SKILL.md loads cleanly under the skill-registry pattern
 *         (lowercase name in frontmatter)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(REPO_ROOT, 'skills', 'write-skill');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const TEMPLATE_MD = path.join(SKILL_DIR, 'template.md');

function readSkill() {
  return fs.readFileSync(SKILL_MD, 'utf8');
}

function readTemplate() {
  return fs.readFileSync(TEMPLATE_MD, 'utf8');
}

// ---------------------------------------------------------------------------
// Fixture briefs — three concrete inputs the scaffold should accept.
// Brief A: complete (name + problem + 2 triggers + scope).
// Brief B: missing triggers (drives AC-2 clarifying-question behavior).
// Brief C: name collides with an existing skill (drives AC-3 rename flow).
// ---------------------------------------------------------------------------

const FIXTURES = {
  complete: {
    name: 'find-skills',
    problem: 'Surface existing skills that already solve a stated problem.',
    triggers: [
      'when an operator asks "do we have a skill for X"',
      'as part of skill discovery before /write-skill',
    ],
    scope: 'atomic single-shot',
  },
  missingTriggers: {
    name: 'replay-incident',
    problem: 'Reconstruct an incident timeline from stop-hook events.',
    // triggers intentionally absent
    scope: 'atomic',
  },
  collision: {
    name: 'plan', // collides with skills/plan/
    problem: 'Decompose a requirement.',
    triggers: ['when planning work', 'before /execute'],
    scope: 'orchestrator',
  },
};

// ---------------------------------------------------------------------------
// Minimal template renderer — substitutes the placeholders the skill's
// Process step 4 documents. Mirrors the prose contract; if the template's
// placeholder set drifts, this renderer (and the tests) need updating.
// ---------------------------------------------------------------------------

function titleCase(kebab) {
  return kebab
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function renderTemplate(template, brief) {
  const description =
    `${brief.problem} (${brief.scope || 'atomic single-shot'})`;
  const triggers = brief.triggers || ['TODO: trigger phrase 1', 'TODO: trigger phrase 2'];
  return template
    .replace(/\{\{kebab-name\}\}/g, brief.name)
    .replace(/\{\{Title Case Name\}\}/g, titleCase(brief.name))
    .replace(/\{\{One-paragraph summary[^}]*\}\}/g, `Scaffolded skill: ${brief.problem}`)
    .replace(/\{\{one-line description[^}]*\}\}/g, description)
    .replace(
      /\{\{describe expected arguments\}\}/g,
      `the input described by triggers: ${triggers.join('; ')}`
    )
    .replace(/\{\{Step 1 verb-phrase title\}\}/g, 'Parse input')
    .replace(/\{\{Step 2 verb-phrase title\}\}/g, 'Do the work')
    .replace(/\{\{Step 3 verb-phrase title\}\}/g, 'Report result')
    .replace(/\{\{What the step does and why\.\}\}/g, 'TODO: fill in.')
    .replace(/\{\{role-X\}\}/g, 'a planner')
    .replace(/\{\{role-Y\}\}/g, 'an executor')
    .replace(/\{\{Why this is out of scope\.\}\}/g, 'TODO: justify exclusion.')
    .replace(
      /\{\{Other reference paths or sibling skills relevant to this one\}\}/g,
      'TODO: link related skills'
    );
}

// ---------------------------------------------------------------------------
// Structural assertions for the produced SKILL.md.
// ---------------------------------------------------------------------------

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function assertProducedSkillIsLoadable(md, expectedName) {
  // Required frontmatter
  const fm = parseFrontmatter(md);
  assert.ok(fm, 'produced SKILL.md is missing frontmatter fence');
  assert.equal(fm.name, expectedName, 'frontmatter.name mismatch');
  assert.ok(fm.description && fm.description.length > 0, 'frontmatter.description is empty');

  // AC-4: skill-registry pattern — lowercase name in frontmatter.
  assert.match(
    fm.name,
    /^[a-z][a-z0-9-]*$/,
    'frontmatter.name must be lowercase kebab-case'
  );

  // Required structural sections (matches reference skills plan/standup/grill).
  assert.match(md, /^# Hive /m, 'produced SKILL.md is missing H1 "# Hive ..."');
  assert.match(md, /\*\*Input:\*\*/, 'produced SKILL.md is missing **Input:** section');
  assert.match(md, /## Skill Preamble/, 'produced SKILL.md is missing ## Skill Preamble');
  assert.match(md, /## Process/, 'produced SKILL.md is missing ## Process');

  // Process must have at least one numbered step.
  assert.match(
    md.split('## Process')[1] || '',
    /^\d+\.\s/m,
    'Process section has no numbered steps'
  );
}

// Separate from loadable — only the renderer output should be free of
// unsubstituted placeholders. write-skill's own SKILL.md mentions
// {{placeholders}} in prose because it documents the substitution contract.
function assertNoUnsubstitutedPlaceholders(md) {
  assert.doesNotMatch(
    md,
    /\{\{[^}]+\}\}/,
    'rendered output still contains unsubstituted {{placeholders}}'
  );
}

// ---------------------------------------------------------------------------
// AC-1: complete brief → scaffold has populated frontmatter + seeded process
// ---------------------------------------------------------------------------

test('AC-1: complete brief renders to a loadable SKILL.md', () => {
  const rendered = renderTemplate(readTemplate(), FIXTURES.complete);
  assertProducedSkillIsLoadable(rendered, 'find-skills');
  assertNoUnsubstitutedPlaceholders(rendered);

  // The description should incorporate the problem statement.
  const fm = parseFrontmatter(rendered);
  assert.match(
    fm.description,
    /Surface existing skills/,
    'description should be seeded from the brief problem statement'
  );

  // H1 should be title-cased from the kebab name.
  assert.match(
    rendered,
    /^# Hive Find Skills/m,
    'H1 should title-case the kebab name'
  );
});

// ---------------------------------------------------------------------------
// AC-2: brief missing triggers → SKILL.md prose specifies inline question
// ---------------------------------------------------------------------------

test('AC-2: SKILL.md prose specifies inline numbered clarifying questions', () => {
  const md = readSkill();

  // Must reference asking inline numbered questions for missing fields.
  assert.match(
    md,
    /numbered/i,
    'SKILL.md must specify numbered clarifying questions for missing fields'
  );
  assert.match(
    md,
    /inline/i,
    'SKILL.md must specify the questions are asked inline'
  );

  // Must explicitly wait for response before writing.
  assert.match(
    md,
    /wait for[^.]*response|before[^.]*proceed|before[^.]*write/i,
    'SKILL.md must specify waiting for the operator response before writing'
  );

  // Must call out triggers as a required field that triggers the question.
  assert.match(md, /trigger/i, 'SKILL.md must reference trigger phrases');
});

// ---------------------------------------------------------------------------
// AC-3: name collision → SKILL.md prose specifies warn + rename default
// ---------------------------------------------------------------------------

test('AC-3: SKILL.md prose specifies collision handling with rename default', () => {
  const md = readSkill();

  // Must reference name-collision detection.
  assert.match(
    md,
    /already exists|collision/i,
    'SKILL.md must reference name-collision detection'
  );

  // Must offer both rename and overwrite.
  assert.match(md, /rename/i, 'SKILL.md must offer rename option');
  assert.match(md, /overwrite/i, 'SKILL.md must offer overwrite option');

  // Rename must be the default.
  assert.match(
    md,
    /default:\s*rename|recommended,\s*default/i,
    'SKILL.md must specify rename as the default'
  );
});

// ---------------------------------------------------------------------------
// AC-3 (sanity check on the fixture): a collision fixture really collides
// ---------------------------------------------------------------------------

test('AC-3: collision fixture actually collides with an existing skill dir', () => {
  const targetDir = path.join(REPO_ROOT, 'skills', FIXTURES.collision.name);
  assert.ok(
    fs.existsSync(targetDir),
    `collision fixture should point at an existing skills/<name>/ dir; ${targetDir} missing`
  );
});

// ---------------------------------------------------------------------------
// AC-4: produced SKILL.md loads under the skill-registry pattern
// ---------------------------------------------------------------------------

test('AC-4: rendered scaffolds from 3 fixture briefs all load cleanly', () => {
  const template = readTemplate();

  // Fixture A: complete brief.
  const renderedA = renderTemplate(template, FIXTURES.complete);
  assertProducedSkillIsLoadable(renderedA, 'find-skills');
  assertNoUnsubstitutedPlaceholders(renderedA);

  // Fixture B: missing triggers — renderer falls back to TODO placeholders
  // (the real skill asks inline; here we mirror the post-Q state).
  const renderedB = renderTemplate(template, FIXTURES.missingTriggers);
  assertProducedSkillIsLoadable(renderedB, 'replay-incident');
  assertNoUnsubstitutedPlaceholders(renderedB);

  // Fixture C: collision case — once the operator picks a new name, the
  // rendered output must still be a clean scaffold (collision handling is
  // a step 3 concern, not a render concern).
  const renderedC = renderTemplate(template, {
    ...FIXTURES.collision,
    name: 'plan-v2', // operator's rename
  });
  assertProducedSkillIsLoadable(renderedC, 'plan-v2');
  assertNoUnsubstitutedPlaceholders(renderedC);
});

// ---------------------------------------------------------------------------
// Scope cap: scaffold-only (no auto-indexing, no auto-commit)
// ---------------------------------------------------------------------------

test('scope cap: SKILL.md forbids auto-indexing and auto-commit', () => {
  const md = readSkill();

  // The "What this skill is NOT" section must call out non-indexer + non-committer.
  assert.match(md, /Not an indexer|no.*index|does NOT[^.]*index/i, 'SKILL.md must forbid auto-indexing');
  assert.match(md, /Not a committer|no.*commit|does NOT[^.]*commit/i, 'SKILL.md must forbid auto-commit');

  // The Process must explicitly stop after writing the file.
  assert.match(
    md,
    /Stop\.\s*Do NOT commit|do not commit|no auto-commit/i,
    'SKILL.md Process must stop after write — no commit step'
  );
});

// ---------------------------------------------------------------------------
// Template invariants — placeholders the renderer expects must exist.
// ---------------------------------------------------------------------------

test('template.md exposes the placeholders the skill Process documents', () => {
  const t = readTemplate();
  for (const placeholder of [
    '{{kebab-name}}',
    '{{Title Case Name}}',
    '{{one-line description',
    '{{describe expected arguments}}',
  ]) {
    assert.ok(
      t.includes(placeholder),
      `template.md missing required placeholder: ${placeholder}`
    );
  }
});

// ---------------------------------------------------------------------------
// SKILL.md self-load check — the write-skill skill itself satisfies the
// skill-registry pattern (would be discovered by the same loader that
// discovers what /write-skill produces).
// ---------------------------------------------------------------------------

test('write-skill SKILL.md itself loads under the skill-registry pattern', () => {
  assertProducedSkillIsLoadable(readSkill(), 'write-skill');
});
