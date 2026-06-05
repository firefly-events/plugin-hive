---
name: plan-mode-cc-workflows
description: Run Hive planning personas through the Claude Code Workflow tool. One assembled Workflow script dispatches persona-routed planning agents (researcher, technical-writer, architect, tpm, ui-designer), returns structured planning-artifact paths, and lets Hive write episode markers plus a return summary while the orchestrator owns user-facing review gates.
---

# Hive Plan Mode — CC Workflows

Atomic skill, NOT inline `/plan` prose. Runs the `cc-workflows` planning dispatch mode for a planning-team assembly. The caller (the `planning-routing` skill plus `/plan` Phase 0) selects this mode when `planning_mode_decision == "cc-workflows"` and hands off the inputs below; this skill owns the lifecycle from CC Workflow tool assembly through terminal episode markers and summary return.

CC Workflows planning mode treats each planning persona's contribution as a Workflow TOOL workload. The Workflow TOOL is the deterministic script orchestrator with `agent()` / `pipeline()` / `parallel()` / `phase()`; `/workflows` is only a history browser for running and completed workflows. Hive owns dispatch, polling, episode markers, and returning a planning-team summary to `/plan`; the Workflow tool owns subagent scheduling and transcript capture.

This is the planning-side mirror of `execute-mode-cc-workflows`. The two skills share the same precondition gate, episode-marker schema family (`cc-workflows-run.yaml`), defensive `args` parse contract, and Workflow tool invocation pattern; what differs is the unit of work (persona, not story) and the artifact a persona produces (planning document, not implementation files).

State directory resolution follows the same rule as the execute-mode CC Workflows skill:

```text
HIVE_STATE_DIR = hive_config.paths.state_dir || ".pHive"
```

All episode markers, messages sidecars, transcript references, and run summaries are rooted under that resolved state dir unless the Workflow tool returns an absolute transcript path.

Kickoff-gate fall-through behavior is explicit: if the runtime precondition gate rejects this mode, emit a structured `precondition_failed` error with `field_sources` and return control to `planning-routing`; do not silently fall through to direct `TeamCreate`, Codex, or Multica planning paths. Fallback to those paths is the caller's responsibility (`planning-routing` Step 0.5) and is gated on this skill returning a structured rejection, not on a silent partial dispatch.

Delegation rules: the orchestrator coordinates Workflow script assembly, Workflow invocation, polling, episode marker writes, and summary return; it does not write planning documents itself. Workflow agents execute assigned persona steps and return structured planning-artifact payloads (paths plus brief content summaries). Persona behavior is loaded from `hive/agents/<persona>.md`; do not improvise inline personas. Codex-routed personas inside this mode resolve to `agentType: "codex:codex-rescue"`; Claude-routed personas use the default subagent surface (`agent()` without an `agentType`).

**Gate ownership invariant.** Planning agents dispatched here produce or revise planning artifacts. They never advance user review or sign-off gates. The orchestrator (`/plan`) still presents and waits locally at the design-discussion review gate, the conditional H/V review gate, and the structured-outline sign-off gate. Workflow tool completion is an artifact-readiness signal, not user review approval.

Reference spine: `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` Run 2 verdict block. The anchors at `:40`, `:64`, and `:81` establish that the Workflow tool, not `/workflows`, is the substrate; criterion (a) passed; and per-task structured-result capture is in place. This skill's outer seam mirrors the execute-mode-cc-workflows seam validated by that spike.

## Invocation contract

Called once per `/plan` Phase 0 planning-team assembly when the plan dispatch resolver selected `mode_decision == cc-workflows`.

The resolver lives in `/plan` Phase 0c and mirrors the multica resolver shape:

- `HIVE_PLANNING_MODE=cc-workflows` selects this skill with source `env`.
- root `hive.config.yaml` with `planning.mode: cc-workflows` selects this skill with source `config` when the environment variable is unset.
- Any other value falls through to the existing planning-routing path (multica, codex, direct).
- Env wins over config.

On selection, `/plan` Phase 0 routes the assembled planning cell here instead of spawning direct `TeamCreate`, Codex, or Multica teammates.

