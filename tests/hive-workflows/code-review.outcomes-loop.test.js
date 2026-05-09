'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, 'hive', 'workflows', 'code-review.workflow.yaml');
const CONFIG_PATH = path.join(REPO_ROOT, 'hive', 'hive.config.yaml');

function loadYaml(filePath) {
  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], "r", encoding="utf-8") as handle:',
    '    data = yaml.safe_load(handle) or {}',
    'print(json.dumps(data))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script, filePath], { encoding: 'utf8' }));
}

function aggregateVerdicts(verdicts, precedence) {
  assert.ok(Array.isArray(verdicts) && verdicts.length > 0, 'verdicts fixture must be non-empty');
  for (const verdict of precedence) {
    if (verdicts.includes(verdict)) return verdict;
  }
  throw new Error(`aggregateVerdicts: no precedence match for ${JSON.stringify(verdicts)}`);
}

function simulateOutcomesLoop(verdictsByIteration, loopConfig) {
  const maxIterations = loopConfig.iteration_cap;
  const precedence = loopConfig.graders.aggregation.verdict_precedence;
  const passCondition = loopConfig.convergence.pass_verdict;

  for (let i = 0; i < verdictsByIteration.length; i++) {
    const finalVerdict = aggregateVerdicts(verdictsByIteration[i], precedence);
    const iterationsUsed = i + 1;
    if (finalVerdict === passCondition) {
      return { iterations_used: iterationsUsed, terminated_by: 'rubric_pass', final_verdict: finalVerdict };
    }
    if (iterationsUsed >= maxIterations) {
      return { iterations_used: iterationsUsed, terminated_by: 'iter_cap', final_verdict: finalVerdict };
    }
  }
  return {
    iterations_used: verdictsByIteration.length,
    terminated_by: 'budget',
    final_verdict: aggregateVerdicts(verdictsByIteration.at(-1), precedence),
  };
}

test('case a — loop terminates at iter_cap (max_outcomes_iterations: 3)', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const config = loadYaml(CONFIG_PATH);
  const loop = workflow.outcomes_loop;

  assert.equal(loop.max_iterations_config, 'circuit_breakers.max_outcomes_iterations');
  assert.equal(config.circuit_breakers.max_outcomes_iterations, 3);
  assert.equal(loop.iteration_cap, 3);

  const result = simulateOutcomesLoop(
    [
      ['needs_revision', 'needs_optimization'],
      ['needs_revision'],
      ['needs_optimization', 'needs_optimization'],
      ['passed'],
    ],
    loop,
  );

  assert.deepEqual(result, {
    iterations_used: 3,
    terminated_by: 'iter_cap',
    final_verdict: 'needs_optimization',
  });
});

test('case b — verdict aggregation across grader passes is correct', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const precedence = workflow.outcomes_loop.graders.aggregation.verdict_precedence;

  assert.deepEqual(precedence, ['needs_revision', 'needs_optimization', 'passed']);
  assert.equal(aggregateVerdicts(['passed', 'passed'], precedence), 'passed');
  assert.equal(
    aggregateVerdicts(['needs_optimization', 'passed', 'passed'], precedence),
    'needs_optimization',
  );
  assert.equal(
    aggregateVerdicts(['passed', 'needs_revision', 'needs_optimization'], precedence),
    'needs_revision',
  );
});

test('case c — peer-validator runs post-loop with right inputs (loop-then-gate ordering invariant)', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const loop = workflow.outcomes_loop;
  const postLoopGate = loop.post_loop_gate;

  assert.equal(postLoopGate.agent, 'peer-validator');
  assert.equal(postLoopGate.runs_after, 'outcomes_loop');
  assert.equal(postLoopGate.mode, 'deterministic-single-shot');
  assert.equal(postLoopGate.inputs.rubric_path, loop.rubric_path);
  assert.equal(postLoopGate.inputs.diff, 'context.diff_content');
  assert.equal(postLoopGate.inputs.scope_analysis, 'steps.analyze.scope_analysis');
  assert.equal(postLoopGate.inputs.final_verdict, 'outcomes_loop.final_verdict');
  assert.equal(postLoopGate.inputs.final_findings, 'outcomes_loop.final_findings');
});

test('case d — graders spawn via messages-session substrate from s5', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const graderSpawn = workflow.outcomes_loop.graders.spawn;

  assert.equal(graderSpawn.substrate, 'messages');
  assert.equal(graderSpawn.module, 'hive/lib/messages-session.js');
  assert.equal(graderSpawn.entrypoint, 'runMessagesSession');
  assert.equal(graderSpawn.own_context, true);
});
