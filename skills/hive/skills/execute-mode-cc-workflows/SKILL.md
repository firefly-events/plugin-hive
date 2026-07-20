---
name: execute-mode-cc-workflows
description: Run Hive workflow stories through the Claude Code Workflow tool. One assembled Workflow script dispatches persona-routed agents, returns structured file lists, and lets Hive write episode markers plus depth summaries while the orchestrator owns serial commits.
---

# Hive Mode — CC Workflows

Atomic skill, NOT inline /execute prose. Runs the `cc-workflows` execution mode for a workflow. The caller (the dispatch skill plus `/execute` step 6f) selects this mode when `mode_decision == "cc-workflows"` and hands off the inputs below; this skill owns the lifecycle from CC Workflow tool assembly through terminal episode markers and summary return.

CC Workflows mode treats each Hive story as a Workflow TOOL workload, not a `/workflows` slash-command workload. The Workflow TOOL is the deterministic script orchestrator with `agent()` / `pipeline()` / `parallel()` / `phase()`; `/workflows` is only a history browser for running and completed workflows. Hive owns dispatch, polling, episode markers, task-tracking updates, and returning a depth summary to `/execute`; the Workflow tool owns subagent scheduling and transcript capture.

State directory resolution follows the same rule as the Multica execution skill:

```text
HIVE_STATE_DIR = hive_config.paths.state_dir || ".pHive"
```

All episode markers, messages sidecars, transcript references, and run summaries are rooted under that resolved state dir unless the Workflow tool returns an absolute transcript path.

Kickoff-gate fall-through behavior is explicit: if the runtime precondition gate rejects this mode, emit a structured `precondition_failed` error with `field_sources` and return control to `/execute`; do not silently fall through to sequential, session, team, or Multica mode.

Delegation rules: the orchestrator coordinates issue resolution, Workflow script assembly, Workflow invocation, polling, episode marker writes, and summary return; it does not implement story acceptance criteria. Workflow agents execute assigned persona steps and return structured results. Persona behavior is loaded from `hive/agents/<persona>.md`; do not improvise inline personas. **All workflow agents run on the default workflow subagent (no Codex `agentType`)** — cc-workflows mode is intentionally an inline-Claude substrate so the returned `<result>` IS the work product; Codex routing lives in the other dispatch modes. Workflow agents return file-list payloads and never write `.git`. The orchestrator commits after this skill returns file-list payloads.

Reference spine: `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` Run 2 verdict block. The anchors at `:40`, `:64`, `:81`, and `:141` establish that the Workflow tool, not `/workflows`, is the substrate; criterion (a) passed; the SERIAL-COMMIT GATE mechanism was confirmed; and this story is explicitly named as the execution-skill work.

## Invocation contract

Called once per parent workflow depth from `/execute` step 6f when `mode_decision == "cc-workflows"`. Triggered by `execution.runtime: "cc-workflows"` resolved from root config or shipped baseline, or by `HIVE_EXECUTION_RUNTIME=workflows`.

The execution runtime key is `execution.runtime`, not the older `execution.mode` key used by some mode-specific skills. If both exist, the runtime resolver must cite which one was consulted in `field_sources`.

Inputs: `workflow_path`, `unblocked_stories[]`, `appends_map`, `epic_handle`, and `hive_config`.

Fixed call signature:

```text
invoked with workflow_path, unblocked_stories[], appends_map, epic_handle, hive_config
```

OUTER SEAM INVARIANT: any change to `workflow_assembly` affects WHAT the assembly emits but never HOW execute-dispatch calls into this skill. This fixed call signature is the outer seam; `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md:64` is the criterion (a) PASS evidence proving the seam can carry the integration-branch prompt contract.

