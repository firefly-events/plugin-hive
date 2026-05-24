'use strict';

/**
 * Tests for /hive:standup --format slack flag (h-03).
 *
 * Story: h-03-standup-format-slack (hermes-integration-mvp)
 * Run:   node --test tests/skills/standup-format-slack.test.js
 *
 * /hive:standup is a prose skill — its "invocation" is Claude reading SKILL.md
 * and applying the Process section. We enforce:
 *
 *   1. SKILL.md documents the --format flag with both accepted values.
 *   2. SKILL.md specifies the Phase 1-only short-circuit under --format slack.
 *   3. SKILL.md specifies no ANSI escape codes under --format slack.
 *   4. step-03-present-standup.md encodes the format branching and the
 *      non-interactive short-circuit for slack format.
 *   5. standup-slack-format.md exists and documents heading, list, and
 *      code-block conventions.
 *   6. routines-integration.md contains the §External coordinators section.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL_MD = path.join(REPO_ROOT, 'skills', 'standup', 'SKILL.md');
const STEP_03_MD = path.join(REPO_ROOT, 'hive', 'workflows', 'steps', 'daily-ceremony', 'step-03-present-standup.md');
const SLACK_FORMAT_MD = path.join(REPO_ROOT, 'hive', 'references', 'standup-slack-format.md');
const ROUTINES_MD = path.join(REPO_ROOT, 'hive', 'references', 'routines-integration.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// SKILL.md — flag documentation
// ---------------------------------------------------------------------------

test('SKILL.md documents --format flag', () => {
  const skill = read(SKILL_MD);
  assert.ok(skill.includes('--format'), 'SKILL.md must mention --format flag');
  assert.ok(skill.includes('slack'), 'SKILL.md must document "slack" as a --format value');
  assert.ok(skill.includes('default'), 'SKILL.md must document "default" as a --format value');
});

test('SKILL.md documents Phase 1-only short-circuit for --format slack', () => {
  const skill = read(SKILL_MD);
  assert.ok(
    skill.includes('Phase 1') && skill.includes('slack'),
    'SKILL.md must note that --format slack emits Phase 1 only'
  );
  assert.ok(
    skill.match(/Phase [23]|Phase 2|Phase 3/),
    'SKILL.md must mention Phase 2/3 in the context of what slack skips'
  );
});

test('SKILL.md specifies no ANSI escape codes under --format slack', () => {
  const skill = read(SKILL_MD);
  assert.ok(
    skill.includes('ANSI') || skill.includes('escape code'),
    'SKILL.md must specify that --format slack output has no ANSI escape codes'
  );
});

test('SKILL.md args parsing includes --format step', () => {
  const skill = read(SKILL_MD);
  assert.ok(
    skill.includes('args.format') || skill.includes('Parse `--format`') || skill.includes('--format` flag'),
    'SKILL.md must include --format in the args parsing steps'
  );
});

// ---------------------------------------------------------------------------
// step-03-present-standup.md — format branching
// ---------------------------------------------------------------------------

test('step-03 encodes format branching between slack and default modes', () => {
  const step = read(STEP_03_MD);
  assert.ok(step.includes('slack'), 'step-03 must reference slack format mode');
  assert.ok(step.includes('args.format'), 'step-03 must reference args.format');
});

test('step-03 specifies non-interactive short-circuit for slack format', () => {
  const step = read(STEP_03_MD);
  assert.ok(
    step.match(/stop|terminates|do NOT proceed|Do NOT proceed/i),
    'step-03 must specify that workflow stops after Phase 1 under --format slack'
  );
  assert.ok(
    step.match(/step 4|step-04|step-04-select-work/i),
    'step-03 must reference the step it does NOT proceed to under slack format'
  );
});

test('step-03 specifies no ANSI in slack mode', () => {
  const step = read(STEP_03_MD);
  assert.ok(
    step.includes('ANSI') || step.includes('escape'),
    'step-03 must specify no ANSI escape codes in slack mode'
  );
});

// ---------------------------------------------------------------------------
// standup-slack-format.md — reference doc existence and conventions
// ---------------------------------------------------------------------------

test('standup-slack-format.md exists', () => {
  assert.ok(fs.existsSync(SLACK_FORMAT_MD), 'hive/references/standup-slack-format.md must exist');
});

test('standup-slack-format.md specifies no ANSI constraint', () => {
  const doc = read(SLACK_FORMAT_MD);
  assert.ok(
    doc.includes('ANSI') || doc.includes('escape code'),
    'standup-slack-format.md must document the no-ANSI constraint'
  );
});

test('standup-slack-format.md documents heading levels', () => {
  const doc = read(SLACK_FORMAT_MD);
  assert.ok(doc.includes('##') || doc.includes('heading'), 'standup-slack-format.md must document heading level conventions');
});

test('standup-slack-format.md documents code blocks for tabular data', () => {
  const doc = read(SLACK_FORMAT_MD);
  assert.ok(
    doc.includes('code block') || doc.includes('fenced') || doc.includes('```'),
    'standup-slack-format.md must document code block usage for tabular data'
  );
});

test('standup-slack-format.md specifies empty-section collapse rule', () => {
  const doc = read(SLACK_FORMAT_MD);
  assert.ok(
    doc.match(/empty|collapse|omit/i),
    'standup-slack-format.md must specify that empty sections are omitted'
  );
});

// ---------------------------------------------------------------------------
// routines-integration.md — External coordinators section
// ---------------------------------------------------------------------------

test('routines-integration.md contains External coordinators section', () => {
  const doc = read(ROUTINES_MD);
  assert.ok(
    doc.includes('External coordinators') || doc.includes('External Coordinators'),
    'routines-integration.md must contain §"External coordinators (Hermes equivalence)"'
  );
});

test('routines-integration.md mentions Hermes in external coordinators section', () => {
  const doc = read(ROUTINES_MD);
  assert.ok(doc.includes('Hermes'), 'routines-integration.md must name Hermes as an example external coordinator');
});

test('routines-integration.md notes --format slack as the cron-safe invocation', () => {
  const doc = read(ROUTINES_MD);
  assert.ok(
    doc.includes('--format slack'),
    'routines-integration.md must document --format slack as the cron-safe invocation path'
  );
});
