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

For each story, write `.pHive/epics/{epic_id}/stories/{story_id}.yaml`.

**YAML quoting (the output-validation gate rejects malformed YAML).** Any scalar
value that contains a colon-space (`: `), a leading `>`/`|`/`&`/`*`/`#`/`-`, or a
section glyph like `§…:` MUST be double-quoted — otherwise YAML parses the inner
colon as a mapping and the gate fails the whole plan with "mapping values are not
allowed here". This bites `source:`, `purpose:`, `relevant_excerpt:`, and
acceptance-criteria lines most often. Example:

```yaml
# WRONG — inner colon makes this invalid YAML
source: design_discussion §Key decision: dual-target without a build step
# RIGHT
source: "design_discussion §Key decision: dual-target without a build step"
```

When in doubt, quote the value. Block scalars (`>`/`|`) are fine for multi-line
prose but the FIRST line after them must not reintroduce an unquoted colon.

REQUIRED fields on every story (the output-validation gate rejects the plan
otherwise — `target: plan-epic` schema):

- `id` — the story slug (matches the filename and the epic `stories[].id`).
- `title` — one-line summary.
- `acceptance_criteria` — a NON-EMPTY list of concrete, checkable criteria
  (Given/When/Then or equivalent). Never omit this and never leave it empty.
- `steps` — a NON-EMPTY list of the workflow steps for the resolved
  methodology (e.g. research/implement/test/review/integrate), each with an
  `id`, `description`, and `agent`.
- `depends_on` — list of upstream story ids (may be empty `[]`).

Each story must be self-contained: inline `relevant_excerpt` in references,
`snippet` in code_examples, `purpose` in key_files. Steps must match the
resolved methodology template. Emit `parallel_allowed: true` +
`parallel_rationale` only when the story satisfies the
bounded-slice/variation/read-only criteria.

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

## DAG executor outputs (required under the Multica binding)

You commit the epic to `feat/{epic_id}` and push it — that branch, NOT your
working checkout, is where the epic lives. The DAG executor cannot guess which
branch you used, so it cannot reconcile your work into the project tree unless
you REPORT it. Before finishing, WRITE these to `.pHive/dag-outputs/outputs.yaml`
(create the directory) in your working copy, as a flat `key: value` YAML map:

```yaml
epic_dir: .pHive/epics/{epic_id}
commit_sha: <the full SHA of your [plan-graph] commit>
branch: feat/{epic_id}
```

- `branch` MUST be the exact branch you committed + pushed the epic to
  (`feat/{epic_id}`, or the resolved `git_flow.base_branch`). The executor's
  reconcile step fetches THIS branch at `commit_sha` and fast-forward-merges it
  into the project tree the validation gate checks. An empty/wrong `branch` is
  the single most common reason a completed plan run fails downstream with
  "epic.yaml not found".
- Push the branch to `origin` so reconcile can fetch it (you already do this in
  step 6). This file is gitignored execution scratch — do not commit it.

## Constraints

- Do NOT present anything to the user or wait for sign-off. User gates are
  orchestrator-local (SKILL.md §Phase B step 5, §Phase B3 step 10).
- The graph IS the source of truth. Do not reproduce the full plan skill prose.
  Cite source sections; do not duplicate them.
