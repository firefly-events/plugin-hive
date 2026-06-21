# Architect Review — DAG-driven Hive flows on Multica

**Reviewer:** architect (planning team `dag-flows-multica`)
**Scope:** feasibility of making the DAG executor the single substrate; Multica as agent execution only behind `AgentSpawn`.

## VERDICT: approve-with-escalation

The core seam is sound: `AgentSpawn` (agent.py:43-58) is a clean Protocol, `AgentHandler.handle` already passes `agent` raw and `step_file_content` verbatim, and the local↔Multica swap is one injected callable. The gate/dispatcher/loader reuse claims check out. But the straw-man assumes two Multica bridge capabilities that **do not exist as code**, and asserts a graph-loop need the model explicitly forbids. These must be resolved before /execute.

## Findings

### 1. MulticaAgentSpawn mapping — impedance mismatch (the big one)
`dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid)` (index.mjs:284) requires a **pre-existing issue UUID**. `AgentSpawn.__call__` carries only `(agent name, step_file_content, inputs, run_id, step_id)`. The bridge exports `resolveAgentUuidByName`, `ensureIssueBriefMatches`, `moveOutOfBacklogIfNeeded` — but **no create-issue/create-task function**. The straw-man (§3 build item 1, s4 spec) says "create/route a Multica task carrying step_file_content" — that create surface is unbuilt. The binding must mint an issue per node (issue UUID = the throwaway carrier; `step_file_content`→brief via `ensureIssueBriefMatches`). That is a new `cli.mjs create` command, not a wrap of existing functions. **The s4 spec understates this as a wrap; it is net-new bridge surface.**

### 2. Harvest/reconcile — assumed function does not exist
§5 R5 and s4 say "MulticaAgentSpawn performs reconcile (fetch-from-bare + ff-merge) before returning." There is **no exported reconcile/ff-merge** in index.mjs or multica-bootstrap (`ensureRepos` index.mjs:269 only *binds* a repo). Reconcile today is the manual orchestrator git pattern (memory `feedback_multica_execute_drive_pattern`: fetch-from-bare + `merge --ff-only`, push-before-next-dependent). Recommendation: **reconcile should be its own SCRIPT node**, not hidden inside the binding — it is shared, deterministic, git-only, needs no agent, and the validation gate (s3) must provably run *after* it. Burying it in the binding hides the harvest from the graph and makes resume/replay opaque.

### 3. inputs/outputs contract — committed files are the contract
Agents commit files; the returned dict cannot be trusted (north-star 2: lead over-claimed "committed" with empty tree). So the **output dict is advisory; committed+reconciled files are the contract**, enforced by the s3 gate reading disk/repo. This is consistent with s3 but the design should state it explicitly: `NodeOutput.outputs` from a Multica node is best-effort metadata (issue id, branch), not the artifact. Downstream `step_output` bindings must depend on gate-verified paths, not agent self-report.

### 4. Graph expressiveness — no loops (model lock)
model.py:34 locks `NodeType = {AGENT,SCRIPT,GATE,PAUSE}` — "No LOOP"; `Graph` is a DAG (no cycle support). plan/review/test map fine as linear+conditional (`when`/`skip_when` + `retry` dict exist). **But TDD red→green→refactor and review→revise→re-review are loops.** The straw-man treats the run/develop flow as single-agent-node DAGs without addressing iteration. Either (a) model revise as bounded retry on a single node, or (b) unroll fixed passes — both are lossy vs. the current LLM-narrated loop. This needs an explicit decision, not silence.

### 5. Risk-table gaps
- Missing: **no create-task surface** (finding 1) — higher severity than any listed risk.
- Missing: **resume across the Node bridge** — `run_state`/Walker resume assumes deterministic re-dispatch; a half-minted Multica issue on replay risks duplicate issues (memory: hand-rolled driver reuses `tracker_id` to avoid dupes). Binding must be idempotent on `(run_id, step_id)`.
- R5 mitigation is unsound as written (assumes nonexistent reconcile fn).
- Spec split: **s4 should split** into (4a) cli.mjs create+dispatch surface, (4b) Python MulticaAgentSpawn binding. Add a spec (or fold into s3) for the **reconcile SCRIPT node**.

## Escalation Flags
- [high] s4-multica-spawn — assumes a Multica create-issue/task surface that does not exist in the bridge; spec must add net-new `cli.mjs create` + idempotency, not "wrap existing".
- [high] reconcile-harvest — straw-man R5 relies on a nonexistent ff-merge function; promote reconcile to an explicit SCRIPT node so the s3 gate provably runs post-harvest.
- [med] graph-loops — TDD/review iteration has no loop primitive (model.py:34 "No LOOP"); decide bounded-retry vs unroll before mapping the run/develop + test flows.
- [med] bridge-resume-idempotency — replay/resume can mint duplicate Multica issues; binding must key idempotency on (run_id, step_id) and reuse tracker_id.
