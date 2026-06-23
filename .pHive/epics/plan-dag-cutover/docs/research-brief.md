# Research Brief: plan-dag-cutover

**Epic:** `plan-dag-cutover`
**Branch:** `feat/plan-dag-cutover`
**Date:** 2026-06-23
**Researcher:** researcher agent (run 01KVSF7YJA5Q0E8DGSB7PFT1NF)

---

## FINDINGS

### FILES_EXAMINED

- `skills/plan/SKILL.md:1–191` — The `/plan` orchestration skill. Phase 0c (lines 139–173) defines the current planning dispatch mode resolver (`cc-workflows | multica | default`). There is NO `hive-dag` cutover case here — this is the insertion point (Step 5pre-equivalent for plan). The plan flow currently has no analog to `/execute`'s step 5pre.

- `skills/execute/SKILL.md:147–196` — The `/execute` skill. Step 5pre (line 152) is the cutover point: `if runner_path == hive-dag, call hive.lib.dag_executor.run_workflow(...)`. Step 5 (line 147) invokes `execute-dispatch` to get `runner_path`. This is the architectural model for `/plan`'s cutover.

- `skills/hive/skills/execute-dispatch/SKILL.md:1–150` — Resolves `mode_decision`, `runner_path`, and `runner_reason`. Outputs include `runner_path: hive-dag | orchestrator-narrated`. Currently flow-specific to execution. The `flow` parameter concept (planning vs execution) does not appear in the skill prose but does appear in the underlying Python library.

- `hive/lib/dag_executor/run.py:1–279` — Production front-door for the DAG executor. `run()` function accepts `flow` parameter (line 160: `flow: str = "execution"`). `resolve_spawn_binding()` already reads `HIVE_{FLOW}_MODE` env var and `{flow}.mode` config key (lines 109–116) — **`flow="planning"` is already wired into the Python layer** at the config-knob level (`planning.mode` key in `hive.config.yaml`). The CLI front door in `main()` (line 244) does not expose `flow` as a flag.

- `hive/lib/dag_executor/__init__.py:1–212` — Public surface. `executor_enabled_for(workflow_name)` checks `.pHive/hive.config.yaml` for `executor: hive-dag` + `executor_default: true` + graduation registry. `CONSUMER_CONFIG_PATH = Path(".pHive/hive.config.yaml")`, `GRADUATED_REGISTRY_PATH = Path(".pHive/runtime/executor-graduated-workflows.yaml")`.

- `hive/workflows/plan.workflow.yaml:1–125` — Plan DAG graph. Shape: `research ‖ design → author → reconcile → output-validation gate`. Currently has 5 nodes, all with `node_type: agent` or `node_type: gate`. **No `user_gate` or `pause` nodes**. Reconcile node is `node_type: reconcile`. Gate node is `node_type: gate` (non-user-facing, predicate-only). Research, design, author nodes emit `outputs:` but none emit `confidence` or `open_questions[]` signals yet.

- `hive/lib/dag_executor/graph/model.py:17–151` — `NodeType` enum: `{AGENT, SCRIPT, GATE, PAUSE}`. The enum is declared as "exactly {AGENT, SCRIPT, GATE, PAUSE}. No LOOP." A new `conditional_pause` or `user_gate` type would extend this enum. Gate handler: predicate-only (machine-evaluable, no human). Pause handler: unconditional human halt (sentinel file mechanism).

- `hive/lib/dag_executor/executor/handlers/pause.py:1–115` — Full PauseHandler implementation. Generates signed token, writes sentinel dirs at `<runs_root>/<run_id>/pause/<node_id>.{approve,reject}`. Halts unconditionally. **This is the existing machinery that the new conditional user-gate node should reuse for its halt path.**

- `hive/lib/dag_executor/pause/signal.py:1–131` — `wait_for_signal()` polls for sentinel files. Token-verified, HMAC-signed. Existing pause security floor (30-day ceiling). Reusable as-is for conditional user-gate halt path.

- `.pHive/hive.config.yaml:1–end` — Consumer config. `executor: hive-dag`, `executor_default: false`. The `planning.mode` key is **not present** in the consumer config — it falls through to the shipped baseline. Shipped baseline `hive/hive.config.yaml` has `planning: { collaborative_review: true, visual: true }` — no `planning.mode` key there either. So adding `planning.mode: hive-dag` (or `HIVE_PLANNING_MODE=hive-dag`) would be the env/config activation path for the plan cutover.

