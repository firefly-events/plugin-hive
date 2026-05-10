/**
 * Contract tests for hive/references/rubric-format.md
 *
 * Story s14-b1-rubric-format-reviewer-refactor. TDD: written RED before the
 * spec exists. Run: node --test tests/hive-agents/rubric-format.test.js
 *
 * Three cases (1:1 with the story's three test directives):
 *   a) reviewer.md AND peer-validator.md both reference the same rubric file
 *      and the schema fixture in rubric-format.md is parseable as JSON Schema
 *      (single source of truth for both consumers — runtime-agnostic per
 *      session-system-prompt-spec §1; loop-vs-single-shot is caller-decided).
 *   b) The hand-rolled validator (defined inline below from the schema's
 *      declared rules) catches a malformed rubric.
 *   c) Verdict semantics consistent across the two consumers: a fixture
 *      rubric, processed through the aggregation rule documented in
 *      rubric-format.md, yields a reviewer change_verdict AND a
 *      peer-validator row set that agree on every criterion outcome.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUBRIC_SPEC = path.join(REPO_ROOT, 'hive', 'references', 'rubric-format.md');
const REVIEWER_PERSONA = path.join(REPO_ROOT, 'hive', 'agents', 'reviewer.md');
const PEER_VALIDATOR_PERSONA = path.join(REPO_ROOT, 'hive', 'agents', 'peer-validator.md');

const SCHEMA_START = '<!-- schema:rubric:start -->';
const SCHEMA_END = '<!-- schema:rubric:end -->';
const RUBRIC_REF_PATH = 'hive/references/rubric-format.md';

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * Extract the JSON Schema fixture from rubric-format.md. The schema is the
 * first ```json fenced block between SCHEMA_START and SCHEMA_END markers.
 */
function extractSchemaFixture(specMarkdown) {
  const startIdx = specMarkdown.indexOf(SCHEMA_START);
  const endIdx = specMarkdown.indexOf(SCHEMA_END);
  assert.ok(startIdx !== -1, `missing ${SCHEMA_START} marker in rubric-format.md`);
  assert.ok(endIdx !== -1 && endIdx > startIdx, `missing ${SCHEMA_END} marker in rubric-format.md`);
  const region = specMarkdown.slice(startIdx, endIdx);
  const fence = region.match(/```json\s*([\s\S]*?)```/);
  assert.ok(fence, 'expected one ```json fenced block between schema markers');
  return JSON.parse(fence[1]);
}

/**
 * Hand-rolled validator. Implements only what the schema's declared rules
 * require: required-fields, type, enum, pattern, array minItems. No deps.
 *
 * Returns an array of error strings (empty = valid).
 */
function validateAgainstSchema(value, schema, pathStr = '$') {
  const errors = [];

  function pushType(actual, expected) {
    errors.push(`${pathStr}: expected type ${expected}, got ${actual}`);
  }

  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      pushType(Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, 'object');
      return errors;
    }
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${pathStr}: missing required field "${req}"`);
    }
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (key in value) {
        errors.push(...validateAgainstSchema(value[key], propSchema, `${pathStr}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push(`${pathStr}: unknown property "${key}"`);
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      pushType(typeof value, 'array');
      return errors;
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${pathStr}: minItems ${schema.minItems}, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validateAgainstSchema(item, schema.items, `${pathStr}[${i}]`));
      });
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      pushType(typeof value, 'string');
      return errors;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${pathStr}: value "${value}" not in enum [${schema.enum.join(', ')}]`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pathStr}: value "${value}" does not match pattern ${schema.pattern}`);
    }
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) {
      pushType(typeof value, 'integer');
    }
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') pushType(typeof value, 'boolean');
  }

  return errors;
}

/**
 * Reference aggregator that mirrors the rule documented in rubric-format.md.
 * Both consumers MUST yield the same per-criterion verdicts; only the
 * aggregation surface differs (reviewer rolls up to change_verdict,
 * peer-validator emits one row per criterion).
 *
 * Aggregation rule (must match Section "Aggregation rule" of rubric-format.md):
 *   - per criterion: result is "pass" or "fail"
 *   - reviewer change_verdict:
 *       any critical fail        → "needs_revision"
 *       else any improvement fail → "needs_optimization"
 *       else                      → "passed"
 *   - peer-validator: one row per criterion with the same per-criterion result
 */
