# H2 Investigation — Where do DAG walker KG emits actually land?

Story: `s2-dag-walker-emit-investigation` (PLU-86) · Epic: `kg-repair-activation`
Date: 2026-06-09 · Investigator: developer (Hive persona)
Live DB backup taken first: `/tmp/kg-sqlite-backup-1781064452.sqlite`

## Verdict: cause (a) — same DB, emits are functionally correct; the walker simply never runs in production flows

The emit pipeline (walker wrapper → `emit_kg_event` → INSERT into
`~/.claude/hive/kg.sqlite`) was instrumented and driven end-to-end. It works:
same DB path as the audited DB, knob enabled, INSERT commits, rows land with
`source_agent='dag-executor'`. The reason the audited DB has zero
`dag-executor` rows is **not** a different path (b) and **not** a silent drop
(c) — it is that the DAG walker's blocked/failed branches have never executed
against the live DB. Correction (s3 review): the walker IS
production-reachable — `hive/lib/dag_executor/__init__.py:185` imports
`Walker` and `:193` invokes `Walker().walk()` (the `run_workflow` production
entry from the hde-9a cutover), in addition to
`hive/lib/dag_executor/run_state/resume.py:38`. Emit rarity is because that
cutover is registry-gated (`runner_path == hive-dag`) and rarely enabled, and
the blocked/failed branches are themselves rare; production /plan + /execute
emits come from the orchestrator (all live `phase_blocked` rows have
`source_agent='orchestrator'`).

Note: the grill finding said "only 1 phase_blocked triple". The DB now has
**6** — all from `/plan` waiting-user-input gates (orchestrator), accumulated
since the audit. Still zero from `dag-executor`, consistent with (a).

## Evidence

### 1. Path resolution — single DB, same default (rules out b)

`hive/lib/kg_emit.py:58`:

```python
db_path = Path(os.environ.get("HIVE_KG_SQLITE_PATH", DEFAULT_KG_SQLITE_PATH))
```

with `DEFAULT_KG_SQLITE_PATH = Path.home() / ".claude" / "hive" / "kg.sqlite"`
(`kg_emit.py:17`). Resolution check with no env override:

```
default resolved path: /Users/don/.claude/hive/kg.sqlite | exists: True | knob: phase
```

Filesystem sweep (`~/.claude`, the repo, all worktrees, excluding
node_modules) found exactly **one** `kg.sqlite`: the default path. There is no
second DB the walker could be writing to.

### 2. Knob + schema state (rules out the knob/FK variants of c)

- `emit_lifecycle_at` resolves to `'phase'` (root `hive.config.yaml:36`;
  `read_emit_lifecycle_at()` in `hive/lib/config.py:76-96` returns it; the
  `'off'` short-circuit at `kg_emit.py:44` is NOT taken).
- `PRAGMA foreign_keys` = `0` on connections (sqlite default; per-connection
  pragma is never set — this is the b2 story). FK enforcement therefore cannot
  be blocking inserts. Both `phase_blocked` and `phase_failed` ARE declared in
  the `predicates` table anyway (so even b2's fix won't break these emits).
- `journal_mode` = `wal`.

### 3. Live DB contents (read-only, via the backup copy)

```
SELECT predicate, COUNT(*) FROM triples GROUP BY 1;
decided|80
phase_blocked|6
```

All 6 `phase_blocked` rows: `source_agent='orchestrator'`, objects like
`waiting-user-input-design-discussion` — /plan gate emits, none from the
walker. Zero `phase_failed` rows.

### 4. Instrumented walker run — emits land (proves the pipeline)

Temporary prints were added at `walker._emit_phase_blocked` /
`_emit_phase_failed` (`walker.py:1245`,`:1270`) and inside
`emit_kg_event` (`kg_emit.py:58-71`), then the walker's own pytest harness was
driven with `HIVE_KG_SQLITE_PATH=/tmp/kg-h2-test.sqlite` (a copy of the live
DB; the live DB was never written):

```
H2-INSTRUMENT walker._emit_phase_blocked node=a
H2-INSTRUMENT emit_kg_event: db_path=/tmp/kg-h2-test.sqlite exists=True predicate=phase_blocked subject=a knob=phase
H2-INSTRUMENT outcome=INSERT-committed total_changes=1
H2-INSTRUMENT walker phase_blocked result=True
H2-INSTRUMENT walker._emit_phase_failed node=a
H2-INSTRUMENT emit_kg_event: db_path=/tmp/kg-h2-test.sqlite exists=True predicate=phase_failed subject=a knob=phase
H2-INSTRUMENT outcome=INSERT-committed total_changes=1
H2-INSTRUMENT walker phase_failed result=True
3 passed in 0.07s
```

Post-run verification on the temp DB:

```
a|phase_blocked|trigger-rule-skip|unknown|dag-executor
a|phase_failed|boom|unknown|dag-executor
```

Tests driven: `test_skip_when_present_emits_node_skipped` (blocked branch,
walker.py:944-968 family), `test_required_step_failure_propagates`
(failed branch via `_record_failure`, walker.py:1191-1204),
`test_optional_step_failure_continues_walk` (optional failure — correctly
does NOT emit `phase_failed`; goes through `_record_optional_failure`,
walker.py:1178).