**Inputs:**
- `assembled_personas[]` — ordered final planning persona names (e.g. `researcher`, `technical-writer`, `architect`, `tpm`, `ui-designer`).
- `planning_story` — synthetic story-like payload describing the planning work, including `id`, `epic`, `title`, `description`, `acceptance_criteria`, `files_to_modify` (the planning docs being produced), and `references`.
- `epic_handle` — parent epic identifier, used for episode paths and integration-branch context.
- `hive_config` — parsed root `hive.config.yaml`, including `agent_backends`, `planning.cc-workflows.*`, `task_tracking.*`, and `paths.state_dir`.
- `integration_branch` — current epic branch/ref (`feat/<epic-id>`). Planning agents do not commit; the orchestrator handles document writes after this skill returns the agent file-list payloads.

Fixed call signature:

```text
invoked with assembled_personas[], planning_story, epic_handle, hive_config, integration_branch
```

OUTER SEAM INVARIANT: any change to `workflow_assembly` for planning agents affects WHAT the assembly emits but never HOW `planning-routing` calls into this skill. This fixed call signature is the outer seam; downstream wiring through `/plan` and `planning-routing` reads this contract and does not branch on internal workflow_assembly shape.

**Outputs:**
- One episode marker per dispatched persona at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/cc-workflows-run.yaml`.
- One messages sidecar per dispatched persona at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/cc-workflows-run.messages.jsonl`.
- Aggregated return object to `planning-routing`:

```js
{
  dispatched: [
    { persona, run_id, transcript_dir, dispatch_started_at }
  ],
  completed: [
    { persona, status: 'passed', files: [{path, change}], marker_path }
  ],
  failed: [
    { persona, status: 'failed' | 'cancelled', notes, marker_path }
  ],
  run_id
}
```

`planning-routing` uses this summary to advance the planning flow. `/plan` then collects committed planning documents (the orchestrator reconciles file-list payloads onto `integration_branch` after this skill returns — same as execute-mode-cc-workflows) and continues into its document review/presentation gates.

Gate ownership stays in `/plan`: this skill never advances the design-discussion review gate, the H/V review gate, or the structured-outline sign-off gate.

## Process

CC Workflows planning mode runs the assembled personas through the Workflow TOOL. Phase 1 keeps per-persona dispatch serial within the team assembly to mirror `execute-mode-cc-workflows` Phase 1 semantics; later phases may change the assembly emitted inside the seam without changing the invocation contract.

The process below mirrors `execute-mode-cc-workflows`: precondition gate, per-persona dispatch, terminal polling, one episode marker per persona, sidecar deferral, reconciliation, then summary return. The unit of work is `persona` (not `story`); everything else is structurally identical.

### Step 0: Precondition gate

Resolve runtime and tooling before dispatching any persona: verify CC runtime version `>= 2.1.154`; read `claude --version` when available; otherwise rely on Workflow tool presence as proxy. Verify `planning.mode` resolves to `"cc-workflows"` OR `HIVE_PLANNING_MODE=cc-workflows` is set. Resolve `${HIVE_STATE_DIR}` from `hive_config.paths.state_dir`, then default to `.pHive`, and confirm `assembled_personas[]` plus `planning_story` are present.

Runtime field resolution must preserve source attribution:

```yaml
field_sources:
  planning.mode:
    source: root config | shipped baseline | env | default
    value: cc-workflows
  HIVE_PLANNING_MODE:
    source: env
    value: cc-workflows
  HIVE_STATE_DIR:
    source: root config | default
    value: .pHive
  cc_runtime:
    source: claude --version | Workflow tool presence proxy
    value: 2.1.154
```

On reject, exit with a structured error and do not dispatch:

```json
{
  "error": "precondition_failed",
  "message": "CC Workflows planning mode requires runtime cc-workflows and Claude Code >= 2.1.154 or Workflow tool presence.",
  "field_sources": {}
}
```

The `field_sources` citation is mandatory on every Step 0 reject. It must show which source was consulted: root config, shipped baseline, env, or default. This is the audit trail for why the kickoff gate rejected the selected mode, and the trigger for `planning-routing` Step 0.5 fallback to codex/direct.

### Step 1: Per-persona dispatch (serial within team — Phase 1)

Phase 1 dispatches personas serially within the team assembly: resolve persona N, assemble the Workflow script shape for persona N, invoke the Workflow tool, track it, then move to persona N+1. This bounds runtime pressure while retaining the Workflow tool's deterministic script surface.

