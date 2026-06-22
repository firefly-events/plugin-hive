# Design Discussion — DAG-driven Hive flows on Multica

Epic: `dag-flows-multica`
Date: 2026-06-21
Author: orchestrator (authored directly — see §0)

## §0. Prelude / provenance

This plan was authored directly by the planning orchestrator rather than dispatched
to a Multica planning team. Two reasons:

1. **The architecture is already decided.** See memory
   `project_planning_dag_multica_spawn` (DECIDED 2026-06-21) and
   `project_hermes_loop_next_steps`. This is a decomposition of a committed design,
   not an open research question.
2. **The substrate we are planning does not yet exist** — there is no production
   DAG-on-Multica path to dispatch this very plan through, and the Studio Multica
   runtime 401s Claude agents headless (only Codex agents run unattended). Spinning
   the Multica planning team here would fail. The irony is the point: this epic
   *builds* the thing that would let future `/plan` runs dispatch to Multica.

Recon (read-only Explore agent) verified every file/symbol cited below against HEAD.

**git_flow:** helper not invoked inline; defaulting `base_branch: develop`,
`branch_strategy: per-epic`. develop is staging-trunk (see
`feedback_seek_direct_push_auth`).

## §1. Goal

Make the **deterministic DAG executor** (`hive/lib/dag_executor/`) the single
orchestration substrate for **all** Hive command flows — `/plan`, `/execute`
(classic + tdd + bdd), `/test`, `/review` — with **Multica** providing only the
agent-execution layer behind the `AgentSpawn` Protocol seam.

The DAG owns flow, gates, routing, schema validation, and resume (deterministic,
in plugin code). Multica owns one node's research/design/writing/coding (non-
deterministic, contained behind the seam). One concern, one home.

North stars:
1. **Code owns the runbook.** If a flow has a fixed runbook, it is a DAG graph —
   never a squad LLM-lead, never exported-skill-as-process, never `.pHive` process
   files. (Squads keep their niche: dynamic, finding-driven sub-processes you
   cannot pre-draw, e.g. a root-cause investigation.)
2. **Never trust the agent's self-report.** The squad experiment proved the LLM
   lead over-claims "committed" with nothing committed. Every flow that produces
   artifacts ends in a **deterministic output-validation gate** that verifies the
   committed files in code.
3. **One binding swaps the whole substrate.** Local vs Multica execution is a
   single `AgentSpawn` binding choice; the same graphs run either way.

## §2. The seam (verified, already exists)

`hive/lib/dag_executor/executor/handlers/agent.py`:

```python
class AgentSpawn(Protocol):
    def __call__(self, agent: str, step_file_content: str,
                 inputs: dict, run_id: str, step_id: str) -> dict: ...
```

- `step_file_content` is passed **verbatim** into the agent prompt — no paraphrase,
  no summarise (handler docstring is explicit; `test_handlers_agent.py` asserts it).
- `AgentHandler(spawn, repo_root)` dispatches agent nodes through the binding.
- `StubAgentSpawn` (deterministic, records calls) exists for tests/fixtures.
- **No production binding exists.** `dag_executor/__init__.py:173–177` explicitly
  says the *caller* must assemble the dispatcher with a real `AgentHandler(spawn=…)`.
  Nothing in non-test code does this today. This is the core substrate gap.

## §3. What already exists vs what we build

**Reuse as-is (verified):**
- Graph model — `Graph`, `Node`, `ConditionalEdge`, `OutputRef`, `NodeType`,
  `InputBinding` (`graph/model.py`). Node carries `id, agent, node_type, task,
  step_file, inputs, outputs, gate, when, skip_when, depends_on, tools, …`.
- Graph loader — YAML `*.workflow.yaml`; `load_workflow(path)`,
  `load_all_workflows(dir="hive/workflows")` (`graph/loader.py`). Existing graphs:
  `development.bdd.workflow.yaml`, `design-review.workflow.yaml`,
  `daily-ceremony.workflow.yaml`.
- Gate framework — `GateHandler.handle()` returns `gate_passed: True` or raises
  `GateFailedError` (`handlers/gate.py`). `Dispatcher.register(NodeType, handler)`
  + `dispatch()` (`executor/dispatcher.py`); default map covers SCRIPT/GATE/PAUSE.
