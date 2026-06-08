# State Dir Resolver — Design Gate Decisions

**Resolved:** 2026-06-08 · maintainer sign-off at the `/plan` design-discussion gate.
Supersedes the *recommended answers* in `design-discussion.md` §6 and resolves the
grill-record findings. Downstream H/V planning, structured outline, and story
decomposition consume THIS file as the binding decision log.

## Open-question rulings

### Q1 — DAG-executor `.pHive` locks → **config fixed, runs relocate, + cleanup story**
- `.pHive/hive.config.yaml` (executor opt-in) and `.pHive/runtime/executor-graduated-workflows.yaml` (graduation registry) **stay fixed** — durable policy / consumer-side lock.
- Run-state outputs **relocate** through the Python resolver: `runs_root()` (`run_state/store.py`), worktree isolation (`isolation/worktree.py`, `isolation/nesting.py`), pause handler (`executor/handlers/pause.py`). All already accept an injectable `root` param — low-risk seam.
- **Not split-brain:** config = policy (fixed), runs = transient state (relocate). Clean separation.
- **Orphan gap (maintainer-flagged):** no TTL/retention exists for run-state YAML today; only worktrees get `git worktree remove`. Relocation alone does NOT solve this — run-state must survive suspend/resume (`mark_suspended`/`unfreeze_for_resume`), so a blind temp-dir destination would risk OS purge of a suspended run. **Add a dedicated suspend-aware cleanup/retention story** (keep-last-N or TTL prune that never touches active/suspended runs).
- Pointing `paths.state_dir` at a temp path is a **supported config opt-in** for ephemeral setups — relocation provides the lever; durability is not bet on it.

### Q2 — `HIVE_STATE_DIR` precedence → **env-override**
1. Explicit `HIVE_STATE_DIR` env (when set)
2. Root `hive.config.yaml` `paths.state_dir`
3. Default `.pHive`

Resolves grill V1/U1: the "config-first" wording in the requirement is **corrected to "env-override"** — env wins when set; absent env resolves config (never skips straight to `.pHive`). Preserves existing script/test injection ergonomics (`release_post.mjs`, `github-issues-adapter.js`). The uniform rule applies to all three runtimes.

### Q3 — tests + scripts → **relocated-state tests added, scripts literal**
- Add targeted relocated-state regression tests (do NOT mechanically rewrite the 219 fixtures).
- `scripts/migrate-state-to-pHive.sh` + maintainer proof scripts (`run_first_live_cycle.py`, `run_rollback_realism_proof.py`) stay literal (`.pHive` intentional).

### Q4 — prose breadth → **executable SKILL.md/workflow only**
- Convert only instructions agents execute (read/write/mkdir/cp under `.pHive/...`) to `${HIVE_STATE_DIR}/...`.
- Leave illustrative docs, examples, changelog, product-name references literal.

## Grill-record resolutions (`grill-record.md`)

- **P1 + H1 (cross-runtime drift)** → add a **shared conformance fixture**: one input→expected-path test vector that the shell, Node, and Python resolvers must all satisfy. Converts the #1 risk from "watch for divergence" into a gated invariant.
- **H2 (shell resolver unverified as spec)** → **characterize-test the shell `_resolve_state_dir()` first** (pin current behavior across edge inputs: absolute paths, `target_project: null`, already-canonical, symlinks), then make it the cross-runtime spec.
- **V1/U1** → resolved by Q2 (env-override; wording corrected).
- **U2** → resolved by Q1 (config fixed / runs relocate is a coherent policy-vs-transient split).
- **Convention violations** → clean (no action).

## Implied story shape (input to decomposition)

1. **Resolver contract + conformance fixture** (ahead of adoption): characterize shell resolver → shared golden test vector → Node resolver in `config.js` → Python resolver in `config.py`, all proving conformance.
2. Subsystem adoption (one story per cluster group): story/session state; metrics (Node+Python readers/writers); context-snapshot + triage; task-tracking/release/handoff seams; scenarios/audits/reverse-sync.
3. DAG-executor: relocate run-state (config stays fixed).
4. **Run-state retention/cleanup** (suspend-aware).
5. Executable prose conversion (SKILL.md/workflow `${HIVE_STATE_DIR}`).
6. Shell semantic-guard coverage (`check-agent-misuse.sh` relocated-dir awareness).
7. Relocated-state regression tests (woven into adoption stories + an integration story).

Scale: **Large** → structured outline before story decomposition.
