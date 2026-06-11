# sdr-6 — scenarios, audits, reverse-sync resolver adoption

- **gate-mode-audit.mjs classified RUNTIME, not maintainer.** The deciding
  evidence was its consumers, not its location: `skills/plan/SKILL.md` and
  `skills/execute/SKILL.md` both point at it as the cross-run aggregator of
  stop-hook telemetry, and `hive/references/gate-lift-telemetry.md` names it
  as one of the two telemetry consumers. A script under `hive/scripts/` can
  be either; check who references it before classifying.

- **`story-status-backfill.mjs` pins REPO_ROOT to the script's own location**
  (`resolve(__dirname, '..', '..')`), so you cannot point it at a temp project
  root the way `audit-episode-markers.mjs [repo-root]` allows. The resolver's
  `CONFIG_FILE` env tier is the testing escape hatch: it relocates the config
  *file* lookup without touching the repo's real `hive.config.yaml`, letting
  the config-precedence permutation run hermetically.

- **Hermetic "default .pHive" permutation via `paths.target_project`.** A true
  no-config backfill run scans the live repo `.pHive` and costs ~45s (git
  `branch --merged` per story). Setting only `target_project` (state_dir left
  unset) re-bases the default `.pHive` name under a temp dir — same code path
  for the "unset → default" assertion, sub-second.

- **`node --test` baseline fails without `npm install`**: importing
  `story-status.mjs` (and anything touching `session-registry.js`) throws
  `js-yaml not available` at module load. If a state-dir suite fails with a
  top-level "test failed", run `npm install` before suspecting the diff.

- **Reverse-sync got an explicit `stateDir` option on `run()`** mirroring the
  sdr-5 seam convention (injection seam wins over resolver). Its internal
  helpers (`getStoryYamlPath`, `patchStoryYaml`, `getCurrentStoryStatus`) now
  take the state dir, not the repo root — the repo root is still needed
  separately only where git is involved (not here, unlike backfill).
