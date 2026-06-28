---
name: planning-routing
description: Assemble and route a planning persona team across Multica, direct Agent(name:), and Codex-backed agent-spawn paths. Inherits the caller's model and execution context.
---

# Hive Planning Routing

> See `hive/references/dispatch-parity.md` for the canonical 6×3 substrate matrix — this routing skill is the **plan** row of that matrix.

Atomic skill, NOT inline `/plan` prose. It assembles the caller's planning persona team, resolves backend routing, spawns Multica, direct, and Codex paths, and returns active teammate handles plus final routing decisions. It inherits the caller's model and does not choose or override it.

## Invocation contract

Call this skill once per planning-team assembly.
Do not call it again after successful teammate creation unless abandoning the prior attempt.

**Inputs:** `assembled_personas` (ordered final planning persona list), `agent_backends` (resolved root-first routing map, `{}` if absent), `planning_mode_decision` (`cc-workflows` when `/plan` selected `HIVE_PLANNING_MODE=cc-workflows` or root `planning.mode: cc-workflows`; `multica` when `/plan` selected `HIVE_PLANNING_MODE=multica` or root `planning.mode: multica`; otherwise `default` or unset), and `requirement_summary` (concise task summary used in spawn prompts).

**Outputs:** `routing_decisions` (persona -> final `cc-workflows`, `multica`, `codex`, or `direct` path), `routing_reasons` (persona -> final reason), and `spawn_outcome` (active teammate handles/ids plus, for `cc-workflows`/`multica`-routed personas, the dispatch summary and per-persona episode marker paths sufficient for caller `SendMessage` work assignment and document reconciliation).

**Side effects:** emits exactly one INFO log line per persona at final spawn
decision; calls `plan-mode-cc-workflows` for CC-Workflows-routed personas;
invokes the DAG front door (`hive.lib.dag_executor.run`) for Multica-routed personas; calls `Agent(name:)`
for direct-routed personas; calls `agent-spawn` -> `codex-invoke` for
Codex-routed personas.

INFO log requested field uses planning-routing vocabulary:
`cc-workflows|multica|codex|direct|unset`.

## Process

### Step 0.1: Build Team Composition

**When the caller supplies `assembled_personas`:** use the list as-is. Do not re-evaluate requirements, add or remove personas, or apply the conditional selection rules below. The caller is the source of truth for roster composition. For `/plan`, this list is always supplied by the planning-classification skill (`skills/hive/skills/planning-classification/SKILL.md`) — planning-routing receives it, never re-derives it.

**Legacy / direct-caller fallback (only when `assembled_personas` is absent or empty):** If no caller-supplied list is provided, self-assemble using the rules below. This path exists for direct callers that have not yet integrated planning-classification.

**Core team (always included):**
- **researcher** (`hive/agents/researcher.md`) - codebase/web exploration, raw findings
- **technical-writer** (`hive/agents/technical-writer.md`) - formatted docs
- **tpm** (`hive/agents/tpm.md`) - delivery sequencing, H/V thinking

**Conditional members (legacy fallback only — catalog is now the source of truth for /plan):**
- **architect** (`hive/agents/architect.md`) - add for architecture decisions, multi-system integration, medium/large scale, API design, data model changes, infrastructure, or "architecture" signals.
- **ui-designer** (`hive/agents/ui-designer.md`) - add for UI work: screens, components, visual design, wireframes, frontend flows, layout, states, or design review. Do not add for purely backend/infrastructure work.

Routing happens only after the assembled persona list is finalized. Backend routing must not change team composition.

### Step 0.2: Build Routing Decisions

If `planning_mode_decision == cc-workflows`, route every persona in
`assembled_personas` to `cc-workflows` with reason `no-fallback-needed`. This
is a spawn-path override selected by `/plan`; do not filter the assembled list
through the Codex supported/known-incompatible tables. CC Workflows persona/provider
validity is owned by `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` and the
Workflow tool seam shared with `execute-mode-cc-workflows`.

If `planning_mode_decision == multica`, route every persona in
`assembled_personas` to `multica` with reason `no-fallback-needed`. This is a
spawn-path override selected by `/plan`; do not filter the assembled list through
the Codex supported/known-incompatible tables. Dispatch is via the DAG front door
(`hive.lib.dag_executor.run`) running the plan graph
(`hive/workflows/plan.workflow.yaml`) with `binding=multica` — not per-persona
fan-out. The plan graph owns per-node work; the calling orchestrator retains all
user-facing review gates (design-discussion, H/V, structured-outline sign-off).
Graph completion is an artifact-readiness signal only — never a user sign-off.

