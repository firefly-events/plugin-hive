# State Dir Resolver — Vertical Slice Plan

Execution plan overlaid on the horizontal layer map. Every slice leaves the product in a working, verifiable state — if a bug appears, it was introduced in THIS slice. Binding inputs: `design-decisions.md` (authoritative), `design-discussion.md`, `research-brief.md`, `horizontal-plan.md`. Where this and `design-discussion.md` §6 disagree, `design-decisions.md` wins.

## 1. Slicing Strategy

```
STRATEGY:
  Total horizontal items: 41 runtime clusters across 8 layers
  Planned slices: 10
  First slice goal: Resolver contract + shared conformance fixture (gates everything else;
                    grill P1/H1/H2 lock).
  Final slice goal: Project-wide cross-runtime relocation verified end-to-end.

  Slicing rationale:
    - Slice 1 establishes the cross-runtime invariant — the conformance fixture converts the
      #1 risk (drift between shell, Node, Python) into a gated test.
    - Slices 2–6 are subsystem-coherent Node + Python adoption groups (one cluster per slice,
      independently shippable, leaves the product in a working state).
    - Slice 7 is the DAG-executor relocation kept narrow per Q1 (run-state only; config + registry FIXED).
    - Slice 8 closes the orphan-gap (maintainer-refined): weekly age-archival of terminal runs
      from <state_dir>/runs to a temp/archive dir; never archives active or suspended runs.
    - Slice 9 covers the shell semantic guard regex (small but isolated).
    - Slice 10 is the Q4-bounded prose conversion (executable SKILL.md / workflow steps only).
    - Each slice carries its own relocated-state regression tests; the conformance fixture
      from Slice 1 is the integration spine that every later slice asserts against.
```

## 2. Vertical Slice Plan

### Step 1: Resolver Contract + Conformance Fixture

WHAT WORKS AFTER THIS STEP:
  All three runtimes (shell, Node, Python) resolve `paths.state_dir` to byte-identical
  absolute paths for every row of the shared conformance fixture, including env-override
  precedence (Q2). No consumer code has adopted the new resolvers yet — but the contract
  is provable, testable, and locked.

LAYERS TOUCHED:
  Resolver Contract:
    - `hooks/common.sh` — characterize-test current `_resolve_state_dir()` behavior across
      edge inputs (absolute paths, `target_project: null`, already-canonical, symlinks,
      missing config, env vs config interaction). No behavior change; pins the spec.
    - `hive/lib/config.js` — add `resolveStateDir({cwd, env})` exported helper.
    - `hive/lib/config.py` — add `resolve_state_dir(*, cwd, env)` with parallel semantics.
  Tests:
    - New shared fixture (`tests/fixtures/state-dir-conformance.yaml` or equivalent):
      one input row → expected canonical path; covers env-override, config, default,
      relative-under-target_project, relative-under-cwd, symlink-canonicalization.
    - Three test harnesses (bash, node, python) — each iterates the same fixture and
      asserts the resolver matches the expected path.

NOT YET:
  - No consumer module has been migrated; literal `.pHive` joins still exist downstream.
  - No DAG-executor work; archival; semantic guard; prose conversion.

VERIFIED BY:
  - Shell characterize-test (bats / shellspec, whichever this repo uses for hook tests).
  - Node Jest/vitest unit test iterating the conformance fixture.
  - Python pytest iterating the conformance fixture.
  - All three resolvers must produce IDENTICAL paths for every fixture row — that
    cross-runtime parity assertion is the gate.

COMMIT REPRESENTS: Resolver contract + shared conformance fixture — cross-runtime
  invariant proven; downstream adoption can now build on a single spec.

---

### Step 2: Story / Session State Adoption

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  Story status, session registry, session-episode writer, and the issue closer all
  read + write under the configured `paths.state_dir`. Setting a custom state dir
  in `hive.config.yaml` moves the entire epic / episode / session tree.

LAYERS TOUCHED:
  Node consumers (subsystem: Story/Session):
    - `hive/lib/story-status.mjs` — adopt Node resolver; replace repo-root `.pHive` probe.
    - `hive/lib/session-registry.js` — adopt resolver for `sessions/index.yaml`.
    - `hive/lib/session-episode-writer.js` — adopt resolver for `episodes/`.
    - `hive/lib/multica-issue-closer.mjs` — adopt resolver for episode-marker reads.
  Tests:
    - Relocated-state regression test for each module (configured state dir → reads + writes
      land under it; default `.pHive` still works when unset).

