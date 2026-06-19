---
name: planning-routing
description: Assemble and route a planning persona team across Multica, direct TeamCreate, and Codex-backed agent-spawn paths. Inherits the caller's model and execution context.
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
calls `plan-mode-multica` for Multica-routed personas; calls `TeamCreate`
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
the Codex supported/known-incompatible tables. Multica persona/provider validity is
owned by `skills/hive/skills/plan-mode-multica/SKILL.md` and the Multica agent
roster.

Otherwise, for each persona in `assembled_personas`, consult `agent_backends`
using the root-first precedence contract already resolved by the caller. Compare
the configured backend against `skills/hive/skills/codex-invoke/SKILL.md`
`Supported personas (PoC)` and `Known-incompatible personas`.

Produce `routing_decisions` with one value per persona: `multica`, `codex`, or
`direct`. Also store tentative `routing_reason` for Step 0.3 final INFO emission.

- When `agent_backends[persona] == codex` and persona is supported, route `codex` with reason `no-fallback-needed`.
- When `agent_backends[persona] == codex` and persona is known-incompatible, route `direct` with reason `known-incompatible`.
- When `agent_backends[persona] == codex` and persona is in neither list, route `direct` with reason `unvalidated-persona`.
- When `agent_backends[persona] == claude`, route `direct` with reason `claude-requested` (configured Claude personas use the direct TeamCreate path; the value `claude` is canonical per hive.config.yaml `Supported backends: claude | codex`).
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
- **Multica path (`plan-mode-multica`):** when any persona is routed `multica`,
  call `skills/hive/skills/plan-mode-multica/SKILL.md` once with the full
  Multica-routed persona list, planning story payload, config, and integration
  branch context. `plan-mode-multica` owns per-persona fan-out, polling, and
  `multica-run.yaml` episode markers. Do not also create local teammates for a
  Multica-routed persona unless fallback is triggered.
- **Direct path (`TeamCreate`):** collect every persona routed `direct` and create them in one `TeamCreate` call. Use Step 0.4 and include only direct-routed personas in `## Team Members`.
- **Codex path (`agent-spawn` -> `codex-invoke`):** for each persona routed `codex`, create a separate persistent-pane teammate through `agent-spawn`, passing full persona context, resolved paths, memory loading context, and the same planning-team coordination context direct teammates receive.

Mixed teams are valid. Some planning personas may come from
`plan-mode-cc-workflows`, some from `plan-mode-multica`, some from `TeamCreate`,
and others from `agent-spawn` -> `codex-invoke`; they are still one planning
team. The caller remains coordinator and uses `SendMessage` for assignments and
review loops where local teammate handles exist, and uses the
`plan-mode-cc-workflows` / `plan-mode-multica` summaries and episode markers for
CC-Workflows-produced / Multica-produced work.

Emit the structured INFO log after each persona's final spawn path is known. If
Step 0.5 handles a runtime Multica or Codex failure, update that persona's result
to the fallback outcome instead of adding a second line.

Preserve the 4-field template exactly:
- `[info] planning routing: persona={X} requested={cc-workflows|multica|codex|direct|unset} path={plan-mode-cc-workflows|plan-mode-multica|codex-invoke|TeamCreate} reason={reason}`

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
- `[info] planning routing: persona=researcher requested=multica path=plan-mode-multica reason=no-fallback-needed`
- `[info] planning routing: persona=researcher requested=multica path=codex-invoke reason=multica-daemon-down: ECONNREFUSED`
- `[info] planning routing: persona=ui-designer requested=multica path=TeamCreate reason=multica-daemon-down: ECONNREFUSED`
- `[info] planning routing: persona=technical-writer requested=codex path=codex-invoke reason=no-fallback-needed`
- `[info] planning routing: persona=ui-designer requested=codex path=TeamCreate reason=known-incompatible`
- `[info] planning routing: persona={X} requested=codex path=TeamCreate reason=unvalidated-persona`
- `[info] planning routing: persona={X} requested=direct path=TeamCreate reason=no-fallback-needed`
- `[info] planning routing: persona={X} requested=unset path=TeamCreate reason=agent_backends-unset`

Return `spawn_outcome` with all active direct and Codex teammate handles plus
the CC-Workflows and Multica dispatch summaries and per-persona episode marker
paths for CC-Workflows-routed and Multica-routed personas. The caller does not
need to know which local backend produced a handle before assigning normal
planning work.

### Step 0.4: Mixed-Team TeamCreate Prompt Template

Render this `TeamCreate` prompt for the direct path only, from `requirement_summary`, `assembled_personas`, and `routing_decisions`. The caller may provide `{caller_phase_label}` for traceability; this skill does not hardcode `/plan` phase references.

