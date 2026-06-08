# State Dir Resolver Design Discussion

## 1. What Are We Doing?

The goal is to make `paths.state_dir` real end-to-end.

Right now the promise is bigger than the implementation. Setting `paths.state_dir` should relocate runtime state away from the default `.pHive` tree, but the research brief found that only shell hooks have a complete config-first resolver today.

Done means a project can set `paths.state_dir` in the root `hive.config.yaml` and all runtime state consumers use that resolved directory consistently across Node, Python, shell hooks, and executable agent instructions.

The important win is not just "some code accepts a state dir." The win is that story status, sessions, metrics, snapshots, triage queues, handoff, release posting, task tracking, scenarios, audits, and DAG executor state either move under the configured state dir or are explicitly documented as intentional fixed-location exceptions.

The original requirement was deferred from PR #8: wire `paths.state_dir` end-to-end with config-first, cwd-fallback behavior. The research brief confirms this is broader than the earlier estimate: 41 production runtime actionable clusters, plus 219 test/fixture hits and 924 prose/doc hits.

My proposed direction is a shared-resolver design with one resolver per runtime:

- Node resolver in `hive/lib/config.js`
- Python resolver in `hive/lib/config.py`
- Existing shell resolver in `hooks/common.sh` remains the reference contract

Then each runtime cluster adopts the native resolver instead of continuing to invent local `.pHive`, env-only, or caller-injected defaults.

I would also define a single `HIVE_STATE_DIR` rule. My recommendation is config-first by default, with `HIVE_STATE_DIR` as an explicit override when set by the caller or environment. That reconciles the current split where `release_post.mjs` treats env as authoritative but `hooks/common.sh` ignores env and reads config.

For prose, I would not globally rewrite every `.pHive` mention. I would convert executable `SKILL.md` and workflow instructions that tell agents to read, write, create, copy, or pass state paths. Illustrative docs and default-location examples can stay literal if they are clearly examples.

## 2. What I Found

The shell side already has the pattern I think the rest of the work should copy. `hooks/common.sh` exposes `_resolve_state_dir()` and `_resolve_target_project()`.

The resolver reads `paths.state_dir` from root `hive.config.yaml`, defaults to `.pHive`, and canonicalizes relative state dirs under the resolved target project or cwd. The metrics hooks and interrupt hook already consume this resolver:

- `hooks/metrics-agent-spawn.sh`
- `hooks/metrics-execute-boundaries.sh`
- `hooks/metrics-human-escalation.sh`
- `hooks/metrics-stop-dispatch.sh`
- `hooks/metrics-token-capture.sh`
- `hooks/stop-interrupt-capture.sh`

That is the strongest prior art because it is already doing the exact config-first/cwd-fallback behavior the requirement asks for.

The Node side has config parsing but no state-dir resolver. `hive/lib/config.js` can read YAML/JSON config and currently exposes `readEmitLifecycleAt`, but not `paths.state_dir`.

There is also a useful Node precedent in `hive/lib/git_flow.mjs`: root-first config precedence. The research brief calls this out with `hive/references/configuration.md` as a hard constraint: root `hive.config.yaml` is the consumer source of truth; shipped `hive/hive.config.yaml` is baseline/schema and should not drive runtime state-dir decisions.

Node state consumers are inconsistent:

- `hive/lib/external/github-issues-adapter.js` uses `_deps.stateDir || process.env.HIVE_STATE_DIR || ".pHive"`.
- `hive/lib/release_post.mjs` uses `process.env.HIVE_STATE_DIR || ".pHive"`.
- `hive/lib/handoff/dispatch.mjs` accepts `state_dir` but defaults to `.pHive`.
- `hive/lib/task-tracking-dispatch/index.ts` uses `this.config?.state_dir ?? ".pHive"`.
- `hive/lib/story-status.mjs`, `hive/lib/session-registry.js`, `hive/lib/session-episode-writer.js`, `hive/lib/scenarios/load.mjs`, and `hive/scripts/multica-reverse-sync.mjs` use direct `.pHive` joins.

The Python side has the same shape. `hive/lib/config.py` can parse config but only exposes the lifecycle helper. Python consumers default to `.pHive` or `.pHive/...` directly unless a caller happens to inject something else.

