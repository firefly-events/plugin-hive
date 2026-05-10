'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, 'hive', 'workflows', 'daily-ceremony.workflow.yaml');

function loadYaml(filePath) {
  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], "r", encoding="utf-8") as handle:',
    '    data = yaml.safe_load(handle) or {}',
    'print(json.dumps(data))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script, filePath], { encoding: 'utf8' }));
}

function planApprovalStep(workflow) {
  const step = (workflow.steps || []).find((candidate) => candidate.id === 'plan-approval');
  assert.ok(step, 'daily-ceremony workflow must define plan-approval');
  return step;
}

function runWorkflowCase(context) {
  const script = [
    'import json, sys',
    'from pathlib import Path',
    'from hive.lib.dag_executor.executor.dispatcher import Dispatcher',
    'from hive.lib.dag_executor.executor.handlers import NodeOutput',
    'from hive.lib.dag_executor.executor.telemetry import Telemetry',
    'from hive.lib.dag_executor.executor.walker import Walker',
    'from hive.lib.dag_executor.graph.loader import load_workflow',
    'from hive.lib.dag_executor.graph.model import NodeType',
    '',
    'payload = json.loads(sys.argv[1])',
    'graph = load_workflow(Path(payload["workflow_path"]))',
    'pause_calls = []',
    'agent_calls = []',
    '',
    'class PauseObserved(Exception):',
    '    pass',
    '',
    'def agent_handler(node, inputs, run_id):',
    '    agent_calls.append(node.id)',
    '    return NodeOutput(outputs={"step_id": node.id})',
    '',
    'def pause_handler(node, inputs, run_id):',
    '    pause_calls.append(node.id)',
    '    raise PauseObserved(f"pause dispatched for {node.id}")',
    '',
    'dispatcher = Dispatcher(handlers={NodeType.AGENT: agent_handler, NodeType.PAUSE: pause_handler})',
    'telemetry = Telemetry(run_id="rid-under-scheduler")',
    'try:',
    '    outputs = Walker().walk(',
    '        graph=graph,',
    '        dispatcher=dispatcher,',
    '        run_id="rid-under-scheduler",',
    '        telemetry=telemetry,',
    '        context=payload.get("context") or {},',
    '    )',
    '    print(json.dumps({',
    '        "status": "completed",',
    '        "pause_calls": pause_calls,',
    '        "agent_calls": agent_calls,',
    '        "output_steps": sorted(outputs.keys()),',
    '    }))',
    'except Exception as exc:',
    '    print(json.dumps({',
    '        "status": "error",',
    '        "pause_calls": pause_calls,',
    '        "agent_calls": agent_calls,',
    '        "error_class": exc.__class__.__name__,',
    '        "error_message": str(exc),',
    '    }))',
  ].join('\n');

  return JSON.parse(
    execFileSync(
      'python3',
      ['-c', script, JSON.stringify({ workflow_path: WORKFLOW_PATH, context })],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ),
  );
}

test('case a — scheduler context + auto_approve=true passes through plan-approval without pause dispatch', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const step = planApprovalStep(workflow);

  assert.deepEqual(step.under_scheduler, { auto_approve: true });

  const result = runWorkflowCase({ scheduler: true });

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.pause_calls, []);
  assert.ok(result.output_steps.includes('execution-kick-off'));
});

test('case b — scheduler context + auto_approve=false errors instead of pausing', () => {
  const result = runWorkflowCase({
    scheduler: true,
    step_metadata: {
      'plan-approval': {
        under_scheduler: {
          auto_approve: false,
        },
      },
    },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_class, 'HandlerError');
  assert.match(result.error_message, /auto_approve=false/i);
  assert.deepEqual(result.pause_calls, []);
});

test('case c — interactive context pauses regardless of under_scheduler metadata', () => {
  const workflow = loadYaml(WORKFLOW_PATH);
  const step = planApprovalStep(workflow);

  assert.deepEqual(step.under_scheduler, { auto_approve: true });

  const result = runWorkflowCase({});

  assert.equal(result.status, 'error');
  assert.equal(result.error_class, 'PauseObserved');
  assert.deepEqual(result.pause_calls, ['plan-approval']);
});
