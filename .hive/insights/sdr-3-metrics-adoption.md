# sdr-3 metrics adoption — insights

- `hive/lib/budget-gate.js` was silently broken as a script entry before this
  story: it was CJS inside the `hive/lib` package scope, which sdr-1 flipped to
  `"type": "module"`. `node hive/lib/budget-gate.js` (the hive-worker.yml gate
  step) died with `ReferenceError: require is not defined` — the third file hit
  by this latent break (config.js in sdr-1, session-registry/episode-writer in
  sdr-2). Any remaining CJS `.js` file under `hive/lib/` should be assumed
  broken as an entrypoint until proven otherwise.

- ESM run-as-main guard gotcha: `path.resolve(process.argv[1]) ===
  fileURLToPath(import.meta.url)` misfires when a *test harness* runs
  `node -e "import(...)" <module-path>` — argv[1] is then the module path and
  the guard executes main. Pass the module path as argv[2]+ in such harnesses
  (see tests/test_metrics_state_dir_adoption.py).

- The Python metrics default was pinned to the *plugin repo* root
  (`Path(__file__).parents[2]/.pHive/metrics`), not cwd — so when Hive runs as
  an installed plugin against a target project, Python readers scanned the
  plugin checkout while shell hooks wrote to the project. The resolver swap to
  cwd-based is a behavior change for any caller that ran from outside the
  project root and accidentally relied on repo-pinning; nothing in-tree did
  (all callers either set METRICS_ROOT or run from project cwd).

- `scripts/tests/kg-bootstrap-from-projects.test.mjs` --apply tests fail on a
  machine where root `npm install` has been run: the test stubs
  `node_modules/better-sqlite3` inside its fixture, but the script resolves the
  REAL better-sqlite3 from the repo root, opens the fixture's empty kg.sqlite,
  and dies on the idx_unique_triple guard. Pre-existing (fails on pristine
  HEAD too); not introduced by sdr-3.

- Classification call: both `scripts/kg-bootstrap-from-projects.js` and
  `scripts/kg-import-cycle-state.js` are maintainer-only (no hooks/skills/
  workflow callers) and read *other projects'* `.pHive/cycle-state` via a
  registry that only stores `path`+`name` — per-project state-dir resolution
  is unknowable there without parsing each project's hive.config.yaml. They
  stay literal per design-decisions Q3; `--cycle-state-dir` remains the
  escape hatch for relocated projects.