For each persona in `assembled_personas[]`:

1. **Persona file load.**
   - Read persona text from `hive/agents/<persona>.md`. If missing, fail the affected persona with a structured dispatch error (`persona_file_missing`) and continue with remaining personas — partial team is recoverable per Step 5 aggregate semantics.

2. **Brief write.**
   - Build a planning brief from `planning_story.description`, `planning_story.acceptance_criteria`, `planning_story.files_to_modify` (the planning docs this persona is expected to produce), the integration branch, and any prior planning artifacts referenced under `${HIVE_STATE_DIR}/epics/{epic_handle}/docs/`.
   - Include the required repository ref and no-git instruction for Codex-routed personas — planning agents do not commit; the orchestrator handles writes after this skill returns the file-list payload.
   - For the `technical-writer` persona, include the target document template path (`hive/references/document-templates/<type>.md`) so the writer composes against the expected shape.

3. **Clone / verify.**
   - Require verification of the expected checkout before document work. The requested ref is the integration branch, conventionally `feat/<epic-id>`.
   - Personas report observed checkout path, branch, and existing-doc availability; verification failure maps to `failed` and still writes a marker.

4. **Dispatch: `workflow_assembly` plus Workflow tool invocation.**
   - Construct the Workflow tool script in memory: one meta block, one `phase()` named for the persona's contribution (e.g. `Research`, `Design Discussion Draft`, `Structured Outline`), and one `agent()` call per `(persona, document)` pair.
   - Use `pipeline()` when the persona must produce multiple ordered artifacts in one run (researcher emits findings → research-brief.md; writer emits draft → revision).
   - Use `parallel()` only inside a phase when the workflow definition and dependency order allow it (rare in planning; documents are usually sequential within a persona).
   - Codex-routed personas resolve to `agentType: "codex:codex-rescue"`.
   - Claude-routed personas use the default subagent surface, equivalent to `Workflow.agent()` without a Codex `agentType`.
   - Persona files are referenced at `hive/agents/<persona>.md`; prompts carry the integration branch and no-git contracts.
   - **Defensive `args` parse contract.** Every assembled script MUST begin its body with `const a = typeof args === 'string' ? JSON.parse(args) : args;` and reference inputs via `a.<field>` (NOT `args.<field>`). The Workflow tool surface does not guarantee that the `args` global arrives as a parsed object when invoked from an orchestrator whose tool-call parameters are string-typed. Mirror the same contract documented in `execute-mode-cc-workflows` Step 1.5 — both skills share the same Workflow tool seam.
   - Invoke the Workflow TOOL with the assembled script.
   - Capture returned `run_id` and `transcript_dir`. This is not the `/workflows` slash command; `/workflows` is the history browser.

5. **Track.**
   - Record `{persona, role, agentType, run_id, transcript_dir, dispatch_started_at}` in an in-memory map.
   - Keep per-persona state independent; the map feeds Step 2 polling and Step 3 marker writes.

The dispatch fanout remains serial within the team in Phase 1. Do not advance to later /plan phases inside this skill; `/plan` owns phase advancement and re-invokes this skill if any subsequent phase requires a fresh team assembly.

### Step 2: Poll until terminal (per persona)

For each dispatched persona, wait for the Workflow TOOL completion signal. A `<task-notification>` arrives on completion with structured `<result>`, `<status>`, `<usage>`, an output file path, and a transcript directory.

Read and normalize:

```text
<result>  -> structured planning-artifact payloads, including file lists, brief content summaries, and review verdicts
<status>  -> completed | failed | cancelled
<usage>   -> agent_count, subagent_tokens, tool_uses, duration_ms
```

Terminal mapping:

| Workflow terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

The poll loop is per persona even when one Workflow run contains multiple agent calls (e.g. researcher running both an exploration agent and a finding-summary agent). A persona reaches terminal after required `(persona, document)` calls are terminal or the Workflow tool reports failed/cancelled. Preserve `run_id` and `transcript_dir` on failures whenever known.

### Step 3: Episode marker per persona terminal

Receive structured file lists from each persona agent:

```json
{ "files": [{ "path": "path/to/doc", "change": "created|modified|deleted" }], "timestamp": "2026-06-05T00:00:00Z" }
```

