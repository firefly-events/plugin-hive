'use strict';

/**
 * Tests for the planning-classification skill (dpt-3) and its composition catalog.
 * Story: dpt-5-tests
 *
 * Classification is a prose skill (SKILL.md), so tests assert against:
 *   a) the catalog data files (specialist-triggers.md, project-profile.yaml, hive/agents/*)
 *   b) a reference resolution harness that implements the same rules as the skill
 *
 * Run: node --test tests/skills/planning-classification.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SPECIALIST_TRIGGERS_PATH = path.join(REPO_ROOT, 'hive', 'references', 'specialist-triggers.md');
const AGENTS_DIR = path.join(REPO_ROOT, 'hive', 'agents');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * Extract the planning_composition YAML block from specialist-triggers.md.
 * The block is the first ```yaml fenced block in the "Planning Composition" section.
 */
function extractPlanningComposition(markdown) {
  // Find the Planning Composition section
  const sectionStart = markdown.indexOf('## Planning Composition');
  assert.ok(sectionStart !== -1, 'specialist-triggers.md must contain "## Planning Composition" section');

  // Find the next section boundary so we only look within this section
  const nextSection = markdown.indexOf('\n## ', sectionStart + 1);
  const sectionText = nextSection === -1 ? markdown.slice(sectionStart) : markdown.slice(sectionStart, nextSection);

  const fence = sectionText.match(/```yaml\s*([\s\S]*?)```/);
  assert.ok(fence, 'Planning Composition section must contain a ```yaml fenced block');
  return yaml.load(fence[1]);
}

/**
 * Return the set of persona filenames present in hive/agents/ (without .md extension).
 */
function agentRoster() {
  return new Set(
    fs.readdirSync(AGENTS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, '')),
  );
}

/**
 * Reference resolver: mirrors the rules described in planning-classification SKILL.md.
 *
 * Resolution rules:
 *   1. Start with spine (always included).
 *   2. For each work_type whose tag appears in matchedTags:
 *      - If project_gate is null → include all specialists
 *      - If project_gate is 'requires_ui' → include only when hasUi === true
 *   3. Deduplicate, preserving first-insertion order.
 *   4. Low-confidence (matchedTags empty) → return spine only.
 *
 * @param {object} composition  Parsed planning_composition block
 * @param {string[]} matchedTags  Tags matched by the classifier
 * @param {boolean} hasUi  Value of project_profile.has_ui
 * @returns {string[]} assembled_personas in stable order
 */
