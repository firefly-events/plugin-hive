import assert from 'node:assert/strict';
import test from 'node:test';

// ---------------------------------------------------------------------------
// Helpers — pure functions extracted from step-03c logic for unit testing.
// These mirror the gate rules in step-03c-metric-declaration.md §4.
// ---------------------------------------------------------------------------

const ONE_WORD_TOKENS = new Set([
  'n/a', 'none', '-', 'pending', 'tbd', 'not applicable', '',
]);

const INVALID_VERIFY_AT = new Set(['eventually', 'someday', '']);

/**
 * Resolve metric_gate mode from a config object.
 * Default: 'blocking'.
 */
function resolveGateMode(config) {
  return config?.meta_optimize?.metric_gate ?? 'blocking';
}

/**
 * Validate a metric block per step-03c §4 rules.
 * Returns an array of failure objects { field, rule }.
 */
function validateMetricBlock(metric) {
  const failures = [];

  if (metric === undefined || metric === null) {
    failures.push({ field: 'metric', rule: 'applies-missing' });
    return failures;
  }

  if (metric.applies === true) {
    const required = ['name', 'direction', 'unit', 'target', 'window', 'source', 'verify_at', 'owner'];
    for (const field of required) {
      if (!metric[field] && metric[field] !== 0) {
        failures.push({ field: `metric.${field}`, rule: 'applies-missing' });
      }
    }
    if (metric.direction && !['up', 'down'].includes(metric.direction)) {
      failures.push({ field: 'metric.direction', rule: 'direction-invalid' });
    }
    if (metric.source?.kind && !['events', 'sql', 'envelope', 'manual'].includes(metric.source.kind)) {
      failures.push({ field: 'metric.source.kind', rule: 'source.kind-invalid' });
    }
    if (INVALID_VERIFY_AT.has((metric.verify_at ?? '').toLowerCase())) {
      failures.push({ field: 'metric.verify_at', rule: 'verify_at-eventually' });
    }
  } else if (metric.applies === false) {
    const j = (metric.justification ?? '').trim().toLowerCase();
    if (ONE_WORD_TOKENS.has(j) || j.split(/\s+/).length < 3) {
      failures.push({ field: 'metric.justification', rule: 'applies:false-one-word' });
    }
  } else {
    failures.push({ field: 'metric.applies', rule: 'applies-missing' });
  }

  return failures;
}

/**
 * Apply gate logic to a list of enriched proposals.
 * Returns { enrichedProposals, rejectedProposals, advisoryFailures }.
 */
function applyGate(proposals, gateMode) {
  const enrichedProposals = [];
  const rejectedProposals = [];
  const advisoryFailures = [];

  for (const proposal of proposals) {
    const failures = validateMetricBlock(proposal.metric);
    if (failures.length === 0) {
      enrichedProposals.push(proposal);
    } else if (gateMode === 'blocking') {
      rejectedProposals.push({
        ...proposal,
        status: 'rejected_metric_gate',
        gate_failures: failures,
      });
    } else {
      // advisory: pass through but record failures
      enrichedProposals.push(proposal);
      advisoryFailures.push({ proposal_id: proposal.id, failures });
    }
  }

  return { enrichedProposals, rejectedProposals, advisoryFailures };
}

// ---------------------------------------------------------------------------
// resolveGateMode
// ---------------------------------------------------------------------------

test('resolveGateMode — defaults to blocking when key absent', () => {
  assert.equal(resolveGateMode({}), 'blocking');
  assert.equal(resolveGateMode({ meta_optimize: {} }), 'blocking');
  assert.equal(resolveGateMode(null), 'blocking');
  assert.equal(resolveGateMode(undefined), 'blocking');
});

test('resolveGateMode — returns blocking when set explicitly', () => {
  assert.equal(resolveGateMode({ meta_optimize: { metric_gate: 'blocking' } }), 'blocking');
});

test('resolveGateMode — returns advisory when set', () => {
  assert.equal(resolveGateMode({ meta_optimize: { metric_gate: 'advisory' } }), 'advisory');
});

// ---------------------------------------------------------------------------
// validateMetricBlock — applies: true
// ---------------------------------------------------------------------------

const validAppliesTrue = {
  applies: true,
  name: 'meta_team.proposal_pass_rate',
  direction: 'up',
  unit: 'ratio',
  baseline: 0.6,
  target: 0.8,
  window: 'next-3-cycles',
  source: { kind: 'manual', ref: 'cycle-state.yaml metric_gate_failures count' },
  verify_at: 'epic-close',
  owner: 'developer',
};

test('validateMetricBlock — valid applies:true block passes with zero failures', () => {
  const failures = validateMetricBlock(validAppliesTrue);
  assert.equal(failures.length, 0);
});

test('validateMetricBlock — direction must be up or down (case-sensitive)', () => {
  const bad = { ...validAppliesTrue, direction: 'UP' };
  const failures = validateMetricBlock(bad);
  assert.ok(failures.some(f => f.rule === 'direction-invalid'), 'expected direction-invalid');
});

test('validateMetricBlock — rejects verify_at: "eventually"', () => {
  const bad = { ...validAppliesTrue, verify_at: 'eventually' };
  const failures = validateMetricBlock(bad);
  assert.ok(failures.some(f => f.rule === 'verify_at-eventually'), 'expected verify_at-eventually');
});

test('validateMetricBlock — rejects verify_at: "someday"', () => {
  const bad = { ...validAppliesTrue, verify_at: 'someday' };
  const failures = validateMetricBlock(bad);
  assert.ok(failures.some(f => f.rule === 'verify_at-eventually'), 'expected verify_at-eventually');
});