For each persona in dispatch order, the orchestrator (after this skill returns) reconciles planning-document writes onto the integration branch. This skill's responsibility is the marker + sidecar — the orchestrator owns `git add`, `git commit`, and `git push` per the SERIAL-COMMIT GATE contract shared with `execute-mode-cc-workflows`.

Write exactly one per-persona episode marker per run at:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/cc-workflows-run.yaml
```

Marker shape:

```yaml
step: cc-workflows-run
persona: <persona>
planning_story: <planning_story.id>
epic: <epic-id>
status: passed | failed | cancelled
workflow_run_id: <run_id>
transcript_dir: <path>
role: <planning role — e.g. researcher | writer | tpm | architect | ui-designer>
agentType: <default | codex:codex-rescue>
files: [{path, change}]
started_at: <iso>
completed_at: <iso>
```

The marker references the planning persona as the unit (not a story). It uses the same `cc-workflows-run.yaml` filename family as `execute-mode-cc-workflows` so downstream consumers (run-status event stream, etc.) can pattern-match a single emit shape.

Also write the adjacent messages sidecar:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{planning_story.id}-{persona}/cc-workflows-run.messages.jsonl
```

The marker references large artifacts by path, including `transcript_dir`, rather than inlining them. Terminal values are `passed`, `failed`, and `cancelled`.

### Step 4: Sidecar deferral

This skill does not consume an `appends_map` — sidecar deferral is an execute-mode concern (review-phase append routing for stories). Planning is pre-execute; there is no sidecar map to defer. If a future planning concern requires per-persona sidecar injection, add it here as a Phase 2 extension; for now this step is a documented no-op kept in the structure so the skill mirrors `execute-mode-cc-workflows` one-for-one for diff reviewers.

## Reconciliation pattern

Reconcile completed CC Workflow planning work by using structured file lists as the unit of commit attribution. Codex-routed planning agents do not push branches or author `.git` state. The orchestrator validates returned file lists against the working tree and commits persona by persona on:

```text
feat/<epic-id>
```

Serial reconciliation is persona-dispatch ordered: read persona A terminal payload, validate its file list, commit persona A's planning-document writes, then repeat for persona B. Planning-document commits are smaller and less conflict-prone than implementation commits, but the same fast-forward + 3-retry contract applies.

If a persona is `failed` or `cancelled`, write its marker and omit commits unless a partial document write has already been authored. This section is a contract, not an instruction for this skill to run git.

### Step 5: Wait for all personas to terminate, then return

Wait until every persona dispatched by this invocation has reached a terminal state or has produced a per-persona dispatch failure marker.

This skill does NOT update task tracker per persona — planning personas do not have tracker records in the way stories do. If a future planning workflow ships persona-level tracker integration, route through the vendor-neutral `task-tracking-dispatch.invoke("updateStatus", ...)` ABI used by `execute-mode-cc-workflows`; do not fork it for planning mode.

Return this aggregate to `planning-routing`:

```js
{
  dispatched: [
    { persona, run_id, transcript_dir, dispatch_started_at }
  ],
  completed: [
    { persona, status: 'passed', files: [{path, change}], marker_path }
  ],
  failed: [
    { persona, status: 'failed' | 'cancelled', notes, marker_path }
  ],
  run_id
}
```

`planning-routing` uses this summary to attribute final spawn outcomes (Step 0.3) and emit per-persona INFO logs. `/plan` then advances into its document review/presentation flow with the freshly-written planning artifacts on disk.

## Failure modes

- `precondition_failed` — Step 0 reject. Must include `field_sources` citation showing root config, shipped baseline, env, or default source consulted for each rejected field. Triggers `planning-routing` Step 0.5 fallback (cc-workflows → codex → direct).
- `persona_file_missing` — `hive/agents/<persona>.md` missing for a persona in `assembled_personas[]`. Record the affected persona as failed, write a failure marker, continue with remaining personas.
- `workflow_dispatch_failed` — Workflow TOOL returned an invocation error or no `run_id` could be captured for a persona.
- `persona_agent_failed` — a single persona's required Workflow agent call failed or returned a failed terminal status.
- `commit_conflict_unrecoverable` — orchestrator post-return exhausted 3 non-fast-forward retries or encountered an unresolvable rebase conflict on a planning-document commit.
- `episode_marker_write_failed` — marker or `.messages.jsonl` sidecar could not be written for a persona terminal.