- `.pHive/runtime/executor-graduated-workflows.yaml:1–end` — Graduation registry. Contains 10 workflows (meta-team-cycle, code-review, performance-audit, test-swarm, development.tdd, development.bdd, development.tdd-codex, ui-design, design-review, development.classic, daily-ceremony). **`plan` workflow is NOT in the registry.** It must be graduated for the cutover to activate.

- `hive/lib/dag_executor/executor/handlers/` — Contains `agent.py`, `gate.py`, `pause.py`, `reconcile.py`, `script.py`. New conditional user-gate will need a new handler file here (e.g., `user_gate.py`) that wraps `pause.py`'s logic with a predicate check at the top.

- `hive/lib/dag_executor/executor/walker.py:112–1096` — Walker. `_scheduler_pause_decision()` (line 112) determines auto-approve vs actual halt for pause nodes in a scheduler context. `_is_pause_node()` used to filter pauses from parallel waves. The conditional gate node will need its own `_is_user_gate_node()` predicate check and a parallel treatment (user-gate nodes should run sequentially, not be dispatched into parallel waves).

- `.pHive/cross-cutting-concerns.yaml:1–119` — Three active concerns: `documentation`, `versioning`, `metrics`. The `scenario-replay-folded` concern is retired. Documentation concern applies to all stories (modifying skill files). Versioning concern applies (new consumer-visible `planning.mode: hive-dag` config key + plan cutover behavior). Metrics concern applies if stories claim measurable outcome improvement.

---

### PATTERNS_OBSERVED

- Pattern: **Cutover via `runner_path`** | File: `skills/execute/SKILL.md:147–152`, `skills/hive/skills/execute-dispatch/SKILL.md:15` | Detail: `/execute` delegates mode selection to `execute-dispatch`, receives `runner_path: hive-dag | orchestrator-narrated`, then branches at step 5pre. This is the exact pattern to mirror in `/plan`.

- Pattern: **`flow` parameter for planning vs execution** | File: `hive/lib/dag_executor/run.py:109–117` | Detail: `resolve_spawn_binding()` already reads per-flow env (`HIVE_{FLOW}_MODE`) and per-flow config (`{flow}.mode`). For `flow="planning"`, it reads `HIVE_PLANNING_MODE` and `planning.mode`. This means the Python layer already supports the planning flow — only the SKILL.md dispatch step and a `plan-dispatch` routing skill are missing.

- Pattern: **Gate ownership invariant** | File: `skills/plan/SKILL.md:179–184` | Detail: User review/sign-off gates are ALWAYS orchestrator-local. CC-Workflows and Multica planning output are artifact-readiness signals, not gate-advancement signals. The new DAG-based plan path must honor this: it must either (a) not auto-advance user-facing gates at all, OR (b) only auto-advance when a machine-verifiable predicate is satisfied (conditional gate design from requirement).

- Pattern: **Graduation registry gating** | File: `.pHive/runtime/executor-graduated-workflows.yaml` | Detail: Every workflow must appear in the registry for the executor to activate. The registry is the single rollback surface (remove the name to roll back). `plan` workflow would be added here as part of the cutover story.

- Pattern: **Consumer config additive gate** | File: `.pHive/hive.config.yaml` | Detail: `executor_default: false` means the DAG path for execute is currently OFF even though `executor: hive-dag` is set. Plan cutover should follow the same pattern: additive and off-by-default until the consumer explicitly opts in.

- Pattern: **Pause node: sentinel-file halt** | File: `hive/lib/dag_executor/executor/handlers/pause.py`, `hive/lib/dag_executor/pause/signal.py` | Detail: `node_type: pause` halts unconditionally, waits for `<node_id>.approve` or `<node_id>.reject` files with HMAC-signed tokens. The conditional user-gate node should reuse this sentinel mechanism for its "halt" path — only the entry predicate differs.

