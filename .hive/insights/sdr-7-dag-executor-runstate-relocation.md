# sdr-7 — DAG executor run-state relocation insights

- **Anchor matters, not just precedence.** `resolve_state_dir` resolves relative
  state dirs under `cwd` — but the DAG isolation surfaces are repo-anchored, not
  cwd-anchored. `WorktreeManager` resolves with `cwd=repo_path` and
  `decide_run_worktree` with `cwd=main_repo` (the resolved MAIN repo, since cwd
  may be *inside* a worktree). Passing bare `Path.cwd()` there would silently
  split worktree paths from run-state paths when invoked from a subdirectory or
  nested worktree.

- **`default_runs_root()` lives in `run_state/store.py`, imported by
  isolation/pause.** Safe because `run_state/__init__` only imports its own
  submodules — no executor/isolation imports, so no cycle. Anyone adding
  executor imports to `run_state/__init__` will create one.

- **WorktreeManager freezes its default at `__init__`, store resolves per
  call.** Deliberate: walker reads `worktree_manager.runs_root` and threads it
  into `decide_run_worktree`, so the attribute must hold a concrete path. The
  resolver returns absolute paths, so `_path_for`'s absolute branch handles it;
  injected *relative* roots keep the old repo-relative join behavior.

- **`resume_run` cannot resume SUSPENDED runs** — it raises
  ResumeFromInvalidStateError pointing at the hde-8 pause path. Durability of
  suspend/resume under relocation is proven via `mark_suspended` →
  `load` → `unfreeze_for_resume` → `save` directly; don't reach for `resume_run`
  in tests of suspended runs.

- **Q1 decoy tests are the load-bearing negative coverage.** Asserting the lock
  constants equal `.pHive/...` is weak; the real proof writes a *decoy*
  hive.config.yaml / graduation registry at the relocated state dir and asserts
  it is ignored while the fixed `.pHive` copy wins.

- **20 pre-existing failures on the epic branch** (`test_metric_signal_routing_real`,
  `test_parity_per_workflow`, pause-migration timeouts, etc.) — environment/
  baseline issues, identical before and after this change (verified via stash
  diff of failure sets). Don't burn time re-investigating them per story.