Key Python examples from the brief:

- `hive/lib/skill_candidate_mine.py` has `DEFAULT_STATE_DIR = Path(".pHive")`.
- `hive/lib/metrics/paths.py` defaults metrics to `PROJECT_ROOT / ".pHive" / "metrics"`.
- `hive/lib/kg_metrics_writer.py` defaults to `Path(".pHive") / "metrics" / "kg"`.
- `hive/lib/dag_executor/*` hardcodes `.pHive` for opt-in config, runtime registry, run state, worktree nesting, pause handling, and run roots.

The DAG executor is the cluster I would treat with the most caution. `hive/lib/dag_executor/__init__.py` hardcodes `.pHive/hive.config.yaml` and `.pHive/runtime/executor-graduated-workflows.yaml`, and CI comments describe those as consumer-side locks. That may be an intentional contract, not a missed resolver call.

Story/session state is the opposite: it looks like straightforward runtime state and should relocate. `hive/lib/story-status.mjs` probes for `.pHive`, then reads `.pHive/epics` and `.pHive/episodes`. `hive/lib/session-registry.js` writes `.pHive/sessions/index.yaml`. `hive/lib/session-episode-writer.js` writes `.pHive/episodes`. `hive/lib/multica-issue-closer.mjs` reads episode markers under `.pHive/episodes`.

Metrics are split. Shell metrics already use `_resolve_state_dir()`, but `hive/lib/budget-gate.js`, `hive/lib/metrics/paths.py`, `hive/lib/kg_metrics_writer.py`, `scripts/kg-bootstrap-from-projects.js`, and `scripts/kg-import-cycle-state.js` still default to `.pHive`-shaped paths. That can create a bug where writers move and readers keep scanning the old tree.

Context snapshot and triage also look like relocation leaks. `hive/lib/context-snapshot.mjs` composes state paths under `.pHive`, `skills/context-snapshot/run.mjs` passes `join(REPO_ROOT, ".pHive")`, and `skills/triage/run.mjs` defaults queue output under `.pHive/triage`.

Task tracking, release, and handoff are partial seams. They already have config/env/caller injection points, but none of them independently guarantee config-first resolution.

Prose matters because agents execute it. The research brief found 924 prose/doc hits, and specifically calls out `skills/test/SKILL.md` and `hive/workflows/steps/test-swarm/step-03-worker.md` as places where markdown instructions can cause agents to create or copy `.pHive` paths.

Some prose already models the target direction. `skills/execute/SKILL.md` and `skills/ship/SKILL.md` use `${HIVE_STATE_DIR}` and explain config-first root resolution. I would reuse that convention for executable instructions.

## 3. My Proposed Approach

I would start by making the resolver contract explicit in the shared config libraries.

In `hive/lib/config.js`, add a `paths.state_dir` resolver that mirrors `hooks/common.sh`:

- Read root `hive.config.yaml`.
- Pull `paths.state_dir`, defaulting to `.pHive`.
- Resolve `paths.target_project` using the same target-project/cwd semantics as `_resolve_target_project()`.
- Canonicalize relative `paths.state_dir` under the resolved target project or cwd.
- Return an absolute or canonical path shape that Node call sites can pass around without re-resolving.

In `hive/lib/config.py`, add the equivalent resolver with the same contract:

- Read the same root config.
- Default to `.pHive`.
- Anchor relative state dirs the same way.
- Make the Python function name and behavior intentionally parallel to Node.

I would treat `hooks/common.sh` as the reference, not as something to rewrite first. Shell already works for metrics and interrupt capture. The shell follow-up is mostly semantic coverage, especially `hooks/check-agent-misuse.sh`.

Next I would adopt the resolver by subsystem instead of doing a blind search-and-replace.

For story status and session state, I would wire the Node resolver into:

- `hive/lib/story-status.mjs`
- `hive/lib/session-registry.js`
- `hive/lib/session-episode-writer.js`
- `hive/lib/multica-issue-closer.mjs`

This is high-value because these modules read/write core state under `epics`, `episodes`, and `sessions`.

For metrics, I would align readers and writers:

