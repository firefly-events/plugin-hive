'use strict';

/**
 * Tests for .sandcastle/prompts/worker-issue-pickup.md
 *
 * Story: s2-sandcastle-worker-prompt (sandcastle-ops-layer)
 * Run:   node --test tests/sandcastle-worker-prompt.test.js
 *
 * The prompt is the worker contract. These tests enforce its structural
 * invariants — label namespace correctness, step ordering, COMPLETE emit on
 * both paths, and the substitution placeholder for FORCE_ISSUE.
 *
 * Covers:
 *  AC-1  Label namespace present (hive:ready / hive:in-flight / hive:failed
 *        / hive:blocked-by / hive:story / hive:epic)
 *  AC-2  Filter→Claim ordering (blocked-by filter appears before in-flight claim)
 *  AC-3  COMPLETE emitted on success path
 *  AC-4  COMPLETE emitted on failure path (critical — else maxIterations burn)
 *  AC-5  COMPLETE emitted on idle path
 *  AC-6  {{FORCE_ISSUE}} placeholder present
 *  AC-7  /hive:execute referenced as the worker's executor
 *  AC-8  gh pr create --base dev/hive-2.0
 *  AC-9  branch naming convention: agent/issue-<N>
 *  AC-10 Re-read story YAML at runtime (not trusting issue body)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROMPT_PATH = path.join(
  __dirname,
  '..',
  '.sandcastle',
  'prompts',
  'worker-issue-pickup.md'
);

function loadPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

// ---------------------------------------------------------------------------
// AC-1: Label namespace
// ---------------------------------------------------------------------------

test('prompt mentions every locked hive:* label', () => {
  const text = loadPrompt();
  for (const label of [
    'hive:ready',
    'hive:in-flight',
    'hive:failed',
    'hive:blocked-by',
    'hive:story',
    'hive:epic',
  ]) {
    assert.match(
      text,
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `prompt missing reference to ${label}`
    );
  }
});

// ---------------------------------------------------------------------------
// AC-2: Filter precedes claim
// ---------------------------------------------------------------------------

test('blocked-by filter directive precedes the in-flight claim directive', () => {
  const text = loadPrompt();
  // Anchor on the actual step directives, not header references.
  // Step 1 says "Discard any issue whose labels contain a `hive:blocked-by:..."
  // Step 2 says "gh issue edit ... --add-label hive:in-flight"
  const filterIdx = text.indexOf('Discard any issue');
  const claimIdx = text.indexOf('--add-label hive:in-flight');
  assert.ok(filterIdx >= 0, 'Step 1 discard/filter directive missing');
  assert.ok(claimIdx >= 0, 'Step 2 in-flight add-label directive missing');
  assert.ok(
    filterIdx < claimIdx,
    `expected filter directive (pos ${filterIdx}) before claim directive (pos ${claimIdx})`
  );
});

// ---------------------------------------------------------------------------
// AC-3 / AC-4 / AC-5: COMPLETE emit
// ---------------------------------------------------------------------------

test('prompt emits <promise>COMPLETE</promise> at least three times (success/failure/idle)', () => {
  const text = loadPrompt();
  const matches = text.match(/<promise>COMPLETE<\/promise>/g) || [];
  assert.ok(
    matches.length >= 3,
    `expected at least 3 COMPLETE emit sites (success/failure/idle), got ${matches.length}`
  );
});

test('failure step explicitly instructs COMPLETE emit', () => {
  const text = loadPrompt();
  const failureSection = text.slice(text.indexOf('Failure path'));
  assert.match(
    failureSection,
    /<promise>COMPLETE<\/promise>/,
    'failure path must emit COMPLETE or the runner will iterate to maxIterations'
  );
  // Must be explicit that the agent does NOT retry on failure.
  assert.match(
    failureSection,
    /do not retry|do not re-run|don't retry/i,
    'failure path must instruct no retry'
  );
});

// ---------------------------------------------------------------------------
// AC-6: FORCE_ISSUE substitution
// ---------------------------------------------------------------------------

test('prompt declares the {{FORCE_ISSUE}} sandcastle promptArgs substitution', () => {
  const text = loadPrompt();
  assert.match(
    text,
    /\{\{FORCE_ISSUE\}\}/,
    'prompt must declare {{FORCE_ISSUE}} so sandcastle promptArgs substitutes at render time'
  );
});

// ---------------------------------------------------------------------------
// AC-7: /hive:execute referenced
// ---------------------------------------------------------------------------

test('prompt routes story execution through /hive:execute skill', () => {
  const text = loadPrompt();
  assert.match(
    text,
    /\/hive:execute/,
    'prompt must defer to the /hive:execute skill (no custom executor)'
  );
});

// ---------------------------------------------------------------------------
// AC-8: gh pr create --base dev/hive-2.0
// ---------------------------------------------------------------------------

test('prompt opens PR against dev/hive-2.0 (hive 2.0 stacked-PR branching)', () => {
  const text = loadPrompt();
  assert.match(
    text,
    /gh pr create[\s\S]*--base dev\/hive-2\.0/,
    'PR must target dev/hive-2.0 per Hive 2.0 stacked-PR branching policy'
  );
  assert.match(
    text,
    /Closes #/,
    'PR body must use "Closes #<N>" to auto-close the issue on merge'
  );
});

// ---------------------------------------------------------------------------
// AC-9: branch convention
// ---------------------------------------------------------------------------

test('prompt uses agent/issue-<N> branch naming convention', () => {
  const text = loadPrompt();
  assert.match(
    text,
    /agent\/issue-/,
    'branchStrategy.branch convention is agent/issue-<N>'
  );
});

// ---------------------------------------------------------------------------
// AC-10: Re-read story YAML at runtime
// ---------------------------------------------------------------------------

test('prompt re-reads story YAML at runtime instead of trusting issue body', () => {
  const text = loadPrompt();
  assert.match(
    text,
    /\.pHive\/epics\/.*stories.*\.yaml/,
    'worker must look up the story YAML on disk'
  );
  assert.match(
    text,
    /external_id/,
    'worker matches the issue number against story external_id, not body'
  );
});
