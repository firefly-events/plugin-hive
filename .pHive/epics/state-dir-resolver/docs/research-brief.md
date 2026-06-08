# State Dir Resolver Research Brief

## Summary

The `paths.state_dir` relocation requirement is broader than the earlier "~26" estimate: the scoped inventory found ~349 code/config/runtime line-hit sites, 219 test/fixture sites, 924 prose/doc sites, and 41 production runtime actionable clusters in `.pHive/epics/state-dir-resolver/research/raw-findings.md`.
The core problem is that only shell hooks have a complete config-first state-dir resolver today; JS, Python, runner prose, tests, and several subsystem-specific defaults still read or write `.pHive` directly or rely on partial injection.

## Current state

`hooks/common.sh` contains the only complete resolver found.
`_resolve_state_dir()` reads `paths.state_dir` from the root `hive.config.yaml`, defaults to `.pHive`, and canonicalizes relative values through `_resolve_target_project()` so relative state dirs anchor under the configured target project or cwd.
The metrics hooks and interrupt hook already consume this shell resolver:

- `hooks/metrics-agent-spawn.sh`
- `hooks/metrics-execute-boundaries.sh`
- `hooks/metrics-human-escalation.sh`
- `hooks/metrics-stop-dispatch.sh`
- `hooks/metrics-token-capture.sh`
- `hooks/stop-interrupt-capture.sh`

The equivalent shared JS and Python resolver does not exist.
`hive/lib/config.js` and `hive/lib/config.py` can parse YAML/JSON config files, but their shared consumers only expose `emit_lifecycle_at`; neither module exposes `paths.state_dir`.
`hive/lib/git_flow.mjs` provides a Node-side precedent for root-first config precedence, but the state-dir path itself is not resolved there.

The current codebase therefore uses partial and inconsistent patterns:

- Env-only `HIVE_STATE_DIR` handling appears in `hive/lib/external/github-issues-adapter.js` and `hive/lib/release_post.mjs`.
- Caller-injected `state_dir` appears in `hive/lib/handoff/dispatch.mjs`, `hive/lib/task-tracking-dispatch/index.ts`, and `hive/lib/skill_candidate_mine.py`.
- Direct literal joins remain in modules such as `hive/lib/story-status.mjs`, `hive/lib/session-registry.js`, `hive/lib/session-episode-writer.js`, `hive/lib/context-snapshot.mjs`, and `skills/triage/run.mjs`.
- Python helpers such as `hive/lib/metrics/paths.py`, `hive/lib/kg_metrics_writer.py`, and `hive/lib/meta-experiment/direct_commit_adapter.py` default directly to `.pHive` or `.pHive/...`.
- Some `.pHive` references are semantic locks or migration/default references rather than obvious runtime state lookups, especially in DAG executor opt-in paths and migration scripts.

## The four consumption surfaces

### Node `.mjs` / `.js`

Node code can already parse config through `hive/lib/config.js`, but the shared config reader currently exposes only `emit_lifecycle_at`.
Some Node modules take injected state-dir values from callers or dependencies, while others inspect `process.env.HIVE_STATE_DIR`, and many still join `process.cwd()` or repo roots with `.pHive`.
This makes a single shell resolver insufficient for Node consumers unless its result is injected everywhere or a Node-native resolver is added.

Key Node examples from the raw findings:

- `hive/lib/external/github-issues-adapter.js` uses `_deps.stateDir || process.env.HIVE_STATE_DIR || ".pHive"`.
- `hive/lib/release_post.mjs` uses `process.env.HIVE_STATE_DIR || ".pHive"`.
- `hive/lib/handoff/dispatch.mjs` accepts `state_dir` but defaults to `.pHive`.
- `hive/lib/task-tracking-dispatch/index.ts` uses `this.config?.state_dir ?? ".pHive"`.
- `hive/lib/story-status.mjs`, `hive/lib/session-registry.js`, `hive/lib/session-episode-writer.js`, `hive/lib/scenarios/load.mjs`, and `hive/scripts/multica-reverse-sync.mjs` use direct `.pHive` path joins.

### Python `.py`

Python code can parse config through `hive/lib/config.py`, but that module also only exposes `emit_lifecycle_at`.
Python state consumers currently rely on literal defaults, environment-specific overrides, or caller injection rather than a shared config-first resolver.
This is a separate resolver surface because Python cannot reuse the shell helper directly without process/env handoff.

Key Python examples from the raw findings:

