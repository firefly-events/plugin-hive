# Status Markers

Status markers are lightweight files that track workflow step completion. They replace the previous verbose episode format. The `/hive:status` command reads these to determine story progress.

## Storage Path

```
.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml
```

## Format

```yaml
step_id: research
status: completed
timestamp: "2026-03-25T21:00:00Z"
artifacts:
  - path/to/created/file.md
```

That's it. Four fields. Target: under 200 bytes per marker.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | string | yes | Step ID matching the workflow definition |
| `status` | enum | yes | `completed`, `failed`, or `escalated` |
| `timestamp` | string | yes | ISO 8601 completion time |
| `artifacts` | list | yes | File paths created or modified (empty list if none) |

## Status Values

| Status | Meaning |
|--------|---------|
| `completed` | Step finished successfully |
| `failed` | Step encountered an unrecoverable error |
| `escalated` | Step needs human intervention |

## What status markers do NOT contain

- Conclusions, decisions, or context — these are either passed directly between agents via prompts or captured as insights (see `agent-memory-schema.md`)
- Token usage or duration — operational metrics belong in logging, not state files
- Story/epic IDs — derivable from the file path

## Reading markers for status

Check `.pHive/episodes/{epic-id}/{story-id}/` for marker files. Cross-reference the workflow step order:

| Condition | Story Status |
|-----------|-------------|
| No markers exist | pending |
| Markers exist but final step has none | in-progress |
| Final step marker has `status: completed` | completed |
| Any marker has `status: failed` or `escalated` | failed |
| All `depends_on` stories not yet completed | blocked |

For in-progress stories, the most recent marker (by step order in the workflow) indicates the current phase.

## Story state — derived from markers, not free-written

Story-level `status:` is **derived** from the episode markers above. The free-write `status:` field that appears in some legacy story YAMLs is **deprecated** — it lags reality (per `feedback_story_status_stale` memo: 2026-04-26 incident where YAML `status:` showed work pending while markers showed completed-and-merged).

Authoritative source order: `git + .pHive/episodes/` markers > `.pHive/epics/{id}/stories/{id}.yaml status:` field. When the two disagree, trust the markers.

For richer transition history (when did a story leave `pending`, when did it enter `failed`), tooling should read the per-step markers and reconstruct a `status_transitions:` view from them — `[{state: pending, at: <first marker timestamp>}, {state: in-progress, at: ...}, {state: completed, at: <final marker>}]`. This is computed, not stored — the markers ARE the transition log.

Agent guidance:
- Developer / tester / reviewer / execute: do NOT update story YAML `status:` as part of normal workflow steps. Write the per-step marker; story state is derived.
- If a workflow needs to express "this story moved state at time T", write a marker for the appropriate step (or a new `status_transition` synthetic step in workflows that need explicit state events).
- Tools reading story state (`/hive:status`, planning consumers, meta-team feeds) MUST reconstruct from markers, not read the YAML field.

## Required fields when mode = multica

When Hive runs in Multica execution mode, each story dispatched to the platform
produces an additional marker file at
`.pHive/episodes/{epic-id}/{story-id}/multica-run.yaml`. This file extends the
base four-field schema with two **required** linkage fields:

| Field | Type | Description |
|-------|------|-------------|
| `issue_id` | string (UUID) | Multica issue UUID returned by `multica issue create` |
| `issue_identifier` | string | Human-readable issue key (e.g. `PLU-22`) |

Both fields must be non-empty. They allow the closer step (s1-1) and audit
tooling to look up the live issue without scanning the full cycle state. Run
`node hive/scripts/audit-episode-markers.mjs` from the repo root to verify
every marker satisfies this requirement; the script exits 1 and prints the
offending paths if any field is missing or empty.

## Multica doc/verdict completion dialect

`multica-run.yaml` is the single marker dialect for Multica work. Execute, plan-mode,
and test-mode must all reuse this marker rather than invent phase-specific marker
files. For source-code execution tasks, completion may still require a code-push SHA.
For doc/verdict tasks, including plan documents and simulated-manual test verdicts,
the terminal predicate is:

```
artifacts_committed == true && episode_terminal == true
```

