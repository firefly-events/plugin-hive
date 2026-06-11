# Insights — sdr-8 run-state archival sweep

- **`cancelled` is not a `RunStatus` member.** The archival terminal set
  (design-decisions) is `{completed, failed, cancelled}` but the schema enum
  only has RUNNING/COMPLETED/FAILED/SUSPENDED, and `store.load()` does
  `RunStatus(payload["status"])` — it raises on `cancelled`. The sweep
  therefore reads run_state.yaml raw via `yaml.safe_load` instead of
  `store.load()`. Anyone adding a cancel path later must either extend the
  enum or keep raw-YAML consumers in mind.
- **Eager `__init__` re-export of a `-m`-runnable module trips runpy.**
  Importing `archive` eagerly in `run_state/__init__.py` made
  `python -m hive.lib.dag_executor.run_state.archive` emit the
  "found in sys.modules after import of package" RuntimeWarning. Fixed with
  a module-level `__getattr__` lazy export; same pattern applies to any
  future package member that doubles as a CLI entry.
- **Repo scheduler convention is Multica autopilots**, not CronCreate/`/loop`
  (`hive/references/multica-autopilots-schema.md`). `.pHive/multica/autopilots.yaml`
  did not exist before this story — it was created here with the weekly
  archival entry (`kind: schedule`, 5-field UTC cron). Future scheduled
  tasks should append to that file, not invent a parallel mechanism.
- **Idempotency needs a dest-collision rule, not just "source gone".** A run
  re-created with an already-archived run_id would otherwise shutil.move
  into a nested duplicate. The sweep skips when `<archive_dest>/<run-id>`
  exists and reports the skip reason.
- **Age reference is `last_updated_at` from YAML with mtime fallback** —
  a `now` kwarg on `archive_terminal_runs` keeps tests wall-clock-free
  (repo policy elsewhere also bans Date.now-style nondeterminism).
