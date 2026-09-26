# Sequential Execution (Step 7)

> `${HIVE_STATE_DIR}` resolves from `paths.state_dir` in the ROOT `hive.config.yaml` at runtime (not from the shipped baseline `hive/hive.config.yaml`). Default: `.pHive`. Relocation after marketplace install still works.

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

## b-0. Skill binding resolution (match-resolve-load-invoke)

Before spawning the subagent in **b**, check the step's agent persona frontmatter for a `skills:` entry (`hive/references/agent-config-schema.md`). A binding is a declaration only — it is inert until this step actually resolves and loads it.

- Call `hive.lib.skill_binding.resolve_skill_binding(persona_path, trigger)`, where `trigger` is the step's `id` or a short description of the current step (e.g. `"running any code review"` for the `review` step, which binds `hive/agents/reviewer.md` to `skills/review/SKILL.md`). **When the persona declares more than one `skills:` binding, do NOT pass the bare step `id` as the trigger** — the resolver matches by bidirectional case-insensitive substring, so a short token like `review` can match two distinct bindings whose `use-when` strings both contain it, raising an ambiguous-authority `SkillBindingError` that fails the step closed on every retry. Pass the full `use-when` phrase of the intended binding instead, so exactly one binding resolves.
- If a binding matches: load the resolved skill file and inject its full content into the subagent prompt as the governing procedure for this step — the persona supplies identity/rubric/output-format only, not a competing inline procedure. Record the resolved path as `skill_invoked: {path}` on the step's captured output (the `AgentHandler`'s `NodeOutput.outputs`, per `hive/lib/dag_executor/executor/handlers/agent.py`) and carry it forward via inter-phase prompt context to downstream steps — it is **not** written onto the base episode marker, which stays limited to the four fields in `hive/references/episode-schema.md` (`step_id`, `status`, `timestamp`, `artifacts`).
- If no `skills:` entry's `use-when` matches this step: proceed with persona-only context exactly as before — zero behavior change for steps with no applicable binding.
- **Fail closed on a matching-but-broken binding.** If `resolve_skill_binding` raises `SkillBindingError` (declared binding present but the target file is missing/unreadable), do not spawn the subagent against inline persona prose as a fallback. Treat it as a step failure subject to the same gate/retry handling as any other failed step (see **f**).

This is the one shared seam sequential and team execution both call — `team-execution.md` points back here rather than re-implementing its own resolver.

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

## b-ii. Implementation-sidecar advisor invocation

For the `implement` step specifically, when a pair-programmer sidecar is configured for the current story (the same story→sidecar_agents map used in **b-i**, filtered to advisor-placement entries), resolve and invoke the bound observe skill using the same shared resolver as **b-0** — this is not a second resolver, it is the identical `hive.lib.skill_binding.resolve_skill_binding` call applied to a different persona/trigger pair:

- Call `hive.lib.skill_binding.resolve_skill_binding("hive/agents/pair-programmer.md", "advising during an implementation-sidecar session")`.
- Spawn the advisor as a **separate subagent instance**, distinct from the `implement` step's developer instance and distinct from the later `review` step's reviewer instance. Distinct instance IDs are load-bearing: the advisor instance MUST NOT be reused as, or influence the selection of, the reviewer instance for the same story.
- Load the resolved `skills/observe/SKILL.md` content into the advisor's subagent prompt as the governing procedure — the persona supplies identity/tone only, not a competing inline procedure.
- Attach the advisor's output to the `implement` step's captured output as **advisory-only** context (see **c** below). It is never treated as a step gate: it does not block step advancement, does not feed the `review` step's `change_verdict` computation, and does not get written as a gate artifact.
- Record the resolved path as `skill_invoked: skills/observe/SKILL.md` on the step's captured output (`NodeOutput.outputs`), same as **b-0** — not on the base episode marker, which stays limited to `hive/references/episode-schema.md`'s four fields.
- **Contract validation.** Before attaching advisor output downstream, call `hive.lib.observe_contract.validate_observe_output` and reject any payload outside its strict advisor schema: verdict/gate/review/blocking fields, machine verdicts, gate-artifact shapes, and pipeline-control instructions must not be forwarded as advice. Ordinary evidence phrases such as “tests passed” remain valid; they are not gate decisions.
- **Fail closed on a matching-but-broken binding**, identically to **b-0**: `SkillBindingError` is a step failure, not a fallback to inline persona prose.
- If no pair-programmer sidecar is configured for the current story: the `implement` step executes exactly as described in **b** — zero diff from pre-story behavior (hard constraint, same as **b-i**).

This seam is independent of **b-i**. **b-i** injects sidecar agents into the `review` step (or after the final step as a fallback); **b-ii** invokes the advisor at the `implement` step, on its own distinct agent instance, ahead of and structurally separate from review. The `review` step's reviewer instance and gate (`skills/review/SKILL.md`'s `passed | needs_optimization | needs_revision`) are unchanged by this seam — observe output is never consulted for that verdict.

## c. Capture the output

Capture the output of each step. Pass outputs to downstream steps as configured in the workflow's `inputs` section — outputs flow directly from step to step via the subagent prompt, not through episode records.

## d. Write an episode record

After each step completes, per the schema in `hive/references/episode-schema.md`, write to:

```
${HIVE_STATE_DIR}/episodes/{epic-id}/{story-id}/{step-id}.yaml
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

Ensure `${HIVE_STATE_DIR}/respawn-summaries/` exists at the start of execution.
