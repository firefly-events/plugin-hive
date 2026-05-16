'use strict';

/**
 * Tests for hive/lib/sandcastle-worker-schema.js
 *
 * Story: s2-sandcastle-worker-prompt (sandcastle-ops-layer)
 * Run:   node --test tests/sandcastle-worker-schema.test.js
 *
 * Approach: zod is a sandcastle peer dep. If it isn't installed at root,
 * we ship a minimal in-test zod shim and inject it via buildSchema(testZod).
 * If the real zod is available we use it. Either way the contract is the
 * same: parse() accepts valid shapes, throws on invalid shapes.
 *
 * Covers:
 *  AC-1 shipped — valid object passes
 *  AC-2 failed — valid object passes with reason
 *  AC-3 idle   — valid object passes with nulls
 *  AC-4 reject — missing status
 *  AC-5 reject — wrong status enum value
 *  AC-6 reject — wrong type on pr_number (string instead of number)
 *  AC-7 reject — negative issue_number
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.join(
  __dirname,
  '..',
  'hive',
  'lib',
  'sandcastle-worker-schema.js'
);

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

// ---------------------------------------------------------------------------
// Minimal zod shim — implements only what buildSchema() touches.
// Real zod is preferred; this shim is the fallback when zod isn't installed.
// ---------------------------------------------------------------------------

function makeShim() {
  function zNumber() {
    const checks = [{ type: 'number' }];
    const api = {
      _checks: checks,
      int() {
        checks.push({ type: 'int' });
        return api;
      },
      positive() {
        checks.push({ type: 'positive' });
        return api;
      },
      nullable() {
        return wrapNullable(api);
      },
      optional() {
        return wrapOptional(api);
      },
      parse(v) {
        return runChecks(checks, v);
      },
    };
    return api;
  }

  function zString() {
    const checks = [{ type: 'string' }];
    const api = {
      _checks: checks,
      optional() {
        return wrapOptional(api);
      },
      parse(v) {
        return runChecks(checks, v);
      },
    };
    return api;
  }

  function zEnum(values) {
    const set = new Set(values);
    const api = {
      _values: values,
      optional() {
        return wrapOptional(api);
      },
      parse(v) {
        if (!set.has(v)) {
          throw new Error(`enum violation: ${v} not in ${values.join('|')}`);
        }
        return v;
      },
    };
    return api;
  }

  function wrapNullable(inner) {
    return {
      _inner: inner,
      _nullable: true,
      optional() {
        return wrapOptional(this);
      },
      parse(v) {
        if (v === null) return null;
        return inner.parse(v);
      },
    };
  }

  function wrapOptional(inner) {
    return {
      _inner: inner,
      _optional: true,
      parse(v) {
        if (v === undefined) return undefined;
        return inner.parse(v);
      },
    };
  }

  function zObject(shape) {
    const api = {
      _shape: shape,
      parse(v) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          throw new Error('expected object');
        }
        const out = {};
        for (const [key, inner] of Object.entries(shape)) {
          const isOptional = inner && inner._optional === true;
          const present = Object.prototype.hasOwnProperty.call(v, key);
          if (!present && !isOptional) {
            throw new Error(`missing required field: ${key}`);
          }
          if (!present) continue;
          out[key] = inner.parse(v[key]);
        }
        return out;
      },
    };
    return api;
  }

  function runChecks(checks, v) {
    for (const c of checks) {
      if (c.type === 'number') {
        if (typeof v !== 'number' || Number.isNaN(v)) {
          throw new Error(`expected number, got ${typeof v}`);
        }
      } else if (c.type === 'int') {
        if (!Number.isInteger(v)) {
          throw new Error(`expected integer, got ${v}`);
        }
      } else if (c.type === 'positive') {
        if (!(v > 0)) {
          throw new Error(`expected positive, got ${v}`);
        }
      } else if (c.type === 'string') {
        if (typeof v !== 'string') {
          throw new Error(`expected string, got ${typeof v}`);
        }
      }
    }
    return v;
  }

  return {
    z: {
      number: zNumber,
      string: zString,
      enum: zEnum,
      object: zObject,
    },
  };
}

function getZodOrShim() {
  try {
    return require('zod');
  } catch {
    return makeShim();
  }
}

function buildTestSchema() {
  const { buildSchema } = loadModule();
  const z = getZodOrShim().z;
  return buildSchema(z);
}

// ---------------------------------------------------------------------------
// AC-1 shipped — valid
// ---------------------------------------------------------------------------

test('ResultSchema accepts a shipped result', () => {
  const schema = buildTestSchema();
  const out = schema.parse({
    issue_number: 42,
    pr_number: 99,
    status: 'shipped',
    branch: 'agent/issue-42',
    duration_seconds: 314.5,
  });
  assert.equal(out.status, 'shipped');
  assert.equal(out.issue_number, 42);
  assert.equal(out.pr_number, 99);
});

// ---------------------------------------------------------------------------
// AC-2 failed — valid with reason
// ---------------------------------------------------------------------------

test('ResultSchema accepts a failed result with reason', () => {
  const schema = buildTestSchema();
  const out = schema.parse({
    issue_number: 7,
    pr_number: null,
    status: 'failed',
    reason: 'tests did not pass on /hive:execute',
  });
  assert.equal(out.status, 'failed');
  assert.equal(out.pr_number, null);
  assert.equal(out.reason, 'tests did not pass on /hive:execute');
});

// ---------------------------------------------------------------------------
// AC-3 idle — valid with nulls
// ---------------------------------------------------------------------------

test('ResultSchema accepts an idle result with nullable fields null', () => {
  const schema = buildTestSchema();
  const out = schema.parse({
    issue_number: null,
    pr_number: null,
    status: 'idle',
    reason: 'no_ready_issues',
  });
  assert.equal(out.status, 'idle');
  assert.equal(out.issue_number, null);
});

// ---------------------------------------------------------------------------
// AC-4 reject — missing status
// ---------------------------------------------------------------------------

test('ResultSchema rejects when status is missing', () => {
  const schema = buildTestSchema();
  assert.throws(
    () => schema.parse({ issue_number: 1, pr_number: null }),
    /status/i
  );
});

// ---------------------------------------------------------------------------
// AC-5 reject — invalid status enum
// ---------------------------------------------------------------------------

test('ResultSchema rejects when status is outside the enum', () => {
  const schema = buildTestSchema();
  assert.throws(
    () =>
      schema.parse({
        issue_number: 1,
        pr_number: null,
        status: 'completed', // not in [shipped, failed, idle]
      }),
    /enum|invalid|completed/i
  );
});

// ---------------------------------------------------------------------------
// AC-6 reject — wrong type on pr_number
// ---------------------------------------------------------------------------

test('ResultSchema rejects when pr_number is a string', () => {
  const schema = buildTestSchema();
  assert.throws(
    () =>
      schema.parse({
        issue_number: 1,
        pr_number: '99', // string, not number
        status: 'shipped',
      }),
    /number|string/i
  );
});

// ---------------------------------------------------------------------------
// AC-7 reject — negative issue_number
// ---------------------------------------------------------------------------

test('ResultSchema rejects when issue_number is negative', () => {
  const schema = buildTestSchema();
  assert.throws(
    () =>
      schema.parse({
        issue_number: -5,
        pr_number: null,
        status: 'failed',
      }),
    /positive|greater|-5/i
  );
});
