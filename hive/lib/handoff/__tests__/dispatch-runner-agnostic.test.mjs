/**
 * Runner-agnostic handoff dispatch tests.
 *
 * Proves the /test + /review handoff runner is overridable (the last hardcoded
 * `spawn('claude')` spot in the dispatch path) while keeping `claude` the default
 * when nothing is configured. Uses the injectable `_spawnSync` seam so no real
 * runner process is ever launched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchHandoff, resolveHandoffRunner } from '../dispatch.mjs';

// --- helpers ---------------------------------------------------------------

function withCleanEnv(fn) {
  const savedHandoff = process.env.HIVE_HANDOFF_RUNNER;
  const savedClaude = process.env.CLAUDE_CMD;
  delete process.env.HIVE_HANDOFF_RUNNER;
  delete process.env.CLAUDE_CMD;
  try {
    return fn();
  } finally {
    if (savedHandoff === undefined) delete process.env.HIVE_HANDOFF_RUNNER;
    else process.env.HIVE_HANDOFF_RUNNER = savedHandoff;
    if (savedClaude === undefined) delete process.env.CLAUDE_CMD;
    else process.env.CLAUDE_CMD = savedClaude;
  }
}

// A fake spawnSync that records the command it was asked to run and returns a
// passing terminal so the handoff resolves to a 'passed' verdict.
function makeRecordingSpawn(record) {
  return (cmd, args, _opts) => {
    record.cmd = cmd;
    record.args = args;
    return { status: 0, stdout: 'All tests passed', stderr: '', error: undefined };
  };
}

// --- resolveHandoffRunner: precedence --------------------------------------

test('resolveHandoffRunner: defaults to claude when nothing is configured', () => {
  withCleanEnv(() => {
    // configPath points at a non-existent file so the config branch is skipped
    const runner = resolveHandoffRunner({ configPath: join(tmpdir(), 'no-such-hive.config.yaml') });
    assert.equal(runner, 'claude');
  });
});

test('resolveHandoffRunner: explicit arg wins over everything', () => {
  withCleanEnv(() => {
    process.env.HIVE_HANDOFF_RUNNER = 'env-runner';
    assert.equal(resolveHandoffRunner({ runner: 'explicit-runner' }), 'explicit-runner');
  });
});

test('resolveHandoffRunner: HIVE_HANDOFF_RUNNER env override', () => {
  withCleanEnv(() => {
    process.env.HIVE_HANDOFF_RUNNER = 'kimi-runner';
    assert.equal(resolveHandoffRunner(), 'kimi-runner');
  });
});

test('resolveHandoffRunner: CLAUDE_CMD env override (shared runner-binary var)', () => {
  withCleanEnv(() => {
    process.env.CLAUDE_CMD = '/opt/wrappers/gemini-cc';
    assert.equal(resolveHandoffRunner(), '/opt/wrappers/gemini-cc');
  });
});

test('resolveHandoffRunner: HIVE_HANDOFF_RUNNER takes precedence over CLAUDE_CMD', () => {
  withCleanEnv(() => {
    process.env.HIVE_HANDOFF_RUNNER = 'handoff-specific';
    process.env.CLAUDE_CMD = 'shared';
    assert.equal(resolveHandoffRunner(), 'handoff-specific');
  });
});

test('resolveHandoffRunner: config file execution.terminal_handoff.runner', () => {
  withCleanEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-cfg-'));
    const cfgPath = join(dir, 'hive.config.yaml');
    writeFileSync(cfgPath, 'execution:\n  terminal_handoff:\n    runner: codex\n', 'utf8');
    try {
      assert.equal(resolveHandoffRunner({ configPath: cfgPath }), 'codex');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('resolveHandoffRunner: env wins over config file', () => {
  withCleanEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-cfg-'));
    const cfgPath = join(dir, 'hive.config.yaml');
    writeFileSync(cfgPath, 'execution:\n  terminal_handoff:\n    runner: codex\n', 'utf8');
    process.env.HIVE_HANDOFF_RUNNER = 'openrouter-runner';
    try {
      assert.equal(resolveHandoffRunner({ configPath: cfgPath }), 'openrouter-runner');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- dispatchHandoff: runner is threaded to the spawn seam -----------------

test('dispatchHandoff: default path spawns "claude" (behaviour unchanged)', async () => {
  await withCleanEnv(async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'handoff-state-'));
    const record = {};
    try {
      const res = await dispatchHandoff({
        story_id: 's-1', target: 'test', branch: 'feat/x',
        state_dir: stateDir, _spawnSync: makeRecordingSpawn(record),
      });
      assert.equal(res.ok, true);
      assert.equal(res.verdict, 'passed');
      assert.equal(record.cmd, 'claude');
      assert.deepEqual(record.args, ['--print', '/test', '--story', 's-1']);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

test('dispatchHandoff: runner opt routes /test to a non-claude runner', async () => {
  await withCleanEnv(async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'handoff-state-'));
    const record = {};
    try {
      const res = await dispatchHandoff({
        story_id: 's-2', target: 'test', branch: 'feat/y',
        runner: 'codex', state_dir: stateDir, _spawnSync: makeRecordingSpawn(record),
      });
      assert.equal(res.ok, true);
      assert.equal(record.cmd, 'codex');
      assert.deepEqual(record.args, ['--print', '/test', '--story', 's-2']);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

test('dispatchHandoff: HIVE_HANDOFF_RUNNER env routes /review to a non-claude runner', async () => {
  await withCleanEnv(async () => {
    process.env.HIVE_HANDOFF_RUNNER = 'kimi-runner';
    const stateDir = mkdtempSync(join(tmpdir(), 'handoff-state-'));
    const record = {};
    try {
      const res = await dispatchHandoff({
        story_id: 's-3', target: 'review', branch: 'feat/z', pr_number: 42,
        state_dir: stateDir, _spawnSync: makeRecordingSpawn(record),
      });
      assert.equal(res.ok, true);
      assert.equal(record.cmd, 'kimi-runner');
      assert.deepEqual(record.args, ['--print', '/review', '#42']);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
