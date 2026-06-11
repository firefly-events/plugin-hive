# State Dir Resolver — Horizontal Layer Map

Breadth-first scan of every layer the `paths.state_dir` epic touches. Companion to the vertical slice plan; binding inputs are `design-decisions.md` (authoritative), `design-discussion.md`, and `research-brief.md`.

Where this document and `design-discussion.md` §6 disagree, `design-decisions.md` wins.

## 1. Layer Inventory

| Layer | Current state | How affected |
|-------|---------------|--------------|
| **Resolver contract** | Only shell `_resolve_state_dir()` in `hooks/common.sh` is complete. | Add Node + Python resolvers; ratify shell as reference via characterize-test + shared conformance fixture. |
| **Shared conformance fixture (test layer)** | Does not exist. | New golden input→expected-path test vector that all three runtimes (shell, Node, Python) must pass — gates Q1/H1/H2. |
| **Node consumer modules** | Inconsistent: env-only, caller-injected, literal `.pHive` joins. | Adopt new Node resolver; preserve injection seams used by tests. |
| **Python consumer modules** | Mostly literal `.pHive` defaults; partial caller injection. | Adopt new Python resolver; classify maintainer/proof scripts. |
| **DAG executor (Python subsystem)** | Config + runtime registry hardcoded to `.pHive`; run-state defaults to `.pHive/runs`, `.pHive/meta-team/worktrees`. | Relocate **run-state only**; `.pHive/hive.config.yaml` + `.pHive/runtime/executor-graduated-workflows.yaml` **stay fixed** (Q1). |
| **Shell hooks layer** | Reference resolver works for metrics + interrupt hooks. | `hooks/check-agent-misuse.sh` regex recognizes `.pHive` + legacy `state` only — needs relocated-state awareness. |
| **Executable skill / workflow prose** | Mixed: `skills/execute`, `skills/ship` already use `${HIVE_STATE_DIR}`; others literal. | Convert only executable read/write/mkdir/cp instructions to `${HIVE_STATE_DIR}/...` (Q4). |
| **Test fixtures (219 hits)** | Default `.pHive` assumed. | Add targeted relocated-state tests; do NOT mechanically rewrite fixtures (Q3). |
| **Run-state archival (new)** | No retention exists for run-state YAML; orphan-gap risk. | New sweep: age-archive terminal runs (completed/failed/cancelled) from `<state_dir>/runs` to temp/archive dir; weekly + manual; suspend-aware. |

## 2. Per-Layer Requirements

### Layer: Resolver Contract

```
NEW MODULES / FUNCTIONS:
  - hive/lib/config.js          — exported `resolveStateDir({cwd, env})` mirroring shell
  - hive/lib/config.py          — exported `resolve_state_dir(*, cwd, env)` with parallel semantics
  - hooks/common.sh             — RETAIN _resolve_state_dir() as the spec; no behavior change

CONTRACT (all three runtimes):
  1. If HIVE_STATE_DIR env set → use it (Q2 env-override).
  2. Else read root hive.config.yaml → paths.state_dir.
  3. Else default to ".pHive".
  4. Relative paths canonicalize under resolved paths.target_project, else cwd.
  5. Returns canonical absolute path.

CONFORMANCE FIXTURE (gates cross-runtime drift — grill P1/H1/H2):
  - One shared YAML/JSON test vector: input env + config + cwd + target_project → expected absolute path.
  - Characterize-tested first against shell resolver to pin current behavior (absolute paths,
    target_project: null, already-canonical, symlinks, missing config, env vs config interaction).
  - Node + Python resolvers must produce byte-identical paths for every input row.
```

### Layer: Node consumer modules

```
STORY / SESSION STATE (highest-risk relocation leaks):
  - hive/lib/story-status.mjs            — repo-root probe + reads .pHive/epics, .pHive/episodes
  - hive/lib/session-registry.js         — writes .pHive/sessions/index.yaml
  - hive/lib/session-episode-writer.js   — writes .pHive/episodes
  - hive/lib/multica-issue-closer.mjs    — reads .pHive/episodes markers

METRICS (Node side of the readers/writers split):
  - hive/lib/budget-gate.js              — defaults under .pHive/metrics

CONTEXT SNAPSHOT + TRIAGE:
  - hive/lib/context-snapshot.mjs        — composes paths under .pHive
  - skills/context-snapshot/run.mjs      — passes join(REPO_ROOT, ".pHive")
  - skills/triage/run.mjs                — defaults queue to .pHive/triage

TASK-TRACKING / RELEASE / HANDOFF (partial seams):
  - hive/lib/task-tracking-dispatch/index.ts   — `this.config?.state_dir ?? ".pHive"`
  - hive/lib/handoff/dispatch.mjs              — accepts state_dir, defaults .pHive
  - hive/lib/release_post.mjs                  — env-only; needs config fallback
  - hive/lib/external/github-issues-adapter.js — `_deps.stateDir || env || ".pHive"`

SCENARIOS / AUDITS / REVERSE-SYNC:
  - hive/lib/scenarios/load.mjs                — direct .pHive joins
  - hive/scripts/multica-reverse-sync.mjs      — direct .pHive joins
  - hive/scripts/story-status-backfill.mjs     — runtime consumer; relocate
  - hive/scripts/audit-episode-markers.mjs     — runtime consumer; relocate
  - hive/scripts/gate-mode-audit.mjs           — classify (maintainer vs runtime)

KG SCRIPTS (classification needed):
  - scripts/kg-bootstrap-from-projects.js      — maintainer or runtime?
  - scripts/kg-import-cycle-state.js           — maintainer or runtime?
```

