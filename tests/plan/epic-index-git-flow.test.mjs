/**
 * Fixture test for pe-5-plan-emit-base.
 *
 * `/plan` is a prompt skill (markdown), so this test does NOT execute
 * the planner. It validates the contract surface that pe-5 introduces:
 *
 *   1. `skills/plan/SKILL.md` Phase A step 0a calls
 *      `resolveGitFlow({ cwd })` and persists the result on the planning
 *      context as `${git_flow_resolution}`.
 *   2. `skills/plan/SKILL.md` Phase C step 15 documents the canonical
 *      `git_flow:` block in the emitted `epic.yaml` template.
 *   3. `hive/references/story-yaml-schema.md` §5 carries the same block
 *      in its canonical-template section + a field table.
 *   4. The documented idempotency rule (update-in-place / insert-
 *      after-methodology) is applicable to a worked example without
 *      duplicating the block.
 *
 * Run: node --test tests/plan/epic-index-git-flow.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const PLAN_SKILL = resolve(REPO_ROOT, 'skills/plan/SKILL.md');
const SCHEMA_DOC = resolve(REPO_ROOT, 'hive/references/story-yaml-schema.md');

const planSkill = readFileSync(PLAN_SKILL, 'utf8');
const schemaDoc = readFileSync(SCHEMA_DOC, 'utf8');

// ---------------------------------------------------------------------------
// AC1: Phase A step 0a calls resolveGitFlow and stores on planning context
// ---------------------------------------------------------------------------

test('AC1 plan Phase A step 0a invokes resolveGitFlow and persists ${git_flow_resolution}', () => {
  // Step 0a label + pe-5 anchor.
  assert.match(
    planSkill,
    /0a\.\s+\*\*Pre-flight:\s*resolve git_flow\s*\(pe-5\)\.?\*\*/,
    'Phase A must declare a step 0a labelled "Pre-flight: resolve git_flow (pe-5)"',
  );
  // Helper invocation by absolute key — bridge + workflow must reference the same import.
  assert.match(
    planSkill,
    /resolveGitFlow\(\s*\{\s*cwd[^}]*\}\s*\)/,
    'Phase A 0a must call resolveGitFlow({ cwd })',
  );
  assert.match(
    planSkill,
    /hive\/lib\/git_flow\.mjs/,
    'Phase A 0a must reference the pe-1 helper path',
  );
  // Planning-context anchor.
  assert.match(
    planSkill,
    /\$\{git_flow_resolution\}/,
    'Phase A 0a must store the resolution as ${git_flow_resolution} on the planning context',
  );
  // Fallback guidance present.
  assert.match(
    planSkill,
    /import failure[^\n]*fall back/i,
    'Phase A 0a must document a fallback for the import-failure case',
  );
});

// ---------------------------------------------------------------------------
// AC2: Phase C step 15 emits a canonical git_flow block in the epic.yaml template
// ---------------------------------------------------------------------------

test('AC2 plan Phase C step 15 templates a git_flow block with both fields', () => {
  // Step 15 anchor.
  assert.match(planSkill, /15\.\s+\*\*Write the epic index\.\*\*/);
  // Required git_flow:* template literals — checked individually so the
  // failing assertion names exactly which field went missing.
  const step15Slice = planSkill.split(/15\.\s+\*\*Write the epic index/)[1] || '';
  assert.ok(step15Slice.length > 0, 'step 15 section must be present');
  assert.match(step15Slice, /git_flow:/, 'step 15 must show the git_flow: key');
  assert.match(
    step15Slice,
    /base_branch:\s*<resolved>/,
    'step 15 template must include base_branch: <resolved>',
  );
  assert.match(
    step15Slice,
    /branch_strategy:\s*<resolved>/,
    'step 15 template must include branch_strategy: <resolved>',
  );
  // Idempotency clause is in-scope so re-plan doesn't dup the block.
  assert.match(
    step15Slice,
    /Idempotency on re-plan/i,
    'step 15 must document the idempotency-on-re-plan contract',
  );
  // Cross-reference to schema doc §5 so readers can find the field table.
  assert.match(
    step15Slice,
    /story-yaml-schema\.md/,
    'step 15 must cite the schema doc for the canonical block shape',
  );
});

// ---------------------------------------------------------------------------
// AC3: story-yaml-schema.md §5 documents the new block
// ---------------------------------------------------------------------------

