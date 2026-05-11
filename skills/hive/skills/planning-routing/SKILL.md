---
name: planning-routing
description: Assemble and route a planning persona team across direct TeamCreate and Codex-backed agent-spawn paths. Inherits the caller's model and execution context.
---

# Hive Planning Routing

Atomic skill, NOT inline `/plan` prose. It assembles the caller's planning persona team, resolves backend routing, spawns direct and Codex paths, and returns active teammate handles plus final routing decisions. It inherits the caller's model and does not choose or override it.

## Invocation contract

Call this skill once per planning-team assembly.
Do not call it again after successful teammate creation unless abandoning the prior attempt.

**Inputs:** `assembled_personas` (ordered final planning persona list), `agent_backends` (resolved root-first routing map, `{}` if absent), and `requirement_summary` (concise task summary used in spawn prompts).

**Outputs:** `routing_decisions` (persona -> final `codex` or `direct` path), `routing_reasons` (persona -> final reason), and `spawn_outcome` (active teammate handles/ids sufficient for caller `SendMessage` work assignment).

**Side effects:** emits exactly one INFO log line per persona at final spawn
decision; calls `TeamCreate` for direct-routed personas; calls `agent-spawn` ->
`codex-invoke` for Codex-routed personas.

INFO log requested field uses codex-invoke vocabulary: `codex|direct|unset`.

## Process

### Step 0.1: Build Team Composition

The caller may pass a completed `assembled_personas` list. If asked to assemble the default planning team from `requirement_summary`, use:

**Core team (always included):**
- **researcher** (`hive/agents/researcher.md`) - codebase/web exploration, raw findings
- **technical-writer** (`hive/agents/technical-writer.md`) - formatted docs
- **tpm** (`hive/agents/tpm.md`) - delivery sequencing, H/V thinking

**Conditional members:**
- **architect** (`hive/agents/architect.md`) - add for architecture decisions, multi-system integration, medium/large scale, API design, data model changes, infrastructure, or "architecture" signals.
- **ui-designer** (`hive/agents/ui-designer.md`) - add for UI work: screens, components, visual design, wireframes, frontend flows, layout, states, or design review. Do not add for purely backend/infrastructure work.

Routing happens only after the assembled persona list is finalized. Backend routing must not change team composition.

### Step 0.2: Build Routing Decisions

For each persona in `assembled_personas`, consult `agent_backends` using the root-first precedence contract already resolved by the caller. Compare the configured backend against `skills/hive/skills/codex-invoke/SKILL.md` `Supported personas (PoC)` and `Known-incompatible personas`.

Produce `routing_decisions` with one value per persona: `codex` or `direct`. Also store tentative `routing_reason` for Step 0.3 final INFO emission.

- If `agent_backends[persona] == codex` and persona is supported, route `codex` with reason `no-fallback-needed`.
- If `agent_backends[persona] == codex` and persona is known-incompatible, route `direct` with reason `known-incompatible`.
- If `agent_backends[persona] == codex` and persona is in neither list, route `direct` with reason `unvalidated-persona`.
- If `agent_backends[persona] == direct`, route `direct` with reason `no-fallback-needed`.
- If `agent_backends[persona]` is unset or `agent_backends` is absent, route `direct` with reason `agent_backends-unset`.

Apply this only to personas present in the assembled list. `ui-designer` is always `direct` even when configured to `codex`, because codex-invoke marks it known-incompatible. Step 0.2 does not emit INFO logs.

### Step 0.3: Spawn Across Two Paths

Use `routing_decisions` to assemble one conceptual planning team:

- **Direct path (`TeamCreate`):** collect every persona routed `direct` and create them in one `TeamCreate` call. Use Step 0.4 and include only direct-routed personas in `## Team Members`.
- **Codex path (`agent-spawn` -> `codex-invoke`):** for each persona routed `codex`, create a separate persistent-pane teammate through `agent-spawn`, passing full persona context, resolved paths, memory loading context, and the same planning-team coordination context direct teammates receive.

Mixed teams are valid. Some planning personas may come from `TeamCreate` while others come from `agent-spawn` -> `codex-invoke`; they are still one planning team. The caller remains coordinator and uses `SendMessage` for assignments and review loops.

Emit the structured INFO log after each persona's final spawn path is known. If Step 0.5 handles a runtime Codex failure, update that persona's result to the fallback outcome instead of adding a second line.

Preserve the 4-field template exactly:
- `[info] planning routing: persona={X} requested={codex|direct|unset} path={codex-invoke|TeamCreate} reason={reason}`

Valid `reason=` values:
- `no-fallback-needed`
- `known-incompatible`
- `unvalidated-persona`
- `agent_backends-unset`
- `codex-dispatch-failed: {error}`

Examples:
- `[info] planning routing: persona=technical-writer requested=codex path=codex-invoke reason=no-fallback-needed`
- `[info] planning routing: persona=ui-designer requested=codex path=TeamCreate reason=known-incompatible`
- `[info] planning routing: persona={X} requested=codex path=TeamCreate reason=unvalidated-persona`
- `[info] planning routing: persona={X} requested=direct path=TeamCreate reason=no-fallback-needed`
- `[info] planning routing: persona={X} requested=unset path=TeamCreate reason=agent_backends-unset`

Return `spawn_outcome` with all active direct and Codex teammate handles. The
caller does not need to know which backend produced a handle before assigning
normal planning work.

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

If the team is mixed, the `TeamCreate` prompt includes only direct-routed personas. Codex-routed personas participate via separate panes and read team context from their own `agent-spawn` prompt.

**Agent-spawn compliance:** Every codex-routed teammate must follow `skills/hive/skills/agent-spawn/SKILL.md` patterns: full persona injection, path resolution (`~`, `${CLAUDE_PLUGIN_ROOT}`), memory loading, domain constraints, and required tool validation. Direct `TeamCreate` teammates still read their persona files and load knowledge paths on startup.

### Step 0.5: Runtime Fallback

If `codex-invoke` dispatch FAILS at runtime for any persona (Codex CLI missing, auth expired, cmux pane creation error, pre-flight failure, timeout, or any error returned from `agent-spawn`/`codex-invoke`), handle it gracefully:

1. Do not hard-fail planning-team assembly.
2. Re-route the failed persona to direct `TeamCreate` in a follow-up call. Re-compose the prompt to add the failed persona, or use `SendMessage` to instruct existing TeamCreate teammates to adopt the re-routed teammate.
3. Update the Step 0.3 INFO log outcome for that persona:
   `[info] planning routing: persona={X} requested=codex path=TeamCreate reason=codex-dispatch-failed: {error}`
   where `{error}` is truncated to 120 chars.
4. Continue the planning flow.

If the orchestrator observes repeated Codex failures (>=3 within one planning invocation), it MAY skip remaining Codex-routed personas for the invocation. Route skipped personas through `TeamCreate`, emit their per-persona INFO logs, and set reason `codex-dispatch-failed: circuit breaker`.

Every planning-persona spawn, success or fallback, must emit exactly one structured INFO log line per persona at the final spawn decision point. Do not skip the INFO log or collapse multiple persona routings into one line.
