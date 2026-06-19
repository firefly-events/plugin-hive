# Insights: al-2-forever-exclusions-guard

## Chroma detection is filesystem-probing, not glob-matching

The Chroma data exclusion can't be expressed as a simple glob because ChromaDB collection directories have opaque UUIDs as names. The only reliable signal is the presence of internal marker files (`chroma.sqlite3`, `data_level0.bin`, `header.bin`, etc.) in the directory tree. The matcher walks up from the candidate path to find these markers — an ancestor containing a marker means the candidate is inside a collection/index data tree.

The critical corollary: sidecar files (`chromadb.pid` etc.) must be checked by name *before* the ancestor walk, not after. If you check the ancestor walk first, a sidecar sitting in the same directory as a marker file gets hard-excluded even though the design says it's evictable.

## Boundary-safe prefix matching for relative paths

`str.startswith(".pHive/team-memories")` would falsely match `.pHive/team-memoriesx/`. Always append `os.sep` to the prefix when checking whether a path is a proper child:

```python
candidate_str.startswith(prefix + os.sep)
```

This is a one-liner gotcha that shows up in every tree-rooted exclusion rule.

## Two layers: filter + guard

The design uses two enforcement points:
1. `build_candidates` silently drops hard-excluded paths — nothing to act on.
2. `apply_guard` raises `HardExcludeError` at apply time — belt-and-suspenders for paths that bypass the planner.

Future stories that add new apply-mode code paths must call `apply_guard` before any destructive action, not just rely on `build_candidates` having filtered things earlier.

## Mocking `Path.home()` in tests

`Path.home()` is called deep inside the module. Patching `hive.lib.artifact_lifecycle.exclusions._home` (the module-level helper) is cleaner than patching `pathlib.Path.home` globally and avoids test isolation issues when tests run in parallel.