- Pattern: **`node_type: gate` (machine predicate)** | File: `hive/lib/dag_executor/graph/model.py:32`, `hive/lib/dag_executor/executor/handlers/gate.py` | Detail: Gate nodes evaluate a predicate against node outputs and pass or fail. They do NOT halt for human input. The new conditional user-gate sits between `gate` (no human) and `pause` (unconditional halt): it evaluates a predicate, auto-passes if satisfied, and halts (like pause) if not.

- Pattern: **`skills/hive/skills/plan-mode-multica/SKILL.md`** | Detail: Already exists as the Multica persona dispatch for planning. The `hive-dag` mode is a DIFFERENT surface — it routes the entire plan graph through the DAG executor, not just per-persona fan-out.

---

### CONSTRAINTS

- Constraint: **`NodeType` enum is closed** | Source: `hive/lib/dag_executor/graph/model.py:17` ("exactly {AGENT, SCRIPT, GATE, PAUSE}. No LOOP.") | Impact: Adding a conditional user-gate requires extending the enum with a new member (e.g., `USER_GATE = "user_gate"`). This is a Python-layer change.

- Constraint: **Gate ownership invariant (orchestrator-local gates)** | Source: `skills/plan/SKILL.md:179–184` | Impact: Story 3 (conditional user-gate) must be designed so the orchestrator (not the DAG executor autonomously) presents gates to the user. The DAG runner halts; the orchestrator surface reads the artifact, presents it to the user, then writes the approve/reject sentinel. This means the DAG-based plan flow must be orchestrator-wrapped at gate boundaries, not fully autonomous.

- Constraint: **Additive + graduation-registry-gated** | Source: `.pHive/hive.config.yaml`, `.pHive/runtime/executor-graduated-workflows.yaml` | Impact: The `plan` workflow must be added to the graduation registry. Consumer opt-in requires `executor_default: true` in `.pHive/hive.config.yaml`. Default orchestrator-narrated path must have ZERO regression.

- Constraint: **efcl-s6 converge-loop is a triage item (not shipped)** | Source: `.pHive/triage/queue.yaml:154,199` | Impact: The requirement mentions "coordinate with / reuse efcl-s6 converge-loop machinery." efcl-s6 is a triage entry about a bounded converge-loop primitive for the DAG graph model — **it is not yet implemented**. Story 3 (conditional user-gate) should be designed to be extensible for future efcl-s6 integration but should NOT depend on efcl-s6 landing first.

- Constraint: **`plan-dispatch` vs extending `execute-dispatch`** | Source: `skills/hive/skills/execute-dispatch/SKILL.md`, `skills/plan/SKILL.md:0c` | Impact: `execute-dispatch` is tightly coupled to execute-mode semantics (sessions, cmux, parallel teams, stories). For the plan flow, the dispatch is simpler: just `runner_path: hive-dag | orchestrator-narrated`. A thin `plan-dispatch` analogue is cleaner than retrofitting `execute-dispatch`. However, the runner resolution logic is already in `run.py:resolve_spawn_binding(flow="planning")`.

- Constraint: **`skills/plan/SKILL.md` step 0c insertion point** | Source: `skills/plan/SKILL.md:139–173` | Impact: The DAG cutover for plan must be checked BEFORE the existing step 0c persona dispatch modes (multica / cc-workflows / default). If `hive-dag` is active, bypass step 1 (team assembly), Phase A research (delegated to DAG nodes), and all subsequent steps — the DAG executor handles the full plan graph. The orchestrator only handles the user-facing gate surface.

---

### RISKS

- Severity: high | Risk: **Gate ownership invariant violation in DAG-automated plan flow.** The plan.workflow.yaml graph currently runs research ‖ design → author → reconcile → gate with no user halt points. If the DAG runner completes the full plan flow autonomously, it would bypass the design-discussion review gate (step 5 in SKILL.md), H/V gate, and structured-outline sign-off — all explicitly declared as "always local to the orchestrator." | Evidence: `skills/plan/SKILL.md:179–184` (gate ownership), `hive/workflows/plan.workflow.yaml:1–125` (no pause nodes currently).

- Severity: high | Risk: **New `user_gate` node type requires changes to multiple Python layers** (model.py enum, graph loader/validator, dispatcher registration, walker handling). Underestimating scope could delay Story 3. | Evidence: `hive/lib/dag_executor/graph/model.py:29–33` (closed enum), `hive/lib/dag_executor/executor/dispatcher.py` (registration pattern), `hive/lib/dag_executor/executor/walker.py:112` (pause scheduling logic that must be mirrored for user_gate).

