import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCommentTitle,
  normalizeTitle,
  tallyTitles,
  emitFindings,
  findRecurringCoderabbitComments,
} from '../coderabbit-finder.mjs';

// ---------------------------------------------------------------------------
// Fixture: anatomy of a real CodeRabbit comment (trimmed from PR 254 CR2)
// ---------------------------------------------------------------------------

const CR_COMMENT_FRAMEWORK_MISMATCH = `_⚠️ Potential issue_ | _🔴 Critical_ | _⚡ Quick win_

**Test framework mismatch prevents tests from running.**

This file uses the \`node:test\` framework but \`package.json\` runs all tests with \`npx vitest run\`.

<details>
<summary>📝 Committable suggestion</summary>

\`\`\`suggestion
import { describe, expect, it } from 'vitest';
\`\`\`

</details>

<!-- fingerprinting:phantom:poseidon:puma -->
<!-- cr-comment:v1:3af8bde5138a8746c96c0b23 -->
<!-- This is an auto-generated comment by CodeRabbit -->`;

const CR_COMMENT_SCHEMA_OPTIONAL = `_⚠️ Potential issue_ | _🟠 Major_ | _⚡ Quick win_

**Schema optionality conflicts with mode-skill required behavior.**

This section marks \`field_sources.agent_models\` as optional, but both cc-workflows skill specs require it.
`;

const CR_COMMENT_PATH_MISLEADING = `_⚠️ Potential issue_ | _🟡 Minor_

**Fix misleading path explanation; the SKILL.md resolution is correct**
`;

const NON_CR_COMMENT = `> Looks good to me.

Some random reviewer prose without any bold-prefix title.`;

// ---------------------------------------------------------------------------
// extractCommentTitle
// ---------------------------------------------------------------------------

test('extractCommentTitle — pulls the bold-prefixed title from a real CR body', () => {
  assert.equal(
    extractCommentTitle(CR_COMMENT_FRAMEWORK_MISMATCH),
    'test framework mismatch prevents tests from running',
  );
});

test('extractCommentTitle — strips trailing period and lowercases', () => {
  assert.equal(
    extractCommentTitle(CR_COMMENT_SCHEMA_OPTIONAL),
    'schema optionality conflicts with mode-skill required behavior',
  );
});

test('extractCommentTitle — works without a trailing period', () => {
  assert.equal(
    extractCommentTitle(CR_COMMENT_PATH_MISLEADING),
    'fix misleading path explanation; the skill.md resolution is correct'
      .replace(/[.,;:!?]+$/g, '')
      .trim(),
  );
});

test('extractCommentTitle — returns null for body without a bold-prefix line', () => {
  assert.equal(extractCommentTitle('just prose, no markdown bold'), null);
});

test('extractCommentTitle — returns null for empty/non-string input', () => {
  assert.equal(extractCommentTitle(''), null);
  assert.equal(extractCommentTitle(null), null);
  assert.equal(extractCommentTitle(undefined), null);
});

test('extractCommentTitle — returns null when bold pair is empty', () => {
  assert.equal(extractCommentTitle('**\n\n**'), null);
});

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

test('normalizeTitle — strips markdown, lowercases, collapses whitespace, drops trailing punctuation', () => {
  assert.equal(
    normalizeTitle('**Foo `bar`   _baz_ TITLE**.'),
    'foo bar baz title',
  );
});

test('normalizeTitle — preserves internal punctuation (only trailing is stripped)', () => {
  assert.equal(
    normalizeTitle('A: thing happens; another thing happens.'),
    'a: thing happens; another thing happens',
  );
});

// ---------------------------------------------------------------------------
// tallyTitles
// ---------------------------------------------------------------------------

function makePR(number, ...commentBodies) {
  return {
    number,
    title: `PR ${number}`,
    comments: commentBodies.map((body, i) => ({
      user: { login: 'coderabbitai' },
      body,
      id: `${number}-${i}`,
    })),
  };
}