test('AC3 story-yaml-schema.md §5 carries the canonical epic.yaml template + git_flow table', () => {
  assert.match(schemaDoc, /^##\s+5\.\s+Epic index/m, 'schema doc must have a §5 "Epic index" section');
  // Canonical template block.
  const fiveSlice = schemaDoc.split(/##\s+5\.\s+Epic index/)[1] || '';
  assert.match(fiveSlice, /name:\s*<epic-id>/);
  assert.match(fiveSlice, /title:\s*<human title>/);
  assert.match(fiveSlice, /methodology:\s*<classic\|bmad>/);
  assert.match(fiveSlice, /git_flow:/);
  assert.match(fiveSlice, /base_branch:\s*<resolved>/);
  assert.match(fiveSlice, /branch_strategy:\s*<resolved>/);
  // Field semantics subsection.
  assert.match(fiveSlice, /###\s+5\.2\s+The\s+`git_flow`\s+block/);
  assert.match(fiveSlice, /Pinning rationale/);
  assert.match(fiveSlice, /Idempotency on re-plan/);
  assert.match(fiveSlice, /Back-compat/);
});

// ---------------------------------------------------------------------------
// AC4: idempotency on re-plan — update existing block in place, no duplication
// ---------------------------------------------------------------------------

/**
 * Mirror the documented idempotency contract as a tiny pure function so
 * we can exercise the rule against worked fixtures. /plan implementations
 * (or future executors) should produce output indistinguishable from
 * this routine on the two contract paths.
 */
function applyGitFlowIdempotent(existingYaml, resolution) {
  const blockText =
    `git_flow:\n` +
    `  base_branch: ${resolution.base_branch}\n` +
    `  branch_strategy: ${resolution.branch_strategy}\n`;

  // Update path — the file already has a git_flow: block with the two
  // expected fields directly underneath. Replace just those values; do
  // NOT duplicate the block.
  const blockRe = /git_flow:\n(?:[ \t]+base_branch:[^\n]*\n)(?:[ \t]+branch_strategy:[^\n]*\n)/;
  if (blockRe.test(existingYaml)) {
    return existingYaml.replace(blockRe, blockText);
  }
  // Insert path — insert immediately after the `methodology:` line.
  const methRe = /(^methodology:[^\n]*\n)/m;
  if (methRe.test(existingYaml)) {
    return existingYaml.replace(methRe, `$1\n${blockText}`);
  }
  // No methodology: anchor — append to end as last resort.
  return existingYaml.replace(/\n*$/, '\n') + '\n' + blockText;
}

test('AC4 idempotency — re-plan updates existing git_flow block in place', () => {
  const before = [
    'name: per-epic-branch-pr-flow',
    'title: example',
    'target_codebase: /tmp/repo',
    'methodology: classic',
    '',
    'git_flow:',
    '  base_branch: main',
    '  branch_strategy: per-epic',
    '',
    'stories:',
    '  - id: pe-1-config-schema',
    '    title: example',
    '',
  ].join('\n');
  const after = applyGitFlowIdempotent(before, {
    base_branch: 'develop',
    branch_strategy: 'per-epic',
  });
  // Exactly one git_flow: key — no duplication.
  const occurrences = after.match(/^git_flow:\s*$/gm) || [];
  assert.equal(occurrences.length, 1, `expected exactly one git_flow block; got ${occurrences.length}`);
  // Value swap landed.
  assert.match(after, /base_branch:\s*develop/);
  assert.match(after, /branch_strategy:\s*per-epic/);
});

test('AC4 idempotency — re-plan inserts git_flow block after methodology when absent', () => {
  const before = [
    'name: legacy-epic',
    'title: example',
    'target_codebase: /tmp/repo',
    'methodology: classic',
    '',
    'stories:',
    '  - id: x-1',
    '    title: example',
    '',
  ].join('\n');
  const after = applyGitFlowIdempotent(before, {
    base_branch: 'develop',
    branch_strategy: 'per-epic',
  });
  // Block was added exactly once.
  const occurrences = after.match(/^git_flow:\s*$/gm) || [];
  assert.equal(occurrences.length, 1);
  // Order: methodology: comes BEFORE git_flow: which comes BEFORE stories:
  const methIdx = after.indexOf('methodology:');
  const gfIdx = after.indexOf('git_flow:');
  const storyIdx = after.indexOf('stories:');
  assert.ok(methIdx < gfIdx && gfIdx < storyIdx,
    `expected methodology < git_flow < stories ordering; got ${methIdx}, ${gfIdx}, ${storyIdx}`);
  // Values match the stub resolution.
  assert.match(after, /base_branch:\s*develop/);
  assert.match(after, /branch_strategy:\s*per-epic/);
});

// ---------------------------------------------------------------------------
// AC2-side: the rendered template (with stub resolution applied) is
// parseable as YAML — make sure the documentation isn't subtly broken.
// ---------------------------------------------------------------------------

test('AC2 the §5 canonical template renders into valid YAML when stub values are substituted', () => {
  const fiveSlice = schemaDoc.split(/##\s+5\.\s+Epic index/)[1] || '';
  // Extract the first fenced ```yaml ... ``` block — that's the canonical template.
  const fenceMatch = fiveSlice.match(/```yaml\n([\s\S]*?)\n```/);
  assert.ok(fenceMatch, 'schema §5 must contain a ```yaml fenced template');
  const template = fenceMatch[1];
  // Substitute the placeholder tokens with concrete values.
  const rendered = template
    .replace(/<epic-id>/g, 'demo-epic')
    .replace(/<human title>/g, 'Demo epic')
    .replace(/<abs path>/g, '/tmp/repo')
    .replace(/<classic\|bmad>/g, 'classic')
    .replace(/<resolved>/, 'develop')
    .replace(/<resolved>/, 'per-epic')
    .replace(/<gh-issue-number>/g, '123')
    .replace(/<story-id>/g, 'demo-1')
    .replace(/<story title>/g, 'demo story')
    .replace(/<low\|medium\|high>/g, 'low')
    .replace(/\[<story-ids>\]/g, '[]');
  // Minimal YAML lint: every non-comment, non-blank line is either a
  // top-level `key:` or properly indented under a parent key. We avoid
  // a full YAML parser dependency (js-yaml is not vendored in repo per
  // pe-1) and just sanity-check structural shape.
  for (const line of rendered.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    assert.match(line, /^([A-Za-z_][A-Za-z0-9_-]*:|[ \t]+\S|[ \t]*-\s)/,
      `unexpected line shape in rendered template: ${JSON.stringify(line)}`);
  }
  // Required keys are present in the rendered output.
  assert.match(rendered, /^name:\s*demo-epic/m);
  assert.match(rendered, /^git_flow:/m);
  assert.match(rendered, /^\s+base_branch:\s*develop/m);
  assert.match(rendered, /^\s+branch_strategy:\s*per-epic/m);
  assert.match(rendered, /^stories:/m);
});
