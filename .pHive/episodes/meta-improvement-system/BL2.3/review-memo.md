# BL2.3 Review Memo — Integrate baseline, metrics, compare, close validation

**Reviewer:** Opus 4.7
**Date:** 2026-04-22
**Story:** BL2.3

## Verdict

**needs_optimization** — The core library composition is sound and the four ACs are demonstrably exercised, but two ambiguities in the step-file narrative (step-06 envelope-write authority contradiction, and step-07 silence on the `rollback_target → rollback_ref` translation call) weaken the "live maintainer path can actually follow this prose" guarantee and will re-surface in BL2.4/BL2.5/S10.

## Per-dimension scores

| # | Dimension                                    | Score |
|---|----------------------------------------------|-------|
| 1 | Placeholder rejection correctness            | 4/5   |
| 2 | XOR invariant preservation                   | 5/5   |
| 3 | Step-file binding realism                    | 3/5   |
| 4 | Skill narrative cohesion                     | 4/5   |
| 5 | Test rigor                                   | 4/5   |
| 6 | Envelope evolution safety                    | 5/5   |
| 7 | Forward-compat for S10                       | 5/5   |
| 8 | Close-gate ordering (step-08)                | 5/5   |
| 9 | rollback_target vs rollback_ref translation  | 3/5   |

## Findings

### F1 — Step-06 authority-model contradiction (dim 3, MODERATE)
- `hive/workflows/steps/meta-team-cycle/step-06-evaluation.md:17-23` states the step's "sole persistent output is the `evaluation_results` JSON + `verdict` string... Do NOT write cycle-state, ledger, envelope, or metrics-carrier files inline from this step."
- But `step-06-evaluation.md:96-106` (§4, added by BL2.3) says: "Put that comparison dict into the envelope under `metrics_snapshot`."
- A narrative runner following this file will either (a) violate the authority model to satisfy §4, or (b) silently skip §4 to preserve the authority model, leaving `metrics_snapshot` unpopulated and failing the step-08 close gate.
- **Fix:** Either reword §4 to "emit `metrics_snapshot` as a *workflow output* consumed by step-08" (so step-08 is the writer), or narrow the authority-model line to explicitly carve out `metrics_snapshot` as the single legitimate envelope mutation from step-06.

### F2 — rollback_target → rollback_ref translation not wired into step-07 (dim 9, MODERATE)
- Research brief §6 (`BL2.3/research-brief.md:77-83`) explicitly recommended step-07 call `envelope.set_rollback_ref(cycle_id, promotion_result.rollback_target)` to make the translation unambiguous. Step-07-promotion.md was not updated — it never mentions `set_rollback_ref` or `set_commit_ref`.
- Worse, `step-07-promotion.md:17` states "No persistent cycle-state, ledger, or envelope writes happen inline from this step" — directly contradicting SKILL.md:116-117 which says to "capture `commit_ref` from the promotion evidence" and "translate the adapter's `rollback_target` into the envelope's `rollback_ref` field before step-08 close invocation."
- SKILL.md:117's translation note is clear in *intent* but still leaves unanswered: which step/agent actually invokes `envelope.set_rollback_ref(...)` / `envelope.set_commit_ref(...)`? If step-07 is output-graph-only and step-08's first action is `validate_closable(envelope)`, no step currently owns the envelope write.
- **Fix:** Either (a) add an explicit §6 to step-07-promotion.md that calls `envelope.set_commit_ref` and `envelope.set_rollback_ref` (and narrow the authority-model line to carve out these two evidence writes), or (b) move the writes into step-08's pre-`validate_closable` section. Option (a) matches BL2.1 research-brief:33 ("caller invokes `envelope.set_commit_ref(...)` and `envelope.set_rollback_ref(...)` after promote returns"). This unblocks BL2.4.

### F3 — Placeholder set leaks on whitespace / mixed case (dim 1, MINOR)
- `closure_validator.py:33` `_PLACEHOLDER_REFS = frozenset({"TBD", "tbd", "pending", "PENDING", "N/A", "n/a", "unknown", "UNKNOWN"})`.
- `_is_placeholder_ref` does `value in _PLACEHOLDER_REFS` — exact match only.
- Escapes: `" TBD"`, `"TBD "`, `"Tbd"`, `"Pending"`, `"tbd\n"`. These would pass validation as non-placeholder 3–5 char strings and later fail at `git rev-parse --verify` (which step-08 §1 still expects but `validate_closable` does not actually invoke).
- **Fix:** Normalize `value.strip().casefold()` before set lookup, or add regex-based placeholder detection. The set semantics should be case-insensitive since closure evidence is operator-typed in many paths.