Failure handling: Step 0 aborts the whole mode; per-persona failures write markers when possible; sibling persona results stay intact; known `run_id` and `transcript_dir` values are preserved; marker write failures return the intended marker path. The aggregate return at Step 5 is the single boundary where the caller learns the partial-team outcome.

## Configuration

`hive.config.yaml`:

```yaml
planning:
  mode: cc-workflows
paths:
  state_dir: .pHive
```

Environment override:

```sh
HIVE_PLANNING_MODE=cc-workflows
```

Runtime and branch configuration:

| Setting | Value |
|---|---|
| `planning.mode` | `"cc-workflows"` |
| `HIVE_PLANNING_MODE` | `cc-workflows` |
| `HIVE_STATE_DIR` | `hive_config.paths.state_dir \|\| ".pHive"` |
| Minimum CC runtime version | `2.1.154` |
| Integration branch convention | `feat/<epic-id>` |

Runtime source priority is resolver-owned (`/plan` Phase 0c), but every reject must report the consulted source in `field_sources`. Persona routing uses the same roster as `/plan`; the behavior file remains `hive/agents/<persona>.md`, and the routing backend determines only Workflow `agentType`.

## Reuses (atomic deps)

- `hive/agents/<persona>.md` — persona files; do NOT improvise.
- `hive/references/episode-schema.md` — episode marker format family.
- `hive/references/document-templates/` — planning document templates the technical-writer composes against (design-discussion, horizontal-plan, vertical-plan, structured-outline).
- `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` — substrate seam mirror; Step 0 precondition gate, defensive `args` parse contract, episode marker schema family, and Step 5 aggregate shape are intentionally shared.
- `hive/lib/task-tracking-dispatch/index.ts` — reserved for future per-persona tracker integration; not consumed in v1.

Key references:

- `skills/hive/skills/plan-mode-multica/SKILL.md` — shape mirror; same unit-of-work (persona), same episode-marker-per-persona pattern, different substrate (Multica dispatch instead of Workflow tool dispatch).
- `skills/hive/skills/execute-mode-cc-workflows/SKILL.md` — substrate mirror; same Workflow tool invocation pattern, same episode marker schema family, different unit-of-work (story instead of persona).
- `skills/hive/skills/planning-routing/SKILL.md` — caller; routes `planning_mode_decision == cc-workflows` to this skill and consumes the Step 5 aggregate return.
- `skills/plan/SKILL.md` Phase 0c — env-over-config resolver that selects `mode_decision == cc-workflows`.
- `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` — Phase 0 Run 2 verdicts; substrate seam evidence shared with `execute-mode-cc-workflows`.
- `hive/references/episode-schema.md` — episode marker format.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, NOT inline /plan or planning-routing prose | This file owns the CC Workflows planning lifecycle for selected mode |
| Workflow TOOL vs /workflows slash command distinction is load-bearing | Workflow TOOL runs deterministic scripts; `/workflows` only browses history |
| Skill does NOT advance user review/sign-off gates | `/plan` owns design-discussion review, H/V review, structured-outline sign-off |
| Skill does NOT run git commit/add/push | Orchestrator commits after return from file-list payloads, mirroring execute-mode-cc-workflows |
| Codex-routed personas never write `.git` | Codex-routed personas use `agentType: "codex:codex-rescue"` plus no-git prompt contract |
| Defensive `args` parse contract is mandatory in every assembled script | `const a = typeof args === 'string' ? JSON.parse(args) : args;` at script-body top |
| Target line count: 250-400 lines | Keep this skill compact but complete |
| Markdown level-2 headers for steps | Preserve the verbatim header list used by plan-mode-multica and execute-mode-cc-workflows |
| Code fences for YAML snippets and shell-snippet excerpts | Required for marker and attribution contracts |
| One marker per persona per run | `cc-workflows-run.yaml` plus `.messages.jsonl` sidecar |
| Fixed outer seam | `assembled_personas[]`, `planning_story`, `epic_handle`, `hive_config`, `integration_branch` |
| No fallback planning mode inside this skill | Step 0 reject returns structured `precondition_failed`; `planning-routing` Step 0.5 owns fallback |