- Keep shell hook writers on `_resolve_state_dir()`.
- Move `hive/lib/budget-gate.js` to the Node resolver.
- Move `hive/lib/metrics/paths.py` and `hive/lib/kg_metrics_writer.py` to the Python resolver.
- Decide whether `scripts/kg-bootstrap-from-projects.js` and `scripts/kg-import-cycle-state.js` are runtime consumers or maintainer/import scripts before changing them.

For context snapshot and triage, I would wire both runtime and prose surfaces:

- `hive/lib/context-snapshot.mjs`
- `skills/context-snapshot/run.mjs`
- `skills/triage/run.mjs`
- relevant executable skill instructions that currently name `.pHive`

For task tracking, release, and handoff, I would preserve the existing injection seams but make their default path config-first:

- `hive/lib/task-tracking-dispatch/index.ts` should keep honoring injected `config.state_dir`, but callers should pass the resolved config value or the module should resolve when absent.
- `hive/lib/handoff/dispatch.mjs` should keep accepting `state_dir`, but default through the resolver.
- `hive/lib/release_post.mjs` should stop being env-only and share the common precedence rule.
- `hive/lib/external/github-issues-adapter.js` should keep `_deps.stateDir` for tests but otherwise use the uniform resolver path.

For scenarios, audits, reverse sync, and maintainer scripts, I would classify each path before editing:

- Runtime relocation consumers: `hive/lib/scenarios/load.mjs`, `hive/scripts/story-status-backfill.mjs`, `hive/scripts/audit-episode-markers.mjs`, `hive/scripts/multica-reverse-sync.mjs`.
- Possible maintainer/default exceptions: `hive/scripts/gate-mode-audit.mjs`, `scripts/run_first_live_cycle.py`, `scripts/run_rollback_realism_proof.py`.
- Intentional literal: `scripts/migrate-state-to-pHive.sh`, because it names `.pHive` as a migration target.

For DAG executor, I would not mechanically relocate the opt-in locks until the maintainer answers the open question. My recommended split is:

- Keep `.pHive/hive.config.yaml` as the fixed consumer opt-in location for now, because docs and CI explicitly describe that lock.
- Relocate executor runtime outputs such as `.pHive/runs` and `.pHive/meta-team/worktrees` through the Python resolver if they are runtime state rather than opt-in policy files.
- Keep `.pHive/runtime/executor-graduated-workflows.yaml` fixed only if the maintainer confirms it is part of the same consumer-side lock.

For `HIVE_STATE_DIR`, I would standardize the precedence rule:

1. Explicit `HIVE_STATE_DIR` environment override, when present.
2. Root `hive.config.yaml` `paths.state_dir`.
3. Default `.pHive`.

The reason is practical: env vars are already used as an injection mechanism by `release_post.mjs` and `github-issues-adapter.js`, and preserving env as an explicit override keeps scripts and tests easy to isolate. The important correction is that absent env should resolve config, not skip directly to `.pHive`.

For prose, I would apply a narrow executable-instruction policy:

- Convert `SKILL.md` and workflow commands that tell agents to read/write/create/copy under `.pHive/...` to `${HIVE_STATE_DIR}/...`.
- Leave illustrative docs, default examples, changelog mentions, and product-name references literal unless they are instructions an agent is expected to execute.
- Keep semantic guards, migration scripts, and protected-path references literal unless a specific decision says they relocate.

## 4. What Could Go Wrong

**High: cross-runtime divergence during rollout.** Shell already resolves config, Node currently mixes env-only, injected, and literal defaults, and Python mostly defaults to `.pHive`. If the resolver implementations differ even slightly, state can split across directories.

**High: tests continue passing while relocation is still broken.** The research brief found 219 test/fixture hits. Default `.pHive` tests can pass even if `paths.state_dir` is ignored. Relocated-state cases need to be added, not just fixture strings updated.

**High: story/session state silently defaults.** `story-status`, `session-registry`, `session-episode-writer`, and `multica-issue-closer` are core state readers/writers. If one remains literal, a configured state dir will look partially empty or stale.