NOT YET:
  - Metrics, context-snapshot, triage, task-tracking, release, handoff, scenarios,
    DAG-executor, archival, semantic-guard, prose are still on legacy paths.

VERIFIED BY:
  - Node consumer unit tests against the resolver.
  - Targeted integration test: temp project with `paths.state_dir: custom-state` →
    story status update lands in `custom-state/epics/...`, not `.pHive/epics/...`.

COMMIT REPRESENTS: Story + session state honors configured `paths.state_dir` —
  highest-value Node consumer cluster relocated.

---

### Step 3: Metrics Adoption (Node + Python — readers/writers aligned)

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  Metrics writers and readers across all three runtimes resolve to the same configured
  state dir. The known divergence trap (writer moves, reader still scans default) is closed.

LAYERS TOUCHED:
  Node consumers (subsystem: Metrics):
    - `hive/lib/budget-gate.js` — adopt Node resolver for `metrics/` defaults.
  Python consumers (subsystem: Metrics):
    - `hive/lib/metrics/paths.py` — adopt Python resolver; `PROJECT_ROOT/.pHive/metrics`
      becomes resolver-driven.
    - `hive/lib/kg_metrics_writer.py` — adopt Python resolver for `metrics/kg`.
  Classification (decide here, write decision into commit):
    - `scripts/kg-bootstrap-from-projects.js` — runtime consumer? then adopt; else literal.
    - `scripts/kg-import-cycle-state.js` — same classification call.
  Shell hooks:
    - No changes (`hooks/metrics-*.sh` already on `_resolve_state_dir()`; just regression-test).
  Tests:
    - Cross-runtime metrics integration test: hook writes a metric under custom state dir,
      Node + Python readers find it under the same custom state dir.

NOT YET:
  - All other subsystems still legacy.

VERIFIED BY:
  - Node unit tests for `budget-gate`.
  - Python unit tests for `metrics/paths`, `kg_metrics_writer`.
  - Cross-runtime integration test (writer/reader same-tree assertion).

COMMIT REPRESENTS: Metrics cluster reads + writes aligned across shell, Node, Python.

---

### Step 4: Context Snapshot + Triage Adoption

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  Context snapshot output and triage queue both write under configured `paths.state_dir`.

LAYERS TOUCHED:
  Node consumers (subsystem: Context Snapshot + Triage):
    - `hive/lib/context-snapshot.mjs` — adopt Node resolver.
    - `skills/context-snapshot/run.mjs` — replace `join(REPO_ROOT, ".pHive")`.
    - `skills/triage/run.mjs` — replace `join(REPO_ROOT, ".pHive", "triage")`.
  Tests:
    - Relocated-state test for snapshot composition.
    - Relocated-state test for triage queue path.

NOT YET:
  - Task-tracking / release / handoff; scenarios; DAG; archival; semantic guard; prose.

VERIFIED BY:
  - Skill-runner integration test for snapshot + triage with custom `paths.state_dir`.

COMMIT REPRESENTS: Snapshot + triage subsystem on the resolver.

---

### Step 5: Task-tracking / Release / Handoff Adoption

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  All four partial-seam modules default through the resolver with env-override precedence
  (Q2). Injection seams used by tests remain intact.

LAYERS TOUCHED:
  Node consumers (subsystem: Task tracking / Release / Handoff):
    - `hive/lib/task-tracking-dispatch/index.ts` — keep injected `config.state_dir`
      seam; default falls through to resolver.
    - `hive/lib/handoff/dispatch.mjs` — keep accepting `state_dir`; default through resolver.
    - `hive/lib/release_post.mjs` — stop being env-only; share Q2 precedence
      (env-override → config → `.pHive`).
    - `hive/lib/external/github-issues-adapter.js` — keep `_deps.stateDir` seam for tests;
      default through resolver instead of `process.env.HIVE_STATE_DIR || ".pHive"`.
  Tests:
    - Per-module relocation test (config-only, env-only, both, neither).
    - Assert env-override beats config; absent env hits config not default.

