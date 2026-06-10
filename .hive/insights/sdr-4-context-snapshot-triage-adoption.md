# sdr-4 — context snapshot + triage state-dir adoption

- `composeContextSnapshot`'s `stateDir` option is misnamed: it has always been
  the **repo root** (the composer appended `.pHive` itself). Renaming it would
  ripple through tests and docs, so adoption kept the name and swapped the
  hard-coded join for `resolveStateDir({ cwd: stateDir })` — same default,
  resolver tiers now honored. If a future story renames it, sweep
  `tests/lib/context-snapshot.test.mjs` and `skills/context-snapshot/SKILL.md`
  together.
- `skills/triage/run.mjs` resolves `QUEUE_DIR` at module load (top-level
  const). That's safe only because each CLI invocation is a fresh process;
  don't import it as a library expecting per-call resolution. The
  `HIVE_TRIAGE_QUEUE_DIR` test-isolation override deliberately stays **ahead**
  of the resolver — existing tests in `tests/skills/triage-json.test.mjs`
  depend on it, and it predates sdr-1.
- Skill runners resolve with `cwd: REPO_ROOT` (plugin repo), so the
  config-file tier only sees `<plugin-repo>/hive.config.yaml`. Relocation for
  a target project flows through the env tiers (`HIVE_STATE_DIR`,
  `CONFIG_FILE`, `HIVE_ROOT`) — tests for runner relocation must set env, not
  drop a config in cwd.
- Fresh checkouts fail `tests/hive-lib/state-dir-adoption.test.mjs` with
  "js-yaml not available" until `npm install` runs — that's missing
  node_modules, not a regression. Check deps before chasing phantom failures.
