# b2-fk-enforcement-audit — insights

- `INSERT OR IGNORE` does NOT swallow FK violations. SQLite's ON CONFLICT
  resolution explicitly excludes FOREIGN KEY constraints, so once
  `PRAGMA foreign_keys = ON` is set, an undeclared-predicate emit raises
  `sqlite3.IntegrityError` even through `OR IGNORE`. This is what makes the
  enforcement actually bite for `emit_kg_event` — no code-path change needed.
- `PRAGMA foreign_keys` is a no-op inside an open transaction. It must be the
  first statement after connect. Python's `with sqlite3.connect(...)` is safe:
  the context manager only commits at exit, it does not BEGIN at entry, so a
  PRAGMA issued first still takes effect.
- Behavior change to know about: `emit_kg_event` only catches
  `sqlite3.OperationalError` ("no such table" soft-fail). `IntegrityError` now
  propagates to callers — intended (the bug this story closes was silent
  acceptance of undeclared predicates like `phase_handoff`), but any future
  caller adding new lifecycle predicates must first add them to the
  `predicates` table (kickoff bootstrap DDL).
- `emit_superseded` catches bare `Exception` and returns `emitted: False` —
  undeclared-predicate writes there fail soft, not loud. Asymmetric with
  `emit_kg_event`; flagged, not changed (out of story scope).
- Audit results for files that needed NO patch:
  - `hive/lib/dag_executor/executor/walker.py` opens no connection — all KG
    writes go through `hive.lib.kg_emit`.
  - `scripts/kg-bootstrap-from-projects.js` opens no connection — it spawns
    `kg-import-cycle-state.js`, which was patched (`db.pragma(...)`).
  - `hive/lib/skill_candidate_mine.py` opens kg.sqlite read-only
    (`?mode=ro`) — FK enforcement is write-time only, left untouched.
- `hive/lib/session-end.js` (Node bridge kgWrite/kgSupersede) writes to
  kg.sqlite too — patched both sites even though the story's file list missed
  it, since acceptance criterion 1 covers "every connection on kg.sqlite".
  It already had app-level predicate validation in kgWrite; the PRAGMA adds
  DB-level backstop and covers kgSupersede which had none.
- Mock gotcha: `scripts/tests/kg-bootstrap-from-projects.test.mjs` ships a
  hand-rolled better-sqlite3 stub. Adding any new Database method call in
  production code (`db.pragma`) breaks the stub with
  `TypeError: db.pragma is not a function` — extend the mock when touching
  better-sqlite3 call surfaces.
- The lint test (`tests/test_kg_fk_enforcement.py::test_lint_kg_connect_sites_enable_foreign_keys`)
  greps audited surfaces for connect-without-PRAGMA within a 10-line window.
  New kg.sqlite connect sites in `hive/lib/kg_*`, `kg_signal/`, `dag_executor/
  executor/`, `scripts/kg-*.js`, or `session-end.js` will fail it until they
  set the PRAGMA.
