# Insights — s4-superseded-callers-wire

## The audit count was 0 for a structural reason, not a prompt-compliance one

The session-end supersede path could never have produced a triple: every plain
`.js` CJS file in `hive/lib/` has been un-loadable since `hive/lib/package.json`
gained `"type": "module"` (commit 3d9a902, mode-resolver story). `require()` or
`import` of `session-end.js`, `kg-emit.js`, or `chromadb-wrapper.js` threw
`ReferenceError: require is not defined in ES module scope` on every node
version. Both JS test suites in `hive/tests/lib/` were failing 18/18 on the
epic branch baseline — nobody noticed because nothing in CI runs them. If you
touch a CJS file under `hive/lib/`, smoke-load it first
(`node -e "import('<abs path>').then(...)"`); ~16 other CJS files there
(messages-session.js, sandcastle-*.js, session-*.js …) are still latent-broken
and will need the same ESM conversion (`config.js` is the established
precedent — convert, don't rename to `.cjs`, so doc paths stay stable).

## js-yaml 4's safeLoad is a throwing stub, not absent

`typeof yaml.safeLoad === 'function'` is TRUE on js-yaml 4 — the residual
export exists solely to throw "Function yaml.safeLoad is removed in js-yaml 4".
The feature-detect in `config.js` (`safeLoad ?? load`) therefore selected the
stub and crashed on any YAML config read. Detect the other way around: prefer
`yaml.load` (safe by default on v4), fall back to `safeLoad` only if `load` is
missing. `hive/lib/logo-exploration-validator.js:179` has the same inverted
check and will crash the first time it parses YAML — left untouched (out of
story scope), worth its own fix.

## ESM test seams: cache-busted imports + injection, not monkey-patching

The old CJS tests patched `sessionEnd.kgWrite = stub` after requiring the
module and relied on `require.cache` eviction for per-test module state. ESM
namespaces are frozen and the import cache is not evictable. Pattern that
replaced it (now in both `hive/tests/lib/` suites):
- fresh module-load state per test: `import(fileURL + '?case=' + n)`
- stubbing: an explicit `_setKgDepsForTest({kgWrite, kgSupersede})` seam in
  `kg-emit.js` (mutable `deps` object consulted at call time)
- `fs.existsSync/readFileSync` patching from CJS tests still works against ESM
  modules because `import fs from 'node:fs'` yields the same mutable object.

## kgSupersede divergence: edge insert must be unconditional

JS `kgSupersede` only inserted the `superseded` provenance edge when the prior
triple existed (`updated > 0`); Python `emit_superseded` inserts it always.
Production reality is the prior-absent case — story-spec/proposal/memory
triples were never first-write-recorded (those predicates are not even in
`SEED_PREDICATES`), so the JS path could never satisfy the
`COUNT(*) WHERE predicate='superseded' > 0` audit. When two runtimes share a
contract doc (`hive/references/kg-emit.md`), diff their behavior on the
*absent* path, not just the happy path.

## Remaining known gap (deliberately out of scope)

`python3 -m hive.lib.kg_emit_cli` in skill markdown assumes CWD is the plugin
root (hive package importable). /plan runs in the user's project dir, so every
prompt-driven emit in `skills/plan/SKILL.md` (not just supersede) shares this
assumption. If emits are still missing in production after this story, that
CWD/PYTHONPATH seam is the next place to look — fixing it belongs to a story
that touches all emit sites at once.