- `ScriptHandler`, `PauseHandler`, `run_state/` (store, resume, archive).
- Multica dispatch (Node bridge) — `dispatchStoryToAgent()`, `pollTaskUntilTerminal()`,
  `resolveAgentUuidByName()` (`hive/lib/multica-story-dispatch/`), `cli.mjs`.
- `ensureRepos()` — exported from `multica-bootstrap/index.mjs` (this epic's first
  commit on-branch), currently **unused**.

**Build:**
1. **`MulticaAgentSpawn`** (Python) — implements `AgentSpawn`. Each call: resolve
   agent uuid by name → create/route a Multica task carrying `step_file_content`
   as the verbatim brief → dispatch → `pollTaskUntilTerminal` → reconcile the
   agent's commits (fetch-from-bare + ff-merge) → harvest outputs → return dict.
   Python→Node bridge: shells `cli.mjs` and parses JSON stdout (multica dispatch is
   a named Node bridge surface; do not port it). Sibling to the local binding.
2. **Local `AgentSpawn` binding** — wraps agent-spawn Step 7 for local/attended runs.
   Default binding; Multica is the swap-in. (Neither exists in prod yet.)
3. **Production executor assembly + run entrypoint** — one place that builds the
   dispatcher (AgentHandler(spawn) + Gate/Script/Pause), loads a graph, runs it with
   run_state/resume, selects the binding by config/env. The missing front door.
4. **Output-validation gate** — schema-validates committed `.pHive/epics` (plan) /
   changed files (execute/test/review) against the story/epic schema *in code*,
   after the producing node. Reuses `GateHandler`/`GateFailedError`; new validation
   logic + a gate/script node per graph.
5. **Per-flow graphs** — author/extend `*.workflow.yaml` for plan, execute
   (classic/tdd; bdd extends existing), test, review; single-agent nodes; verbatim
   per-node `step_file`s. The graph IS the source of truth.
6. **Skill wiring** — `/plan`, `/execute`, `/test`, `/review` route to the DAG run
   entrypoint when the backend resolves to DAG/Multica, via the existing routing
   seams (planning-routing, execution mode-resolve). Gates stay local to the
   orchestrator — Multica completion ≠ user sign-off.
7. **Repo-bind completion** — wire `ensureRepos` into multica-init; un-defer the
   stale SKILL text (lines 33-34, 58-60); status + unit test. Hard prereq: without a
   bound repo, task workdirs are bare scaffolds and agents cannot commit output.

## §4. Layering (one home per concern)

| Concern | Home | Deterministic |
|---|---|---|
| Flow / gates / routing / schema validation / resume | DAG graph + executor (plugin code) | yes |
| One node's research/design/writing/coding | Multica agent behind `AgentSpawn` | no (contained) |
| Which agent fills a node | roster / config | yes |
| Plan/exec OUTPUT (epics, stories, code) + project config | the PROJECT repo `.pHive/` | n/a |

Process never lives in the project repo (project ≠ plugin). Output lands in the
project's `.pHive/` / working tree.

## §5. Risks

| # | Sev | Risk | Mitigation |
|---|---|---|---|
| R1 | high | Multica runtime 401s Claude agents headless; only Codex runs unattended (Studio Keychain/launchd root cause, `project_hermes_loop_next_steps`). | Operational prereq, not a code fix. Route DAG-on-Multica creator nodes to Codex agents (`feedback_codex_general_backend`) for headless; document Claude-needs-GUI-session caveat. Captured, not solved by this epic. |
| R2 | high | Agent self-report unreliable ("committed" with nothing committed). | North-star 2: every artifact-producing flow ends in a deterministic output-validation gate reading committed files. |
| R3 | high | No production executor binding exists — the run entrypoint is greenfield; easy to accidentally re-implement agent-spawn inside the handler. | Handler stays untouched; build only the *assembly + run* front door + the two bindings. `test_handlers_agent.py` guards the verbatim contract. |
| R4 | med | Two competing orchestrators (DAG walker vs squad LLM-lead) fight over flow if both used. | Decision: DAG owns flow; Multica = agent execution only. No squads in any of these flows. |
| R5 | med | Harvest gap — DAG must reconcile agent commits (bare→ff-merge) before the gate validates, or it validates an empty tree. | MulticaAgentSpawn performs reconcile before returning; gate runs post-reconcile. Mirror `feedback_multica_execute_drive_pattern`. |
| R6 | med | Python→Node bridge brittleness (subprocess JSON contract to cli.mjs). | Pin a thin, tested JSON I/O contract; unit-test the bridge with a recorded cli.mjs fixture. |
| R7 | med | Per-flow step_files drift from the canonical skill prose they replace. | step_files are the deterministic per-node truth; cite source skill sections; covered by graph validator + review. |
| R8 | low | Large blast radius — 4 flows in one epic; ship gated on all green. | Vertical slices: substrate first, then one flow per slice, each E2E-green independently before the next. |