NOT YET:
  - Scenarios / audits / reverse-sync; DAG; archival; semantic guard; prose.

VERIFIED BY:
  - Node unit tests covering all four precedence permutations on each module.
  - Adapter test for `github-issues-adapter` preserving `_deps.stateDir` injection.

COMMIT REPRESENTS: Partial-seam Node modules unified under the resolver with
  Q2 precedence asserted at every call site.

---

### Step 6: Scenarios / Audits / Reverse-sync Adoption

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  Scenario loading, status backfill, episode-marker audit, and reverse-sync honor
  configured `paths.state_dir`. Maintainer-only proof scripts stay literal (Q3).

LAYERS TOUCHED:
  Node consumers (subsystem: Scenarios / Audits / Reverse-sync):
    - `hive/lib/scenarios/load.mjs` — adopt Node resolver.
    - `hive/scripts/story-status-backfill.mjs` — adopt resolver.
    - `hive/scripts/audit-episode-markers.mjs` — adopt resolver.
    - `hive/scripts/multica-reverse-sync.mjs` — adopt resolver.
  Classification (per Q3 — explicit in commit):
    - `hive/scripts/gate-mode-audit.mjs` — classify (maintainer vs runtime); relocate if runtime.
  LITERAL (Q3 — leave untouched):
    - `scripts/migrate-state-to-pHive.sh`
    - `scripts/run_first_live_cycle.py`
    - `scripts/run_rollback_realism_proof.py`
  Tests:
    - Relocation regression test for each adopted script.

NOT YET:
  - DAG-executor run-state; archival; semantic guard; prose.

VERIFIED BY:
  - Per-script relocation test against a temp project with custom state dir.

COMMIT REPRESENTS: Scenarios + audits + reverse-sync subsystem relocated; maintainer
  proof scripts explicitly preserved as literal per design decision Q3.

---

### Step 7: DAG-executor Run-state Relocation (Q1 — config FIXED, runs relocate)

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  DAG-executor run-state lives under the configured `paths.state_dir`. Executor opt-in
  config (`.pHive/hive.config.yaml`) and runtime registry
  (`.pHive/runtime/executor-graduated-workflows.yaml`) remain FIXED as Q1 specifies.
  Suspend / resume still works (run-state stays durable under the live location).

LAYERS TOUCHED:
  Python consumers (subsystem: DAG executor):
    - `hive/lib/dag_executor/run_state/store.py` — `runs_root()` resolves via Python resolver;
      the existing injectable `root` param remains the seam.
    - `hive/lib/dag_executor/isolation/worktree.py` — relocate worktree root through resolver.
    - `hive/lib/dag_executor/isolation/nesting.py` — relocate nesting paths.
    - `hive/lib/dag_executor/executor/handlers/pause.py` — relocate pause-state path.
  Explicitly NOT touched (Q1 locks):
    - `hive/lib/dag_executor/__init__.py` — `.pHive/hive.config.yaml` opt-in path remains.
    - `.pHive/runtime/executor-graduated-workflows.yaml` graduation registry remains.
  Tests:
    - DAG executor relocation test: configured state dir → runs land under
      `<state_dir>/runs/<run-id>` and `<state_dir>/meta-team/worktrees/...`.
    - Suspend / resume round-trip on relocated runs (`mark_suspended` →
      `unfreeze_for_resume`) — proves live location stays durable.
    - Negative: executor opt-in config path UNCHANGED — assert reads still hit `.pHive/hive.config.yaml`.

NOT YET:
  - Run-state archival sweep (Step 8); semantic guard; prose.

VERIFIED BY:
  - Python DAG-executor pytest covering relocation + suspend/resume.
  - Negative test asserting executor opt-in lock unchanged.

COMMIT REPRESENTS: DAG-executor run-state relocates; consumer-side opt-in lock preserved.

---

### Step 8: Run-state Archival Sweep (suspend-aware, weekly-automated)

BUILDS ON: Step 7

