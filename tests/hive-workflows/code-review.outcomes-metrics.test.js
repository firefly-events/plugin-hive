'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, 'hive', 'workflows', 'code-review.workflow.yaml');

function loadYaml(filePath) {
  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], "r", encoding="utf-8") as handle:',
    '    data = yaml.safe_load(handle) or {}',
    'print(json.dumps(data))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script, filePath], { encoding: 'utf8' }));
}

function buildMetricsEvent(loopConfig, runtime) {
  const metrics = loopConfig.metrics;
  const event = {
    emitter: metrics.emitter,
    event_type: metrics.event_type,
    story_id: runtime.story_id,
    iterations_used: runtime.iterations_used,
    tokens_used: runtime.tokens_used,
    wall_clock_ms: runtime.wall_clock_ms,
    terminated_by: runtime.terminated_by,
    final_verdict: runtime.final_verdict,
  };
  return [event];
}

test('case a — every Outcomes invocation emits exactly one metrics event', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const loop = workflow.outcomes_loop;

  const emitted = buildMetricsEvent(loop, {
    story_id: 's15-b2-outcomes-loop-code-review',
    iterations_used: 2,
    tokens_used: 12000,
    wall_clock_ms: 450,
    terminated_by: 'rubric_pass',
    final_verdict: 'passed',
  });

  assert.equal(loop.metrics.emit_on, 'completion');
  assert.equal(emitted.length, 1);
});

test("case b — payload includes token + wall-clock telemetry and terminated_by stays within ('rubric_pass'|'iter_cap')", () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const loop = workflow.outcomes_loop;
  const emitted = buildMetricsEvent(loop, {
    story_id: 's15-b2-outcomes-loop-code-review',
    iterations_used: 3,
    tokens_used: 24500,
    wall_clock_ms: 1800,
    terminated_by: 'iter_cap',
    final_verdict: 'needs_revision',
  });

  assert.deepEqual(loop.metrics.payload_fields, [
    'story_id',
    'iterations_used',
    'tokens_used',
    'wall_clock_ms',
    'terminated_by',
    'final_verdict',
  ]);
  assert.deepEqual(emitted[0], {
    emitter: loop.metrics.emitter,
    event_type: loop.metrics.event_type,
    story_id: 's15-b2-outcomes-loop-code-review',
    iterations_used: 3,
    tokens_used: 24500,
    wall_clock_ms: 1800,
    terminated_by: 'iter_cap',
    final_verdict: 'needs_revision',
  });
  assert.ok(['rubric_pass', 'iter_cap'].includes(emitted[0].terminated_by));
  assert.equal(typeof emitted[0].tokens_used, 'number');
  assert.equal(typeof emitted[0].wall_clock_ms, 'number');
});

test('case c — ingestion uses the existing metrics emitter, no new sink', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const metrics = workflow.outcomes_loop.metrics;

  assert.equal(metrics.emitter, 'hive.lib.dag_executor.executor.telemetry.Telemetry.emit');
  assert.equal(metrics.sink, 'existing-executor-telemetry-jsonl');
  assert.equal(metrics.new_sink, false);
});