function reviewerAggregate(rubric, perCriterion) {
  let anyCriticalFail = false;
  let anyImprovementFail = false;
  for (const c of rubric.criteria) {
    const r = perCriterion[c.id];
    if (r === 'fail') {
      if (c.severity === 'critical') anyCriticalFail = true;
      else if (c.severity === 'improvement') anyImprovementFail = true;
    }
  }
  if (anyCriticalFail) return 'needs_revision';
  if (anyImprovementFail) return 'needs_optimization';
  return 'passed';
}

function peerValidatorAggregate(rubric, perCriterion) {
  return rubric.criteria.map((c) => ({
    criterion_id: c.id,
    verdict: perCriterion[c.id] === 'pass' ? 'PASS' : 'FAIL',
  }));
}

// ---------------------------------------------------------------------------
// Case (a): both personas reference the rubric file; schema fixture parses
// ---------------------------------------------------------------------------
test('case a — reviewer.md + peer-validator.md both reference rubric-format.md; schema fixture parses', () => {
  const spec = readFile(RUBRIC_SPEC);
  const reviewer = readFile(REVIEWER_PERSONA);
  const peerValidator = readFile(PEER_VALIDATOR_PERSONA);

  assert.ok(
    reviewer.includes(RUBRIC_REF_PATH),
    `reviewer.md must reference ${RUBRIC_REF_PATH}`,
  );
  assert.ok(
    peerValidator.includes(RUBRIC_REF_PATH),
    `peer-validator.md must reference ${RUBRIC_REF_PATH}`,
  );

  const schema = extractSchemaFixture(spec);
  assert.equal(schema.type, 'object', 'top-level schema must be an object');
  assert.ok(Array.isArray(schema.required), 'schema must declare required fields');
  assert.ok(schema.properties && schema.properties.criteria, 'schema must declare criteria');

  const criterionSchema = schema.properties.criteria.items;
  assert.ok(criterionSchema, 'criteria schema must define items');
  assert.deepEqual(
    [...(criterionSchema.properties.severity.enum || [])].sort(),
    ['critical', 'improvement'],
    'criterion severity enum must be exactly [critical, improvement]',
  );

  // Runtime-agnostic invariant: schema must NOT mention loop-specific terms.
  // Caller (S15 Outcomes loop or peer-validator single-shot) decides usage.
  const schemaText = JSON.stringify(schema);
  assert.ok(
    !/outcomes|single[- ]shot|loop body/i.test(schemaText),
    'schema must be runtime-agnostic — no loop/single-shot terms in field names or enums',
  );
});

// ---------------------------------------------------------------------------
// Case (b): malformed rubric is caught by the validator
// ---------------------------------------------------------------------------
test('case b — schema validation catches malformed rubrics', () => {
  const schema = extractSchemaFixture(readFile(RUBRIC_SPEC));

  // Valid rubric — baseline (no errors).
  const valid = {
    rubric_id: 'demo-rubric',
    version: '1.0.0',
    criteria: [
      { id: 'spec-fidelity', severity: 'critical', description: 'AC mapping exists' },
      { id: 'naming', severity: 'improvement', description: 'Names match conventions' },
    ],
  };
  assert.deepEqual(validateAgainstSchema(valid, schema), [], 'baseline rubric must validate clean');

  // Malformed #1: missing required top-level field.
  const missingId = { version: '1.0.0', criteria: valid.criteria };
  const e1 = validateAgainstSchema(missingId, schema);
  assert.ok(
    e1.some((m) => m.includes('rubric_id')),
    `expected rubric_id required-field error, got: ${JSON.stringify(e1)}`,
  );

  // Malformed #2: criterion severity outside enum.
  const badSeverity = {
    ...valid,
    criteria: [{ id: 'x', severity: 'maybe', description: 'bad' }],
  };
  const e2 = validateAgainstSchema(badSeverity, schema);
  assert.ok(
    e2.some((m) => m.includes('severity') && m.includes('enum')),
    `expected severity-enum violation, got: ${JSON.stringify(e2)}`,
  );

  // Malformed #3: criteria not an array.
  const wrongType = { ...valid, criteria: 'not-an-array' };
  const e3 = validateAgainstSchema(wrongType, schema);
  assert.ok(
    e3.some((m) => m.includes('criteria') && m.includes('array')),
    `expected criteria-type violation, got: ${JSON.stringify(e3)}`,
  );

  // Malformed #4: empty criteria list (minItems guard).
  const empty = { ...valid, criteria: [] };
  const e4 = validateAgainstSchema(empty, schema);
  assert.ok(
    e4.some((m) => m.includes('minItems')),
    `expected minItems violation on empty criteria, got: ${JSON.stringify(e4)}`,
  );
});