- `hive/lib/skill_candidate_mine.py` defaults `DEFAULT_STATE_DIR = Path(".pHive")` while allowing a caller-provided `state_dir`.
- `hive/lib/metrics/paths.py` defaults metrics to `PROJECT_ROOT / ".pHive" / "metrics"` and only `METRICS_ROOT` can override.
- `hive/lib/kg_metrics_writer.py` defaults to `Path(".pHive") / "metrics" / "kg"`.
- `hive/lib/dag_executor/*` hardcodes `.pHive` for opt-in config, runtime registry, runs roots, worktree nesting, and pause/run-state paths.

### Shell hooks

Shell is the best-covered surface today.
`hooks/common.sh` reads the root config via `_read_paths_config`, resolves `paths.target_project`, and provides `_resolve_state_dir`.
Existing metrics and interrupt hooks source this file and already write under the resolved state directory.

The remaining shell-specific issue is not absence of a resolver but semantic coverage.
`hooks/check-agent-misuse.sh` has a regex that recognizes only default `.pHive` and legacy `state` story paths; this may be intentionally default/legacy-aware, but it will miss arbitrary relocated state dirs.

### Skill prose

Skill and workflow prose is not runtime code, but the raw findings flag it as behaviorally relevant because agents execute those instructions.
Some skills already use `${HIVE_STATE_DIR}` and explain config-first root resolution, especially `skills/execute/SKILL.md` and `skills/ship/SKILL.md`.
Many other skills, references, and workflow steps still instruct reads, writes, `mkdir`, or `cp` operations under `.pHive/...`.

This is a separate consumption surface because no resolver function can automatically rewrite agent instructions.
Planner decisions must decide whether prose should be globally converted to `${HIVE_STATE_DIR}` placeholders, limited to executable SKILL.md instructions, or documented as default-location examples.

## Actionable clusters

The 41 runtime clusters fall into these subsystems:

### Hooks

Shell metrics and interrupt hooks are already wired through `_resolve_state_dir()` and represent the working pattern for config-first resolution.
The main hook-side exception is `hooks/check-agent-misuse.sh`, whose story-path regex recognizes `.pHive` and legacy `state` only.
This cluster is lower implementation risk than other surfaces because the resolver exists, but the semantic guard still needs a decision for relocated state dirs.

### DAG executor

The DAG executor has multiple `.pHive` locks that may be intentional consumer-side contracts rather than straightforward relocation bugs.
`hive/lib/dag_executor/__init__.py` hardcodes `.pHive/hive.config.yaml` and `.pHive/runtime/executor-graduated-workflows.yaml`; docs and CI comments describe these as consumer opt-in and graduation registry locations.
Executor run-state surfaces also default under `.pHive/runs` and `.pHive/meta-team/worktrees`, including pause handlers, worktree isolation, nesting, and run-state store modules.
Because the docs intentionally name these paths, the executor cluster should not be mechanically rewritten without resolving the open opt-in-location question.

### Story status and session state

Story/session modules are direct runtime readers/writers of the core state tree and are high-risk relocation leaks.
`hive/lib/story-status.mjs` finds a repo root by `.pHive` presence and reads `.pHive/epics` and `.pHive/episodes`.
`hive/lib/session-registry.js` writes `.pHive/sessions/index.yaml`, `hive/lib/session-episode-writer.js` writes `.pHive/episodes`, and `hive/lib/multica-issue-closer.mjs` reads episode markers under `.pHive/episodes`.
These modules need either shared Node resolution or consistently injected resolved paths.

### Metrics

Metrics are split across working shell resolver consumers and non-shell literal defaults.
The metrics hooks use `_resolve_state_dir()`, but `hive/lib/budget-gate.js`, `hive/lib/metrics/paths.py`, `hive/lib/kg_metrics_writer.py`, `scripts/kg-bootstrap-from-projects.js`, and `scripts/kg-import-cycle-state.js` still default directly to `.pHive`-shaped metrics or cycle-state paths.
This creates cross-runtime divergence where hook-emitted metrics may move while readers or importers still scan default locations.

### Context snapshot and triage

Context snapshot and triage are user-facing state readers/writers with direct `.pHive` defaults.
`hive/lib/context-snapshot.mjs` composes snapshots by joining an input `stateDir` with `.pHive`, while `skills/context-snapshot/run.mjs` passes `join(REPO_ROOT, ".pHive")`.
`skills/triage/run.mjs` defaults queue output to `join(REPO_ROOT, ".pHive", "triage")`.
The prose for these skills also names `.pHive`, so this cluster spans both runtime and agent-instruction surfaces.