function resolvePersonas(composition, matchedTags, hasUi) {
  const tagSet = new Set(matchedTags);
  const seen = new Set();
  const result = [];

  function add(persona) {
    if (!seen.has(persona)) {
      seen.add(persona);
      result.push(persona);
    }
  }

  // Spine is always first
  for (const p of composition.spine) add(p);

  if (tagSet.size === 0) {
    // Low-confidence / no-match: spine only
    return result;
  }

  for (const wt of composition.work_types) {
    if (!tagSet.has(wt.tag)) continue;
    const gate = wt.project_gate ?? null;
    if (gate === null || (gate === 'requires_ui' && hasUi)) {
      for (const specialist of wt.specialists) add(specialist);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Test 1 — Map schema
// ---------------------------------------------------------------------------
test('1 — planning_composition parses; schema_version present; spine correct; every specialist resolves to hive/agents/*.md', () => {
  const markdown = readFile(SPECIALIST_TRIGGERS_PATH);
  const parsed = extractPlanningComposition(markdown);
  const composition = parsed.planning_composition;

  assert.ok(composition, 'top-level key "planning_composition" must exist');

  // schema_version
  assert.ok(
    typeof composition.schema_version === 'string' && composition.schema_version.length > 0,
    'planning_composition.schema_version must be a non-empty string',
  );

  // spine
  assert.deepEqual(
    composition.spine,
    ['researcher', 'technical-writer', 'tpm'],
    'spine must be exactly [researcher, technical-writer, tpm]',
  );

  // every specialist resolves to hive/agents/<persona>.md
  const roster = agentRoster();
  const allSpecialists = composition.work_types.flatMap(wt => wt.specialists);
  for (const specialist of allSpecialists) {
    assert.ok(
      roster.has(specialist),
      `specialist "${specialist}" must have a corresponding hive/agents/${specialist}.md`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Low-confidence fallback
// ---------------------------------------------------------------------------
test('2 — no-match requirement resolves to spine only', () => {
  const parsed = extractPlanningComposition(readFile(SPECIALIST_TRIGGERS_PATH));
  const composition = parsed.planning_composition;

  // Empty tag set → no work_type fires
  const assembled = resolvePersonas(composition, [], true);

  assert.deepEqual(
    assembled,
    composition.spine,
    'assembled_personas with no matched tags must equal spine exactly',
  );
});

// ---------------------------------------------------------------------------
// Test 3 — Project gate (has_ui gate)
// ---------------------------------------------------------------------------
test('3 — has_ui=false suppresses requires_ui specialists; has_ui=true admits them', () => {
  const parsed = extractPlanningComposition(readFile(SPECIALIST_TRIGGERS_PATH));
  const composition = parsed.planning_composition;

  // Collect all tags that have project_gate: requires_ui
  const gatedTags = composition.work_types
    .filter(wt => wt.project_gate === 'requires_ui')
    .map(wt => wt.tag);

  assert.ok(gatedTags.length > 0, 'At least one work_type must have project_gate: requires_ui');

  // Collect specialists behind the UI gate
  const gatedSpecialists = composition.work_types
    .filter(wt => wt.project_gate === 'requires_ui')
    .flatMap(wt => wt.specialists);

  // has_ui=false: gated specialists must be absent
  const assembledNoUi = resolvePersonas(composition, gatedTags, false);
  for (const specialist of gatedSpecialists) {
    assert.ok(
      !assembledNoUi.includes(specialist),
      `has_ui=false: "${specialist}" must not appear in assembled_personas`,
    );
  }

  // has_ui=true: gated specialists must be present
  const assembledWithUi = resolvePersonas(composition, gatedTags, true);
  for (const specialist of gatedSpecialists) {
    assert.ok(
      assembledWithUi.includes(specialist),
      `has_ui=true: "${specialist}" must appear in assembled_personas`,
    );
  }

  // Spot-check the concrete names called out in the story spec
  assert.ok(!assembledNoUi.includes('ui-designer'), 'ui-designer absent when has_ui=false');
  assert.ok(!assembledNoUi.includes('accessibility-specialist'), 'accessibility-specialist absent when has_ui=false');
  assert.ok(assembledWithUi.includes('ui-designer'), 'ui-designer present when has_ui=true');
  assert.ok(assembledWithUi.includes('accessibility-specialist'), 'accessibility-specialist present when has_ui=true');
});

// ---------------------------------------------------------------------------
// Test 4 — Roster-only invariant
// ---------------------------------------------------------------------------
test('4 — resolution never emits a persona absent from hive/agents/', () => {
  const parsed = extractPlanningComposition(readFile(SPECIALIST_TRIGGERS_PATH));
  const composition = parsed.planning_composition;
  const roster = agentRoster();

  // Exercise with all tags + has_ui=true to get the maximum possible roster
  const allTags = composition.work_types.map(wt => wt.tag);
  const assembled = resolvePersonas(composition, allTags, true);

  for (const persona of assembled) {
    assert.ok(
      roster.has(persona),
      `persona "${persona}" in assembled_personas but hive/agents/${persona}.md does not exist`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 5 — Multi-tag union + dedupe
// ---------------------------------------------------------------------------
test('5 — overlapping tags (data + architecture) both map to architect; deduped to one occurrence', () => {
  const parsed = extractPlanningComposition(readFile(SPECIALIST_TRIGGERS_PATH));
  const composition = parsed.planning_composition;

  // Verify data and architecture tags both map to architect in the catalog
  const architectTags = composition.work_types
    .filter(wt => wt.specialists.includes('architect'))
    .map(wt => wt.tag);

  assert.ok(
    architectTags.includes('architecture'),
    'work_types must have an "architecture" tag that maps to architect',
  );
  assert.ok(
    architectTags.includes('data'),
    'work_types must have a "data" tag that maps to architect',
  );

  // Resolve with both tags active
  const assembled = resolvePersonas(composition, ['architecture', 'data'], false);

  // architect must appear exactly once
  const architectCount = assembled.filter(p => p === 'architect').length;
  assert.equal(architectCount, 1, 'architect must appear exactly once despite matching two tags');

  // Stable order: architect should follow the last spine member (tpm) — first tag wins insertion
  const tpmIdx = assembled.indexOf('tpm');
  const archIdx = assembled.indexOf('architect');
  assert.ok(tpmIdx !== -1, 'tpm must be in assembled_personas');
  assert.ok(archIdx > tpmIdx, 'architect must appear after spine members');
});

// ---------------------------------------------------------------------------
// Test 6 — Provenance block validates against story-yaml-schema §6.4
// ---------------------------------------------------------------------------
test('6 — planning_team block conforming to story-yaml-schema §6.4 validates', () => {
  // Reference resolver produces the assembled_personas that /plan would use.
  // Construct a realistic planning_team fixture and assert its shape.
  const parsed = extractPlanningComposition(readFile(SPECIALIST_TRIGGERS_PATH));
  const composition = parsed.planning_composition;

  const matchedTags = ['architecture'];
  const assembled = resolvePersonas(composition, matchedTags, false);

  // Build a planning_team provenance block (the shape written to epic.yaml by dpt-4)
  const planningTeam = {
    matched_tags: matchedTags,
    roster: assembled,
    per_tag_reasoning: {
      architecture: 'requirement describes structural work spanning multiple subsystems',
    },
    confidence: 'high',
    gate_decisions: {
      include_architect: true,
      include_ui_designer: false,
    },
  };

  // Field-level assertions against §6.4.1 / §6.4.2
  assert.ok(Array.isArray(planningTeam.matched_tags), 'matched_tags must be an array');
  assert.ok(Array.isArray(planningTeam.roster), 'roster must be an array');
  assert.ok(planningTeam.roster.length > 0, 'roster must be non-empty (spine always present)');
  assert.ok(
    typeof planningTeam.per_tag_reasoning === 'object' && !Array.isArray(planningTeam.per_tag_reasoning),
    'per_tag_reasoning must be a map',
  );
  for (const tag of planningTeam.matched_tags) {
    assert.ok(
      typeof planningTeam.per_tag_reasoning[tag] === 'string',
      `per_tag_reasoning must have a string entry for every matched tag — missing "${tag}"`,
    );
  }
  assert.ok(
    ['low', 'medium', 'high'].includes(planningTeam.confidence),
    `confidence must be low|medium|high, got "${planningTeam.confidence}"`,
  );
  assert.ok(
    typeof planningTeam.gate_decisions === 'object' && !Array.isArray(planningTeam.gate_decisions),
    'gate_decisions must be a map',
  );
  for (const [, v] of Object.entries(planningTeam.gate_decisions)) {
    assert.equal(typeof v, 'boolean', 'every gate_decisions value must be a boolean');
  }

  // Spine is always present in the roster
  for (const spinePersona of composition.spine) {
    assert.ok(
      planningTeam.roster.includes(spinePersona),
      `spine persona "${spinePersona}" must appear in roster`,
    );
  }

  // Round-trip: block must survive a yaml.dump → yaml.load cycle without loss
  const roundTripped = yaml.load(yaml.dump({ planning_team: planningTeam }));
  assert.deepEqual(roundTripped.planning_team, planningTeam, 'planning_team block must round-trip through YAML cleanly');
});