- Severity: medium | Risk: **`plan` workflow graduation adds a live entrypoint.** Premature graduation could route plan runs through the executor for consumers who set `executor_default: true` without expecting this. The graduation registry comment says "added during cutover events per the locked Order 1-9 sequence." Plan workflow graduation would be Order 10+ and should require explicit consumer validation. | Evidence: `.pHive/runtime/executor-graduated-workflows.yaml` (graduation comment on Order 1-9).

- Severity: medium | Risk: **`run.py` main() CLI doesn't expose `flow` flag.** The orchestrator-prose step that calls `hive.lib.dag_executor.run_workflow(...)` for plan would need to pass `flow="planning"`. The Python API supports it; the CLI shim does not expose it. If the plan cutover uses the CLI shim, the `flow` would default to `"execution"` and the wrong config knob would be consulted. | Evidence: `hive/lib/dag_executor/run.py:244–275` (argparse lacks `--flow` argument).

- Severity: low | Risk: **efcl-s6 dependency for Story 3 is unresolved.** If conditional user-gate design is blocked on efcl-s6 primitives, Story 3 is blocked. The safest path is to design the conditional gate independently (reusing the pause sentinel machinery directly) with a documented extension point for when efcl-s6 ships. | Evidence: `.pHive/triage/queue.yaml:154,199` (efcl-s6 is triage, not in any epic yet).

---

### UTILITIES_AVAILABLE

- Utility: `hive.lib.dag_executor.run()` | File: `hive/lib/dag_executor/run.py:151` | Relevance: Production front-door for all DAG flows. Accepts `workflow_path`, `binding`, `flow`, `run_state_path`, `context`. Call with `flow="planning"`, `workflow_path="hive/workflows/plan.workflow.yaml"`, `context={"requirement": requirement}` for the plan cutover.

- Utility: `hive.lib.dag_executor.run_workflow()` | File: `hive/lib/dag_executor/__init__.py:155` | Relevance: Lower-level wrapper. Used by `/execute` step 5pre prose. Requires a pre-assembled dispatcher. `run()` in `run.py` is the simpler entry point.

- Utility: `hive.lib.dag_executor.pause.wait_for_signal()` | File: `hive/lib/dag_executor/pause/signal.py:69` | Relevance: Existing sentinel-file halt mechanism. Reusable directly for the conditional user-gate's halt path.

- Utility: `hive.lib.dag_executor.pause.generate()` | File: `hive/lib/dag_executor/pause/token.py` | Relevance: HMAC token generation for sentinel verification. Reuse in conditional user-gate handler.

- Utility: `hive.lib.dag_executor.executor.handlers.PauseHandler` | File: `hive/lib/dag_executor/executor/handlers/pause.py:46` | Relevance: Full pause handler. The new conditional user-gate handler can be implemented as a `ConditionalPauseHandler` that wraps or extends this class.

- Utility: `resolve_spawn_binding(flow="planning")` | File: `hive/lib/dag_executor/run.py:86` | Relevance: Already reads `HIVE_PLANNING_MODE` env and `planning.mode` config. The plan-dispatch routing for the Python layer is already wired here.

---

### EXTERNAL_REFERENCES

- Source: `skills/plan/SKILL.md §Phase A step 0c` | Relevance: Insertion point for `hive-dag` cutover check. Current modes: cc-workflows, multica, default. The new `hive-dag` check goes before these. | Key takeaway: The check belongs in Phase 0c (plan dispatch mode resolution), before the `planning-routing` call that spawns personas.

- Source: `skills/execute/SKILL.md §5pre` | Relevance: The cutover model. One conditional check after `execute-dispatch` returns `runner_path`. | Key takeaway: "Single dispatch point" — do not re-evaluate runner_path inline; use the dispatch skill's output.

- Source: `hive/references/workflow-schema.md` (referenced in requirement) | Relevance: Schema documentation for workflow YAML format. Needs a cutover section for the conditional user-gate node type. | Key takeaway: Need to read this file and add a `user_gate` node schema entry as part of Story 5.

---

### UNANSWERED_QUESTIONS