Instrumentation was fully reverted afterwards (`git diff` on both files
empty; zero `H2-INSTRUMENT` markers remain).

### 5. Latent silent-drop edges (real, but not the cause today)

These exist in code and were confirmed by instrumentation, but none is active
in the current environment:

- **DB-missing drop** (`kg_emit.py:59-60`): if the DB file doesn't exist,
  `emit_kg_event` returns `{"emitted": False}` silently. Confirmed live:

  ```
  H2-INSTRUMENT emit_kg_event: db_path=/tmp/does-not-exist.sqlite exists=False predicate=phase_failed subject=a
  H2-INSTRUMENT outcome=DROPPED-db-missing
  ```

  Matters for sandboxed/CI walker runs where `~/.claude/hive/kg.sqlite` is
  absent — emits vanish without trace. By design, but worth knowing.
- **Wrapper swallow** (`walker.py:1262-1267`, `:1287-1292`): any exception in
  the emit path is reduced to a DEBUG log. With default logging config that
  is invisible. Today nothing throws, so nothing is being swallowed.
- **`INSERT OR IGNORE` + unique index** (`idx_unique_triple` on
  `subject, predicate, object, source_epic`): repeated identical emits are
  deduped silently. Fine for lifecycle semantics, but means re-runs don't
  bump counts.

## For s3 (s3-phase-lifecycle-wire)

**Confirmation: s3 is additive-only — no repair scope.** The emit substrate
needs no fix for s3 to land triples; the existing `phase_blocked` /
`phase_failed` pattern is proven working end-to-end.

Concrete recommendation s3 should consume:

1. **Mirror the existing wrapper pattern exactly.** Add module-level
   `_emit_phase_started(node_id, source_epic)` and
   `_emit_phase_complete(node_id, source_epic)` next to `_emit_phase_blocked`
   (`walker.py:1245`) / `_emit_phase_failed` (`walker.py:1270`): lazy
   `from hive.lib.kg_emit import emit_kg_event, sanitize_obj` inside
   `try/except Exception` with a DEBUG-log fallback, `source_agent="dag-executor"`,
   `source_epic=source_epic or "unknown"`.
2. **Call sites:** `phase_started` at step entry — `_record_running`
   (`walker.py:1155`) is the single seam every dispatched node passes through
   (mirrors how `_record_failure`/`_record_skipped` host the existing emits);
   `phase_complete` at success exit — `_record_completion` (`walker.py:1163`).
   That keeps all four lifecycle emits in the `_record_*` layer rather than
   scattered through the walk loop. Handle the `state is None` branch the same
   way `_record_failure` does (emit first, then return).
3. **Predicates already declared:** `phase_started` and `phase_complete` exist
   in the `predicates` table — no schema change needed (and b2's FK
   enforcement, when it lands, will be satisfied).
4. **Volume note:** unlike blocked/failed, started/complete fire for EVERY
   node. The `idx_unique_triple` dedupe keys on
   `(subject, predicate, object, source_epic)`, so per-run objects (e.g. a
   run_id-bearing object) would grow the DB per run while a static object
   (e.g. the workflow/step slug) dedupes across runs. s3 should pick the
   object granularity deliberately — recommend a static slug
   (`sanitize_obj(node_id-or-step-kind)`) to start, consistent with
   `emit_lifecycle_at: phase`.
5. **AC3 ruling (orchestrator decision, recorded during s3 review):** blocked
   nodes are never dispatched, so emitting `phase_started` for them would be
   semantically false; AC3's parenthetical shows its intent is suppressing
   `phase_complete` on non-success paths. Ruling: blocked = `phase_blocked`
   only; failed = `phase_started` + `phase_failed` (no `phase_complete`).
6. **No test-pollution risk:** walker tests run with the default env; if CI
   has no `~/.claude/hive/kg.sqlite` the DB-missing guard makes emits no-op.
   For local dev runs, tests that exercise the walker will now write
   started/complete triples to the LIVE DB unless they set
   `HIVE_KG_SQLITE_PATH`. s3 should add a pytest fixture (autouse in the
   walker test modules) pointing `HIVE_KG_SQLITE_PATH` at a tmp_path DB —
   that gap exists today for blocked/failed too.

## Appendix — artifacts

- Live DB backup: `/tmp/kg-sqlite-backup-1781064452.sqlite` (taken before any
  query activity; live DB never written during this investigation).
- Instrumented scratch DB: `/tmp/kg-h2-test.sqlite` (disposable).
- A sqlite3-CLI quirk surfaced during the read-only audit: the `sqlite3` CLI
  in the harness could not open the live WAL-mode DB (`SQLITE_CANTOPEN`,
  error 14) even with `-readonly`, while Python's `sqlite3` opened
  `file:...?mode=ro` fine. Queries here were therefore run against the
  byte-identical backup. Worth remembering for s1-kg-stats (waived for this
  run): prefer Python `sqlite3` over the CLI for reading this DB.
