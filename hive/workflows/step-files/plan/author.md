# Plan Node: author

Source: `skills/plan/SKILL.md` §Phase C: Story Decomposition (steps 10c–15)
and §Phase D: Publishing (step 19, adapter-gated)

## Role

Technical-writer. Receive the research brief and design discussion, decompose the
requirement into stories, write all story YAMLs and the epic index, commit to the
feature branch. This node is the primary artifact producer for the plan flow.

## Inputs

- `research_brief` (step_output from `research`): markdown research brief
- `design_discussion` (step_output from `design`): markdown design discussion
- `requirement` (context): original planning requirement

## Task Sequence

### 1. Resolve methodology (SKILL.md §Phase C, step 10c)

Apply 4-tier precedence:
1. `--methodology=<value>` flag in requirement → use it
2. `epic.yaml` `methodology:` field → use it
3. `hive.config.yaml` `methodology:` field → use it
4. Auto-detect: scan for `.feature` files (→ bdd), test dirs (→ tdd), else `classic`

Emit: `[telemetry] methodology_resolution source=<source> value=<value>`

Available: `classic`, `tdd`, `bdd`. Must match a workflow YAML in `hive/workflows/`.

### 2. Decompose into stories (SKILL.md §Phase C, steps 11–12)

Using the design discussion (scale, proposed approach, vertical slices if present),
break the requirement into an epic with dependency-tracked stories. Apply
requirements traceability: every stated capability maps to at least one story.
Flag unmapped capabilities as GAPS before proceeding.

### 3. Write story YAMLs (SKILL.md §Phase C, step 13)

For each story, write `.pHive/epics/{epic_id}/stories/{story_id}.yaml`. Each story
must be self-contained: inline `relevant_excerpt` in references, `snippet` in
code_examples, `purpose` in key_files. Steps must match the resolved methodology
template. Emit `parallel_allowed: true` + `parallel_rationale` only when the story
satisfies the bounded-slice/variation/read-only criteria.

### 4. Evaluate cross-cutting concerns (SKILL.md §Phase C, step 14)

For each story, evaluate each concern's `applies_when`. Add `cross_cutting:` entries
or dedicated metric blocks per the concern routing table. Run the metric review gate
(step 14a) before proceeding.

### 5. Write epic index (SKILL.md §Phase C, step 15)

Write `.pHive/epics/{epic_id}/epic.yaml` with: `name`, `title`, `methodology`,
`version_bump` (default `none`), `git_flow` block, and `stories` list.

### 6. Commit to feature branch

Commit all `.pHive/epics/{epic_id}/` files to `feat/{epic_id}` (or the resolved
`git_flow.base_branch`). Use prefix `[plan-graph]` in the commit message.

Output the committed epic directory path as `epic_dir` and the commit SHA as
`commit_sha` (empty string when running under local binding — ReconcileHandler
no-ops on empty SHA).

### 7. Publish to tracker (SKILL.md §Phase D, step 19, adapter-gated)

If `task_tracking.adapter` is configured, publish each story via the
task-tracking dispatch module. Write `tracker_id` back into story YAMLs. If
`task_tracking.adapter` is unset, skip Phase D silently.

## Outputs

- `epic_dir`: repo-root-relative path to the committed epic directory,
  e.g. `.pHive/epics/my-feature`
- `commit_sha`: git SHA of the commit (empty string under local binding)

## Constraints

- Do NOT present anything to the user or wait for sign-off. User gates are
  orchestrator-local (SKILL.md §Phase B step 5, §Phase B3 step 10).
- The graph IS the source of truth. Do not reproduce the full plan skill prose.
  Cite source sections; do not duplicate them.