WHAT WORKS AFTER THIS STEP:
  Terminal runs (`completed | failed | cancelled`) older than the configured threshold
  are MOVED from `<state_dir>/runs/<run-id>` into a temp/archive directory; OS purge
  reclaims them. Active and suspended runs are NEVER archived regardless of age. A weekly
  scheduled sweep runs automatically; a manual CLI entry point exists for ad-hoc invocation.
  Project footprint self-bounds.

LAYERS TOUCHED:
  Python consumers (new subsystem: Run-state archival):
    - New module under `hive/lib/dag_executor/` (or sibling), e.g. `run_state/archive.py`,
      exposing `archive_terminal_runs(state_dir, *, threshold, archive_dest, dry_run=False)`.
    - Selection: scan `<state_dir>/runs/<run-id>` whose run-state YAML status is
      terminal AND last-modified age ≥ threshold.
    - Hard guard: query run-state status; skip anything not in {completed, failed, cancelled}.
      Suspended runs ALWAYS skipped regardless of age (suspend-aware).
    - Action: `shutil.move(<state_dir>/runs/<run-id>, <archive_dest>/<run-id>)`.
    - Destination: `$TMPDIR` by default; configurable open knob for story decomposition.
    - Schedule: weekly trigger (mechanism deferred to story — cron / launchd / scheduled task).
    - Manual CLI: `python -m hive.lib.dag_executor.run_state.archive [--dry-run] ...`.
  Tests:
    - Guard correctness: suspended run + active run + non-terminal run all NEVER moved.
    - Age threshold honored: under-threshold terminal run NOT moved; over-threshold IS moved.
    - Idempotency: re-running the sweep is a no-op once aged terminals are gone.
    - `--dry-run` prints intended moves without touching filesystem.

OPEN KNOBS (settled in story decomposition, NOT here):
  - Default age threshold (e.g. 7d).
  - Archive destination resolution ($TMPDIR vs configurable).
  - Move-then-OS-purge vs move-then-explicit-delete-after-N-days.

NOT YET:
  - Semantic guard; executable prose.

VERIFIED BY:
  - Python pytest for archive selection + guard + dry-run + idempotency.
  - End-to-end: simulate weekly trigger against a temp project with mixed run states.
  - Manual: invoke CLI with `--dry-run` against a real `<state_dir>/runs` tree.

COMMIT REPRESENTS: Project footprint self-bounds via weekly age-archival of terminal
  runs to temp; live + suspended runs durable under `<state_dir>/runs`.

---

### Step 9: Shell Semantic-guard Coverage

BUILDS ON: Step 1

WHAT WORKS AFTER THIS STEP:
  `hooks/check-agent-misuse.sh` recognizes the resolved `<state_dir>/<story-id>` shape
  in addition to `.pHive` + legacy `state`. Misuse detection works regardless of where
  the project's state dir is configured.

LAYERS TOUCHED:
  Shell hooks:
    - `hooks/check-agent-misuse.sh` — update story-path regex to consult the resolver
      (source `hooks/common.sh`) and accept the resolved state-dir basename.
  Tests:
    - Shell test: misuse correctly flagged under default `.pHive`.
    - Shell test: misuse correctly flagged under custom `paths.state_dir`.
    - Shell test: legitimate access NOT flagged in either configuration.

NOT YET:
  - Executable prose conversion.

VERIFIED BY:
  - Shell hook test suite (bats / shellspec / whichever this repo uses).

COMMIT REPRESENTS: Semantic guard becomes relocated-state-aware.

---

### Step 10: Executable Prose Conversion (Q4 — SKILL.md / workflow only)

BUILDS ON: Step 1 (uses `${HIVE_STATE_DIR}` placeholder convention already in
  `skills/execute/SKILL.md` and `skills/ship/SKILL.md`)

WHAT WORKS AFTER THIS STEP:
  Every executable instruction in `SKILL.md` and workflow steps that previously told an
  agent to read / write / mkdir / cp under `.pHive/...` now uses `${HIVE_STATE_DIR}/...`.
  Agents executing these instructions land in the configured state dir.

LAYERS TOUCHED:
  Executable skill / workflow prose:
    - `skills/test/SKILL.md`
    - `hive/workflows/steps/test-swarm/step-03-worker.md`
    - Any other SKILL.md / workflow step matching
      `rg -nP '(mkdir|cp|cat|tee|cat\s*>|>)\s+\.pHive' skills/ hive/workflows/`
      that instructs an agent to perform the operation (not illustrative).
  LITERAL (out of scope — Q4):
    - Illustrative docs, examples, changelog, product-name references, README mentions.