**High: DAG executor semantic locks get broken.** The executor has `.pHive/hive.config.yaml` and `.pHive/runtime/executor-graduated-workflows.yaml` references that docs and CI describe as consumer-side locations. Rewriting them as runtime state could violate an intentional opt-in model.

**Medium: `HIVE_STATE_DIR` precedence breaks existing scripts.** `release_post.mjs` and `github-issues-adapter.js` already honor env. `hooks/common.sh` does not. A uniform rule is necessary, but changing precedence can surprise tests or local workflows that relied on one side's behavior.

**Medium: metrics writers and readers disagree.** Shell metrics can move under the configured state dir while Python/Node readers still scan `.pHive/metrics`. This is an easy partial-fix trap.

**Medium: prose leaks remain.** Agents can follow markdown instructions literally. If `SKILL.md` and workflow files keep executable `.pHive` paths, the code may be correct while agent-authored outputs still land in the default tree.

**Medium: partial-seam call sites silently default.** Handoff, task tracking, and release code already accept injected state dirs, which can make the code look wired. But if their upstream caller does not inject the resolved value, they still fall back incorrectly.

**Low: migration and proof scripts may be over-engineered.** `scripts/migrate-state-to-pHive.sh` intentionally names `.pHive`, and maintainer proof scripts may target plugin-hive meta-team state directly. Moving those could create noise without improving the user-facing requirement.

**Low: semantic guard references may need special handling.** `hooks/check-agent-misuse.sh`, `skills/hive/skills/register-project/register-project.mjs`, and protected-path checks may refer to `.pHive` as a default product location, not a current runtime destination.

## 5. Dependencies and Constraints

The main dependency is root-first config precedence. The research brief cites `hive/references/configuration.md` and `hive/lib/git_flow.mjs`: root `hive.config.yaml` is the consumer source of truth, and shipped `hive/hive.config.yaml` is baseline/schema.

The shell resolver is the reference contract. `hooks/common.sh` already implements the behavior requested by the original requirement: config-first `paths.state_dir`, default `.pHive`, and relative-path canonicalization through target project/cwd.

Node depends on extending `hive/lib/config.js`. The parser is already there, but consumers only get `emit_lifecycle_at` today.

Python depends on extending `hive/lib/config.py`. Same issue: YAML/JSON parsing exists, but not `paths.state_dir`.

The rollout depends on deciding which `.pHive` references are runtime state and which are semantic locks. DAG executor opt-in config, migration scripts, protected path guards, and project registration checks are the main exception candidates.

The prose policy depends on recognizing that skills are executable instructions. `skills/execute/SKILL.md` and `skills/ship/SKILL.md` already establish the `${HIVE_STATE_DIR}` convention, so the work should not invent a new placeholder.

The test strategy depends on fixture discipline. There are 219 test/fixture hits, so implementation stories should add targeted relocated-state tests instead of trying to mechanically rewrite every fixture in the first pass.

No external library or service dependency appears in the research. This is an internal config/path resolution refactor.

## 6. Open Questions

1. Should `.pHive/hive.config.yaml` for DAG executor remain a fixed consumer opt-in location, or should it move under resolved `paths.state_dir`?

   Recommended answer: keep `.pHive/hive.config.yaml` fixed for now.

   Rationale: the research brief says current docs and CI intentionally name `.pHive` for executor opt-in. Treat that as a semantic lock unless the maintainer explicitly changes the contract. Relocate executor runtime outputs separately if they are ordinary state.

2. Should `HIVE_STATE_DIR` env override config, mirror config, or only be an injected compatibility variable?

   Recommended answer: env should be an explicit override, then root config, then `.pHive`.

   Rationale: `release_post.mjs` and `github-issues-adapter.js` already use env injection, while shell uses config. Env override preserves useful test/script control, but absent env must not bypass config.

3. Should tracked tests and migration/proof scripts be changed in the same epic, or should they remain default-state fixtures?

   Recommended answer: add relocated-state tests in this epic, but keep migration scripts and maintainer-only proof scripts literal unless a runtime consumer depends on them.

   Rationale: tests need to catch relocation regressions, but `scripts/migrate-state-to-pHive.sh` intentionally names `.pHive`, and the proof scripts are identified as likely maintainer-only exception candidates.