Otherwise, for each persona in `assembled_personas`, consult `agent_backends`
using the root-first precedence contract already resolved by the caller. Compare
the configured backend against `skills/hive/skills/codex-invoke/SKILL.md`
`Supported personas (PoC)` and `Known-incompatible personas`.

Produce `routing_decisions` with one value per persona: `multica`, `codex`, or
`direct`. Also store tentative `routing_reason` for Step 0.3 final INFO emission.

- When `agent_backends[persona] == codex` and persona is supported, route `codex` with reason `no-fallback-needed`.
- When `agent_backends[persona] == codex` and persona is known-incompatible, route `direct` with reason `known-incompatible`.
- When `agent_backends[persona] == codex` and persona is in neither list, route `direct` with reason `unvalidated-persona`.
- When `agent_backends[persona] == claude`, route `direct` with reason `claude-requested` (configured Claude personas use the direct Agent(name:) path; the value `claude` is canonical per hive.config.yaml `Supported backends: claude | codex`).
- When `agent_backends[persona]` is unset or `agent_backends` is absent, route `direct` with reason `agent_backends-unset`.

Apply this only to personas present in the assembled list. `ui-designer` is always `direct` even when configured to `codex`, because codex-invoke marks it known-incompatible. Step 0.2 does not emit INFO logs.

### Step 0.3: Spawn Across Three Paths

> **Parallel-call-site annotation (audit pass):** `parallel_rationale: read-only` — the planning team produces design-discussion documents under `.pHive/epics/{id}/docs/`; no production code writes. Out-of-scope for the `ed-7` story-level fan-out gate (one team with N personas, not N independent stories); catalogued in [`hive/references/parallel-call-sites.md`](../../../../hive/references/parallel-call-sites.md) §3 (`planning-routing:mixed-team`).

Use `routing_decisions` to assemble one conceptual planning team:

- **CC Workflows path (`plan-mode-cc-workflows`):** when any persona is routed
  `cc-workflows`, call `skills/hive/skills/plan-mode-cc-workflows/SKILL.md` once
  with the full CC-Workflows-routed persona list, planning story payload, epic
  handle, config, and integration branch context. `plan-mode-cc-workflows` owns
  per-persona Workflow tool dispatch, polling, and `cc-workflows-run.yaml`
  episode markers. Do not also create local teammates for a CC-Workflows-routed
  persona unless fallback is triggered.
- **DAG front-door path (plan graph):** when `planning_mode_decision == multica`
  (any persona is routed `multica`), invoke the DAG front door to run the plan
  graph with the Multica binding:

  ```python
  from hive.lib.dag_executor.run import run

  result = run(
      "hive/workflows/plan.workflow.yaml",
      binding="multica",
      context={"requirement": requirement_summary},
  )
  ```

  The plan graph (`plan.workflow.yaml`) owns the per-node work — research,
  design, author, reconcile, and output-validation. Graph completion is an
  **artifact-readiness signal only**; it is NOT a user sign-off. The calling
  orchestrator (`/plan`) retains all user-facing review gates (design-discussion,
  H/V, structured-outline sign-off) and MUST present and wait at them locally
  after the graph completes. Do not also create local teammates for a
  multica-routed persona unless DAG fallback is triggered.
- **Direct path (`Agent(name:)`):** collect every persona routed `direct` and spawn each as an `Agent(name:)` teammate. Parallel dispatch requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (research preview, NOT GA); without the flag, execution is SEQUENTIAL — the guaranteed floor. Use Step 0.4 and include only direct-routed personas in `## Team Members`.
- **Codex path (`agent-spawn` -> `codex-invoke`):** for each persona routed `codex`, create a separate persistent-pane teammate through `agent-spawn`, passing full persona context, resolved paths, memory loading context, and the same planning-team coordination context direct teammates receive.

Mixed teams are valid. Some planning personas may come from
`plan-mode-cc-workflows`, some from the DAG front-door path (plan graph), some
from `Agent(name:)`, and others from `agent-spawn` -> `codex-invoke`; they are
still one planning team. The caller remains coordinator and uses `SendMessage`
for assignments and review loops where local teammate handles exist, and uses the
`plan-mode-cc-workflows` summaries and episode markers for CC-Workflows-produced
work, and the DAG front door result for Multica-dispatched planning work.

Emit the structured INFO log after each persona's final spawn path is known. If
Step 0.5 handles a runtime Multica or Codex failure, update that persona's result
to the fallback outcome instead of adding a second line.

