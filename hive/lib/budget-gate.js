// ESM: hive/lib/package.json declares "type": "module", which made the prior
// CJS form of this file un-loadable as a script entry (same latent break
// sdr-1 fixed in config.js). require() consumers keep working via
// require(esm) on Node >= 22.12.

/**
 * hive/lib/budget-gate.js
 *
 * Pre-flight token-budget gate for the autonomous worker loop (sandcastle-ops
 * Story S3). Invoked from `.github/workflows/hive-worker.yml` BEFORE the
 * sandcastle worker runs. Exit 1 = run aborted; exit 0 = within budget.
 *
 * Behavior:
 *   1. Scan `<state-dir>/metrics/events/stop-*.jsonl` for rows whose
 *      timestamp falls on or after UTC midnight of the current calendar day.
 *      `<state-dir>` resolves via the sdr-1 resolver (HIVE_STATE_DIR env >
 *      paths.state_dir in hive.config.yaml > default `.pHive`), matching the
 *      shell metrics hooks that write those rows.
 *   2. For each `metric_type: "tokens"` row, compute
 *        cost = (input_tokens × rate.in + output_tokens × rate.out) / 1e6
 *      using a per-model rate-card. Unknown models fall back to opus rates
 *      (conservative; never under-bills).
 *   3. Read `tokens.daily_usd_limit` from hive.config.yaml. If absent →
 *      Infinity (gate effectively disabled with a warning).
 *   4. If total spend ≥ limit, error + exit(1) with remaining-budget message.
 *
 * Event shape (from <state-dir>/metrics/events/stop-*.jsonl, per real samples):
 *   {
 *     "metric_type": "tokens",
 *     "value": <total tokens>,
 *     "timestamp": "<ISO-8601>",
 *     "dimensions": {
 *        "model": "claude-opus-4-8",
 *        "input_tokens": <n>,
 *        "output_tokens": <n>,
 *        "cache_creation_input_tokens": <n>,
 *        "cache_read_input_tokens": <n>
 *     }
 *   }
 * The schema doc at .pHive/metrics/metrics-event.schema.md describes the
 * canonical row; the model + per-direction token split lives in `dimensions`.
 *
 * Test seam: gate() and computeDailySpend() accept a `_deps` object so unit
 * tests inject fake fs/config without touching the real filesystem. `_deps.cwd`
 * and `_deps.env` thread through to the state-dir resolver.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveStateDir } from './config.js';

// Rates are USD per million tokens. Pricing drifts; this rate-card is
// intentionally inline so it shows up in diffs when rates change.
// Source: Anthropic pricing page; verify before relying on absolute numbers.
const RATES_PER_MTOK = {
  'claude-opus-4-8':          { in: 15.0, out: 75.0 },
  'claude-sonnet-4-6':        { in:  3.0, out: 15.0 },
  'claude-haiku-4-5-20251001': { in:  1.0, out:  5.0 },
  'claude-haiku-4-5':          { in:  1.0, out:  5.0 },
};

const FALLBACK_MODEL = 'claude-opus-4-8';

function rateLookup(model, warn = console.warn) {
  if (RATES_PER_MTOK[model]) return RATES_PER_MTOK[model];
  warn(`[budget-gate] no rate-card entry for model="${model}"; falling back to ${FALLBACK_MODEL} rates`);
  return RATES_PER_MTOK[FALLBACK_MODEL];
}

function rowCost(row, warn = console.warn) {
  if (row.metric_type !== 'tokens') return 0;
  const dims = row.dimensions || {};
  const model = dims.model;
  if (!model) return 0;
  const rate = rateLookup(model, warn);
  const inTok = Number(dims.input_tokens) || 0;
  const outTok = Number(dims.output_tokens) || 0;
  return (inTok * rate.in + outTok * rate.out) / 1_000_000;
}

function utcMidnightToday(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function isTodayUtc(isoTimestamp, midnightMs) {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return false;
  const nextMidnightMs = midnightMs + 24 * 60 * 60 * 1000;
  return t >= midnightMs && t < nextMidnightMs;
}

// Resolved per call (not at module load) so HIVE_STATE_DIR / hive.config.yaml
// changes and cwd are honored at read time.
function defaultEventsDir(_deps = {}) {
  return path.join(
    resolveStateDir({ cwd: _deps.cwd, env: _deps.env }),
    'metrics',
    'events'
  );
}

function computeDailySpend(_deps = {}) {
  const _fs = _deps.fs || fs;
  const eventsDir = _deps.eventsDir || defaultEventsDir(_deps);
  const warn = _deps.warn || console.warn;
  const now = _deps.now || new Date();
  const midnightMs = utcMidnightToday(now);

  let total = 0;
  let entries;
  try {
    entries = _fs.readdirSync(eventsDir);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      warn(`[budget-gate] events dir not found at ${eventsDir}; spend=0`);
      return 0;
    }
    throw e;
  }

  const files = entries.filter((f) => f.startsWith('stop-') && f.endsWith('.jsonl'));
  for (const file of files) {
    const fullPath = path.join(eventsDir, file);
    let contents;
    try {
      contents = _fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      warn(`[budget-gate] could not read ${file}: ${e.message}`);
      continue;
    }
    const lines = contents.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch (e) {
        warn(`[budget-gate] malformed JSONL row ${file}:${i + 1}; skipping`);
        continue;
      }
      if (!isTodayUtc(row.timestamp, midnightMs)) continue;
      total += rowCost(row, warn);
    }
  }
  return total;
}

function readDailyLimit(_deps = {}) {
  const _fs = _deps.fs || fs;
  const warn = _deps.warn || console.warn;
  if (typeof _deps.config === 'number') return _deps.config;
  if (_deps.config && typeof _deps.config.daily_usd_limit === 'number') {
    return _deps.config.daily_usd_limit;
  }
  const configPath = _deps.configPath || path.join(_deps.cwd || process.cwd(), 'hive.config.yaml');
  let contents;
  try {
    contents = _fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    warn(`[budget-gate] hive.config.yaml not readable (${e.code || e.message}); limit=Infinity`);
    return Infinity;
  }
  // Minimal YAML probe — avoid pulling a yaml dep at this layer. We look
  // for a top-level `tokens:` block followed by `daily_usd_limit:` at
  // exactly 2-space indent (the project's `.yamllint.yml` enforces 2-space
  // indent). Falls back to Infinity if the key is absent.
  const lines = contents.split('\n');
  let inTokens = false;
  for (const raw of lines) {
    if (/^tokens:\s*$/.test(raw)) { inTokens = true; continue; }
    if (inTokens && /^\S/.test(raw)) inTokens = false; // top-level key change
    if (inTokens) {
      const m = raw.match(/^\s{2}daily_usd_limit:\s*([0-9.]+)\s*(#.*)?$/);
      if (m) {
        const parsed = Number(m[1]);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        warn('[budget-gate] invalid tokens.daily_usd_limit; limit=Infinity (gate disabled)');
        return Infinity;
      }
    }
  }
  warn('[budget-gate] tokens.daily_usd_limit not set in hive.config.yaml; limit=Infinity (gate disabled)');
  return Infinity;
}

function gate(_deps = {}) {
  const limit = readDailyLimit(_deps);
  const spend = computeDailySpend(_deps);
  const log = _deps.log || console.log;
  const err = _deps.err || console.error;

  const remaining = limit - spend;
  if (spend >= limit) {
    err(`[budget-gate] BLOCKED: today's spend $${spend.toFixed(2)} >= daily limit $${limit.toFixed(2)} (remaining: $${remaining.toFixed(2)})`);
    return { ok: false, spend, limit, remaining };
  }
  log(`[budget-gate] OK: today's spend $${spend.toFixed(2)} / $${Number.isFinite(limit) ? limit.toFixed(2) : '∞'} (remaining: $${Number.isFinite(remaining) ? remaining.toFixed(2) : '∞'})`);
  return { ok: true, spend, limit, remaining };
}

const _internal = { rateLookup, rowCost, utcMidnightToday, isTodayUtc, RATES_PER_MTOK };

export { computeDailySpend, gate, readDailyLimit, _internal };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = gate();
  process.exit(result.ok ? 0 : 1);
}