NOT YET:
  - Nothing material. This is the cleanup pass.

VERIFIED BY:
  - `rg` audit: zero executable `.pHive/...` instructions remain in SKILL.md /
    workflow steps after the conversion.
  - Spot-check: pick 2-3 converted skills and run them against a custom state dir;
    state lands where expected.

COMMIT REPRESENTS: Executable agent instructions honor `paths.state_dir`; epic
  is feature-complete on the resolver contract.

---

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY — state-dir-resolver epic
─────────────────────────────────────────────────────────────────────────────────────────────────────────

                  │ S1        │ S2       │ S3       │ S4       │ S5       │ S6       │ S7       │ S8       │ S9       │ S10      │
                  │ Contract  │ Story/   │ Metrics  │ Snapshot │ Task/Rel │ Scenario │ DAG run  │ Archival │ Shell    │ Prose    │
                  │ + Fixture │ Session  │ N+P+sh   │ + Triage │ + Handoff│ + Audit  │ -state   │ sweep    │ guard    │ (Q4)     │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
Resolver contract │ shell ref │          │          │          │          │          │          │          │          │          │
                  │ +Node     │          │          │          │          │          │          │          │          │          │
                  │ +Python   │          │          │          │          │          │          │          │          │          │
                  │ +fixture  │          │          │          │          │          │          │          │          │          │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
Node consumers    │           │ story-   │ budget-  │ ctx-snap │ task-trk │ scenarios│          │          │          │          │
                  │           │ status,  │ gate     │ skills/  │ handoff  │ status-  │          │          │          │          │
                  │           │ session* │          │ snapshot │ release  │ backfill │          │          │          │          │
                  │           │ closer   │          │ triage   │ gh-iss   │ audit    │          │          │          │          │
                  │           │          │          │          │          │ rev-sync │          │          │          │          │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
Python consumers  │           │          │ metrics/ │          │          │          │ run_stat │ archive  │          │          │
                  │           │          │ paths.py │          │          │          │ store    │ sweep    │          │          │
                  │           │          │ kg_metr  │          │          │          │ isolatn  │ (new)    │          │          │
                  │           │          │ writer   │          │          │          │ pause    │          │          │          │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
DAG fixed locks   │           │          │          │          │          │          │ UNCHANGE │          │          │          │
(Q1)              │           │          │          │          │          │          │ config + │          │          │          │
                  │           │          │          │          │          │          │ registry │          │          │          │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
Shell hooks       │ character │          │ metrics  │          │          │          │          │          │ check-   │          │
                  │ -ize test │          │ hooks    │          │          │          │          │          │ agent-   │          │
                  │ common.sh │          │ regress  │          │          │          │          │          │ misuse   │          │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
Prose (SKILL.md)  │           │          │          │          │          │          │          │          │          │ test     │
                  │           │          │          │          │          │          │          │          │          │ workflow │
                  │           │          │          │          │          │          │          │          │          │ rg audit │
──────────────────┼───────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
Tests             │ conform   │ + Node   │ + Node + │ + skill  │ + 4 perm │ + per-   │ + DAG    │ + guard, │ + shell  │ + rg     │
                  │ fixture × │ consumer │ Python + │ runner   │ utations │ script   │ relocate │ age,     │ misuse   │ audit    │
                  │ 3 runtime │ regress  │ cross-rt │ tests    │ test     │ regress  │ + suspnd │ dry-run  │ test     │ + spot   │
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