Outputs: one episode marker per story at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.yaml`, one messages sidecar at `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.messages.jsonl`, and one aggregated return object:

```js
{ stories: [{ id, status, commits, marker_path }], run_id }
```

Depth advancement stays outside this skill. `/execute` receives the summary, advances the DAG, and re-invokes this skill for the next depth.

## Process

CC Workflows mode runs a depth of unblocked stories through the Workflow TOOL. Phase 1 keeps per-story dispatch serial within the current depth to preserve the same operational shape as `execute-mode-multica`; later phases may change the assembly emitted inside the seam without changing the invocation contract.

The process below mirrors `execute-mode-multica`: precondition gate, per-story dispatch, terminal polling, one episode marker per story, sidecar deferral, reconciliation, then summary return.

### Step 0: Precondition gate

```js
// Worktree-isolation check — must be the first action in this gate.
// Rejects before any field resolution if the skill is not running inside
// a `.claude/worktrees/<name>/` checkout.
import { execFileSync } from 'node:child_process';
const precondition = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_preconditions.py'], { input: JSON.stringify({ cwd: process.cwd() }), encoding: 'utf8' }));
// Python equivalent of assertWorktreeIsolation(); this must remain first.
if (!precondition.ok) throw Object.assign(new Error(precondition.error), precondition);
```

Resolve runtime and tooling before touching any story: verify CC runtime version `>= 2.1.154`; read `claude --version` when available; otherwise rely on Workflow tool presence as proxy. Verify `execution.runtime` resolves to `"cc-workflows"` OR `HIVE_EXECUTION_RUNTIME=workflows` is set. Resolve `${HIVE_STATE_DIR}` from `hive_config.paths.state_dir`, then default to `.pHive`, and confirm `workflow_path` plus `unblocked_stories[]` are present.

Runtime field resolution must preserve source attribution:

```yaml
field_sources:
  execution.runtime:
    source: root config | shipped baseline | env | default
    value: cc-workflows
  HIVE_EXECUTION_RUNTIME:
    source: env
    value: workflows
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
  "message": "CC Workflows execution requires runtime cc-workflows and Claude Code >= 2.1.154 or Workflow tool presence.",
  "field_sources": {}
}
```

The `field_sources` citation is mandatory on every Step 0 reject. It must show which source was consulted: root config, shipped baseline, env, or default. This is the audit trail for why the kickoff gate rejected the selected mode.

### Step 1: Per-story dispatch (serial within depth — Phase 1)

Phase 1 dispatches stories serially within the current depth: resolve story N, assemble the Workflow script shape for story N, invoke the Workflow tool, track it, then move to story N+1 as dictated by the phase assembly. This bounds runtime pressure while retaining the Workflow tool's deterministic script surface.

For each story in `unblocked_stories[]`:

1. **Issue resolution via task-tracking ABI.**
   - If `story.tracker_id` exists, call `task-tracking-dispatch.invoke("getIssue", { tracker_id: story.tracker_id })`; capture tracker id, adapter story id, issue identifier, and URL.
   - If missing, call `task-tracking-dispatch.invoke("createIssue", { title: story.title, body: '<brief placeholder — will be filled before dispatch>', labels: [] })`; capture the new tracker id for the final task-tracking update.
   - Use the vendor-neutral task-tracking ABI consistently — same pattern as the `updateStatus` step below — so this skill stays atomic and adapter-agnostic.

2. **Backlog kick.**
   - Ensure the resolved tracker story is not stranded in backlog state before dispatch.
   - Use the adapter-backed issue surface; if movement fails, record a per-story dispatch failure and continue with remaining stories at this depth.

3. **Brief write.**
   - Build a story brief from workflow steps, story spec, acceptance criteria, files-to-touch, sidecar context, and integration branch.
   - Include the required repository ref and no-git instruction for Codex-routed agents.
   - Load persona text from `hive/agents/<persona>.md`; if missing, fail the affected story with a structured dispatch error.

4. **Clone / verify.**
   - Require verification of the expected checkout before implementation work.
   - The requested ref is the integration branch, conventionally `feat/<epic-id>`.
   - Agents report observed checkout path, branch, and file availability; verification failure maps to `failed` and still writes a marker.

5. **Dispatch: `workflow_assembly` plus Workflow tool invocation.**
   - Construct the Workflow tool script in memory: one meta block, one `phase()` per workflow step, and one `agent()` call per `(story, step)` pair.
   - Use `pipeline()` when the workflow step order must be serial for a story.
   - Use `parallel()` only inside a phase when the workflow definition and dependency order allow it.
   - **No Codex routing inside cc-workflows mode.** Every `agent()` call MUST use the default workflow subagent — do NOT pass `agentType: "codex:codex-rescue"` (or any other Codex `agentType`) even when `agent_backends[persona] == "codex"`. The `codex:codex-rescue` subagent is a one-shot forwarder that hands work to a separate background Codex CLI run and returns a status report immediately; this breaks the cc-workflows structured-output contract (dispatch → immediate file-list return → episode marker write → reconcile). The cc-workflows substrate runs each agent INLINE within the Claude orchestrator so that the returned `<result>` IS the work product, not a pointer to out-of-band work. Codex routing belongs to the other dispatch modes (planning-routing's `codex-invoke` path via cmux panes); cc-workflows mode is an inline-Claude substrate and intentionally does not overlap.
   - Persona files are referenced at `hive/agents/<persona>.md`; prompts carry the integration branch and no-git contracts. Persona behavior is injected into the prompt body; the agent's runtime is the default workflow subagent regardless of how `agent_backends` would route the persona in other modes.
   - **`opts.model` is REQUIRED on every `agent()` call.** Before assembling the Workflow script, import and call the model-tier resolver for each persona:
     ```js
     const { tier, source } = JSON.parse(execFileSync('python3', ['hive/lib/cc_workflows_model_tier.py'], { input: JSON.stringify({ persona, config: hive_config }), encoding: 'utf8' }));
     // Python equivalent of resolveModelTier(persona, { config: hive_config }).
     // assembled agent() call must carry opts.model:
     // agent(prompt, { schema, phase, label, model: tier })
     ```
     No `agent()` call may omit `opts.model`. The resolver reads `model_overrides` (runtime promotion) then `model_tiers` (base assignment) from `hive.config.yaml` — never from persona frontmatter. Unmapped personas default to `sonnet` with a WARN. Collect `{phase, persona, tier, source}` for each dispatched agent to populate `field_sources.agent_models` in the terminal marker (Step 3).
   - **Defensive `args` parse contract.** Every assembled script MUST begin its body with `const a = typeof args === 'string' ? JSON.parse(args) : args;` and reference inputs via `a.<field>` (NOT `args.<field>`). The Workflow tool surface does not guarantee that the `args` global arrives as a parsed object — when the tool is invoked from an orchestrator whose tool-call parameters are string-typed (XML/JSON-string body parameters), `args` arrives as the raw JSON-encoded string and `args.<field>` evaluates to JavaScript `undefined`. Template literals then render the word `undefined` as filename / path fragments and downstream Edit / Write tool calls touch the wrong path. Surfaced by the cc-workflows-smoke run (audit finding `workflow-tool-args-string-vs-object`); the defensive shim is cheap and idempotent.
   - **Per-agent insight-capture clause (MANDATORY).** Every `agent()` prompt MUST end with the suffix template below. This bridges `feedback_insights_before_shutdown` and `feedback_execution_protocol` for one-shot Workflow subagents that never receive `SendMessage({type: shutdown_request})` and therefore have no shutdown-protocol hook to self-capture. Why this lives in the mode skill instead of `hive/agents/<persona>.md`: Workflow subagents follow the `agent()` prompt literally; they do not chain-load persona memories or fire a shutdown hook. A persona-file rule has no enforcement surface in cc-workflows mode. The mode skill is the single dispatch point that CAN enforce it, by template.

     Persona substitution: replace `<persona>` with the exact persona name (e.g. `researcher`, `developer`, `tester`, `reviewer`). The mode skill template is persona-agnostic; the orchestrator interpolates the right value per `agent()` call.

     Suffix template (append verbatim to each prompt):

     ```text
     INSIGHT CAPTURE (before returning your structured output)

     If you encountered any reusable lesson during this turn — a constraint that surprised you, a pattern that worked unexpectedly well, a footgun the next <persona> on this codebase will hit — append it to:

       hive/agents/memories/<persona>/<kebab-case-title>.md

     File shape (frontmatter + 3-5 line body):

     ---
     name: <kebab-case-title>
     description: <one-line summary, second-person imperative>
     applies_to: <persona>
     ---

     <2-4 lines: the lesson + why it matters. Concrete, not generic. Cite file paths or line numbers where useful.>

     Skip the capture entirely if nothing on this turn is reusable across stories. Do NOT write a memory just to satisfy this clause; empty captures pollute the memory dir. Fire-and-forget — do not block your return on the write. If the directory does not exist, create it.
     ```
   - Invoke the Workflow TOOL with the assembled script.
   - Capture returned `run_id` and `transcript_dir`. This is not the `/workflows` slash command; `/workflows` is the history browser, per `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md:40`.

6. **Track.**
   - Record `{story_id, tracker_id, persona, role, agentType, run_id, transcript_dir, dispatch_started_at}` in an in-memory map.
   - Keep per-story state independent; the map feeds Step 2 polling and Step 3 marker writes.

The dispatch fanout remains serial within the current depth in Phase 1. Do not advance to later DAG depths inside this skill; `/execute` owns DAG advancement and re-invokes this skill for the next depth.

### Step 2: Poll until terminal (per story)

For each dispatched story, wait for the Workflow TOOL completion signal. The spike at `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md:81` confirms that a `<task-notification>` arrives on completion with structured `<result>`, `<status>`, `<usage>`, an output file path, and a transcript directory.

Read and normalize:

```text
<result>  -> structured agent payloads, including file lists and review verdicts
<status>  -> completed | failed | cancelled
<usage>   -> agent_count, subagent_tokens, tool_uses, duration_ms
```

Terminal mapping:

| Workflow terminal | Episode marker status |
|---|---|
| `completed` | `passed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

