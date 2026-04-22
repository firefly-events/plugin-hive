# S7 — B-L1 Shared Lifecycle Library — Slice Summary

**Status:** complete
**Branch:** `meta-improvement-system-s7` (stacked on `meta-improvement-system-s6`)
**Stories:** L1.1, L1.2, L1.3, L1.4, L1.5, L1.6, L1.7 (all merged into branch)
**Execution mode:** sequential (linear dependency chain)
**Commits:** 7 (one per story), plus episodes

## What shipped

`hive/lib/meta-experiment/` — shared runtime library consumed later by
`maintainer-skills/meta-meta-optimize/` (local, S9) and
`skills/hive/skills/meta-optimize/` (public, S10). NOT a SKILL.md — follows
the existing `hive/lib/metrics/` pattern (module-local tests via
`unittest.discover`).

| Story | Module | Purpose |
|-------|--------|---------|
| L1.1 | scaffold (+README, tests) | Package root, discovery doc, import smoke test |
| L1.2 | `envelope.py` | Thin pass-through over C1 `hive.lib.metrics.create_envelope / read_envelope / update_envelope`. Seven intent-named narrow setters — single-field by construction. |
| L1.3 | `baseline.py` | Substrate-facing capture. `capture_from_run(run_id)` returns `None` when events missing/empty (backlog-fallback first-class). `capture_and_persist` raises `NoBaselineError` when baseline required but absent. |
| L1.4 | `compare.py` | Wraps C1 `delta_compare` + applies single-knob `threshold_pct` uniformly. Returns structured decision object (verdict, threshold_pct, per-metric over/under flags, regression_metrics list). No per-metric asymmetric classes. |
| L1.5 | `promotion_adapter.py` | Abstract `PromotionAdapter` base + frozen result dataclasses. `PromotionEvidence` invariant: exactly one of `commit_ref` XOR `pr_ref` must be non-None. This is the architectural seam that guards against direct-commit overfit in L1.7. |
| L1.6 | `rollback_watch.py` | Single-path observation-window watch. Q3 locked — no manual/recommendation/human-gated branches. `EnvelopeWriter` Protocol lets tests run without touching substrate. Trip ordering: TripEvent → set_regression_watch → callback → conditional set_decision(reverted). Structural test locks the public surface to prevent alt-mode accretion. |
| L1.7 | `closure_validator.py` | Non-bypassable close gate. Six distinct error classes (MissingEvidence, AmbiguousEvidence, MissingMetricsSnapshot, MissingRollbackTarget, InvalidDecision, base CloseValidationError). Accepts commit_ref XOR pr_ref → S10 PR-only closes pass without retrofit. |

## Test coverage

`python3 -m unittest discover hive/lib/meta-experiment/tests` → **60 tests OK**.

Breakdown per story: L1.1 scaffold (3) → L1.2 envelope (7) → L1.3 baseline (6)
→ L1.4 compare (8) → L1.5 promotion_adapter (9) → L1.6 rollback_watch (11)
→ L1.7 closure_validator (15 + 1 additional).

## Architectural guardrails engaged

1. **closure-evidence-shape-mismatch** escalation mitigated via L1.5's
   `PromotionEvidence(commit_ref | pr_ref)` invariant + L1.7's symmetric
   validator. S10 (PR-only) cannot trip the validator by shipping PR evidence.
2. **Q3 single-path rollback** locked at L1.6 via `__all__` + structural
   test asserting the public surface contains no alternate-mode names or
   parameters.
3. **Lean threshold policy** enforced at L1.4 — `threshold_pct` is a required
   positional; no per-metric map is a value a caller can supply.
4. **Backlog-fallback** preserved at L1.3 — missing metrics is a first-class
   `None` outcome, not a crash.

## Pending work deferred out of S7

- Concrete `PromotionAdapter` implementations — direct-commit in BL2.1 (S9),
  PR-only in BL3.2 (S10).
- Envelope schema extension to carry `pr_ref` as a first-class field — L1.7
  validator accepts it today, C1 schema currently documents only `commit_ref`.
  Deferrable to S10 (BL3.2/BL3.3) without retrofitting this slice.
- End-to-end `regression_watch → auto_revert_callback → set_decision(reverted)`
  proof with a real adapter — BL2.4 / BL2.6 (S9).

## Execution notes

- Codex (codex-rescue) handled dev + test per story. Opus 4.7 reviewed each
  story (via plain `Agent` general-purpose subagent with reviewer framing —
  `model_overrides.reviewer: opus` applies at the TeamCreate layer, but ad-hoc
  Agent spawns inherit the caller's model).
- Serial Codex dispatch per user policy. No parallel-dispatch race.
- One minor mid-run hiccup on L1.6 (Codex returned a "waiting" message after
  writing the module file but before writing tests; resolved with a single
  SendMessage to the same agent ID). Tests + exports landed on resume; no
  rework needed.
- README submodule-list drift caught at L1.4 review; tidied at L1.5.
