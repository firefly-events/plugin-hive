import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daysBetween,
  tallyRunFailures,
  emitRunFailureFindings,
  findStuckReworkIssues,
  findFailureTail,
} from '../failure-tail-finder.mjs';

const NOW = '2026-06-09T20:00:00Z';

function makeRun(over = {}) {
  return {
    workflowName: 'CI',
    conclusion: 'failure',
    createdAt: '2026-06-09T15:00:00Z',
    runId: 100,
    htmlUrl: 'https://github.com/x/y/actions/runs/100',
    ...over,
  };
}

function makeIssue(over = {}) {
  return {
    id: 'ISSUE-1',
    title: 'A stuck rework issue',
    state: 'open',
    labels: ['hive:needs-rework'],
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    htmlUrl: 'https://github.com/x/y/issues/1',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

test('daysBetween — local copy returns positive days for an earlier timestamp', () => {
  assert.equal(daysBetween('2026-06-02T20:00:00Z', NOW), 7);
});

// ---------------------------------------------------------------------------
// tallyRunFailures
// ---------------------------------------------------------------------------

test('tallyRunFailures — groups failures by workflowName', () => {
  const runs = [
    makeRun({ workflowName: 'CI', runId: 1 }),
    makeRun({ workflowName: 'CI', runId: 2 }),
    makeRun({ workflowName: 'Build', runId: 3 }),
  ];
  const tally = tallyRunFailures(runs, NOW);
  assert.equal(tally.get('CI').count, 2);
  assert.equal(tally.get('Build').count, 1);
});

test('tallyRunFailures — drops non-terminal-failure conclusions', () => {
  const runs = [
    makeRun({ conclusion: 'success' }),
    makeRun({ conclusion: 'skipped' }),
    makeRun({ conclusion: 'neutral' }),
    makeRun({ conclusion: 'failure' }),
    makeRun({ conclusion: 'cancelled' }),
    makeRun({ conclusion: 'timed_out' }),
    makeRun({ conclusion: 'action_required' }),
  ];
  const tally = tallyRunFailures(runs, NOW);
  // failure + cancelled + timed_out + action_required = 4 keep
  assert.equal(tally.get('CI').count, 4);
});

test('tallyRunFailures — drops failures older than windowDays', () => {
  const runs = [
    makeRun({ createdAt: '2026-06-01T00:00:00Z' }), // 8d
    makeRun({ createdAt: '2026-05-25T00:00:00Z' }), // 15d
    makeRun({ createdAt: '2026-06-08T00:00:00Z' }), // 1d
  ];
  const tally = tallyRunFailures(runs, NOW, { windowDays: 7 });
  assert.equal(tally.get('CI').count, 1);
});

test('tallyRunFailures — defensive against non-array input', () => {
  assert.equal(tallyRunFailures(null, NOW).size, 0);
  assert.equal(tallyRunFailures(undefined, NOW).size, 0);
});

test('tallyRunFailures — captures oldest_failure age + recent runs', () => {
  const runs = [
    makeRun({ createdAt: '2026-06-09T15:00:00Z', runId: 10 }),
    makeRun({ createdAt: '2026-06-05T00:00:00Z', runId: 11 }),
    makeRun({ createdAt: '2026-06-03T00:00:00Z', runId: 12 }),
  ];
  const tally = tallyRunFailures(runs, NOW);
  const entry = tally.get('CI');
  assert.equal(entry.count, 3);
  assert.ok(entry.oldestAgeDays >= 6);
  assert.deepEqual(entry.runs.map((r) => r.runId), [10, 11, 12]);
});

// ---------------------------------------------------------------------------
// emitRunFailureFindings
// ---------------------------------------------------------------------------

test('emitRunFailureFindings — emits only when count >= minRecurrence', () => {
  const tally = tallyRunFailures([
    makeRun({ workflowName: 'CI' }),
  ], NOW);
  assert.deepEqual(emitRunFailureFindings(tally), []);
});

test('emitRunFailureFindings — 2 failures → medium severity', () => {
  const tally = tallyRunFailures([
    makeRun({ workflowName: 'CI', runId: 1 }),
    makeRun({ workflowName: 'CI', runId: 2 }),
  ], NOW);
  const findings = emitRunFailureFindings(tally);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'medium');
  assert.equal(findings[0].category, 'CI_FAILURE_PATTERN');
  assert.equal(findings[0].location, 'workflow:CI');
});

test('emitRunFailureFindings — 4+ failures → high severity', () => {
  const tally = tallyRunFailures(
    Array.from({ length: 4 }, (_, i) => makeRun({ workflowName: 'CI', runId: i })),
    NOW,
  );
  const findings = emitRunFailureFindings(tally);
  assert.equal(findings[0].severity, 'high');
});

test('emitRunFailureFindings — finding sort: high severity first, then failure_count desc', () => {
  const tally = tallyRunFailures([
    makeRun({ workflowName: 'A', runId: 1 }),
    makeRun({ workflowName: 'A', runId: 2 }),
    makeRun({ workflowName: 'B', runId: 3 }),
    makeRun({ workflowName: 'B', runId: 4 }),
    makeRun({ workflowName: 'B', runId: 5 }),
    makeRun({ workflowName: 'B', runId: 6 }),
    makeRun({ workflowName: 'B', runId: 7 }),
  ], NOW);
  const findings = emitRunFailureFindings(tally);
  assert.equal(findings[0].evidence.workflow_name, 'B');
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[1].evidence.workflow_name, 'A');
});

