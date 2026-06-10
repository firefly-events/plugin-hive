# s7-tester-emit — insights

- The s6 helper (`hive/lib/agent_shutdown_emits.py`) deliberately left `tested`
  out of `ALLOWED_OBJECTS` for s7 to pin. Pinning it there (not in tester-side
  code) is what makes the closed vocabulary enforceable for every caller,
  including the raw `kg_emit_cli` path mirrored in the persona doc — there is
  no separate tester module to drift.
- Gotcha for s8 (`implemented`): the vocabulary check runs AFTER lowercasing
  but the reviewer-style verdict projection (`REVIEWER_VERDICT_TO_OBJECT`) is
  predicate-gated on `validated` only. Tester verdicts needed no projection
  (`pass|fail|inconclusive` is already the rubric vocabulary); if developer
  verdicts need mapping, add a per-predicate map, don't widen the reviewer one.
- `tested` rejects `passed` (past tense) — reviewer's map accepts `passed` →
  `approve`, so the two predicates intentionally differ on this token. Worth
  remembering when writing orchestrator-side glue: don't share a verdict
  normalizer across roles.
- Test isolation trick from s6 reused: pop `hive.lib.config` / `kg_emit` /
  `agent_shutdown_emits` from `sys.modules` before import so `HIVE_CONFIG`
  knob changes take effect per-test despite module-level config caching.