### Task tracking, release, and handoff

This cluster has partial seams rather than pure hardcodes.
`hive/lib/task-tracking-dispatch/index.ts` uses `config.state_dir` when injected and otherwise defaults `.pHive`.
`hive/lib/handoff/dispatch.mjs` accepts a `state_dir` option and otherwise defaults `.pHive`.
`hive/lib/release_post.mjs` honors `HIVE_STATE_DIR` but does not read config itself.
These modules can likely be fixed through resolver adoption at call sites or shared config injection, but they currently do not guarantee config-first behavior independently.

### Scenarios, audits, reverse sync, and maintainer scripts

Scenario loading, status backfill, reverse sync, audit scripts, and maintainer proof scripts contain direct `.pHive` paths.
The raw findings identify `hive/lib/scenarios/load.mjs`, `hive/scripts/story-status-backfill.mjs`, `hive/scripts/audit-episode-markers.mjs`, `hive/scripts/multica-reverse-sync.mjs`, `hive/scripts/gate-mode-audit.mjs`, `scripts/run_first_live_cycle.py`, and `scripts/run_rollback_realism_proof.py`.
Some may be runtime relocation consumers, while maintainer-only proof scripts and migration scripts are exception candidates.
`scripts/migrate-state-to-pHive.sh` intentionally names `.pHive` as the migration target and should probably remain literal.

## Open questions

- Should `.pHive/hive.config.yaml` for DAG executor remain a fixed consumer opt-in location, or should it move under resolved paths.state_dir? Current docs intentionally name `.pHive`.
- Should HIVE_STATE_DIR env override config, mirror config, or only be an injected compatibility variable? Current sources disagree.
- Should tracked tests and migration/proof scripts be changed in the same epic, or should they remain default-state fixtures?
- Should markdown workflow/prose paths move to HIVE_STATE_DIR placeholders globally, or only in SKILL.md files that directly instruct agents to write state?

## inconsistency_risk_signals

- Signal: env-var vs config precedence | Where: hive/lib/release_post.mjs:24 and hooks/common.sh:129 | Detail: JS uses HIVE_STATE_DIR first while shell resolver ignores it and reads paths.state_dir.
- Signal: consumer flag location tension | Where: hive/lib/dag_executor/__init__.py:30-31 | Detail: executor config/registry are hardcoded to `.pHive` despite paths.state_dir relocation promise.
- Signal: semantic-vs-default ambiguity | Where: scripts/migrate-state-to-pHive.sh and skills/hive/skills/register-project/register-project.mjs:88-99 | Detail: some `.pHive` references may mean the default product name, not the resolved state dir.
- Signal: prose can execute | Where: skills/test/SKILL.md and hive/workflows/steps/test-swarm/step-03-worker.md | Detail: markdown instructions tell agents to mkdir/cp/write .pHive paths, so treating prose as non-runtime may still leak behavior.
- Signal: root-first wording mismatch | Where: skills/execute/SKILL.md:14 vs hive/references/configuration.md:14 | Detail: execute says shipped baseline does not drive runtime path decisions for state_dir, while general config docs describe fall-through for missing keys.

## Constraints & risks

Root-first config precedence is a hard constraint.
The raw findings cite `hive/references/configuration.md` and `hive/lib/git_flow.mjs` for the rule that root `hive.config.yaml` is the consumer source of truth, while shipped `hive/hive.config.yaml` is baseline/schema and should not drive runtime state-dir decisions.

Intentional semantic `.pHive` locks must be separated from relocation bugs.
DAG executor opt-in paths, migration scripts, protected-path guards, and project registration checks may refer to `.pHive` as a named product/default/consumer contract rather than a relocatable state lookup.
These need explicit decisions before mechanical replacement.

Prose-that-executes can leak relocated-state behavior even after code is fixed.
The raw findings count 924 prose/doc hits, and specific SKILL.md/workflow instructions tell agents to create, copy, read, or write `.pHive` paths.
At minimum, executable skill prose needs a consistent placeholder policy.

Test-regression risk is high.
The inventory found 219 test/fixture hits, including context snapshot tests, metrics shell tests, DAG executor tests, and reverse-sync/status tests.
Existing tests may continue to pass against default `.pHive` while relocation remains broken unless relocated-state cases are added.