Preserve the 4-field template exactly:
- `[info] planning routing: persona={X} requested={cc-workflows|multica|codex|direct|unset} path={plan-mode-cc-workflows|dag-plan-graph|codex-invoke|Agent} reason={reason}`

Valid `reason=` values:
- `no-fallback-needed`
- `known-incompatible`
- `unvalidated-persona`
- `agent_backends-unset`
- `cc-workflows-precondition-failed: {error}`
- `cc-workflows-dispatch-failed: {error}`
- `multica-daemon-down: {error}`
- `multica-dispatch-failed: {error}`
- `codex-dispatch-failed: {error}`

Examples:
- `[info] planning routing: persona=researcher requested=cc-workflows path=plan-mode-cc-workflows reason=no-fallback-needed`
- `[info] planning routing: persona=researcher requested=cc-workflows path=codex-invoke reason=cc-workflows-precondition-failed: claude-version-too-low`
- `[info] planning routing: persona=researcher requested=multica path=dag-plan-graph reason=no-fallback-needed`
- `[info] planning routing: persona=researcher requested=multica path=codex-invoke reason=multica-daemon-down: ECONNREFUSED`
- `[info] planning routing: persona=ui-designer requested=multica path=Agent reason=multica-daemon-down: ECONNREFUSED`
- `[info] planning routing: persona=technical-writer requested=codex path=codex-invoke reason=no-fallback-needed`
- `[info] planning routing: persona=ui-designer requested=codex path=Agent reason=known-incompatible`
- `[info] planning routing: persona={X} requested=codex path=Agent reason=unvalidated-persona`
- `[info] planning routing: persona={X} requested=direct path=Agent reason=no-fallback-needed`
- `[info] planning routing: persona={X} requested=unset path=Agent reason=agent_backends-unset`

Return `spawn_outcome` with all active direct and Codex teammate handles plus
the CC-Workflows and Multica dispatch summaries and per-persona episode marker
paths for CC-Workflows-routed and Multica-routed personas. The caller does not
need to know which local backend produced a handle before assigning normal
planning work.

### Step 0.4: Per-Persona Direct Agent(name:) Prompts

Spawn each direct-routed persona as its OWN `Agent(name: "{persona}")` teammate
with a prompt scoped to that single persona. Do NOT render one combined prompt
listing every persona — render one scoped prompt per direct persona. Each
per-persona prompt carries only that persona's role and context, plus a separate
roster/coordination block naming the rest of the planning team. Build each from
`requirement_summary`, `assembled_personas`, and `routing_decisions`. The caller
may provide `{caller_phase_label}` for traceability; this skill does not hardcode
`/plan` phase references.

Render this per-persona prompt once per direct-routed persona, substituting that
persona's single role line (drop the other role lines) and listing the remaining
team members in the roster:

```text
You are joining a planning team for requirement: "{requirement_summary}"

## Your role (this teammate only)
[exactly one role line below — the one matching {persona}]

researcher - Explore the target codebase. Read persona from hive/agents/researcher.md.
Load memories from the agent's knowledge paths. Gather raw findings: file paths, patterns, constraints, risks.

technical-writer - Produce formatted planning documents. Read persona from hive/agents/technical-writer.md.
Load memories from the agent's knowledge paths. Transform raw findings into research briefs, design discussions, H/V plans, structured outlines.

tpm - Sequence delivery planning. Read persona from hive/agents/tpm.md.
Load memories from the agent's knowledge paths. Own horizontal/vertical thinking. Review all documents for delivery feasibility.

architect - Evaluate technical feasibility. Read persona from hive/agents/architect.md.
Load memories from the agent's knowledge paths. Review designs for architectural soundness.

ui-designer - Produce wireframes and review UI aspects. Read persona from hive/agents/ui-designer.md.
Load memories from the agent's knowledge paths. Scan existing design language before proposing new UI.

## Team roster & coordination
- Your teammates on this planning team: {the other assembled personas, by name}.
- Orchestrator assigns work via SendMessage.
- All agents review documents before user presentation (collaborative review gate).
- Read your full persona file and load your memory directory.
- Use agent-spawn skill patterns: load full persona, resolve paths, load memories.
```

Emit one `Agent(name: "{persona}")` call per direct-routed persona — each prompt
includes only that persona's role line and names the other team members in the
roster. Personas routed to other paths (Codex, Multica, CC-Workflows) are named
in the roster for coordination but are NOT spawned via `Agent(name:)` here.
Codex-routed personas participate via separate panes and read team context from
their own `agent-spawn` prompt. Multica-routed personas participate through the DAG front door
(`hive.lib.dag_executor.run` + `plan.workflow.yaml`) and receive the planning
context via the `context.requirement` field passed to the graph.