- How should the orchestrator surface the design-discussion artifact to the user when the plan DAG halts at the `user_gate` node? The pause handler writes a sentinel-dir path — does the orchestrator poll the run_state, or does the DAG runner emit an artifact path that the orchestrator reads?

- The requirement says the conditional gates should have "pause/resume on the existing `run_state_path` checkpoint — SHARED machinery with `efcl-s6`." But `efcl-s6` isn't implemented yet. Should Story 3 be designed as if efcl-s6 exists, or should it build the halt independently and leave an extension point?

- Is the `plan-dispatch` analogue a new SKILL.md file (`skills/hive/skills/plan-dispatch/SKILL.md`) or should it be a new section in the existing `plan-mode-multica` / `execute-dispatch` structure?

- The plan.workflow.yaml currently has `research ‖ design → author` — but the requirement says the design-discussion gate "always halts." This means a new `user_gate` node must be inserted BETWEEN `design` and `author`. Does this require creating a new `plan-with-gates.workflow.yaml` separate from the existing `plan.workflow.yaml`, or does the existing one get modified?

---

### INCONSISTENCY_RISK_SIGNALS

- Signal: vocabulary mismatch
  | Where: requirement ("runner_path from `execute-dispatch`") vs `skills/hive/skills/execute-dispatch/SKILL.md` outputs
  | Detail: Requirement says to "extend `execute-dispatch` (make it flow-agnostic) or add a planning analog." The execute-dispatch skill is deeply coupled to execution-mode semantics (stories, parallel teams, sessions). The word "extend" may overstate the shared surface — a `plan-dispatch` analogue is architecturally cleaner. The architect should resolve which path is chosen.

- Signal: hidden assumption
  | Where: requirement ("pause/resume on run_state_path — SHARED machinery with efcl-s6")
  | Detail: efcl-s6 is a triage item with no epic yet. The requirement assumes efcl-s6 machinery is available for Story 3 to coordinate with. This assumption may block Story 3 if interpreted as a hard dependency.

- Signal: unresolved tension
  | Where: `skills/plan/SKILL.md:179–184` (gate ownership invariant) vs plan DAG running research+design autonomously
  | Detail: The SKILL.md gate ownership invariant says "CC-Workflows-dispatched and Multica-dispatched planning may produce artifacts, but neither ever advances user review/sign-off gates." If `/plan` routes to the DAG executor, the DAG research/design nodes run autonomously. The tension: is running `research` and `design` nodes autonomously a gate-advancement issue, or is the invariant only about the human review gate at step 5? The architecture design must clarify this boundary.

- Signal: convention violation
  | Where: `hive/lib/dag_executor/graph/model.py:17` ("No LOOP") vs potential efcl-s6 converge-loop integration
  | Detail: The model comment explicitly says "No LOOP" for NodeType. If Story 3 tries to integrate efcl-s6's bounded converge-loop, this creates a conflict with the existing model contract.

- Signal: posture mismatch
  | Where: requirement says "5pre-equivalent for plan" vs plan.workflow.yaml currently having no pause/user-gate nodes
  | Detail: The `5pre` step in `/execute` is a routing fork — it decides BETWEEN the DAG executor and the orchestrator-narrated path. In the plan case, the "5pre-equivalent" would also be this routing fork. But the requirement also says the DAG executor itself needs conditional user-gate nodes. These are two separate concerns (routing fork + in-DAG gate nodes) that must both be solved. A design that only adds the routing fork without in-DAG gates would fail to route plan runs with user interaction through the DAG.

---

## VALIDATION NOTE

**Checked:** Python DAG executor module (`hive.lib.dag_executor`), YAML workflow schema, existing NodeType enum, pause/signal mechanism, graduation registry format.
**Source:** codebase-only (all validation performed by reading existing Python source, YAML files, and skill markdown files in the plugin-hive repository). No external library/SDK/API mentioned in the requirement beyond Python standard library and PyYAML — no context7 lookup needed.
**Confidence:** high — the implementation files are fully readable and the existing pause, gate, and executor patterns are well-documented with clear extension points.
**Findings:** No external dependency issues. The plan DAG cutover is a pure-internal change. Key version constraints: `NodeType` enum must be extended (Python change); graduation registry (YAML change); SKILL.md dispatch (Markdown change).