// ---------------------------------------------------------------------------
// Case (c): verdict semantics consistent across the two consumers
// ---------------------------------------------------------------------------
test('case c — reviewer + peer-validator agree on per-criterion outcomes for the same rubric', () => {
  const rubric = {
    rubric_id: 'consistency-fixture',
    version: '1.0.0',
    criteria: [
      { id: 'spec-fidelity', severity: 'critical', description: 'every AC mapped' },
      { id: 'security', severity: 'critical', description: 'inputs validated' },
      { id: 'naming', severity: 'improvement', description: 'names match conventions' },
    ],
  };

  // Scenario 1: all pass.
  let perCrit = { 'spec-fidelity': 'pass', security: 'pass', naming: 'pass' };
  assert.equal(reviewerAggregate(rubric, perCrit), 'passed');
  let rows = peerValidatorAggregate(rubric, perCrit);
  for (const row of rows) {
    assert.equal(row.verdict, 'PASS', `row ${row.criterion_id} must agree with reviewer`);
  }

  // Scenario 2: improvement fails only — reviewer = needs_optimization;
  // peer-validator row for that criterion is FAIL; others PASS.
  perCrit = { 'spec-fidelity': 'pass', security: 'pass', naming: 'fail' };
  assert.equal(reviewerAggregate(rubric, perCrit), 'needs_optimization');
  rows = peerValidatorAggregate(rubric, perCrit);
  const namingRow = rows.find((r) => r.criterion_id === 'naming');
  assert.equal(namingRow.verdict, 'FAIL');
  assert.equal(rows.filter((r) => r.verdict === 'FAIL').length, 1);

  // Scenario 3: critical fails — reviewer = needs_revision;
  // peer-validator row for that criterion is FAIL.
  perCrit = { 'spec-fidelity': 'pass', security: 'fail', naming: 'pass' };
  assert.equal(reviewerAggregate(rubric, perCrit), 'needs_revision');
  rows = peerValidatorAggregate(rubric, perCrit);
  const securityRow = rows.find((r) => r.criterion_id === 'security');
  assert.equal(securityRow.verdict, 'FAIL');

  // Scenario 4: critical AND improvement fail — critical dominates for
  // reviewer (needs_revision), peer-validator surfaces both FAIL rows.
  perCrit = { 'spec-fidelity': 'pass', security: 'fail', naming: 'fail' };
  assert.equal(reviewerAggregate(rubric, perCrit), 'needs_revision');
  rows = peerValidatorAggregate(rubric, perCrit);
  assert.equal(rows.filter((r) => r.verdict === 'FAIL').length, 2);

  // Cross-consumer invariant: every criterion that the reviewer would treat
  // as a failing input is exactly the set of FAIL rows the peer-validator
  // emits — no consumer hides or invents per-criterion verdicts.
  const reviewerSeesFails = new Set(
    rubric.criteria.filter((c) => perCrit[c.id] === 'fail').map((c) => c.id),
  );
  const peerFails = new Set(rows.filter((r) => r.verdict === 'FAIL').map((r) => r.criterion_id));
  assert.deepEqual([...peerFails].sort(), [...reviewerSeesFails].sort());
});

// ---------------------------------------------------------------------------
// Case (c'): rubric-format.md must DOCUMENT the aggregation rule that the
// reference aggregators above implement. If the doc and the test drift,
// future readers can't trust either.
// ---------------------------------------------------------------------------
test("case c' — rubric-format.md documents the aggregation rule both consumers follow", () => {
  const spec = readFile(RUBRIC_SPEC);
  // Aggregation rule must be a named section consumers can cite.
  assert.match(spec, /##\s+Aggregation rule/i, 'rubric-format.md must contain "Aggregation rule" section');
  // Section must mention all three reviewer verdict tokens and both severities.
  for (const token of ['needs_revision', 'needs_optimization', 'passed', 'critical', 'improvement']) {
    assert.ok(spec.includes(token), `aggregation rule must reference "${token}"`);
  }
});