**Agent-spawn compliance:** Every codex-routed teammate must follow `skills/hive/skills/agent-spawn/SKILL.md` patterns: full persona injection, path resolution (`~`, `${CLAUDE_PLUGIN_ROOT}`), memory loading, domain constraints, and required tool validation. Direct `Agent(name:)` teammates still read their persona files and load knowledge paths on startup.

### Step 0.5: Runtime Fallback

Fallback order is `cc-workflows` -> `codex` -> `direct` for CC-Workflows-routed
personas, and `multica` -> `codex` -> `direct` for Multica-routed personas.
CC-Workflows and Multica are sibling spawn-path overrides; falling from one to
the other is not a supported transition because the user picked the requested
mode for substrate-shape reasons. Fall through to Codex (and then direct) on
runtime rejection instead.

If `plan-mode-cc-workflows` returns a Step 0 `precondition_failed` (CC runtime
too low, Workflow tool absent, `planning.mode` / `HIVE_PLANNING_MODE` not
resolving to `cc-workflows`, `assembled_personas[]` empty, or `planning_story`
missing), handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route each affected persona to Codex when that persona is supported by
   `codex-invoke` and not known-incompatible; otherwise re-route it to direct
   `Agent(name:)`.
3. If the Codex fallback for an affected persona also fails, apply the Codex
   fallback rules below and end at direct `Agent(name:)`.
4. Update the Step 0.3 INFO log outcome for each affected persona:
   `[info] planning routing: persona={X} requested=cc-workflows path={codex-invoke|Agent} reason=cc-workflows-precondition-failed: {error}`
   where `{error}` is truncated to 120 chars and reflects the
   `field_sources` citation from the structured precondition_failed payload.
5. Continue the planning flow.

If `plan-mode-cc-workflows` returns a non-precondition dispatch failure for any
persona after Step 0 passed (Workflow tool invocation error, persona file
missing, agent failed terminal status, episode marker write failed), handle it
gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to Codex when supported, otherwise direct
   `Agent(name:)`.
3. If the Codex fallback also fails, apply the Codex fallback rules below.
4. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=cc-workflows path={codex-invoke|Agent} reason=cc-workflows-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
5. Continue the planning flow.

If the DAG front door dispatch fails before or during graph execution because the
Multica daemon is down or unreachable (connection refused, timeout resolving the
server/workspace, daemon health check failure, or equivalent transport setup
error during `binding=multica` init), handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route each affected persona to Codex when that persona is supported by
   `codex-invoke` and not known-incompatible; otherwise re-route it to direct
   `Agent(name:)`.
3. If the Codex fallback for an affected persona also fails, apply the Codex
   fallback rules below and end at direct `Agent(name:)`.
4. Update the Step 0.3 INFO log outcome for each affected persona:
   `[info] planning routing: persona={X} requested=multica path={codex-invoke|Agent} reason=multica-daemon-down: {error}`
   where `{error}` is truncated to 120 chars.
5. Continue the planning flow.

If the DAG front door returns a non-daemon dispatch failure for any persona
after reaching the daemon (graph step error, node timeout, or executor error),
handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to Codex when supported, otherwise direct
   `Agent(name:)`.
3. If the Codex fallback also fails, apply the Codex fallback rules below.
4. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=multica path={codex-invoke|Agent} reason=multica-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
5. Continue the planning flow.

If `codex-invoke` dispatch FAILS at runtime for any persona (Codex CLI missing, auth expired, cmux pane creation error, pre-flight failure, timeout, or any error returned from `agent-spawn`/`codex-invoke`), handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to direct `Agent(name:)` in a follow-up call. Re-compose the prompt to add the failed persona, or use `SendMessage` to instruct existing `Agent(name:)` teammates to adopt the re-routed teammate.
3. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=codex path=Agent reason=codex-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
4. Continue the planning flow.

If the orchestrator observes repeated Codex failures (>=3 within one planning invocation), it MAY skip remaining Codex-routed personas for the invocation. Route skipped personas through `Agent(name:)`, emit their per-persona INFO logs, and set reason `codex-dispatch-failed: circuit breaker`.

Every planning-persona spawn, success or fallback, must emit exactly one structured INFO log line per persona at the final spawn decision point. Do not skip the INFO log or collapse multiple persona routings into one line.
