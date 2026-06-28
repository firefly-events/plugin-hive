/**
 * Contract tests for story s1-tool-grant-removal (epic teamcreate-migration).
 *
 * Claude Code v2.1.178 deleted the TeamCreate tool. The orchestrator and
 * team-lead persona files both listed it in their tools: arrays — a
 * runtime-breaking declaration of a deleted tool. This story removes
 * TeamCreate from both tools: arrays (SendMessage must survive) and rewrites
 * the two inline prose hints that referenced the deleted tool to describe the
 * v2.1.178 natural-language auto-spawn model instead.
 *
 * Run: node --test tests/hive-agents/teamcreate-tool-grant-removal.test.js
 *
 * Each test maps 1:1 to a story acceptance criterion (AC1..AC6). The tests are
 * behavioral: they assert on the persona files' published contract (the tools:
 * grant array and the prose hints), not on implementation internals.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'hive', 'agents');
const ORCHESTRATOR = path.join(AGENTS_DIR, 'orchestrator.md');
const TEAM_LEAD = path.join(AGENTS_DIR, 'team-lead.md');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * Extract the tool names declared in the persona's `tools:` array.
 *
 * The persona files declare tools on a single line of YAML frontmatter, e.g.
 *   tools: ["Grep", "Glob", "Read", "Write", "Edit", "Bash", "SendMessage"]
 * Returns the parsed array of tool-name strings.
 */
function parseToolsArray(markdown, label) {
  const match = markdown.match(/^tools:\s*(\[[^\]]*\])\s*$/m);
  assert.ok(match, `${label}: expected a single-line tools: [ ... ] array in frontmatter`);
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    assert.fail(`${label}: tools: array is not valid JSON: ${match[1]} (${err.message})`);
  }
  assert.ok(Array.isArray(parsed), `${label}: tools: must be an array`);
  return parsed;
}

// --- AC1: orchestrator.md tools: array no longer contains TeamCreate ---
test('AC1: orchestrator.md tools: array does not contain TeamCreate', () => {
  const tools = parseToolsArray(readFile(ORCHESTRATOR), 'orchestrator.md');
  assert.ok(
    !tools.includes('TeamCreate'),
    `orchestrator.md tools: array must not contain the deleted TeamCreate tool; got ${JSON.stringify(tools)}`,
  );
});

// --- AC2: team-lead.md tools: array no longer contains TeamCreate ---
test('AC2: team-lead.md tools: array does not contain TeamCreate', () => {
  const tools = parseToolsArray(readFile(TEAM_LEAD), 'team-lead.md');
  assert.ok(
    !tools.includes('TeamCreate'),
    `team-lead.md tools: array must not contain the deleted TeamCreate tool; got ${JSON.stringify(tools)}`,
  );
});

// --- AC3: SendMessage survives in both tools: arrays ---
test('AC3: SendMessage survives in both persona tools: arrays', () => {
  const orchestratorTools = parseToolsArray(readFile(ORCHESTRATOR), 'orchestrator.md');
  const teamLeadTools = parseToolsArray(readFile(TEAM_LEAD), 'team-lead.md');
  assert.ok(
    orchestratorTools.includes('SendMessage'),
    `orchestrator.md tools: array must still grant SendMessage; got ${JSON.stringify(orchestratorTools)}`,
  );
  assert.ok(
    teamLeadTools.includes('SendMessage'),
    `team-lead.md tools: array must still grant SendMessage; got ${JSON.stringify(teamLeadTools)}`,
  );
});

// --- AC4: grep -rn 'TeamCreate' hive/agents/ returns zero matches ---
test('AC4: no TeamCreate references remain anywhere under hive/agents/', () => {
  // Mirror the story's verification grep. grep exits 1 (no match) on success
  // and 0 (match found) on failure, so capture the output rather than letting
  // a non-zero exit throw.
  let output = '';
  try {
    output = execFileSync('grep', ['-rn', 'TeamCreate', AGENTS_DIR], {
      encoding: 'utf8',
    });
  } catch (err) {
    // Exit code 1 = no matches found = the desired state. Any other failure
    // (e.g. exit 2) is a real error.
    if (err.status === 1) {
      output = '';
    } else {
      throw err;
    }
  }
  assert.equal(
    output.trim(),
    '',
    `grep -rn TeamCreate hive/agents/ must return zero matches; found:\n${output}`,
  );
});

// --- AC5: orchestrator.md knowledge hint rewritten — no TeamCreate, describes spawn ---
test('AC5: orchestrator.md spawn hint describes natural-language spawn without naming TeamCreate', () => {
  const markdown = readFile(ORCHESTRATOR);
  // The hint is the agent-spawn skill use-when describing how roster agents are
  // spawned for story execution. Locate it by its stable anchor phrase.
  const hintMatch = markdown.match(/use-when:\s*"([^"]*spawning roster agents[^"]*)"/);
  assert.ok(
    hintMatch,
    'orchestrator.md must retain a spawn use-when hint ("spawning roster agents ...")',
  );
  const hint = hintMatch[1];
  assert.ok(
    !/TeamCreate/.test(hint),
    `orchestrator.md spawn hint must not reference the deleted TeamCreate tool; got: "${hint}"`,
  );
  assert.ok(
    /natural-language|natural language|auto-spawn|teammate spawn/i.test(hint),
    `orchestrator.md spawn hint must describe the natural-language spawn model; got: "${hint}"`,
  );
});

// --- AC6: team-lead.md prose hint rewritten — natural-language description, no TeamCreate ---
test('AC6: team-lead.md sub-worker hint instructs natural-language description, not a TeamCreate call', () => {
  const markdown = readFile(TEAM_LEAD);
  // The prose hint is the activation-protocol step about sub-workers. Locate
  // the line that addresses describing sub-workers / spawning teammates.
  const lines = markdown.split('\n');
  const hintLine = lines.find(
    (l) => /sub-worker/i.test(l) || (/natural language/i.test(l) && /spawn|teammate/i.test(l)),
  );
  assert.ok(
    hintLine,
    'team-lead.md must retain a sub-worker activation hint describing how teammates are created',
  );
  assert.ok(
    !/TeamCreate/.test(hintLine),
    `team-lead.md sub-worker hint must not reference the deleted TeamCreate tool; got: "${hintLine.trim()}"`,
  );
  assert.ok(
    /natural language/i.test(hintLine) && /(auto-spawn|spawns?|teammate)/i.test(hintLine),
    `team-lead.md sub-worker hint must instruct the lead to describe the team in natural language so the runtime auto-spawns teammates; got: "${hintLine.trim()}"`,
  );
});
