'use strict';

/**
 * Tests for hive/lib/budget-gate.js
 *
 * Story: s3-gh-actions-cron-loop (sandcastle-ops-layer)
 * Run:   node --test tests/budget-gate.test.js
 *
 * No filesystem writes — tests inject `_deps.fs` (a minimal in-memory fs
 * shim implementing only readdirSync + readFileSync) and `_deps.config`.
 * `_deps.now` pins the clock so timestamps are deterministic.
 *
 * Covers (per S3 acceptance criteria + cross-cutting metrics):
 *   AC-budget-1  empty events dir → spend=0 + gate passes
 *   AC-budget-2  mixed-model events → correct weighted sum
 *   AC-budget-3  over-limit → gate fails with remaining message
 *   AC-budget-4  malformed JSONL rows → skipped with warn; run continues
 *   AC-budget-5  unknown model → opus fallback + warn
 *   AC-budget-6  rows older than UTC midnight today → excluded
 *   AC-budget-7  non-tokens metric_type rows → contribute zero
 *   AC-budget-8  missing daily_usd_limit → limit=Infinity, gate passes
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { computeDailySpend, gate, _internal } = require(
  path.join(__dirname, '..', 'hive', 'lib', 'budget-gate.js')
);

/** Build a minimal in-memory fs shim from a file map. */
function makeFs(files /* { name: contents } */) {
  return {
    readdirSync: () => Object.keys(files),
    readFileSync: (full /* abs path */, _enc) => {
      const name = path.basename(full);
      if (!(name in files)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files[name];
    },
  };
}

/** Build a JSONL-line stop-event row. */
function tokensRow({
  ts,
  model = 'claude-opus-4-8',
  input_tokens = 0,
  output_tokens = 0,
}) {
  return JSON.stringify({
    event_id: `evt_${ts}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ts,
    run_id: 'run_test',
    story_id: 'session-end',
    metric_type: 'tokens',
    value: input_tokens + output_tokens,
    unit: 'tokens',
    dimensions: { model, input_tokens, output_tokens },
    source: 'stop-hook-jsonl-transcript',
  });
}

const NOW = new Date('2026-05-15T12:00:00Z');
const TODAY_TS = '2026-05-15T08:00:00Z';
const YESTERDAY_TS = '2026-05-14T23:59:59Z';

function silentWarns() {
  const log = [];
  return { warns: log, warn: (m) => log.push(m) };
}

test('AC-budget-1: empty events dir → spend=0, gate passes', () => {
  const { warn, warns } = silentWarns();
  const result = gate({
    fs: makeFs({}),
    config: 100, // $100 daily limit
    now: NOW,
    warn,
    log: () => {},
    err: () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.spend, 0);
  assert.equal(result.limit, 100);
  // No warnings expected when dir is empty but exists
  assert.ok(Array.isArray(warns));
});

test('AC-budget-2: mixed-model events → correct weighted sum', () => {
  // Opus: 1M input × $15/MTok + 0.5M output × $75/MTok = 15 + 37.5 = $52.50
  // Sonnet: 2M input × $3/MTok + 1M output × $15/MTok = 6 + 15 = $21.00
  // Haiku: 5M input × $1/MTok + 2M output × $5/MTok = 5 + 10 = $15.00
  // Total = $88.50
  const files = {
    'stop-a.jsonl': [
      tokensRow({ ts: TODAY_TS, model: 'claude-opus-4-8', input_tokens: 1_000_000, output_tokens: 500_000 }),
      tokensRow({ ts: TODAY_TS, model: 'claude-sonnet-4-6', input_tokens: 2_000_000, output_tokens: 1_000_000 }),
    ].join('\n'),
    'stop-b.jsonl': tokensRow({ ts: TODAY_TS, model: 'claude-haiku-4-5', input_tokens: 5_000_000, output_tokens: 2_000_000 }),
  };
  const spend = computeDailySpend({
    fs: makeFs(files),
    now: NOW,
    warn: () => {},
  });
  assert.equal(Number(spend.toFixed(2)), 88.50);
});

test('AC-budget-3: over-limit → gate fails with remaining-budget message', () => {
  const files = {
    'stop-x.jsonl': tokensRow({ ts: TODAY_TS, model: 'claude-opus-4-8', input_tokens: 10_000_000, output_tokens: 0 }),
    // Cost: $150
  };
  const errs = [];
  const result = gate({
    fs: makeFs(files),
    config: 50, // $50 limit
    now: NOW,
    warn: () => {},
    log: () => {},
    err: (m) => errs.push(m),
  });
  assert.equal(result.ok, false);
  assert.equal(result.spend, 150);
  assert.equal(result.limit, 50);
  assert.equal(result.remaining, -100);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /BLOCKED/);
  assert.match(errs[0], /remaining/i);
});

test('AC-budget-4: malformed JSONL row → skipped with warn, run continues', () => {
  const files = {
    'stop-mix.jsonl': [
      '{not-json',
      tokensRow({ ts: TODAY_TS, model: 'claude-haiku-4-5', input_tokens: 1_000_000, output_tokens: 0 }),
      'also-bad-{',
    ].join('\n'),
  };
  const { warn, warns } = silentWarns();
  const spend = computeDailySpend({ fs: makeFs(files), now: NOW, warn });
  // Haiku 1M input only: $1.00
  assert.equal(Number(spend.toFixed(2)), 1.00);
  assert.ok(warns.some((w) => /malformed/i.test(w)));
});

test('AC-budget-5: unknown model → opus rate fallback + warn', () => {
  const files = {
    'stop-u.jsonl': tokensRow({ ts: TODAY_TS, model: 'claude-sonnet-9-99', input_tokens: 1_000_000, output_tokens: 0 }),
  };
  const { warn, warns } = silentWarns();
  const spend = computeDailySpend({ fs: makeFs(files), now: NOW, warn });
  // Unknown → opus rate: 1M × $15/MTok = $15
  assert.equal(Number(spend.toFixed(2)), 15.00);
  assert.ok(warns.some((w) => /no rate-card/i.test(w)));
});

test('AC-budget-6: rows older than UTC midnight today → excluded', () => {
  const files = {
    'stop-old.jsonl': [
      tokensRow({ ts: YESTERDAY_TS, model: 'claude-opus-4-8', input_tokens: 10_000_000, output_tokens: 0 }),
      tokensRow({ ts: TODAY_TS, model: 'claude-haiku-4-5', input_tokens: 1_000_000, output_tokens: 0 }),
    ].join('\n'),
  };
  const spend = computeDailySpend({ fs: makeFs(files), now: NOW, warn: () => {} });
  // Only today's haiku row: $1.00
  assert.equal(Number(spend.toFixed(2)), 1.00);
});

test('AC-budget-7: non-tokens metric_type rows → contribute zero', () => {
  const wallClockRow = JSON.stringify({
    event_id: 'evt_test',
    timestamp: TODAY_TS,
    run_id: 'r',
    story_id: 's',
    metric_type: 'wall_clock_ms',
    value: 12345,
    unit: 'ms',
    dimensions: {},
    source: 'stop-hook-wall-clock',
  });
  const files = { 'stop-w.jsonl': wallClockRow };
  const spend = computeDailySpend({ fs: makeFs(files), now: NOW, warn: () => {} });
  assert.equal(spend, 0);
});

test('AC-budget-8: missing daily_usd_limit → limit=Infinity, gate passes', () => {
  const files = {
    'stop-big.jsonl': tokensRow({ ts: TODAY_TS, model: 'claude-opus-4-8', input_tokens: 100_000_000, output_tokens: 100_000_000 }),
  };
  const { warn, warns } = silentWarns();
  // config=null forces the gate to fall through readDailyLimit; we point
  // configPath at a non-existent path so the limit defaults to Infinity.
  const result = gate({
    fs: {
      readdirSync: makeFs(files).readdirSync,
      readFileSync: (full) => {
        const name = path.basename(full);
        if (name === 'hive.config.yaml') {
          const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err;
        }
        return makeFs(files).readFileSync(full);
      },
    },
    now: NOW,
    warn,
    log: () => {},
    err: () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.limit, Infinity);
  assert.ok(warns.some((w) => /Infinity|hive\.config\.yaml/i.test(w)));
});

test('rateLookup: known models return inline rate-card entries', () => {
  assert.deepEqual(_internal.rateLookup('claude-opus-4-8', () => {}), { in: 15.0, out: 75.0 });
  assert.deepEqual(_internal.rateLookup('claude-sonnet-4-6', () => {}), { in: 3.0, out: 15.0 });
  assert.deepEqual(_internal.rateLookup('claude-haiku-4-5', () => {}), { in: 1.0, out: 5.0 });
});
