'use strict';

/**
 * Tests for skills/sandcastle-gh-init/assets/
 *
 * Story: s1-workflow-template (sandcastle-gh-issue-dispatch)
 * Run:   node --test tests/sandcastle-gh-init-assets.test.js
 *        UPDATE_SNAPSHOTS=1 node --test tests/sandcastle-gh-init-assets.test.js
 *
 * Asset shape:
 *   hive-dispatch.yml.tpl              -- {{RUNNER}} + {{SECRET_KEY}} placeholders
 *   hive-dispatch.example.yml          -- rendered with defaults (ubuntu-latest, ANTHROPIC_API_KEY)
 *   sandcastle-hive-bridge.mts.tpl     -- {{SECRET_KEY}} placeholder
 *   sandcastle-hive-bridge.example.mts -- rendered with default (ANTHROPIC_API_KEY)
 *
 * Snapshot rule: rendering each .tpl with default substitutions MUST match
 * the corresponding .example file byte-for-byte. Regenerate by exporting
 * UPDATE_SNAPSHOTS=1 and re-running.
 *
 * Structural rules enforced (acceptance criteria from story s1):
 *   AC-1 workflow fires `on: issues:[labeled]` with `if:` gate on hive:ready
 *   AC-2 success path opens PR and transitions to hive:shipped
 *   AC-3 failure step uses `if: failure()` and transitions to hive:failed
 *   AC-4 per-issue concurrency.group with cancel-in-progress: false
 *   AC-5 permissions block is minimal (contents/issues/pull-requests:write)
 *   AC-6 bridge sets HIVE_EXECUTION_MODE=team (workflow env + prompt restatement)
 *   AC-7 bridge validates ISSUE_NUMBER as positive integer (injection guard)
 *   AC-8 bridge prints clear error + exit(1) on missing API key
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = path.join(
  __dirname,
  '..',
  'skills',
  'hive',
  'skills',
  'sandcastle-gh-init',
  'assets'
);

const YML_TPL = path.join(ASSETS, 'hive-dispatch.yml.tpl');
const YML_EXAMPLE = path.join(ASSETS, 'hive-dispatch.example.yml');
const MTS_TPL = path.join(ASSETS, 'sandcastle-hive-bridge.mts.tpl');
const MTS_EXAMPLE = path.join(ASSETS, 'sandcastle-hive-bridge.example.mts');

const DEFAULT_RUNNER = 'ubuntu-latest';
const DEFAULT_SECRET_KEY = 'ANTHROPIC_API_KEY';

function render(tpl, substitutions) {
  let out = tpl;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Snapshot tests (byte-for-byte, regenerable via UPDATE_SNAPSHOTS=1)
// ---------------------------------------------------------------------------

test('hive-dispatch.yml.tpl renders to example with default substitutions', () => {
  const tpl = readFile(YML_TPL);
  const rendered = render(tpl, {
    RUNNER: DEFAULT_RUNNER,
    SECRET_KEY: DEFAULT_SECRET_KEY,
  });
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.writeFileSync(YML_EXAMPLE, rendered);
    return;
  }
  const expected = readFile(YML_EXAMPLE);
  assert.equal(rendered, expected,
    'hive-dispatch.example.yml is out of sync with hive-dispatch.yml.tpl.\n' +
    'Regenerate with: UPDATE_SNAPSHOTS=1 node --test tests/sandcastle-gh-init-assets.test.js');
});

test('sandcastle-hive-bridge.mts.tpl renders to example with default substitution', () => {
  const tpl = readFile(MTS_TPL);
  const rendered = render(tpl, { SECRET_KEY: DEFAULT_SECRET_KEY });
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.writeFileSync(MTS_EXAMPLE, rendered);
    return;
  }
  const expected = readFile(MTS_EXAMPLE);
  assert.equal(rendered, expected,
    'sandcastle-hive-bridge.example.mts is out of sync with sandcastle-hive-bridge.mts.tpl.\n' +
    'Regenerate with: UPDATE_SNAPSHOTS=1 node --test tests/sandcastle-gh-init-assets.test.js');
});

test('placeholders are removed from rendered output', () => {
  // GitHub Actions expression syntax `${{ ... }}` is legitimate in the
  // rendered output, so we check for our placeholder shape `{{NAME}}`
  // specifically (no preceding `$`).
  const placeholderPattern = /(?<!\$)\{\{[A-Z_]+\}\}/;
  const renderedYml = render(readFile(YML_TPL), {
    RUNNER: DEFAULT_RUNNER,
    SECRET_KEY: DEFAULT_SECRET_KEY,
  });
  assert.ok(!placeholderPattern.test(renderedYml), 'rendered yml still has a {{NAME}} placeholder');
  const renderedMts = render(readFile(MTS_TPL), { SECRET_KEY: DEFAULT_SECRET_KEY });
  assert.ok(!placeholderPattern.test(renderedMts), 'rendered mts still has a {{NAME}} placeholder');
});

test('templates expose only documented placeholders', () => {
  const yml = readFile(YML_TPL);
  const mts = readFile(MTS_TPL);
  const ymlPlaceholders = new Set([...yml.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]));
  const mtsPlaceholders = new Set([...mts.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]));
  assert.deepEqual([...ymlPlaceholders].sort(), ['RUNNER', 'SECRET_KEY']);
  assert.deepEqual([...mtsPlaceholders].sort(), ['SECRET_KEY']);
});

// ---------------------------------------------------------------------------
// AC-1: workflow trigger + label guard
// ---------------------------------------------------------------------------

test('AC-1 workflow fires on issues:[labeled] with hive:ready guard', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /on:\s*\n\s*issues:\s*\n\s*types:\s*\[labeled\]/);
  assert.match(yml, /if:\s*github\.event\.label\.name\s*==\s*'hive:ready'/);
});

// ---------------------------------------------------------------------------
// AC-2: success path opens PR + flips to hive:shipped
// ---------------------------------------------------------------------------

test('AC-2 success step opens PR and transitions to hive:shipped', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /name:\s*On success/);
  assert.match(yml, /gh pr create/);
  assert.match(yml, /--add-label hive:shipped/);
  assert.match(yml, /gh issue comment/);
});

// ---------------------------------------------------------------------------
// AC-3: failure path uses if: failure() + flips to hive:failed
// ---------------------------------------------------------------------------

test('AC-3 failure step uses if: failure() and transitions to hive:failed', () => {
  const yml = readFile(YML_EXAMPLE);
  // Failure step must appear AFTER the bridge step and use if: failure().
  const failureBlock = yml.match(/name:\s*On failure[\s\S]+?if:\s*failure\(\)[\s\S]+?--add-label hive:failed/);
  assert.ok(failureBlock, 'failure step block (if: failure() -> hive:failed) not found');
});

// ---------------------------------------------------------------------------
// AC-4: per-issue concurrency
// ---------------------------------------------------------------------------

test('AC-4 concurrency.group is per-issue, cancel-in-progress: false', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /^concurrency:\s*$/m);
  assert.match(yml, /^\s*group:\s*hive-issue-\$\{\{ github\.event\.issue\.number \}\}\s*$/m);
  assert.match(yml, /^\s*cancel-in-progress:\s*false\s*$/m);
});

// ---------------------------------------------------------------------------
// AC-5: minimal permissions block
// ---------------------------------------------------------------------------

test('AC-5 permissions block lists only contents/issues/pull-requests as write', () => {
  const yml = readFile(YML_EXAMPLE);
  const block = yml.match(/permissions:\s*\n((?:\s{2}\S.*\n)+)/);
  assert.ok(block, 'permissions block not found');
  const lines = block[1]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const parsed = Object.fromEntries(lines.map(l => l.split(':').map(s => s.trim())));
  assert.deepEqual(parsed, {
    contents: 'write',
    issues: 'write',
    'pull-requests': 'write',
  });
});

// ---------------------------------------------------------------------------
// AC-6: HIVE_EXECUTION_MODE=team
// ---------------------------------------------------------------------------

test('AC-6 workflow sets HIVE_EXECUTION_MODE=team on bridge step env', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /HIVE_EXECUTION_MODE:\s*team/);
});

test('AC-6 bridge prompt restates the no-nested-sandcastle rule', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /HIVE_EXECUTION_MODE=team/);
  assert.match(mts, /Do NOT spawn additional sandcastles/);
});

// ---------------------------------------------------------------------------
// AC-7: ISSUE_NUMBER validated as positive integer (no shell injection)
// ---------------------------------------------------------------------------

test('AC-7 bridge validates ISSUE_NUMBER matches /^\\d+$/', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /\/\^\\d\+\$\/\.test\(issueNumberRaw\)/);
});

test('AC-7 bridge never shells out (no child_process, no exec)', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.ok(!/child_process/.test(mts), 'bridge must not import child_process');
  assert.ok(!/\bexecSync\b/.test(mts), 'bridge must not call execSync');
  assert.ok(!/\bspawnSync\b/.test(mts), 'bridge must not call spawnSync');
});

// ---------------------------------------------------------------------------
// AC-8: missing-key handling
// ---------------------------------------------------------------------------

test('AC-8 bridge fails loudly when the API key env is missing', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /process\.env\["ANTHROPIC_API_KEY"\]/);
  assert.match(mts, /is not set/);
  assert.match(mts, /process\.exit\(1\)/);
});

// ---------------------------------------------------------------------------
// Bridge contract: imports, agent, sandbox, branchStrategy, run() shape
// ---------------------------------------------------------------------------

test('bridge imports run + claudeCode from @ai-hero/sandcastle and docker sandbox', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /import \{ run, claudeCode \} from "@ai-hero\/sandcastle";/);
  assert.match(mts, /import \{ docker \} from "@ai-hero\/sandcastle\/sandboxes\/docker";/);
});

test('bridge invokes run() with branch agent/issue-<n> and cost controls', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /agent: claudeCode\("claude-opus-4-7"\)/);
  assert.match(mts, /sandbox: docker\(\)/);
  assert.match(mts, /branchStrategy: \{ type: "branch", branch \}/);
  assert.match(mts, /maxIterations:\s*5/);
  assert.match(mts, /idleTimeoutSeconds:\s*600/);
  assert.match(mts, /const branch = `agent\/issue-\$\{issueNumber\}`;/);
});

// ---------------------------------------------------------------------------
// Job-level timeout-minutes (story risk: cost runaway)
// ---------------------------------------------------------------------------

test('workflow job has a timeout-minutes ceiling', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /timeout-minutes:\s*\d+/);
});