// ---------------------------------------------------------------------------
// findStuckReworkIssues
// ---------------------------------------------------------------------------

test('findStuckReworkIssues — closed issues filtered out', () => {
  const issues = [makeIssue({ state: 'closed' })];
  assert.deepEqual(findStuckReworkIssues(issues, NOW), []);
});

test('findStuckReworkIssues — issues without rework label filtered out', () => {
  const issues = [makeIssue({ labels: ['bug', 'enhancement'] })];
  assert.deepEqual(findStuckReworkIssues(issues, NOW), []);
});

test('findStuckReworkIssues — label objects (with .name) supported', () => {
  const issues = [
    makeIssue({
      labels: [{ name: 'hive:needs-rework' }],
      updatedAt: '2026-06-04T00:00:00Z',
    }),
  ];
  const findings = findStuckReworkIssues(issues, NOW);
  assert.equal(findings.length, 1);
});

test('findStuckReworkIssues — fresh issues (<3d) filtered out', () => {
  const issues = [
    makeIssue({ updatedAt: '2026-06-08T00:00:00Z' }), // 1d
  ];
  assert.deepEqual(findStuckReworkIssues(issues, NOW), []);
});

test('findStuckReworkIssues — issue stuck 4d → medium', () => {
  const issues = [
    makeIssue({ updatedAt: '2026-06-05T00:00:00Z' }),
  ];
  const findings = findStuckReworkIssues(issues, NOW);
  assert.equal(findings[0].severity, 'medium');
});

test('findStuckReworkIssues — issue stuck 10d → high', () => {
  const issues = [
    makeIssue({ updatedAt: '2026-05-30T00:00:00Z' }),
  ];
  const findings = findStuckReworkIssues(issues, NOW);
  assert.equal(findings[0].severity, 'high');
});

test('findStuckReworkIssues — finding shape carries issue_id, age, labels, url', () => {
  const issues = [
    makeIssue({ id: 'PLU-99', updatedAt: '2026-06-04T00:00:00Z' }),
  ];
  const [f] = findStuckReworkIssues(issues, NOW);
  assert.equal(f.id, 'finding-stuck-rework-PLU-99');
  assert.equal(f.location, 'issue:PLU-99');
  assert.equal(f.evidence.age_days, 5);
  assert.deepEqual(f.evidence.labels, ['hive:needs-rework']);
  assert.equal(f.evidence.html_url, 'https://github.com/x/y/issues/1');
});

// ---------------------------------------------------------------------------
// findFailureTail
// ---------------------------------------------------------------------------

test('findFailureTail — throws when caller forgets nowIso', () => {
  assert.throws(() => findFailureTail({ runs: [] }), /nowIso/);
});

test('findFailureTail — returns combined findings (runs + issues)', () => {
  const runs = [
    makeRun({ workflowName: 'CI', runId: 1 }),
    makeRun({ workflowName: 'CI', runId: 2 }),
  ];
  const issues = [
    makeIssue({ updatedAt: '2026-06-04T00:00:00Z' }),
  ];
  const findings = findFailureTail({ runs, issues }, { nowIso: NOW });
  assert.equal(findings.length, 2);
  const cats = findings.map((f) => f.category).sort();
  assert.deepEqual(cats, ['CI_FAILURE_PATTERN', 'STUCK_REWORK_ISSUE']);
});

test('findFailureTail — empty sources returns empty findings', () => {
  assert.deepEqual(findFailureTail({}, { nowIso: NOW }), []);
});