## §6. Dependencies

- `/hive:multica-init` bootstrap + bound repo + a healthy Multica server with a
  working agent runtime (Codex for headless).
- Existing DAG executor primitives (model/loader/dispatcher/gate/run_state) — all
  present and tested.
- Node bridge: `multica-story-dispatch` + `multica-bootstrap` (incl. `ensureRepos`).

## §7. Open questions (for user)

1. **Methodology for this epic** — substrate is exploratory Python + bridge work.
   Proposing `classic` (research→implement→test→review→integrate). Override?
2. **Version bump** — feature-large; proposing `minor`. (Asked at confirmation.)
3. **Backend default** — should DAG flows default to the *local* `AgentSpawn`
   binding (Multica opt-in via config/env), matching the safe-default pattern? Or
   default to Multica where `planning.mode: multica` / `execution.mode: multica`
   already set? Proposing: binding follows the existing mode knobs; local is the
   fallback when unset.
4. **Test/review graphs** — `/test` and `/review` flows are less crisply specified
   than plan/execute. Author minimal graphs (single producer node + validation
   gate) this epic and deepen later, or full-fidelity now? Proposing minimal-then-deepen.

## §8. Scale assessment

**Large.** Multi-system (Python DAG executor + Node Multica bridge + skill markdown
wiring), greenfield production entrypoint, 4 distinct flows, long horizon. Warrants
vertical slicing (see `vertical-plan.md`) with one flow proven E2E per slice.

## §9. Team-review synthesis (revisions)

Architect (approve-with-escalation), TPM, researcher reviewed the straw-man. Docs +
story set revised. Findings folded in (full docs: `architect-review.md`,
`tpm-sequencing.md`, `research-deepen.md`; escalations: `.pHive/cycle-state/dag-flows-multica.yaml`):

- **Create-task is net-new** (high). The Multica bridge has no create-issue function —
  `dispatchStoryToAgent` needs a pre-existing issue UUID. MulticaAgentSpawn mints a
  throwaway task per node via a new `POST /api/issues` helper in `cli.mjs`. Story
  `s5-multica-bridge` owns this; `s6-multica-spawn` consumes it.
- **Reconcile is a SCRIPT node, not a binding side-effect** (high). No fetch/ff-merge
  helper exists; agent work lands on `agent/<persona>/<run>`. New `s7-reconcile-node`
  runs after agent nodes, before the gate, so the gate provably validates real files.
- **No LOOP primitive** (med, OPEN Q §7.5). `graph/model.py:34` locks a strict DAG.
  TDD red→green→refactor and review→revise have no loop home. Proposed default:
  single-pass flows + bounded `Node.retry` for self-correction on gate fail; defer
  true multi-node loops. User decides at confirmation.
- **Idempotency** — bridge resume can mint duplicate issues; MulticaAgentSpawn keys
  on `run_id+step_id` and reuses `tracker_id` (mirrors `feedback_handrolled_multica_driver_gotchas`).
- **Committed files = the contract**, not the output dict. The gate (and downstream
  nodes that need artifacts) read the reconciled working tree.
- **Sequencing** — repo-bind gates Slice 2 (not Slice 1); execute/test/review are a
  PARALLEL band after the spine; some graphs already exist (`development.*.workflow.yaml`,
  `test-swarm.workflow.yaml`) so those flows EXTEND rather than author from scratch;
  R1 (Multica 401 headless) de-risked on the trivial 2-node graph at Slice 2.

### §7.5 Open question — loop handling (added)
TDD/review loops vs strict-DAG. Proposed: single-pass + bounded `retry`; defer loops.