Each column is a commit-worthy, working state.
```

## 4. Deferred Items

```
DEFERRED (not in current slice plan, explicit):

  - `.pHive/hive.config.yaml` (DAG executor opt-in) relocation
      → Q1 lock: STAYS FIXED. Not deferred-then-do-later; deferred as a permanent policy decision.
  - `.pHive/runtime/executor-graduated-workflows.yaml` relocation
      → Q1 lock: STAYS FIXED. Same rationale.
  - Mechanical rewrite of 219 existing test fixtures
      → Q3: relocated-state tests are added in adoption slices; existing fixtures stay.
  - Maintainer proof scripts (`run_first_live_cycle.py`, `run_rollback_realism_proof.py`)
      → Q3: stay literal; maintainer tooling, not runtime consumer.
  - Migration script (`scripts/migrate-state-to-pHive.sh`)
      → Q3: stays literal; intentionally names `.pHive` as the migration target.
  - Illustrative docs / examples / changelog / product-name references
      → Q4: out of scope; only executable prose converts.
  - Data migration of existing state under `.pHive`
      → No requirement proven; the epic relocates FUTURE resolution, not historical data.
  - Explicit archive-purge daemon (delete-after-N-days knob)
      → Open knob in Slice 8 archival story; default leaves OS purge in charge of `$TMPDIR`.

RATIONALE: Every deferral here is anchored in a maintainer decision (Q1–Q4) or in
  explicit research-brief findings. Nothing silently falls off.
```

## 5. Risk by Slice

```
RISK PER SLICE:
  S1  (Contract + Fixture):  Medium — characterize-test must pin shell behavior accurately;
                              any drift between fixture rows and shell breaks downstream.
                              Mitigation: write fixture FROM observed shell output, not theory.
  S2  (Story / Session):     Medium — core state readers/writers; any missed module silently
                              splits state under custom dir.
                              Mitigation: relocated-state test PER module + grep for residual
                              `.pHive` joins after edit.
  S3  (Metrics):             High   — cross-runtime; reader/writer divergence is the documented
                              partial-fix trap.
                              Mitigation: cross-runtime integration test asserts same-tree.
  S4  (Snapshot + Triage):   Low    — small, contained subsystem.
  S5  (Task/Rel/Handoff):    Medium — Q2 precedence (env-override) must match across 4 modules.
                              Mitigation: per-module 4-permutation test (config-only, env-only,
                              both, neither).
  S6  (Scenarios/Audits):    Low-Medium — Q3 classification calls (which script is runtime).
                              Mitigation: classification is explicit in commit message.
  S7  (DAG run-state):       High   — Q1 split discipline; relocating a fixed-lock path breaks
                              the consumer opt-in model AND suspend/resume must keep working.
                              Mitigation: negative test asserting opt-in lock unchanged +
                              positive suspend/resume round-trip on relocated runs.
  S8  (Archival sweep):      High   — archiving a suspended run destroys resumable state.
                              Mitigation: hard guard (suspend-aware) + dry-run mode + tests
                              that simulate active/suspended/terminal mix.
  S9  (Shell guard):         Low    — single regex change; well-bounded.
  S10 (Prose conversion):    Low    — text-only; risk is missing an executable instruction.
                              Mitigation: rg audit checks zero `.pHive` executable hits remain.
```

## 6. Moldability Notes

- **Reorderable slices.** S2–S6 are independent Node + Python subsystem adoptions; they can
  reorder freely once S1 lands. The horizontal map's cross-layer dependency graph forbids
  reordering S1 ahead of anything else, and forbids S8 ahead of S7.
- **Droppable slices.** None of S1–S8 can be dropped without breaking the epic's core
  promise. S9 (semantic guard) and S10 (prose) could in principle slip to a follow-up
  epic if scope shrinks, but the design decisions argue for keeping them together.
- **New slices we might discover.**
  - **kg-bootstrap / kg-import classification** — if S3 classification flips one of those
    to runtime, the change is small enough to absorb into S3 (no new slice needed).
  - **gate-mode-audit classification** — same: absorb into S6 if runtime.
  - **Schedule mechanism for S8** — if cron / launchd / external scheduler choice turns out
    to be non-trivial, the *trigger* may need its own micro-slice (the sweep itself stays in S8).
  - **Resolver caching** — if the resolver is called hot in DAG executor inner loops and
    benchmarks show config-read overhead, a memoization slice may appear. Currently no
    research signal that this is needed; flag for the developer.
- **Learning loop.** Each adoption slice teaches the next about edge cases (missing config,
  cwd-vs-root ambiguity, env-injection points used by tests). The plan is moldable: if
  Slice 2 surfaces a new corner case, it goes into the conformance fixture immediately and
  every later slice inherits the coverage.
