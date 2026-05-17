# Hive Meta-Team — Nightly Cycle Report
**Cycle:** meta-2026-05-17 | **Date:** 2026-05-17 | **Verdict:** PASSED

---

## What Changed Tonight

- **`hive/lib/budget-gate.js`** — Added `claude-haiku-4-5-20251001` to `RATES_PER_MTOK` rate-card so haiku model events resolve to haiku rates instead of falling back to opus rates (15× over-count). Old short key `claude-haiku-4-5` retained for backward compatibility with any events logged before the API model ID stabilised.

---

## What Was Found (Not Fixed This Cycle)

- **STUB_DOC** `hive/references/hive-cloud-roadmap.md` — 13-line placeholder for the deferred Hive Cloud epic _(reason: out_of_scope — intentional forward-reference placeholder; flagged out_of_scope in meta-2026-05-11, -12, -14, -15, -16 as well)_

---

## Flagged for Human Review

- Nothing requires your attention.

---

## Cycle Metrics

| Metric | Count |
|--------|-------|
| Findings identified | 2 |
| Proposals generated | 1 |
| Changes promoted | 1 |
| Changes reverted | 0 |
| Flagged for human | 0 |

**Next cycle priority:** `hive/references/hive-cloud-roadmap.md` STUB_DOC has been flagged out_of_scope for 6+ consecutive cycles — consider adding a permanent ignore annotation to the queue entry or accepting the stub as a stable out-of-scope fixture.

kg-signal: findings=0 proposals=0 hit_rate_5cycle=0.0 miss_reason=empty_kg