### Layer: Python consumer modules

```
METRICS:
  - hive/lib/metrics/paths.py            — PROJECT_ROOT / ".pHive" / "metrics" default
  - hive/lib/kg_metrics_writer.py        — Path(".pHive") / "metrics" / "kg" default

GENERAL STATE:
  - hive/lib/skill_candidate_mine.py     — DEFAULT_STATE_DIR = Path(".pHive")
  - hive/lib/meta-experiment/direct_commit_adapter.py — literal .pHive paths

DAG EXECUTOR — RELOCATE (run-state seam, already accepts injectable root):
  - hive/lib/dag_executor/run_state/store.py        — runs_root()
  - hive/lib/dag_executor/isolation/worktree.py
  - hive/lib/dag_executor/isolation/nesting.py
  - hive/lib/dag_executor/executor/handlers/pause.py

DAG EXECUTOR — FIXED (Q1 lock; do NOT relocate):
  - hive/lib/dag_executor/__init__.py    — .pHive/hive.config.yaml (executor opt-in)
  - .pHive/runtime/executor-graduated-workflows.yaml — graduation registry

LITERAL EXCEPTIONS (Q3):
  - scripts/migrate-state-to-pHive.sh
  - scripts/run_first_live_cycle.py
  - scripts/run_rollback_realism_proof.py
```

### Layer: Shell hooks

```
REFERENCE RESOLVER (no behavior change, characterize-tested in Slice 1):
  - hooks/common.sh — _resolve_state_dir(), _resolve_target_project()

CONSUMERS (already wired, regression-test only):
  - hooks/metrics-agent-spawn.sh, metrics-execute-boundaries.sh,
    metrics-human-escalation.sh, metrics-stop-dispatch.sh,
    metrics-token-capture.sh, stop-interrupt-capture.sh

SEMANTIC GUARD (needs relocated-state regex):
  - hooks/check-agent-misuse.sh — story-path regex matches .pHive + legacy `state` only
```

### Layer: Executable skill / workflow prose

```
ALREADY ON ${HIVE_STATE_DIR} (use as convention model):
  - skills/execute/SKILL.md
  - skills/ship/SKILL.md

EXECUTABLE PROSE TO CONVERT (Q4 scope — instructions agents execute):
  - skills/test/SKILL.md
  - hive/workflows/steps/test-swarm/step-03-worker.md
  - Other SKILL.md / workflow steps with bare read/write/mkdir/cp under .pHive/...
    (audit via `rg -nP '(mkdir|cp|cat|tee|cat\s*>|>)\s+\.pHive' skills/ hive/workflows/`)

LITERAL (out of scope):
  - Illustrative docs, examples, changelog, product-name references, README mentions
```

### Layer: Test fixtures

```
NEW TARGETED RELOCATED-STATE TESTS (woven into adoption slices):
  - Node resolver unit tests + per-consumer relocation tests
  - Python resolver unit tests + per-consumer relocation tests
  - Shell characterize-test pinning current resolver behavior
  - Cross-runtime conformance fixture test (Slice 1 deliverable)
  - DAG executor relocated-runs tests (Slice 7)
  - Archival sweep tests (Slice 8): guard correctness + age threshold + dry-run

UNCHANGED (Q3):
  - 219 existing .pHive fixture sites — leave literal unless a relocated case is needed
```

### Layer: Run-state archival (new subsystem)

```
NEW MODULE (Python, lives alongside dag_executor run-state):
  - Sweep entry point: archive_terminal_runs(state_dir, *, threshold, archive_dest)
  - Selection: runs in terminal states (completed | failed | cancelled) older than threshold
  - GUARD: skip any run still active or suspended regardless of age — consult run-state status
  - Action: move <state_dir>/runs/<run-id> → <archive_dest>/<run-id>
  - Destination: temp/archive dir (open knob — $TMPDIR default; story may make configurable)
  - Trigger: weekly scheduled sweep (cron / launchd / scheduler-of-choice) + manual CLI entry
  - OS purge reclaims; story may add explicit-delete-after-N-days knob

OPEN KNOBS (settle in story decomposition, not here):
  - Default age threshold (e.g. 7d)
  - Archive destination resolution ($TMPDIR vs configurable)
  - Move-then-OS-purge vs move-then-explicit-delete
```

