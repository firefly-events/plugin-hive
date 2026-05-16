'use strict';

/**
 * Tests for hive/lib/sandcastle-worker-runner.js
 *
 * Story: s2-sandcastle-worker-prompt (sandcastle-ops-layer)
 * Run:   node --test tests/sandcastle-worker-runner.test.js
 *
 * Mocking: @ai-hero/sandcastle is NOT installed at the repo root (no root
 * package.json deps; sandcastle is per-consumer BYO). All tests inject a
 * `_deps` object containing fakes for `run`, `claudeCode`, and `docker`.
 * This is documented as a test seam in sandcastle-worker-runner.js.
 *
 * Covers:
 *  AC-1 runOnce passes the correct promptFile to run()
 *  AC-2 runOnce sets maxIterations default 5
 *  AC-3 runOnce sets branchStrategy with substituted issue number when forced
 *  AC-4 runOnce sets branchStrategy.branch="agent/issue-pickup" when idle
 *  AC-5 runOnce passes ResultSchema as `output`
 *  AC-6 runOnce forwards promptArgs.FORCE_ISSUE as string
 *  AC-7 runOnce returns result.output verbatim
 *  AC-8 runOnce throws when sandcastle returns no output
 *  AC-9 imageName + modelTag propagate to docker() + claudeCode()
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.join(
  __dirname,
  '..',
  'hive',
  'lib',
  'sandcastle-worker-runner.js'
);

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

/**
 * Build a _deps with capturing fakes for run / claudeCode / docker.
 * @param {object} [overrides]
 * @param {object} [overrides.runResult]  what fake run() resolves to
 */
function makeDeps(overrides = {}) {
  const capturedRunArgs = [];
  const capturedClaudeArgs = [];
  const capturedDockerArgs = [];

  const runResult =
    overrides.runResult !== undefined
      ? overrides.runResult
      : {
          iterations: 1,
          branch: 'agent/issue-42',
          output: {
            issue_number: 42,
            pr_number: 99,
            status: 'shipped',
            branch: 'agent/issue-42',
          },
        };

  // Sentinel for the Zod schema — the runner accepts `_deps.outputSchema`
  // to bypass real schema construction when zod isn't installed at root.
  const outputSchemaSentinel = overrides.outputSchema || { _sentinel: 'schema' };

  return {
    run: async (args) => {
      capturedRunArgs.push(args);
      return runResult;
    },
    claudeCode: (modelTag) => {
      capturedClaudeArgs.push(modelTag);
      return { _kind: 'claudeCode', modelTag };
    },
    docker: (dockerOpts) => {
      capturedDockerArgs.push(dockerOpts);
      return { _kind: 'docker', dockerOpts };
    },
    outputSchema: outputSchemaSentinel,
    _captured: {
      capturedRunArgs,
      capturedClaudeArgs,
      capturedDockerArgs,
      outputSchemaSentinel,
    },
  };
}

// ---------------------------------------------------------------------------
// AC-1: promptFile
// ---------------------------------------------------------------------------

test('runOnce passes the worker prompt file path to sandcastle.run', async () => {
  const { runOnce, _internal } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 42, _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.equal(args.promptFile, _internal.PROMPT_FILE);
  assert.equal(args.promptFile, '.sandcastle/prompts/worker-issue-pickup.md');
});

// ---------------------------------------------------------------------------
// AC-2: maxIterations default
// ---------------------------------------------------------------------------

test('runOnce defaults maxIterations to 5', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 1, _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.equal(args.maxIterations, 5);
});

test('runOnce honors explicit maxIterations override', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 1, maxIterations: 1, _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.equal(args.maxIterations, 1);
});

// ---------------------------------------------------------------------------
// AC-3: branchStrategy substitution when issue forced
// ---------------------------------------------------------------------------

test('runOnce sets branchStrategy to agent/issue-<N> when issueNumber forced', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 42, _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.deepEqual(args.branchStrategy, {
    type: 'branch',
    branch: 'agent/issue-42',
  });
});

// ---------------------------------------------------------------------------
// AC-4: branchStrategy placeholder when no issue forced (idle path)
// ---------------------------------------------------------------------------

test('runOnce uses agent/issue-pickup placeholder when no issue forced', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.equal(args.branchStrategy.type, 'branch');
  assert.equal(args.branchStrategy.branch, 'agent/issue-pickup');
});

// ---------------------------------------------------------------------------
// AC-5: output schema reference
// ---------------------------------------------------------------------------

test('runOnce passes the injected output schema through as the Output.object input', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 7, _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.strictEqual(args.output, deps._captured.outputSchemaSentinel);
});

// ---------------------------------------------------------------------------
// AC-6: promptArgs FORCE_ISSUE
// ---------------------------------------------------------------------------

test('runOnce sends FORCE_ISSUE in promptArgs as a string', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 314, _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.deepEqual(args.promptArgs, { FORCE_ISSUE: '314' });
});

test('runOnce sends FORCE_ISSUE empty string in cron path', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({ _deps: deps });
  const [args] = deps._captured.capturedRunArgs;
  assert.deepEqual(args.promptArgs, { FORCE_ISSUE: '' });
});

// ---------------------------------------------------------------------------
// AC-7: returns result.output verbatim
// ---------------------------------------------------------------------------

test('runOnce returns result.output from sandcastle.run', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps({
    runResult: {
      iterations: 1,
      output: {
        issue_number: 17,
        pr_number: null,
        status: 'failed',
        reason: 'gh pr create returned exit 1',
      },
    },
  });
  const out = await runOnce({ issueNumber: 17, _deps: deps });
  assert.equal(out.status, 'failed');
  assert.equal(out.issue_number, 17);
  assert.equal(out.reason, 'gh pr create returned exit 1');
});

// ---------------------------------------------------------------------------
// AC-8: throws when no output
// ---------------------------------------------------------------------------

test('runOnce throws when sandcastle returns no structured output', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps({
    runResult: { iterations: 5, output: undefined },
  });
  await assert.rejects(
    () => runOnce({ issueNumber: 1, _deps: deps }),
    /no output|structured result|maxIterations/i
  );
});

// ---------------------------------------------------------------------------
// AC-9: imageName + modelTag propagate
// ---------------------------------------------------------------------------

test('runOnce propagates imageName to docker() and modelTag to claudeCode()', async () => {
  const { runOnce } = loadModule();
  const deps = makeDeps();
  await runOnce({
    issueNumber: 1,
    imageName: 'sandcastle:custom',
    modelTag: 'claude-opus-4-7-test',
    _deps: deps,
  });
  assert.deepEqual(deps._captured.capturedDockerArgs, [
    { imageName: 'sandcastle:custom' },
  ]);
  assert.deepEqual(deps._captured.capturedClaudeArgs, [
    'claude-opus-4-7-test',
  ]);
});

test('runOnce defaults imageName to sandcastle:hive and modelTag to claude-opus-4-7', async () => {
  const { runOnce, _internal } = loadModule();
  const deps = makeDeps();
  await runOnce({ issueNumber: 1, _deps: deps });
  assert.deepEqual(deps._captured.capturedDockerArgs, [
    { imageName: _internal.DEFAULT_IMAGE },
  ]);
  assert.deepEqual(deps._captured.capturedClaudeArgs, [_internal.DEFAULT_MODEL]);
});
