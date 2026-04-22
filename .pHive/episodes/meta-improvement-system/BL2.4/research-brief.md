# BL2.4 Research Brief — Activate Rollback Watch on Real Committed Experiment

## Summary
Confirmed architecture readiness for BL2.4: `rollback_watch.py` has the core `evaluate_watch()` primitive and `TripEvent` shape; `envelope.py` provides `set_regression_watch()` / `set_decision()` writers. Three unknowns resolved below; two API gaps identified.

---

## Findings

### 1. Observation Window Default Duration
**B0 contract specifies shape, not default.** Section 1.8 (`observation_window`) mandates a time-bounded descriptor (start + end timestamps) but leaves duration choice to S2. No signed default exists.

**Recommendation:** BL2.4 should **default to 4 hours** for the maintainer polling loop. Justification:
- Post-close observation is typically within a single working session (meta-team watches committed code for ~4h).
- Aligns with B0.2's implicit "continuous polling during window" cost model (serial, bounded cost).
- Allows BL2.3–BL2.4 integration fixture to use realistic timescale without slow tests.

### 2. Envelope Writer API Gaps
**Found:** `envelope.py` has `set_regression_watch()` and `set_decision()`. ✓
**Missing:** `set_observation_window()` **NOT in protocol**. BL2.4 decision point:
- **Option A (recommended):** Add `set_observation_window()` to `envelope.py` following the pattern of `set_metrics_snapshot()`.
- **Option B:** In-memory mutation acceptable since step-08 (close) owns the final persistent write. But breaks envelope.py's single-field-update principle.

**Action:** BL2.4 should add the method to envelope.py for API consistency.

### 3. Auto-Revert Callback Factory
`evaluate_watch()` signature accepts:
```python
auto_revert_callback: _Callable[[dict[str, _Any], str], _RollbackResult] | None
```
(Takes envelope dict + rollback_ref string; returns RollbackResult.)

`DirectCommitAdapter.rollback(envelope: dict, rollback_ref: str)` matches this signature exactly.

**Binding approach (cleanest):**
```python
from functools import partial
from hive.lib.meta_experiment.direct_commit_adapter import DirectCommitAdapter

adapter = DirectCommitAdapter(...)
callback = adapter.rollback
# or: callback = partial(adapter.rollback)
evaluate_watch(..., auto_revert_callback=callback, ...)
```
No lambda needed; direct method ref works because signature aligns.

### 4. Where evaluate_watch() Gets Invoked
**Current state:** Primitive exists in `rollback_watch.py` but **no step currently calls it**. This is the BL2.4 design choice:

**Recommendation:** **Post-close external scheduled check** (not pre-close assertion).
- Rationale: Observation window is *after* close (post-close measurement phase). Evaluating during close would be premature.
- Implementation: BL2.4 or later step-scheduling framework calls `evaluate_watch()` once per polling interval (e.g., every 10 min) while `observation_window.end` is not yet elapsed.
- **Does NOT belong** in step-07 (close) or earlier; should be a separate external loop or step-08 post-action hook.

### 5. Trigger-Relevant Evidence Fields (AC3)
BL2.6 proof story will cite these exact envelope keys to demonstrate the watch was armed and fired:
- `regression_watch.state` → "tripped" (proof watch fired)
- `regression_watch.tripped_by` → post_close_snapshot dict (evidence of regression)
- `regression_watch.tripped_at` → ISO timestamp (when watch fired)
- `decision` → "reverted" (proof auto-revert completed)
- `rollback_ref` → reference that was passed to rollback() (audit trail)
- `rollback_result` (if persisted) → success: true/false (closure evidence)

**TripEvent dataclass already carries all of these** as fields: `experiment_id`, `tripped_at`, `tripped_by`, `regression_metrics`, `threshold_pct`, `rollback_ref`, `rollback_result`.

### 6. Arming Helper
No existing `arm_rollback_watch()` helper found. Currently, arming is implicit in envelope creation (see BL2.3 test fixtures: `"regression_watch": {"state": "armed", ...}`).

**Recommendation:** Add to `rollback_watch.py`:
```python
def arm_watch(envelope_id: str, observation_window_start: str, observation_window_end: str, envelope_writer: EnvelopeWriter) -> dict[str, Any]:
    """Arm regression watch for an accepted experiment."""
    envelope_writer.set_regression_watch(envelope_id, {"state": "armed", "tripped_by": None, "tripped_at": None})
    envelope_writer.set_observation_window(envelope_id, {"start": observation_window_start, "end": observation_window_end})
    return {"armed": True}
```
(Depends on `set_observation_window()` being added to envelope.py.)

---

## API Gaps BL2.4 Must Fill
1. **`envelope.set_observation_window()`** — Add to envelope.py protocol + implementation.
2. **`rollback_watch.arm_watch()`** — Add helper to prepare watch before evaluate_watch() is called.

---

## Files Referenced
- `/hive/lib/meta-experiment/rollback_watch.py` (primitives OK)
- `/hive/lib/meta-experiment/envelope.py` (add set_observation_window)
- `/hive/lib/meta-experiment/direct_commit_adapter.py` (rollback() signature matches)
- `/.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` (§1.8, §2.3, §3.2 pinned)
- `/tests/meta_meta/test_live_cycle_integration.py` (fixture patterns reusable)

---

## Key Dates & Escalation Context
- **B0 signed:** 2026-04-19
- **Escalation:** rollback-realism-proof-ambiguity (stories S9, BL2.4, BL2.6)
- **Scope constraint:** Anti-over-engineering (Q3): no per-metric threshold classes, no alternate rollback modes.