test('tallyTitles — same title across two PRs counts as 2 distinct PRs', () => {
  const tally = tallyTitles([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(255, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  const entry = tally.get('test framework mismatch prevents tests from running');
  assert.ok(entry);
  assert.equal(entry.count, 2);
  assert.equal(entry.prNumbers.size, 2);
  assert.deepEqual([...entry.prNumbers].sort(), [254, 255]);
});

test('tallyTitles — duplicate comments in same PR count once toward prNumbers', () => {
  const tally = tallyTitles([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  const entry = tally.get('test framework mismatch prevents tests from running');
  assert.equal(entry.count, 2);
  assert.equal(entry.prNumbers.size, 1);
});

test('tallyTitles — non-coderabbit authors are ignored', () => {
  const pr = {
    number: 254,
    comments: [
      { user: { login: 'human-reviewer' }, body: CR_COMMENT_FRAMEWORK_MISMATCH },
    ],
  };
  const tally = tallyTitles([pr]);
  assert.equal(tally.size, 0);
});

test('tallyTitles — coderabbit[bot] login variants are accepted', () => {
  const pr = {
    number: 254,
    comments: [
      { user: { login: 'coderabbitai[bot]' }, body: CR_COMMENT_FRAMEWORK_MISMATCH },
    ],
  };
  const tally = tallyTitles([pr]);
  assert.equal(tally.size, 1);
});

test('tallyTitles — comments without extractable title are skipped, not tallied as null', () => {
  const tally = tallyTitles([
    makePR(254, NON_CR_COMMENT),
  ]);
  assert.equal(tally.size, 0);
});

test('tallyTitles — empty input array returns empty tally', () => {
  assert.equal(tallyTitles([]).size, 0);
});

test('tallyTitles — non-array input returns empty tally (defensive)', () => {
  assert.equal(tallyTitles(null).size, 0);
  assert.equal(tallyTitles(undefined).size, 0);
  assert.equal(tallyTitles({}).size, 0);
});

// ---------------------------------------------------------------------------
// emitFindings
// ---------------------------------------------------------------------------

test('emitFindings — only emits titles meeting minRecurrence (default 3)', () => {
  const tally = tallyTitles([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(255, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  assert.deepEqual(emitFindings(tally), []);
});

test('emitFindings — emits a finding when threshold met (3+ PRs)', () => {
  const tally = tallyTitles([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(255, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(256, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  const findings = emitFindings(tally);
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.category, 'CODERABBIT_RECURRING');
  assert.equal(f.severity, 'medium');
  assert.deepEqual(f.evidence.pr_numbers, [254, 255, 256]);
  assert.equal(f.evidence.recurrence_count, 3);
  assert.match(f.id, /^finding-cr-recurring-/);
});

test('emitFindings — 5+ PRs upgrades severity to high', () => {
  const prs = [254, 255, 256, 257, 258].map((n) =>
    makePR(n, CR_COMMENT_FRAMEWORK_MISMATCH),
  );
  const tally = tallyTitles(prs);
  const findings = emitFindings(tally);
  assert.equal(findings[0].severity, 'high');
});

test('emitFindings — sort order is recurrence-desc then alphabetical', () => {
  const tally = tallyTitles([
    makePR(101, CR_COMMENT_SCHEMA_OPTIONAL),
    makePR(102, CR_COMMENT_SCHEMA_OPTIONAL),
    makePR(103, CR_COMMENT_SCHEMA_OPTIONAL),
    makePR(201, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(202, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(203, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(204, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  const findings = emitFindings(tally);
  assert.equal(findings.length, 2);
  // framework_mismatch (4 PRs) ranks above schema_optional (3 PRs)
  assert.match(findings[0].evidence.pattern_title, /test framework mismatch/);
  assert.match(findings[1].evidence.pattern_title, /schema optionality/);
});

test('emitFindings — custom minRecurrence honored', () => {
  const tally = tallyTitles([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(255, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  const findings = emitFindings(tally, { minRecurrence: 2 });
  assert.equal(findings.length, 1);
});

test('emitFindings — window_days propagates into evidence', () => {
  const tally = tallyTitles([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(255, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(256, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  const findings = emitFindings(tally, { windowDays: 30 });
  assert.equal(findings[0].evidence.window_days, 30);
  assert.match(findings[0].description, /within last 30d/);
});

// ---------------------------------------------------------------------------
// findRecurringCoderabbitComments (convenience)
// ---------------------------------------------------------------------------

test('findRecurringCoderabbitComments — one-call tally+emit returns findings ready for step-02', () => {
  const findings = findRecurringCoderabbitComments([
    makePR(254, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(255, CR_COMMENT_FRAMEWORK_MISMATCH),
    makePR(256, CR_COMMENT_FRAMEWORK_MISMATCH),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'CODERABBIT_RECURRING');
});

test('findRecurringCoderabbitComments — zero findings on insufficient input', () => {
  assert.deepEqual(findRecurringCoderabbitComments([]), []);
});