### F4 — Missing on-disk envelope artifact test (dim 5, MINOR)
- AC2 requires "representative envelope and event records exist under `.pHive/metrics/`." Research brief §8 case 5 ("envelope_artifacts_on_disk") was not ported into `tests/meta_meta/test_live_cycle_integration.py`. `test_baseline_capture_and_persist_writes_metrics_snapshot` exercises `envelope.load` round-trip but does not assert `.pHive/metrics/{experiment_id}/envelope.yaml` exists.
- **Fix:** Add a one-liner `assert (metrics_root / ... / "envelope.yaml").is_file()` to one of the composed-path tests.

### F5 — Test comment acknowledges a wiring gap without opening a ticket (dim 5, MINOR)
- `tests/meta_meta/test_live_cycle_integration.py:163-166` comments "The envelope store's yamlish serializer does not accept raw lists, so we build the close envelope in memory from library outputs rather than round-tripping through set_metrics_snapshot for the compare verdict."
- This is a real limitation of the envelope persistence layer that will bite BL2.6 (the real proving cycle writes the compare verdict → envelope → step-08 reads it back). Flag to the BL2.6 backlog rather than leaving it only in a test comment.

## Optimization follow-ups (do before BL2.4)

1. Resolve F1 — step-06 authority-model contradiction (either reword §4 to "workflow output" or carve out `metrics_snapshot` from the no-write rule).
2. Resolve F2 — either wire `envelope.set_commit_ref` / `set_rollback_ref` into step-07 (preferred, matches BL2.1 brief) or move them to the top of step-08. The live path currently has no clear writer for these two fields.
3. Resolve F3 — case-insensitive + whitespace-tolerant placeholder rejection (`value.strip().casefold() in {...}`).

## Follow-ups (can land in BL2.4 or later)

4. Port research-brief §8 case 5 as a one-line artifact-on-disk assertion.
5. File a backlog note on the yamlish-serializer list limitation so BL2.6 does not rediscover it at cycle-run time.

## AC coverage summary

- AC1 ("baseline capture, metric emission, comparison, close validation in one flow") — covered by `test_full_composed_path_library_primitives_close_gate`. Passes. F1/F2 are readability / wiring risks for the *narrative* runner, not the library.
- AC2 ("envelope and event records exist under `.pHive/metrics/`") — partially covered (events.jsonl round-trip in `test_baseline_capture_and_persist_writes_metrics_snapshot`). Missing explicit envelope.yaml on-disk assertion (F4).
- AC3 ("fabricated `commit: TBD` close attempt rejected") — covered by `test_close_gate_rejects_fabricated_commit_TBD` + `_rejects_placeholder_pending` + `_rejects_placeholder_rollback_ref`. F3 whitespace escape is an edge case beyond AC3's literal requirement but worth closing.
- AC4 ("evidence remains explicit enough for future PR-only close records") — covered by `test_close_gate_accepts_pr_only_evidence_shape` + `test_close_gate_rejects_both_commit_and_pr_refs`. Strong.

## Escalation bearing

- `closure-evidence-shape-mismatch` (moderate) — PRESERVED. Validator accepts pr_ref path without coercing to commit_ref; S10 can proceed. PASSED.
- `rollback-realism-proof-ambiguity` (major, BL2.4/BL2.6) — PARTIALLY HELPED. `rollback_ref` is validated at close, but F2's unowned envelope write for `rollback_ref` means BL2.4 inherits the same "who writes this?" ambiguity. Fixing F2 in a BL2.3 optimization pass would de-risk BL2.4.

## Verdict rationale

`needs_optimization` rather than `passed` because F1 (step-06 contradiction) and F2 (step-07 silence on the field-translation call) introduce real ambiguity in the live narrative runner — the exact axis this story is supposed to eliminate. The shared library itself is correctly composed and 115 tests (10 integration + 41 meta_meta + 64 lib) are green. Optimization pass is bounded — 2 step-file edits + 1 closure_validator normalization — and unblocks BL2.4 cleanly.