4. Should markdown workflow/prose paths move to `HIVE_STATE_DIR` placeholders globally, or only in `SKILL.md` files that directly instruct agents to write state?

   Recommended answer: convert executable `SKILL.md` and workflow instructions only.

   Rationale: the research found 924 prose/doc hits. Global replacement risks corrupting examples, product-name references, and historical docs. The leak to fix is instructions agents execute.

## 7. Verification Strategy

The verification has to prove relocation, not just preserve default `.pHive` behavior.

For Node, I would add focused tests around `hive/lib/config.js` and representative consumers:

- Resolver reads root `hive.config.yaml`.
- Default remains `.pHive`.
- Relative `paths.state_dir` anchors under target project/cwd.
- Env override behavior matches the chosen precedence rule.
- Story/session consumers use the resolved path.

For Python, I would add equivalent tests around `hive/lib/config.py` and the highest-risk consumers:

- Metrics path helpers resolve under configured state dir.
- KG metrics writer resolves under configured state dir.
- DAG executor runtime paths are either relocated or explicitly fixed by the chosen DAG decision.

For shell, I would keep the existing resolver tests if present and add regression coverage only for the new/changed semantic guard behavior. The metrics hooks already consume `_resolve_state_dir()`.

For integration-style verification, I would use a temporary project with:

- root `hive.config.yaml`
- `paths.state_dir: custom-state`
- at least one Node state write
- at least one Python metrics/state write
- at least one shell hook path resolution

The expected result is no new runtime write under default `.pHive` except intentional fixed-location files confirmed by the open-question decisions.

For prose, verification is mostly grep-based review:

- executable `SKILL.md` and workflow command examples should use `${HIVE_STATE_DIR}` where they direct state reads/writes
- illustrative/default docs may still mention `.pHive`
- migration and semantic guards remain literal by documented decision

VERIFICATION PLAN:

```text
Tools: existing Node test runner, existing Python test runner, shell hook tests, rg-based prose audit
Platforms: local repo test environment; no external platform dependency identified
Automated: resolver unit tests, representative consumer relocation tests, metrics path tests, shell regression tests where changed
Manual: review of semantic exceptions and executable prose conversions
Not verifying: broad migration of all 924 prose/doc hits; that would overreach the executable-instruction policy
```

## 8. Scale Assessment

This is not a tiny path-default cleanup.

The research found 41 production runtime actionable clusters across four surfaces:

- Node `.mjs` / `.js`
- Python `.py`
- shell hooks
- executable skill/workflow prose

The file count is likely medium-to-large even with a disciplined rollout. The resolver code itself is small, but adoption touches many subsystems:

- story status/session state
- metrics
- context snapshot/triage
- task tracking/release/handoff
- scenarios/audits/reverse sync
- DAG executor
- shell semantic guards
- executable skill prose

There is no data migration requirement proven by the research, but migration semantics are adjacent. Existing state may remain in `.pHive`; the requirement is that future runtime resolution honors `paths.state_dir`.

The unknowns are meaningful. The four open questions can change implementation scope, especially DAG executor and prose conversion breadth.

My size recommendation is **Large**.

I would not call it Small because 41 clusters, 4 runtime surfaces, and 219 test/fixture hits make accidental partial completion likely.

I would not call it merely Medium because the hard part is cross-runtime consistency plus exception discipline. The actual resolver functions are simple; the rollout and tests are where the risk lives.

SCALE ASSESSMENT:

```text
Files affected: likely 30-50 implementation/test/prose files, depending on DAG and prose decisions
Subsystems: story/session, metrics, context snapshot, triage, task tracking, release, handoff, scenarios/audits, DAG executor, shell hooks, executable skill prose
Migration required: no confirmed data migration; migration scripts should likely remain literal
Cross-team coordination: no external team dependency identified, but maintainer decisions are needed
Unknowns: 4

RECOMMENDATION: Needs structured outline
RATIONALE: The design direction is clear, but decomposition should separate resolver contract, subsystem adoption, tests, semantic exceptions, and prose cleanup so each story can be reviewed without mixing runtime behavior with intentional `.pHive` locks.
```
