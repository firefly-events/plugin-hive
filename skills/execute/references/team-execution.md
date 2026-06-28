# Team Execution (Step 6)

> `${HIVE_STATE_DIR}` resolves from `paths.state_dir` in the ROOT `hive.config.yaml` at runtime (not from the shipped baseline `hive/hive.config.yaml`). Default: `.pHive`.
>
> **Parallel-dispatch gate (ed-7):** `Agent(name:)` (this section) and the cmux variant (below) are two of the four in-scope dispatch points for the parallel gate. Each story listed in the prompt must already carry the `parallel_allowed: true` + `parallel_rationale ∈ {variation, read-only, bounded-slice}` pair emitted by `/plan` Phase C step 13, with `bounded-slice` stories declaring disjoint `files_to_modify[]`. The gate runs in `execute-dispatch` Step 1.5 *before* this section's prompt is generated — by the time you arrive here, the depth-0 `unblocked_stories[]` set has already been validated and `mode_decision` was downgraded to `sequential` on any violation. See [`hive/references/parallel-call-sites.md`](../../../hive/references/parallel-call-sites.md) §2 for the catalog of in-scope sites.

Spawn each story as a named teammate via `Agent(name: "{story-id}")` — one `Agent(name:)` call per story, and each call's prompt carries ONLY that one story's scope. Never combine two or more stories into a single teammate's prompt. Parallel teammates require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (research preview, NOT GA); sequential is the guaranteed floor when the flag is unset. Generate a natural-language prompt per story that describes that single story's task:

```
Execute story "{story-id}" of the "{epic-id}" epic.

## Scope (this teammate, this story only)
You own exactly one story: {story-id}. Do NOT read, start, or execute any
other story. Read the story at
${HIVE_STATE_DIR}/epics/{epic-id}/stories/{story-id}.yaml and execute the
steps described.

## Dependencies & context
[If no depends_on:] No dependencies — start immediately.
[If depends_on present:] Depends on: {dep-1}, {dep-2}. Wait until all
dependencies complete before starting this story.

## Workflow
Follow the development workflow phases from the loaded methodology
(e.g., research -> implement -> test -> review -> integrate).

## Completion & reporting
Write episode records after each step to
${HIVE_STATE_DIR}/episodes/{epic-id}/{story-id}/. When this story
completes, report back.
```

Rules for generating each per-story prompt:
- Emit exactly one prompt per story, addressed to that single story only — never name a second story's scope inside a teammate's prompt. Use the story ID as the teammate name (`Agent(name: "{story-id}")`).
- Stories with no `depends_on` say "start immediately"; stories with dependencies list them explicitly so the teammate blocks correctly.
- Do NOT inline the full story content — each teammate reads its own story YAML file directly.
- For large epics (10+ stories), keep each prompt minimal (ID + title + deps only) — but still one scoped prompt per story.

## Sidecar injection (append-placement triggers)

After building each story's task block, check if that story's ID is present in the story→sidecar_agents map (populated in step 2b from `appends[]` records).

- If the story ID is **not** in the map: the task block is emitted byte-for-byte as described above — no changes.
- If the story ID **is** in the map: append the following to that story's task block (one line-pair per agent in the list):

  ```
  Also spawn {agent-name} as a sidecar for the review step.
  {agent-name} reads hive/agents/{agent-name}.md and participates in code review.
  ```

- Epics with no `appends[]` entries produce an `Agent(name:)` prompt that is byte-for-byte identical to pre-sidecar behavior — this is the primary constraint.

> **Pattern note:** This is the sidecar-within-named-teammate pattern — sidecar runs within the dev teammate's pane, not as a separate `Agent(name:)` call.

## Per-Story Commits

Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes. Do NOT batch commits at epic end.

## Respawn Monitoring (team execution)

The orchestrator monitors active teammates for context degradation signals during execution. If a teammate shows signs of context pressure (see `skills/hive/skills/respawn/SKILL.md` for detection heuristics), the orchestrator triggers the respawn protocol:

1. `SendMessage` the respawn signal to the teammate
2. Wait for the teammate to write its respawn summary to `${HIVE_STATE_DIR}/respawn-summaries/`
3. Check the respawn iteration count — if >= 3, escalate to user instead
4. Spawn a fresh teammate via agent-spawn skill with `respawn_summary_path` pointing to the summary
5. The fresh teammate picks up where the previous one left off

Ensure `${HIVE_STATE_DIR}/respawn-summaries/` exists before epic execution begins (create if needed).

## cmux Team Execution Variant

When active: `execution.terminal_mux` resolves to `cmux` (explicit setting, or `auto` with cmux detected).

Dispatch: same as the `Agent(name:)` path — the orchestrator loops through stories — but delivers each story prompt to a cmux pane via agent-spawn instead.

- Topologically sorted stories with no unmet dependencies are spawned immediately.
- Each spawn goes through the agent-spawn skill (section 7.3), which opens a cmux pane, launches `claude` in interactive mode, and delivers the prompt.
- Agent-spawn returns a `surface_id`; the orchestrator records it in the tracking map.

Tracking map:

```
{story_id: {surface_id, status: pending|active|complete|failed, depends_on: [...]}}
```

Poll loop (replaces `Agent(name:)`'s internal monitoring):

```
Every 10 seconds:
  for each active surface:
    cmux read-screen --surface <id> --scrollback
    - Search output for [STORY-COMPLETE:{story-id}]
    - Persist last-read line count per surface to avoid reprocessing
    - If marker found: mark complete, check dependents
    - If surface.health fails: mark failed, capture scrollback, log error
```

Dependency unblocking: when `story-a` completes, scan the tracking map for stories whose `depends_on` lists are now fully satisfied, then spawn those stories.

Messaging: the orchestrator can send messages to any active pane.

- Respawn signal: `cmux send --surface <id> "Your context is degrading. Write a respawn summary to ${HIVE_STATE_DIR}/respawn-summaries/{story-id}.md and exit."`
- Sidecar injection: `cmux send --surface <id> "Also spawn {agent-name} as a sidecar for the review step. Read hive/agents/{agent-name}.md."`

Completion marker convention: agents must emit `[STORY-COMPLETE:{story-id}]` as the last line of their workflow output. Add this to the per-story prompt template.

Cleanup: after all stories complete, close all surfaces: `cmux close-surface --surface <id>` for each tracked surface.

Sidecar injection: same logic as the `Agent(name:)` variant. Check the story→sidecar_agents map and append sidecar instructions to the story prompt before spawn.

Per-story commits: same as the `Agent(name:)` variant. Stories commit independently on feature branches.

Respawn monitoring: same detection heuristics, but use `surface.send_text` for the respawn signal and `surface.read_text` plus `surface.health` for monitoring and liveness.