Doc/verdict tasks do not require a code-push SHA. Writers set the following scalar
fields on the same `multica-run.yaml` marker:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `completion_kind` | enum | yes | `doc-verdict` for plan/test doc or verdict tasks; `code-push` for source-code execution tasks. |
| `artifacts_committed` | boolean | yes | `true` only after the task's docs/verdict artifacts have been committed to the shared branch. |
| `episode_terminal` | boolean | yes | `true` when the underlying Multica task status is terminal (`passed`, `failed`, or `cancelled`). The base marker `status:` enum (`completed` / `failed` / `escalated`) is a separate, derived vocabulary. |
| `requires_code_push_sha` | boolean | yes | `false` for `doc-verdict`; `true` for `code-push`. |
| `code_push_sha` | string or null | yes | Commit SHA for code-push tasks; `null` for doc/verdict tasks. |
| `terminal_by_dialect` | boolean | yes | The derived terminal predicate for the selected completion kind. |

The `artifacts` list remains the manifest of committed outputs and audit sidecars.
For doc/verdict tasks it must include the committed plan documents or verdict files
plus `multica-run.messages.jsonl`. Both `plan-mode-multica` and
`test-mode-multica` must set `completion_kind: doc-verdict` and rely on
`terminal_by_dialect`, not a final-comment SHA, to decide whether the Multica run is
complete.

## cc-workflows-run.yaml — `field_sources.agent_models` map

`cc-workflows-run.yaml` markers (emitted by `execute-mode-cc-workflows` and `plan-mode-cc-workflows`) carry a **required** `field_sources.agent_models` section that records the resolved model tier for every agent dispatched in the run. This enables post-run audit tooling to verify every agent ran at the intended tier rather than inheriting the parent session model.

Requirement level (must match the skill specs and the `substrate_coverage.cc_workflows_model_tier_resolved_per_agent` target of `1.0`):

- **REQUIRED** for every `cc-workflows-run.yaml` marker emitted by either mode skill. One entry per dispatched agent. Omitting an entry is a coverage-metric failure.
- **N/A** when no agents are dispatched (zero-agent runs — e.g. a precondition-only dry run that exits before `phase()` is called). In that case the section may be absent or set to `{}`; mark such runs with a `notes:` line explaining the zero-dispatch.

### Shape

```yaml
field_sources:
  agent_models:
    <phase>:           # matches the phase() label in the assembled Workflow script
      persona: <persona>
      tier: sonnet | opus | haiku
      source: model_overrides | model_tiers | default
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `<phase>` | string | Phase label from the Workflow script `phase()` call |
| `persona` | string | Persona name as dispatched (e.g. `developer`, `reviewer`) |
| `tier` | string | Resolved model tier (`sonnet`, `opus`, or `haiku`) |
| `source` | string | Attribution: `model_overrides` (runtime promotion), `model_tiers` (base assignment), or `default` (unmapped — always `sonnet` with WARN) |

### Resolution contract

The tier is resolved by `hive/lib/cc_workflows_model_tier.py` at `workflow_assembly` time, before the Workflow tool is invoked. Precedence:

1. `model_overrides[persona]` — runtime promotion wins
2. `model_tiers[tier]` — iterate tiers looking for persona inclusion
3. Default — `sonnet` with a stderr warning naming the unmapped persona

The helper MUST NOT read persona frontmatter `model:` fields from `hive/agents/*.md`. Frontmatter is documentation (base tier annotation); `hive.config.yaml` is the sole runtime source of truth (per `feedback_frontmatter_base_tier_not_override`).

### Coverage metric

`substrate_coverage.cc_workflows_model_tier_resolved_per_agent` measures the ratio of agents with `field_sources.agent_models` populated to total agent count in a cc-workflows-mode dispatch. Target: `1.0` (every agent carries an explicit resolved tier in the marker).

## Inter-phase context passing

Context between workflow steps is passed **directly via agent prompts**, not stored in marker files. When the orchestrator or team lead runs step N+1, they include relevant output from step N in the task prompt. This is ephemeral — it lives in the conversation, not on disk.

For context that should persist beyond the current session, use the **insight capture** system (see `agent-memory-schema.md`).