## 3. Cross-Layer Dependencies

```
DEPENDENCIES:

Resolver Contract  ──gates──▶  ALL Node / Python consumer adoption
Conformance Fixture ──gates──▶ Node + Python resolver acceptance
Characterize-test shell ──pins──▶ Conformance fixture spec rows

Node resolver ──blocks──▶  story/session, metrics-node, context-snapshot,
                            triage, task-tracking, release, handoff,
                            scenarios, audits, reverse-sync, kg scripts

Python resolver ──blocks──▶ metrics-py, skill-candidate-mine,
                            kg-metrics-writer, DAG-executor run-state,
                            meta-experiment

DAG run-state relocation ──blocks──▶ Run-state archival sweep
                                      (archival sweeps <state_dir>/runs)

Run-state status semantics ──gates──▶ Archival guard correctness
                                       (must not archive active/suspended)

Shell semantic guard ──depends_on──▶ Resolver contract
  (regex must accept the resolved <state_dir>/<story-id> shape)

Executable prose ──depends_on──▶ Conformance fixture
  (uses ${HIVE_STATE_DIR} but resolved value must match runtimes)

Metrics writers (shell, Node, Python) ──must agree with──▶ Metrics readers
  (cross-runtime divergence trap — fixed by uniform resolver adoption)
```

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP — state-dir-resolver epic
─────────────────────────────────────────────────────────────────────────────────────────

Resolver        │ shell ref      │ Node config.js │ Python config.py│ conformance     │
contract        │ (characterize) │ resolveStateDir│ resolve_state_dir│ fixture (golden)│
────────────────┼────────────────┼────────────────┼─────────────────┼─────────────────┤
Node consumers  │ story/session  │ metrics (Node) │ ctx-snapshot +  │ task-track /    │
                │ (4 modules)    │ budget-gate    │ triage (3 mods) │ release /handoff│
                │                │                │                 │ (4 mods)        │
                ├────────────────┼────────────────┴─────────────────┴─────────────────┤
                │ scenarios/     │ audit / reverse-sync / kg scripts (5 mods)         │
                │ load.mjs       │                                                    │
────────────────┼────────────────┼────────────────┬─────────────────┬─────────────────┤
Python consumers│ metrics (py)   │ skill_candidate│ DAG run-state   │ DAG config +    │
                │ kg_metrics_wri │ _mine          │ (4 mods — MOVE) │ registry        │
                │                │                │                 │ (FIXED — Q1)    │
────────────────┼────────────────┼────────────────┼─────────────────┼─────────────────┤
Shell hooks     │ common.sh      │ metrics hooks  │ stop-interrupt  │ check-agent-    │
                │ (reference)    │ (consumers OK) │ (consumer OK)   │ misuse (regex)  │
────────────────┼────────────────┼────────────────┼─────────────────┼─────────────────┤
Prose / skills  │ skills/execute │ skills/ship    │ skills/test     │ workflows/      │
(executable)    │ (already done) │ (already done) │ (convert)       │ test-swarm etc. │
────────────────┼────────────────┼────────────────┼─────────────────┼─────────────────┤
Tests           │ shell          │ Node resolver  │ Python resolver │ conformance +   │
                │ characterize   │ + consumers    │ + consumers     │ integration     │
────────────────┼────────────────┼────────────────┼─────────────────┼─────────────────┤
Archival (new)  │ age-archive    │ terminal-only  │ weekly + manual │ suspend-aware   │
                │ sweep          │ guard          │ trigger         │ guard           │
─────────────────────────────────────────────────────────────────────────────────────────
```

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected: 8 (resolver, Node, Python, shell, prose, tests, DAG, archival)
  Runtime clusters covered: 41 actionable (per research brief)
  Implementation files (est.): 25-35 source files + new resolver tests
  New vs modified: 3 new (Node resolver, Python resolver, archival sweep + conformance fixture)
                   ~22-32 modified consumers
                   ~8-15 prose conversions (Q4-bounded)
  Estimated total effort: large

  LARGEST LAYER: Node consumer modules (~14 modules across 6 subsystem groups)
  RISKIEST LAYER: DAG executor + Archival
    - Q1 split (config FIXED, runs relocate) requires discipline; mechanical rewrite breaks the opt-in lock.
    - Archival guard correctness is non-negotiable: archiving a suspended run destroys resumable state.
    - Cross-runtime drift on env-override precedence (Q2) is the second-highest risk; the conformance
      fixture is the gate that catches it.
```
