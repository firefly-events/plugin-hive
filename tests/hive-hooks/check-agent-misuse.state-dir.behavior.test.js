/**
 * Behavioral tests for hooks/check-agent-misuse.sh relocated-state coverage.
 *
 * Story sdr-9-shell-semantic-guard-coverage. Verifies story-path detection
 * recognizes the resolved state-dir basename (sdr-1 resolver contract) in
 * addition to default `.pHive` and legacy `state`.
 * Run: node tests/hive-hooks/check-agent-misuse.state-dir.behavior.test.js
 *
 * Cases:
 *   a) default `.pHive` — misuse under a story path still BLOCKS
 *   b) custom `paths.state_dir` — misuse under resolved state-dir path BLOCKS
 *   c) legitimate access — ALLOWED in both configurations
 *   d) state-dir configuration unset — default `.pHive` behavior unchanged
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'check-agent-misuse.sh');

function runHook(payload, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // Keep tests hermetic: caller-supplied overrides only, no ambient leakage.
  if (!('HIVE_STATE_DIR' in envOverrides)) delete env.HIVE_STATE_DIR;
  if (!('CONFIG_FILE' in envOverrides)) delete env.CONFIG_FILE;
  const result = spawnSync(HOOK_PATH, {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function writeTempConfig(stateDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdr9-guard-'));
  const configPath = path.join(dir, 'hive.config.yaml');
  fs.writeFileSync(configPath, `paths:\n  state_dir: ${stateDir}\n`);
  return configPath;
}

// "Implement story … development workflow" hits Pattern 1's execution-signal
// catalog without tripping Pattern 2's `execute.*epic` regex, which would
// otherwise match across "execute story <dir>/epics/…" path text and mask
// whether the story-path regex itself fired.
function misusePrompt(storyPath) {
  return `Implement story ${storyPath} and run the development workflow for it.`;
}

function legitimatePrompt(storyPath) {
  return `Read ${storyPath} for context and summarize the acceptance criteria.`;
}

// ---------------------------------------------------------------------------
// Case (a): default `.pHive` — misuse under a story path still blocks
// ---------------------------------------------------------------------------
test('case a — default .pHive story-path misuse still blocks', () => {
  const result = runHook({
    tool_name: 'Agent',
    tool_input: {
      prompt: misusePrompt('.pHive/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
      description: 'developer working one step',
    },
  });

  assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stderr=${result.stderr}`);
  assert.match(result.stderr, /story-level work/);
});

// ---------------------------------------------------------------------------
// Case (b): custom paths.state_dir — resolved state-dir story path blocks
// ---------------------------------------------------------------------------
test('case b — custom state_dir story-path misuse blocks', async (t) => {
  await t.test('relative state_dir from hive.config.yaml', () => {
    const configPath = writeTempConfig('.hive-meta');
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: misusePrompt('.hive-meta/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'developer working one step',
        },
      },
      { CONFIG_FILE: configPath },
    );

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stderr=${result.stderr}`);
    assert.match(result.stderr, /story-level work/);
  });

  await t.test('HIVE_STATE_DIR env override', () => {
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: misusePrompt('/srv/project/.custom-meta/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'developer working one step',
        },
      },
      { HIVE_STATE_DIR: '/srv/project/.custom-meta' },
    );

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stderr=${result.stderr}`);
    assert.match(result.stderr, /story-level work/);
  });

  await t.test('default .pHive paths remain covered alongside the custom dir', () => {
    const configPath = writeTempConfig('.hive-meta');
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: misusePrompt('.pHive/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'developer working one step',
        },
      },
      { CONFIG_FILE: configPath },
    );

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stderr=${result.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// Case (c): legitimate access — not flagged in either configuration
// ---------------------------------------------------------------------------
test('case c — legitimate access is not flagged', async (t) => {
  await t.test('default .pHive: reading a story for context allows', () => {
    const result = runHook({
      tool_name: 'Agent',
      tool_input: {
        prompt: legitimatePrompt('.pHive/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
        description: 'context gathering',
      },
    });

    assert.equal(result.status, 0, `expected ALLOW, got exit=${result.status} stderr=${result.stderr}`);
  });

  await t.test('custom state_dir: reading a story for context allows', () => {
    const configPath = writeTempConfig('.hive-meta');
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: legitimatePrompt('.hive-meta/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'context gathering',
        },
      },
      { CONFIG_FILE: configPath },
    );

    assert.equal(result.status, 0, `expected ALLOW, got exit=${result.status} stderr=${result.stderr}`);
  });

  await t.test('custom state_dir: unrelated prompt allows', () => {
    const configPath = writeTempConfig('.hive-meta');
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: 'Run the unit tests for hive/lib/config.py and report failures.',
          description: 'test runner step',
        },
      },
      { CONFIG_FILE: configPath },
    );

    assert.equal(result.status, 0, `expected ALLOW, got exit=${result.status} stderr=${result.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// Case (d): state-dir configuration unset — default behavior unchanged
// ---------------------------------------------------------------------------
test('case d — unset state-dir config leaves default .pHive behavior unchanged', async (t) => {
  const missingConfig = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sdr9-guard-unset-')),
    'hive.config.yaml',
  );

  await t.test('default .pHive misuse still blocks', () => {
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: misusePrompt('.pHive/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'developer working one step',
        },
      },
      { CONFIG_FILE: missingConfig },
    );

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stderr=${result.stderr}`);
  });

  await t.test('legacy state/ misuse still blocks', () => {
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: misusePrompt('state/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'developer working one step',
        },
      },
      { CONFIG_FILE: missingConfig },
    );

    assert.equal(result.status, 2, `expected BLOCK, got exit=${result.status} stderr=${result.stderr}`);
  });

  await t.test('unconfigured custom dir is not treated as a state dir', () => {
    const result = runHook(
      {
        tool_name: 'Agent',
        tool_input: {
          prompt: misusePrompt('.hive-meta/epics/state-dir-resolver/stories/sdr-9-shell-semantic-guard-coverage.yaml'),
          description: 'developer working one step',
        },
      },
      { CONFIG_FILE: missingConfig },
    );

    assert.equal(result.status, 0, `expected ALLOW, got exit=${result.status} stderr=${result.stderr}`);
  });
});