The poll loop is per story even when one Workflow run contains multiple agent calls. A story reaches terminal after required `(story, step)` calls are terminal or the Workflow tool reports failed/cancelled. Preserve `run_id` and `transcript_dir` on failures whenever known.

### Step 3: Episode marker per terminal

This is the SERIAL-COMMIT GATE that architect Q3+Q4 unified mechanism specifies. The spike verdict at `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md:81` confirms that Codex creators returned file lists, no agents wrote `.git`, and the adapter or orchestrator authored serial commits after the Workflow run returned.

Receive structured file lists from each agent:

```json
{ "files": [{ "path": "path/to/file", "change": "created|modified|deleted" }], "timestamp": "2026-06-02T00:00:00Z" }
```

For each story in dependency order, the orchestrator or adapter equivalent stages and commits on the integration branch. The commit message is story-id-prefixed:

```text
[<story-id>] <type>(<scope>): <description>
```

Attribution: the following shell-snippet excerpts are copied from `hive/lib/multica-story-dispatch/index.mjs:180-280` per D1 copy-with-attribution.

Snippet 1 — integration-branch baseline (reset to upstream):

```sh
git fetch origin ${qBranch}
git checkout ${qBranch}
git reset --hard origin/${qBranch}
```

Snippet 2 — per-story serial commit + fast-forward retry:

