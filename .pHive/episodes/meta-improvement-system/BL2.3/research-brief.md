# BL2.3 Wiring Brief: Baseline capture, metric emission, compare, and close validation

## 1. Baseline capture binding

**Where:** Step 01 boot must reserve a `baseline_ref` (cycle ID + baseline marker); the actual capture happens in a post-step-03 window. SKILL.md:72 marks this "stop condition" for BL2.3 boundary.

**API:** `baseline.capture_from_run(run_id)` → `dict[str, Any] | None` (returns `{"captured_at": ISO, "metrics": {...}}` or `None`). Then `baseline.persist_to_envelope(experiment_id, snapshot)` stores it in the envelope. Or direct call: `baseline.capture_and_persist(experiment_id, run_id)`.

**Inputs needed:** `run_id` (where events were recorded during step 2–5) and `experiment_id` (cycle ID).

**Envelope fields populated:** `metrics_snapshot` with `captured_at` timestamp and metric values keyed by type (tokens, wall_clock_ms, fix_loop_iterations, first_attempt_pass, human_escalation).

**Worktree location:** Baseline reads from `.pHive/metrics/{cycle_id}/events.jsonl` (already on disk by C2 emission in steps 2–5). No write to worktree; envelope persists under `.pHive/metrics/{cycle_id}/envelope.yaml`.

**Step-01-boot.md update:** Add post-boot task: "Instantiate envelope with `envelope.create({experiment_id: cycle_id, ...})` so downstream steps can populate it. Baseline capture will bind to this envelope later."

---

## 2. Compare binding (step-06 evaluation)

**API:** `compare.evaluate(baseline_metrics, candidate_metrics, threshold_pct)` → `{"verdict": "accept"|"reject", "threshold_pct": N, "metrics": {...}, "regression_metrics": [...]}`. Or use `compare.evaluate_from_envelope(envelope_dict, candidate_metrics, threshold_pct)` to load baseline directly from envelope.

**Step-06 flow:** After evaluation scoring completes (safety constraints applied), call `compare.evaluate_from_envelope(...)` with candidate metrics (collected in step 4–5 runs). Produces evaluation verdict + metrics summary. This BECOMES part of evaluation_results output.

**Envelope field:** `compare.evaluate()` output dictionary is stored as `regression_watch` on the envelope (via `envelope.set_regression_watch(cycle_id, compare_result)`).

**Step-06-evaluation.md update:** Add final task under "Compile workflow outputs": "Call `compare.evaluate_from_envelope(envelope, candidate_metrics, threshold=...)` and set `regression_watch` with the result. Include verdict (accept/reject) in evaluation_results output."

**Note:** Step 6 remains read-only; does NOT write cycle-state or envelope directly. Output flows through workflow graph to step 7.

---

## 3. Closure validator binding (step-08)

**Three required fields enforced by `closure_validator.validate_closable(envelope)`:**
1. **`commit_ref`**: Real git commit hash (40-char SHA-1 or 7+ char abbrev passing `git rev-parse --verify`). **NOT** "TBD", "pending", empty string, or unresolvable text.
2. **`metrics_snapshot`**: Non-empty dict from baseline capture (step 01–03 boundary). Absence → `MissingMetricsSnapshotError`.
3. **`rollback_ref`**: Real git ref (commit or branch/tag) passing `git rev-parse --verify`. Used as atomic-revert target per B0 §3.2.

**Rejection mechanism:** Step-08 closes with call to `closure_validator.validate_closable(envelope)` as FIRST task. If it raises any `CloseValidationError` subclass (e.g., `InvalidDecisionError` if `commit: TBD`), step HALTS before ledger append or cycle-state write, records `close_rejected: {reason}`, and leaves cycle incomplete.

**PR-only evidence path (S10-forward):** Validator accepts EITHER `commit_ref` OR `pr_ref` (mutually exclusive per L1.5). Current direct-commit path uses `commit_ref`; future PR-close path uses `pr_ref`. Both trigger the same close gate; no direct-commit-only shortcut.

**Step-08-close.md is already correct.** Confirm that the step calls shared `closure_validator.validate_closable(envelope)` before proceeding to ledger append.

---

## 4. Metrics emission points

**Timing:** Events emitted per-step during steps 2–5 (C2.2 emission). Stop hook (`.claude-plugin/plugin.json`) emits final session-end marker at cycle conclusion.

**Schema (JSONL):** Each event row has: `event_id`, `timestamp`, `run_id`, `metric_type`, `value`, `unit`, `dimensions`, `source`, plus optional `story_id` OR `proposal_id` (exactly one). Events written to `.pHive/metrics/{cycle_id}/events.jsonl`.

**Validator:** `baseline.py` enforces `_REQUIRED_EVENT_FIELDS` and `_EVENT_METRIC_TYPES` (tokens, wall_clock_ms, fix_loop_iterations, first_attempt_pass, human_escalation).

**Envelope closure:** Final metrics snapshot (from baseline capture) is locked in envelope by step 01–03 boundary. No additional emission needed at close time; snapshot is reference to this earlier capture.

---

## 5. Evidence-shape preservation (closure-evidence-shape-mismatch escalation)

**AC4 requirement:** Evidence must remain explicit enough for PR-only close records (S10 future).

**Explicit fields on envelope that must NOT collapse:**
- `commit_ref` — direct commit path (current)
- `pr_ref` — PR-only path (reserved S10)
- `metrics_snapshot` — BOTH paths require this
- `rollback_ref` — BOTH paths require this
- `decision` — BOTH paths require terminal state

