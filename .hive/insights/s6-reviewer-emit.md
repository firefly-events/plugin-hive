# s6-reviewer-emit — insights

- **Verdict vocabulary mismatch is real and needs one canonical map.** The reviewer persona's rubric contract is strictly 3-value (`passed | needs_optimization | needs_revision`) while the KG `validated` object vocabulary mandated by the story is `approve | approve-with-changes | reject`. Resolved by a single projection map (`REVIEWER_VERDICT_TO_OBJECT` in `hive/lib/agent_shutdown_emits.py`) that both the persona doc and Python callers reference. s7/s8 should reuse the same pattern if `tested`/`implemented` objects diverge from their personas' native verdict words — do NOT invent a second mapping site.

- **"Exactly one emit" is enforced structurally, not by prompt discipline alone.** The KG's `INSERT OR IGNORE` + unique index on `(subject, predicate, object, source_epic)` absorbs replayed shutdowns, so a retried pre-shutdown sequence cannot double-count. Tests pin this (`test_replayed_shutdown_does_not_double_count`) rather than trusting the persona text.

- **Module reload pattern is mandatory in tests.** `kg_emit.py` caches `EMIT_LIFECYCLE_AT` at import time, so any test that sets `HIVE_CONFIG` must pop `hive.lib.config`, `hive.lib.kg_emit`, AND the new `hive.lib.agent_shutdown_emits` from `sys.modules` before importing — popping only the leaf module silently keeps the stale knob.

- **Silent-on-no-review is a return-value contract, not an exception.** Helper returns `{"emitted": False, "reason": ...}` for empty verdicts and out-of-vocabulary objects; never raises. Shutdown paths must not block on KG availability, matching `emit_kg_event` knob-off/missing-sqlite semantics.
