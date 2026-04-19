# Sequential Execution (Step 7)

For each story (in dependency order):

## a. Read the workflow steps

Each step has an `agent` field referencing a persona in `hive/agents/`. Read that agent's markdown file to understand their role and output format.

## b. Execute each step sequentially

Spawn a subagent with:
- The agent persona (from `hive/agents/{agent}.md`) as system context
- **If `step_file` exists on the workflow step:** read the step file and include it as the primary task instructions. The agent receives three layers of context:
  1. Agent persona (WHO — identity, capabilities, quality standards)
  2. Step file (HOW — exact procedure, execution rules, command templates, gating)
  3. Story spec (WHAT — the specific feature to implement)
- **If `step_file` does not exist:** use the step's `description` field (the workflow step's human-readable instruction, as defined by the story schema in `skills/plan/SKILL.md`).
- Any `inputs` from previous steps, resolved **directly from prior step outputs** (as configured in the workflow's `inputs` section) and any referenced artifacts on disk. Inter-phase context must be passed in the subagent prompt — do **not** attempt to reconstruct it by reading episode records.
- The story's specification (description + acceptance criteria).

## b-i. Sidecar injection (append-placement triggers)

For the current story, check if its ID is present in the story→sidecar_agents map (populated in step 2b from `appends[]` records).

- If the story ID is **not** in the map: all steps execute exactly as described in **b** — zero diff from pre-story behavior (hard constraint).
- If the story ID **is** in the map:
  - Scan the story's workflow step list for a step with `id: review`. (All three development workflows — classic, tdd, bdd — include this step.)
  - **If a "review" step is found:** when step execution reaches that step, inject each sidecar agent as a participating agent in the subagent spawn. Include each agent's persona (`hive/agents/{agent-name}.md`) alongside the primary reviewer persona and instruct each sidecar to participate in code review. This is injection INTO the step — not a new step.
  - **If no "review" step exists in the workflow:** after the final workflow step completes, inject sidecar agents as an additional post-step execution. Before injecting, emit:

    ```
    [warn] sidecar inject-after fallback: review step not found in {workflow-file}; scanned steps: {step-name-list}; sidecar agent(s) appended after final step
    ```

    The warning must include the workflow filename and the full list of scanned step IDs. This fallback path is the primary mitigation for deep-coupling risk — implement it with the same care as the happy path.
- For all steps other than the injection target: proceed with step execution unchanged.

## c. Capture the output

Capture the output of each step. Pass outputs to downstream steps as configured in the workflow's `inputs` section — outputs flow directly from step to step via the subagent prompt, not through episode records.

## d. Write an episode record

After each step completes, per the schema in `hive/references/episode-schema.md`, write to:

```
.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml
```

Episode markers are **limited to status and artifact paths** (per the episode schema). They are the audit trail — discovery of what ran, succeeded/failed, and which artifacts it produced. They are **not** a data-flow mechanism. Substantive step output is carried forward in the subagent prompt for the next step, never reconstructed by reading episode YAMLs.

## e. Check review verdict

After the review step:

- `passed` -> skip `optimize`, proceed directly to `integrate`
- `needs_optimization` -> execute `optimize` step, then `integrate`
- `needs_revision` -> route to fix loop or replanning

## f. Check other gate criteria

Before advancing. For test steps, verify tests pass. For failed gates, write a `failed` episode and halt the story.

## g. Respawn Monitoring (sequential execution)

During long-running steps (implement, test, optimize), the orchestrator should watch for context degradation in the spawned sub-worker. If the sub-worker's responses show quality decline, repetitive behavior, or task drift (see `skills/hive/skills/respawn/SKILL.md` for the full signal list):

1. Signal the sub-worker to write a respawn summary
2. After the sub-worker writes the summary and terminates, check respawn count (max 3 per step)
3. Spawn a fresh sub-worker via agent-spawn skill with `respawn_summary_path`
4. The fresh sub-worker continues the step from where the previous one left off
5. If respawn count reaches 3, escalate to the user with the summary chain

Ensure `.pHive/respawn-summaries/` exists at the start of execution.