**What must NOT happen:** Integration code should not normalize both `commit_ref` and `pr_ref` into a single "evidence" field, or add logic that treats direct-commit as the canonical close and PR-close as a fallback. Validator already enforces mutual exclusion; step files must preserve that shape in envelope writes.

**In integration tests:** Add test case "evidence_shape_fidelity" that fabricates an envelope with `pr_ref` (no `commit_ref`) and verifies `validate_closable()` still passes. Confirms PR-only path is not locked out.

---

## 6. rollback_target -> rollback_ref translation

**Source (Step 7):** `DirectCommitAdapter.promote(envelope, decision)` returns `PromotionResult` with field `rollback_target` (a git commit SHA captured BEFORE the merge/cherry-pick mutates main).

**Translation (Step 7 → 8):** Step-07-promotion.md should call `envelope.set_rollback_ref(cycle_id, promotion_result.rollback_target)` to persist the adapter's return value as the envelope's `rollback_ref` field.

**Already wired in BL2.2:** SKILL.md:117 references this ("capture `rollback_target` and store it in the envelope as the cycle rollback reference"), but the name-asymmetry is confusing. Step-07-promotion.md should explicitly call `envelope.set_rollback_ref(...)` so the field mapping is unambiguous.

---

## 7. Files to modify (ordered list)

1. **step-01-boot.md** — Add post-boot task to instantiate envelope with `envelope.create({experiment_id, ...})` for downstream binding.
2. **step-06-evaluation.md** — Add final task under "Compile workflow outputs" to call `compare.evaluate_from_envelope(...)` and set `regression_watch` field; include verdict in evaluation_results.
3. **step-08-close.md** — Confirm it calls `closure_validator.validate_closable(envelope)` as first mandatory check before ledger append (already correct; verify documentation is current).
4. **maintainer-skills/meta-meta-optimize/SKILL.md** — Add one-line clarification at SKILL.md:117 linking `rollback_target` to envelope `rollback_ref` storage; update step-07 reference to show explicit field call.
5. **tests/meta_meta/test_live_cycle_integration.py** — Create new file with integration fixture and test cases (see §8 below).

---

## 8. Integration test plan

**File:** `/Users/don/Documents/plugin-hive/tests/meta_meta/test_live_cycle_integration.py`

**Fixture approach:** Use `tmp_path` to create ephemeral `.pHive/metrics/{cycle_id}/` structure. Populate `events.jsonl` with stub event records matching `_REQUIRED_EVENT_FIELDS` schema. Instantiate envelope + baseline + compare + closure validator in sequence, avoiding mutable repo state.

**Test cases:**

1. **test_live_cycle_baseline_to_close_happy_path** — Fixture setup: events.jsonl with valid metrics, envelope created, baseline captured and persisted, candidate metrics scored, compare verdict produced, commit_ref and rollback_ref set. Assert `validate_closable(envelope)` passes; envelope has all 3 required fields populated with real values.

2. **test_live_cycle_commit_tbd_rejection** — Fabricate envelope with `commit_ref="TBD"`, `metrics_snapshot={...}`, `rollback_ref="HEAD"`, `decision="accept"`. Call `validate_closable(envelope)` and assert it raises `InvalidDecisionError` or `MissingEvidenceError` with message naming the TBD value.

3. **test_live_cycle_evidence_shape_fidelity_pr_only_path** — Fabricate envelope with `pr_ref="refs/pull/42/head"` (no `commit_ref`), valid `metrics_snapshot` and `rollback_ref`, `decision="accept"`. Assert `validate_closable(envelope)` PASSES (does not lock into commit_ref-only path).

4. **test_live_cycle_missing_metrics_snapshot** — Envelope with valid `commit_ref`, `rollback_ref`, but `metrics_snapshot={}` or missing. Assert `validate_closable()` raises `MissingMetricsSnapshotError`.

5. **test_live_cycle_envelope_artifacts_on_disk** — After a compose run, verify `.pHive/metrics/{cycle_id}/envelope.yaml` and events.jsonl exist and are readable by envelope module functions.

---

## 9. Risks and open questions

1. **Metric emission before baseline capture.** Events must exist in events.jsonl BEFORE baseline.capture_from_run() reads them. Confirm C2 emitters are active in steps 2–5 and not blocked by any missing infrastructure.

2. **Envelope location ambiguity.** Currently `.pHive/metrics/{cycle_id}/envelope.yaml` is the wiring assumption. Confirm `hive/lib/metrics/` core functions (`create_envelope`, `read_envelope`, `update_envelope`) resolve this path consistently.

3. **Step-07 integration with envelope.** Confirm SKILL.md and step-07-promotion.md agree on how `rollback_target` from DirectCommitAdapter flows to `envelope.set_rollback_ref()`. The BL2.2 review flagged this as "implicit name-translation"; BL2.3 should make it explicit.

4. **`commit: TBD` rejection surface.** Step-08 validation raises `CloseValidationError` subtypes, which are caught and logged as `close_rejected`. Verify error messages are user-clear and appear in morning summary so failures are visible.

5. **Metrics substrate completeness.** `hive/lib/metrics/` exports `create_envelope`, `read_envelope`, `update_envelope` per envelope.py wrapping. Verify these are stable and `read_run_events()` is implemented (used by baseline.py).

---

**Brief authored:** 2026-04-22  
**Source documents:** BL2.3 story spec, BL2.2 SKILL.md, step files, L1.3/L1.4/L1.7 shared library, B0 consumer contract, cycle-state escalation closure-evidence-shape-mismatch.
