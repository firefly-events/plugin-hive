# BL2.4 Review Memo — Activate Rollback Watch on a Real Committed Experiment

**Reviewer:** Opus 4.7
**Date:** 2026-04-22
**Story:** BL2.4
**Verdict:** `needs_optimization`
**One-line rationale:** Armed path is correctly wired and realism proof is genuine, but two small tripping-path semantics questions (decision mutation on failed auto-revert; timestamp-normalization drift when `now` is a `datetime`) are worth tightening before BL2.6 tries to cite the evidence fields.

---

## Per-dimension scores

| # | Dimension | Score | Note |
|---|-----------|-------|------|
| 1 | Armed-path correctness | 5 | `arm_watch` rejects non-accept, missing `rollback_ref`, and empty `metrics_snapshot`; produces exactly the four fields `evaluate_watch` consumes (`regression_watch.state=armed`, `observation_window.start`/`end`, plus baseline `metrics_snapshot` in envelope). |
| 2 | Concrete callback binding realism | 5 | `make_direct_commit_auto_revert(adapter)` returns the bound method directly; test asserts `inspect.ismethod`, `callback.__self__ is adapter`, `callback.__func__ is DirectCommitAdapter.rollback`. No trampoline, no partial indirection. |
| 3 | Observation window semantics | 4 | Default 4h + configurable via `observation_window_hours`; `evaluate_watch` uses `start <= now < end` correctly. Docstring says start-inclusive/end-exclusive and the tests exercise both boundaries. Minor: `arm_watch` doesn't defend against `observation_window_hours <= 0`. |
| 4 | EnvelopeWriter protocol extension | 5 | Added `set_observation_window` to the Protocol + concrete `envelope.py` writer + test `RecordingEnvelopeWriter`. No concrete implementer omits the new method. |
| 5 | Step/skill integration clarity | 4 | §1c is correctly placed after the closure validator and before persistent writes; SKILL.md post-close section describes `evaluate_watch` cadence. Minor gap: §1c arms `envelope_writer=envelope` which is a plain dict — the live close path needs to resolve this to the actual writer (not the dict instance) or document that §2 writes the `armed` payload, not the writer. Today's step-08 prose does both — worth clarifying. |
| 6 | Trigger evidence durability | 3 | `set_regression_watch(state='tripped', tripped_by, tripped_at)` is called before the rollback fires; `set_decision('reverted')` is only called if `rollback_result.success`. But when the callback is `None` OR fails, `regression_watch.state` still flips to `tripped` without a corresponding `decision` update, and **`rollback_result` itself is never persisted to the envelope** (it's only in the returned `TripEvent`). BL2.6 needs to cite `rollback_result` from disk per the research brief §5 — today it can only cite `tripped_at`/`tripped_by`/`decision`. |
| 7 | Test realism | 5 | No mocks. `test_arm_then_evaluate_tripped_invokes_direct_commit_adapter_rollback` does a real `DirectCommitAdapter.promote`, arms the watch, trips it, runs `git revert` against the actual repo, verifies `git log --oneline -2` shows both the promotion and the revert commit, and asserts the envelope writer received `tripped` + `reverted` in that order. Concur with tester assessment. |
| 8 | Scope discipline | 5 | Arms the real path, wires the concrete callback, writes durable state for most trigger fields, and explicitly stops short of the deliberate-regression proof (BL2.6). Story AC4 satisfied. |
| 9 | `__all__` export decision | 3 | `__all__` intentionally excludes `arm_watch`/`make_direct_commit_auto_revert`; the module uses `__getattr__` to lazy-expose them, and the package `__init__` calls `__getattr__("arm_watch")` / `__getattr__("make_direct_commit_auto_revert")` at import time to re-export them at package root. This works but is unusual: direct `from hive.lib.meta_experiment.rollback_watch import arm_watch` still succeeds (via `__getattr__`), so the "don't widen `__all__`" decision only affects `from rollback_watch import *` and linters — not normal callers. If the motivation is a lib-suite constraint, the pattern should be documented inline (why `__all__` excludes public helpers). Otherwise an inbound dev will be confused. |

---

## Findings

### F1 — `rollback_result` not persisted to envelope (Dim 6, medium)
**File:** `hive/lib/meta-experiment/rollback_watch.py:143-159`
`evaluate_watch` writes the tripped regression-watch state and flips `decision` to `reverted`, but the `RollbackResult` (`revert_ref`, `notes`, `success`) is only returned via the `TripEvent` dataclass. BL2.6's proof needs `rollback_result` visible on disk per research brief §5. Options:
- Add `envelope_writer.set_rollback_result(experiment_id, result_dict)` (needs a new envelope method — `envelope.py` already has `set_rollback_ref`, so the precedent is there).
- OR fold `rollback_result` into the `set_regression_watch({state: 'tripped', ..., rollback_result: {...}})` payload.

### F2 — `decision` mutation only on success, but `regression_watch` state is already `tripped` (Dim 6, minor)
**File:** `rollback_watch.py:143-159`
If `auto_revert_callback` is None or returns `success=False`, the envelope ends up with `regression_watch.state='tripped'` but `decision='accept'` (unchanged). That's technically a recoverable state, but it's a confusing shape for a later auditor. Consider either:
- Setting `decision='revert_failed'` (new enum value) when the callback fails, or
- Documenting in SKILL.md post-close section that a tripped-but-unreverted run must be retried by the maintainer.

### F3 — Timestamp normalization drift for naive/non-UTC datetimes (Dim 3, minor)
**File:** `rollback_watch.py:162-175`
`_format_timestamp` returns `value.isoformat()` unchanged for non-UTC (including naive) datetimes, but `_coerce_timestamp` for a datetime input returns the raw datetime + its isoformat. If a caller passes a naive `datetime.now()`, the `armed_at` and `observation_window.start` strings lack a timezone suffix, and later `evaluate_watch(now="2026-...Z")` mixes tz-aware vs tz-naive datetimes which Python 3's `<` will raise on. The activation test passes a UTC datetime so this path is not exercised. Recommend either normalizing to UTC internally or documenting the "must be tz-aware or Z-suffixed ISO" precondition in the `arm_watch` docstring.

### F4 — `arm_watch` skip condition for `reverted` not enforced in code (Dim 5, minor)
**File:** `rollback_watch.py:54-55` + `step-08-close.md:102`
Step-08 §1c says "for `reject` or `reverted`, skip arming and record `regression_watch: {state: 'not_applicable'}`". The `arm_watch` helper only raises on `decision != 'accept'` (generic error). The skill prose correctly tells the runner to branch on decision first, but there's no code-level guard that records `not_applicable` — it's pure runner responsibility. Acceptable for now, but BL2.6 should not depend on `not_applicable` being present in a real envelope unless we add a runner test.

### F5 — `__getattr__`-based re-export adds one layer of import indirection (Dim 9, minor)
**File:** `rollback_watch.py:178-186` + `__init__.py:22-27`
The module-level `__getattr__` provides `arm_watch`/`make_direct_commit_auto_revert` without widening `__all__`. Works, but: (a) IDE jump-to-definition may miss this; (b) `dir(rollback_watch)` won't list these names until first access; (c) the rationale ("existing lib suite constraints") is not captured in a code comment. Add a brief inline comment documenting the constraint if it's a deliberate, durable choice.

### F6 — `_arm_watch(now=None)` raises `TypeError` with a developer-oriented message (Dim 1, trivial)
**File:** `rollback_watch.py:63-64`
`now` is declared `str | _datetime = None` but treated as required. Prefer `now: str | _datetime` (no default) so the signature reflects reality, or document that `None` is an explicit sentinel. Non-blocking.

---

## Follow-ups (needs_optimization)

Before integrate:

1. **[Blocking for BL2.6 citation]** Address F1 — persist `rollback_result` to envelope so BL2.6 can cite success/revert_ref/notes from disk. Either new writer method or nested in `set_regression_watch`. Pick one and add a test assertion in `test_rollback_watch_activation.py` proving the durable field shape.
2. **[Low-risk clarity]** Address F2 by documenting the tripped-but-unreverted fallback state in SKILL.md "Post-close observation" so an auditor reading the envelope later understands why `decision` may still read `accept` while `regression_watch.state='tripped'`.
3. **[Doc only]** Address F5 with an inline comment on `rollback_watch.__all__` explaining why public helpers are lazy-exposed, or promote them to `__all__` if the lib-suite constraint no longer applies.

F3, F4, F6 are non-blocking and can land in BL2.6 or a follow-up polish pass.

---

## BL2.6 forward-risk flags

- **Proof artifact shape.** If F1 is not fixed, BL2.6's proof will either (a) inspect the live `TripEvent` object in-process (fragile — the research brief wants disk evidence) or (b) reintroduce an envelope-level persistence step. Fixing now is cheaper.
- **Deliberate regression harness.** The live path assumes `metrics_snapshot` is a dict with a `.metrics.tokens` shape (from the test fixture). BL2.6 will need a realistic "regressed" snapshot — make sure the deliberate-regression generator matches the compare module's expected shape. Recommend a helper lives next to `rollback_watch.py` so BL2.6 doesn't roll one.
- **Window-timing pressure.** The 4-hour default is correct for production but BL2.6's proof test will want to pass an explicit short window (seconds) or override `now` to fast-forward through the window. Today `observation_window_hours` is int/float, and `now` is settable in `evaluate_watch`, so the seams exist — just flag it.
- **Worktree state after revert.** `DirectCommitAdapter.rollback` does a real `git revert --no-edit`. If BL2.6 runs this in the live repo (not a tmp_path fixture), test cleanup must not leave the revert commit behind. Test fixture discipline is critical.

---

## Overall

BL2.4 lands the hard part (concrete bound method, real revert commit, durable armed/tripped state in the envelope). One durable-evidence gap (F1) is worth closing before integrate so BL2.6 has a clean citation target. Nothing here requires revision.
