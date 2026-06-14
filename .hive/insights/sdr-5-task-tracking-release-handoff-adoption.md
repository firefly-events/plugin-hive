# sdr-5 — task tracking / release / handoff resolver adoption

- **`hive/lib/external/github-issues-adapter.js` was unloadable at baseline.**
  `hive/lib/package.json` declares `"type": "module"`, which silently put the
  CJS adapter into ESM scope — every `require()` of it threw
  `require is not defined in ES module scope`, so all 12 of its tests failed
  before this story touched anything. Fixed with a one-line
  `hive/lib/external/package.json` (`"type": "commonjs"`) scope marker. Lesson:
  when flipping a package scope to ESM, grep that scope for `require(` first;
  CJS files under it break only at load time, and only if something runs them.

- **Resolver output is absolute; some call sites contractually need relative.**
  `resolveStateDir()` canonicalizes to an absolute path. The github adapter's
  story paths and release_post's `sourcePath` trace strings have always been
  cwd/repo-relative — tests and `_deps` fs mocks compare on the relative form,
  and absolute paths leak machine paths into release artifacts. Pattern used:
  resolve absolute for fs access, then `path.relative(realpath(base), resolved)`
  for the human/contract-facing form (realpath the base, or macOS
  `/var → /private/var` symlinks corrupt the relative path). Default stays
  byte-identical to the old `.pHive` literal.

- **Lazy default-param is the cheapest injection-preserving seam.**
  `dispatchHandoff({ state_dir = resolveStateDir() })` only runs the resolver
  when the caller passes nothing — explicit test/CLI injection short-circuits
  it with zero extra code. Same shape as `this.config?.state_dir ?? resolveStateDir()`
  in the TS dispatcher.

- **Hermetic handoff tests via a fake `claude` on PATH.** `dispatchHandoff`
  spawns `claude --print …` with `spawnSync` (inherits `process.env.PATH`), so
  a 2-line shell script named `claude` prepended to PATH makes the full
  evidence-write path testable in ~150 ms per case, no network/CLI needed.

- **CJS→ESM config bridge:** the adapter reaches the ESM `config.js` via
  `require('../config.js')` — works on Node ≥ 22.12 (require(esm)); the
  try/catch falls back to legacy env-or-default on older Nodes, mirroring the
  documented `handoff/dispatch.mjs` `_require` fallback.