test('validateMetricBlock — rejects empty verify_at', () => {
  const bad = { ...validAppliesTrue, verify_at: '' };
  const failures = validateMetricBlock(bad);
  assert.ok(failures.some(f => f.rule === 'verify_at-eventually'), 'expected verify_at-eventually');
});

test('validateMetricBlock — rejects invalid source.kind', () => {
  const bad = { ...validAppliesTrue, source: { kind: 'csv', ref: 'foo' } };
  const failures = validateMetricBlock(bad);
  assert.ok(failures.some(f => f.rule === 'source.kind-invalid'), 'expected source.kind-invalid');
});

// ---------------------------------------------------------------------------
// validateMetricBlock — applies: false
// ---------------------------------------------------------------------------

test('validateMetricBlock — valid applies:false with full sentence passes', () => {
  const block = {
    applies: false,
    justification: 'Pure schema doc change with no observable runtime surface.',
  };
  const failures = validateMetricBlock(block);
  assert.equal(failures.length, 0);
});

test('validateMetricBlock — rejects one-word justification "N/A"', () => {
  const block = { applies: false, justification: 'N/A' };
  const failures = validateMetricBlock(block);
  assert.ok(failures.some(f => f.rule === 'applies:false-one-word'), 'expected applies:false-one-word');
});

test('validateMetricBlock — rejects one-word justification "none"', () => {
  const block = { applies: false, justification: 'none' };
  const failures = validateMetricBlock(block);
  assert.ok(failures.some(f => f.rule === 'applies:false-one-word'));
});

test('validateMetricBlock — rejects empty justification', () => {
  const block = { applies: false, justification: '' };
  const failures = validateMetricBlock(block);
  assert.ok(failures.some(f => f.rule === 'applies:false-one-word'));
});

test('validateMetricBlock — rejects missing metric block', () => {
  const failures = validateMetricBlock(undefined);
  assert.ok(failures.some(f => f.rule === 'applies-missing'));
});

// ---------------------------------------------------------------------------
// applyGate — blocking mode (default)
// ---------------------------------------------------------------------------

const passingProposal = {
  id: 'proposal-1',
  title: 'Improve pass rate',
  metric: validAppliesTrue,
};

const failingProposal = {
  id: 'proposal-2',
  title: 'Pure doc change',
  metric: { applies: false, justification: 'N/A' },
};

test('applyGate blocking — passing proposal enters enrichedProposals', () => {
  const { enrichedProposals, rejectedProposals } = applyGate([passingProposal], 'blocking');
  assert.equal(enrichedProposals.length, 1);
  assert.equal(rejectedProposals.length, 0);
});

test('applyGate blocking — failing proposal goes to rejectedProposals with status=rejected_metric_gate', () => {
  const { enrichedProposals, rejectedProposals } = applyGate([failingProposal], 'blocking');
  assert.equal(enrichedProposals.length, 0);
  assert.equal(rejectedProposals.length, 1);
  assert.equal(rejectedProposals[0].status, 'rejected_metric_gate');
});

test('applyGate blocking — per-proposal scope: A passes, B rejected; cycle continues with A', () => {
  const { enrichedProposals, rejectedProposals } = applyGate(
    [passingProposal, failingProposal],
    'blocking',
  );
  assert.equal(enrichedProposals.length, 1);
  assert.equal(enrichedProposals[0].id, 'proposal-1');
  assert.equal(rejectedProposals.length, 1);
  assert.equal(rejectedProposals[0].id, 'proposal-2');
});

test('applyGate blocking — zero proposals pass triggers zero-pass condition', () => {
  const { enrichedProposals, rejectedProposals } = applyGate([failingProposal], 'blocking');
  assert.equal(enrichedProposals.length, 0, 'zero proposals should pass');
  assert.equal(rejectedProposals.length, 1);
});

test('applyGate blocking — empty proposal list yields empty outputs (no error)', () => {
  const { enrichedProposals, rejectedProposals, advisoryFailures } = applyGate([], 'blocking');
  assert.equal(enrichedProposals.length, 0);
  assert.equal(rejectedProposals.length, 0);
  assert.equal(advisoryFailures.length, 0);
});

// ---------------------------------------------------------------------------
// applyGate — advisory mode (legacy non-blocking)
// ---------------------------------------------------------------------------

test('applyGate advisory — failing proposal passes through to enrichedProposals', () => {
  const { enrichedProposals, rejectedProposals, advisoryFailures } = applyGate(
    [failingProposal],
    'advisory',
  );
  assert.equal(enrichedProposals.length, 1, 'advisory: failing proposal must pass through');
  assert.equal(rejectedProposals.length, 0);
  assert.equal(advisoryFailures.length, 1);
});

test('applyGate advisory — both proposals pass through; failures recorded separately', () => {
  const { enrichedProposals, rejectedProposals, advisoryFailures } = applyGate(
    [passingProposal, failingProposal],
    'advisory',
  );
  assert.equal(enrichedProposals.length, 2);
  assert.equal(rejectedProposals.length, 0);
  assert.equal(advisoryFailures.length, 1);
  assert.equal(advisoryFailures[0].proposal_id, 'proposal-2');
});

test('applyGate advisory — passing proposal has zero advisory failures', () => {
  const { advisoryFailures } = applyGate([passingProposal], 'advisory');
  assert.equal(advisoryFailures.length, 0);
});