```sh
git add <specific files for this story>
git commit -m "[${story?.id ?? '<story-id>'}] <type>(<scope>): <description>"
# fetch + rebase to handle peer dispatches landing concurrently
git fetch origin ${qBranch}
git rebase origin/${qBranch}
git push origin HEAD:${qBranch}
```

Fast-forward and retry mechanics belong to the orchestrator after this skill returns. On non-fast-forward rejection, re-run `git fetch`, `git rebase`, and `git push`; retry up to 3 times. On conflict, stop and post the conflict diff for adjudication.

IMPORTANT CONSTRAINT: this skill itself does NOT run `git add`, `git commit`, or `git push`. It documents the contract and returns the file-list payload. The orchestrator, or adapter equivalent, commits after the skill returns; Codex agents never write `.git` themselves. This bypasses `feedback_codex_sandbox_commit_block` by design.

Write exactly one per-story episode marker per run at:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.yaml
```

Marker shape:

```yaml
step: cc-workflows-run
story: <story-id>
epic: <epic-id>
status: passed | failed
workflow_run_id: <run_id>
transcript_dir: <path>
agents: [{persona, role, agentType}]
commits: [<sha1>, ...]
started_at: <iso>
completed_at: <iso>
field_sources:
  agent_models:
    <phase>:
      persona: <persona>
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
```

`field_sources.agent_models` records the resolved model tier for every dispatched agent, keyed by phase (matching the `phase()` label in the Workflow script). This enables post-run audit tooling to confirm every agent ran at the intended tier — not the parent session model. The `source` field traces whether the tier came from `model_overrides` (runtime promotion), `model_tiers` (base assignment), or the unmapped `default` (always `sonnet` with WARN).

Also write the adjacent messages sidecar:

```text
${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/cc-workflows-run.messages.jsonl
```

The schema mirrors the episode marker pattern from `execute-mode-multica` while using `cc-workflows-run.yaml`. The marker references large artifacts by path, including `transcript_dir`, rather than inlining them. Terminal values are `passed`, `failed`, and `cancelled`.

### Step 4: Sidecar deferral

Mirror the Multica skill's sidecar deferral pattern. For each `story_id` in `appends_map`, emit:

```text
[info] sidecar injection deferred to v2 cc-workflows multi-agent contract: {story_id} -> {agent_names}
```

Do not create extra Workflow runs, tracker issues, or agent assignments for sidecar-only work in Phase 1. Non-marker artifacts are deferred to sidecar files referenced by path: transcripts stay in `transcript_dir`, large logs stay beside the marker or a run-specific sidecar directory, and messages append to `cc-workflows-run.messages.jsonl`.

## Reconciliation pattern

Reconcile completed CC Workflow work by using structured file lists as the unit of commit attribution. Unlike Multica agent branches, Codex-routed Workflow agents do not push branches or author `.git` state. The orchestrator validates returned file lists against the working tree and commits story by story on:

```text
feat/<epic-id>
```

Serial reconciliation is dependency ordered: read Story A terminal payload, validate its file list, commit Story A files, then repeat for Story B.

If a story is `failed` or `cancelled`, write its marker and omit commits unless a partial commit has already been authored. This section is a contract, not an instruction for the skill to run git.

### Step 5: Wait for all depth-0 to terminate, then return

Wait until every story dispatched for this invocation has reached a terminal state or has produced a per-story dispatch failure marker.

After terminal normalization and marker writes, update the task tracker through the vendor-neutral task-tracking ABI:

```text
task-tracking-dispatch.invoke("updateStatus", { id: tracker_id, state: <next> })
```

State mapping: `passed -> done`, `failed -> in_review` or adapter-supported failure state, `cancelled -> cancelled`.

Use this verbatim ABI shape from `hive/lib/task-tracking-dispatch/index.ts:205`:

```ts
async invoke(
  method: string,
  params: any = {},
  options?: { skill_context?: string },
): Promise<DispatchResult>
```

Adapter dispatch type from `hive/lib/task-tracking-dispatch/index.ts:53`:

```ts
dispatch: (req: { method: string; params?: any }) => Promise<any>;
```

The task-tracking dispatch ABI is reused unchanged. Do not fork it for CC Workflows mode.

Return this aggregate to `/execute`:

```js
{
  stories: [
    { id, status, commits, marker_path }
  ],
  run_id
}
```

`/execute` uses this summary to advance the DAG to the next depth, then re-invokes this skill with the next depth's unblocked stories.

## Failure modes

- `precondition_failed` — Step 0 reject. Must include `field_sources` citation showing root config, shipped baseline, env, or default source consulted for each rejected field.
- `workflow_dispatch_failed` — Workflow TOOL returned an invocation error or no `run_id` could be captured.
- `agent_failed` — a single story's required Workflow agent call failed or returned a failed terminal status.
- `commit_conflict_unrecoverable` — orchestrator post-return exhausted 3 non-fast-forward retries or encountered an unresolvable rebase conflict.
- `episode_marker_write_failed` — marker or `.messages.jsonl` sidecar could not be written.

Failure handling: Step 0 aborts the whole mode; per-story failures write markers when possible; sibling story results stay intact; known `run_id` and `transcript_dir` values are preserved; marker write failures return the intended marker path.

## Configuration

`hive.config.yaml`:

```yaml
execution:
  runtime: cc-workflows
paths:
  state_dir: .pHive
```

Environment override:

```sh
HIVE_EXECUTION_RUNTIME=workflows
```

Runtime and branch configuration:

| Setting | Value |
|---|---|
| `execution.runtime` | `"cc-workflows"` |
| `HIVE_EXECUTION_RUNTIME` | `workflows` |
| `HIVE_STATE_DIR` | `hive_config.paths.state_dir \|\| ".pHive"` |
| Minimum CC runtime version | `2.1.154` |
| Integration branch convention | `feat/<epic-id>` |

Runtime source priority is resolver-owned, but every reject must report the consulted source in `field_sources`. Persona routing uses the same roster as `/execute`; the behavior file remains `hive/agents/<persona>.md`, and the routing backend determines only Workflow `agentType`.

## Reuses (atomic deps)

- `hive/adapters/multica/index.ts` — issue CRUD via dispatch ABI.
- `hive/lib/task-tracking-dispatch/index.ts` — vendor-neutral status updates, reused unchanged.
- `hive/lib/multica-story-dispatch/index.mjs` — shell-snippet contract source, lines 180-280, D1 copy-with-attribution.
- `hive/references/episode-schema.md` — episode marker format.
- `hive/agents/<persona>.md` — persona files; do NOT improvise.

Key references:

- `skills/hive/skills/execute-mode-multica/SKILL.md` — shape mirror.
- `skills/hive/skills/execute-mode-session/SKILL.md` — explicit protocol-displacement prose reference; this skill does not replace respawn, but the session skill's replaces-respawn framing at `SKILL.md:8` and `SKILL.md:71` is the reference pattern.
- `hive/lib/multica-story-dispatch/index.mjs` — lines 180-280 shell-snippet contract source per D1 copy-with-attribution.
- `hive/lib/task-tracking-dispatch/index.ts` — vendor-neutral ABI, reused unchanged.
- `.pHive/epics/cc-workflows-first-party/docs/spike-findings.md` — Phase 0 Run 2 verdicts; `:40` names Workflow tool vs `/workflows`, `:64` records criterion (a) PASS, `:81` records SERIAL-COMMIT GATE evidence, and `:141` explicitly names this story.
- `hive/references/episode-schema.md` — episode marker format.

## Constraint summary

| Rule | Enforcement |
|---|---|
| Atomic skill, NOT inline /execute prose | This file owns the CC Workflows lifecycle for selected mode |
| Workflow TOOL vs /workflows slash command distinction is load-bearing | Workflow TOOL runs deterministic scripts; `/workflows` only browses history |
| Skill does NOT run git commit/add/push | Orchestrator commits after return from file-list payloads |
| No Codex routing in cc-workflows mode | Every `agent()` call uses the default workflow subagent; `agentType: "codex:codex-rescue"` is forbidden because it forwards to a separate Codex CLI run and returns a status report instead of the work product, breaking the structured-output contract |
| No-git contract enforced via prompt | Default workflow subagent prompts carry an explicit "do not run git commit/add/push" instruction; the orchestrator commits after this skill returns file-list payloads |
| Target line count: 250-400 lines | Keep this skill compact but complete |
| Markdown level-2 headers for steps | Preserve the verbatim header list used by the mirror |
| Code fences for YAML snippets and shell-snippet excerpts | Required for marker and attribution contracts |
| One marker per story per run | `cc-workflows-run.yaml` plus `.messages.jsonl` sidecar |
| Fixed outer seam | `workflow_path`, `unblocked_stories[]`, `appends_map`, `epic_handle`, `hive_config` |
| No fallback execution mode | Step 0 reject returns structured `precondition_failed` |
