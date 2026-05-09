/**
 * Behavioral tests for hooks/check-agent-misuse.sh orchestrator-pattern gate.
 *
 * Story s10-a7-agent-spawn-flow-hook-relax. TDD: written RED before implementation.
 * Run: node tests/hive-hooks/check-agent-misuse.orchestrator-pattern.behavior.test.js
 *
 * Three cases:
 *   a) Messages-API spawn (messages-session.js routed Agent()) — ALLOW
 *   b) TeamCreate spawn — ALLOW
 *   c) Existing orchestrator-pattern catalog match — BLOCK
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'check-agent-misuse.sh');

function runHook(payload) {
  const result = spawnSync(HOOK_PATH, {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Case (a): Messages-API routed Agent() spawn — ALLOW
// ---------------------------------------------------------------------------
test('case a — Messages-API-routed Agent() spawn via hive/lib/messages-session.js is allowed', () => {
  const result = runHook({
    tool_name: 'Agent',
    tool_input: {
      prompt: [
        'Implement story from .pHive/epics/cwc-2026-integration/stories/s10-a7-agent-spawn-flow-hook-relax.yaml.',
        'Route the spawn through hive/lib/messages-session.js Agent() substrate.',
        'This is an execution workflow phase for the story.',
      ].join(' '),
      description: 'developer working on s10-a7 through Messages-API',
    },
  });

  assert.equal(result.status, 0, `expected ALLOW, got exit=${result.status} stderr=${result.stderr}`);
});

// ---------------------------------------------------------------------------
// Case (b): TeamCreate fallback path — ALLOW
// ---------------------------------------------------------------------------
test('case b — TeamCreate fallback path remains allowed', () => {
  const result = runHook({
    tool_name: 'TeamCreate',
    tool_input: {
      prompt: 'Execute story from .pHive/epics/cwc-2026-integration/stories/s10-a7-agent-spawn-flow-hook-relax.yaml via team workflow.',
      description: 'team create for full story execution fallback',
    },
  });

  assert.equal(result.status, 0, `expected ALLOW, got exit=${result.status} stderr=${result.stderr}`);
});

// ---------------------------------------------------------------------------
// Case (c): Existing orchestrator-pattern catalog — BLOCK
// ---------------------------------------------------------------------------
test('case c — existing orchestrator-pattern catalog still blocks story execution patterns', async (t) => {
  const storyPath = '.pHive/epics/cwc-2026-integration/stories/s10-a7-agent-spawn-flow-hook-relax.yaml';

  await t.test('prompt catalog: story YAML path + execution verb blocks', () => {
    const result = runHook({
      tool_name: 'Agent',
      tool_input: {
        prompt: `Please execute story ${storyPath} and complete the workflow phase end to end.`,
        description: 'developer working one step',
      },
    });

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stderr, /Use TeamCreate/, 'block reason should direct caller to TeamCreate');
  });

  await t.test('description catalog: whole-story delegation phrasing blocks', () => {
    const result = runHook({
      tool_name: 'Agent',
      tool_input: {
        prompt: 'Read context only.',
        description: 'execute the full story',
      },
    });

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stderr, /whole-story delegation/i);
  });

  await t.test('epic execution catalog still blocks', () => {
    const result = runHook({
      tool_name: 'Agent',
      tool_input: {
        prompt: 'Execute epic cwc-2026-integration by running the stories in order.',
        description: 'developer for planning',
      },
    });

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stderr, /epic-level execution/i);
  });
});