```text
Create a planning team for requirement: "{requirement_summary}"

## Team Members

[include only personas whose routing_decisions entry is direct]

**researcher** - Explore the target codebase. Read persona from hive/agents/researcher.md.
Load memories from the agent's knowledge paths. Gather raw findings: file paths, patterns, constraints, risks.

**technical-writer** - Produce formatted planning documents. Read persona from hive/agents/technical-writer.md.
Load memories from the agent's knowledge paths. Transform raw findings into research briefs, design discussions, H/V plans, structured outlines.

**tpm** - Sequence delivery planning. Read persona from hive/agents/tpm.md.
Load memories from the agent's knowledge paths. Own horizontal/vertical thinking. Review all documents for delivery feasibility.

[if architect is in the assembled list and routed direct]
**architect** - Evaluate technical feasibility. Read persona from hive/agents/architect.md.
Load memories from the agent's knowledge paths. Review designs for architectural soundness.

[if ui-designer is in the assembled list and routed direct]
**ui-designer** - Produce wireframes and review UI aspects. Read persona from hive/agents/ui-designer.md.
Load memories from the agent's knowledge paths. Scan existing design language before proposing new UI.

## Coordination
- Orchestrator assigns work via SendMessage
- All agents review documents before user presentation (collaborative review gate)
- Each agent reads their full persona file and loads their memory directory
- Use agent-spawn skill patterns: load full persona, resolve paths, load memories
```

If the team is mixed, the `TeamCreate` prompt includes only direct-routed personas.
Codex-routed personas participate via separate panes and read team context from
their own `agent-spawn` prompt. Multica-routed personas participate through
`plan-mode-multica` and read the planning story/config context passed to that
mode atom.

**Agent-spawn compliance:** Every codex-routed teammate must follow `skills/hive/skills/agent-spawn/SKILL.md` patterns: full persona injection, path resolution (`~`, `${CLAUDE_PLUGIN_ROOT}`), memory loading, domain constraints, and required tool validation. Direct `TeamCreate` teammates still read their persona files and load knowledge paths on startup.

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
   `TeamCreate`.
3. If the Codex fallback for an affected persona also fails, apply the Codex
   fallback rules below and end at direct `TeamCreate`.
4. Update the Step 0.3 INFO log outcome for each affected persona:
   `[info] planning routing: persona={X} requested=cc-workflows path={codex-invoke|TeamCreate} reason=cc-workflows-precondition-failed: {error}`
   where `{error}` is truncated to 120 chars and reflects the
   `field_sources` citation from the structured precondition_failed payload.
5. Continue the planning flow.

If `plan-mode-cc-workflows` returns a non-precondition dispatch failure for any
persona after Step 0 passed (Workflow tool invocation error, persona file
missing, agent failed terminal status, episode marker write failed), handle it
gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to Codex when supported, otherwise direct
   `TeamCreate`.
3. If the Codex fallback also fails, apply the Codex fallback rules below.
4. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=cc-workflows path={codex-invoke|TeamCreate} reason=cc-workflows-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
5. Continue the planning flow.

If `plan-mode-multica` fails before or during persona dispatch because the
Multica daemon is down or unreachable (connection refused, timeout resolving the
server/workspace, daemon health check failure, or equivalent transport setup
error), handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route each affected persona to Codex when that persona is supported by
   `codex-invoke` and not known-incompatible; otherwise re-route it to direct
   `TeamCreate`.
3. If the Codex fallback for an affected persona also fails, apply the Codex
   fallback rules below and end at direct `TeamCreate`.
4. Update the Step 0.3 INFO log outcome for each affected persona:
   `[info] planning routing: persona={X} requested=multica path={codex-invoke|TeamCreate} reason=multica-daemon-down: {error}`
   where `{error}` is truncated to 120 chars.
5. Continue the planning flow.

If `plan-mode-multica` returns a non-daemon dispatch failure for any persona
after reaching the daemon, handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to Codex when supported, otherwise direct
   `TeamCreate`.
3. If the Codex fallback also fails, apply the Codex fallback rules below.
4. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=multica path={codex-invoke|TeamCreate} reason=multica-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
5. Continue the planning flow.

If `codex-invoke` dispatch FAILS at runtime for any persona (Codex CLI missing, auth expired, cmux pane creation error, pre-flight failure, timeout, or any error returned from `agent-spawn`/`codex-invoke`), handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to direct `TeamCreate` in a follow-up call. Re-compose the prompt to add the failed persona, or use `SendMessage` to instruct existing TeamCreate teammates to adopt the re-routed teammate.
3. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=codex path=TeamCreate reason=codex-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
4. Continue the planning flow.

If the orchestrator observes repeated Codex failures (>=3 within one planning invocation), it MAY skip remaining Codex-routed personas for the invocation. Route skipped personas through `TeamCreate`, emit their per-persona INFO logs, and set reason `codex-dispatch-failed: circuit breaker`.

Every planning-persona spawn, success or fallback, must emit exactly one structured INFO log line per persona at the final spawn decision point. Do not skip the INFO log or collapse multiple persona routings into one line.
