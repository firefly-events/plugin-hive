# Architect Review — Epic F Phase B2 H/V Plans

**Verdict:** approve-with-escalation

The direct SKILL extraction plan is feasible after correcting path prefixes.
The workflow extraction slice is not feasible as written because `task_file:`
is not a visible workflow contract and a citation-only `task:` would not pass
the extracted prompt body to `ui-designer`.

## Pass 1: Horizontal plan feasibility

### H1. Prompt Reference Directory Convention

Finding: feasible.

The seam is real. `hive/references/` is already the shared reference surface,
with existing flat W6 files `hive/references/brand-system-schema.yaml` and
`hive/references/design-token-spec.md` visible in the directory listing.
The current directory also contains topic subdirectories only where a family
has multiple artifacts, such as `hive/references/document-templates/`.

Evidence:
- `hive/references/brand-system-schema.yaml` exists in the `hive/references/`
  listing.
- `hive/references/design-token-spec.md` exists in the `hive/references/`
  listing.
- W6 a-08 created `hive/references/brand-system-schema.yaml` as the canonical
  destination, not a plugin-root placeholder path
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:23`,
  `.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:28`).
- W6 a-09 uses `hive/references/design-token-spec.{md|yaml}`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:18`,
  `.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:24`).

Touched files are correct for the six new prompt files under
`hive/references/ui-prompts/`.

Cross-layer dependencies are complete:
- H2 cannot cite prompt files before H1 creates the four direct SKILL prompt
  files.
- H3 cannot use design-review prompt files before H1 creates the two workflow
  prompt files.
- H4 must count files and citation references after H1-H3 land.

Hidden coupling: the H1 plan should say explicitly that prompt citations are
repo-root-relative paths. Current SKILLs cite `hive/references/...` directly
(`skills/brand-system/SKILL.md:38`, `skills/design-system/SKILL.md:47`), and
W6 stories use the same convention
(`.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:46`,
`.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:37`).

Recommendation: keep the directory flat, put `## Required placeholders` in
every prompt file, and use repo-root-relative citations like
`hive/references/ui-prompts/brand-system.md`.

### H2. SKILL Body Reduction

Finding: feasible with path correction.

The seam is real. The four direct SKILLs currently contain inline
`ui-designer` task blocks at `skills/brand-system/SKILL.md:32`,
`skills/design-system/SKILL.md:42`, `skills/polish-audit/SKILL.md:85`, and
`skills/visual-qa/SKILL.md:49`.

Touched files are wrong in the H/V plans where they use `skills/hive/skills/...`.
The actual files are:
- `skills/brand-system/SKILL.md`
- `skills/design-system/SKILL.md`
- `skills/polish-audit/SKILL.md`
- `skills/visual-qa/SKILL.md`

Evidence:
- `find skills -maxdepth 3 -path '*/SKILL.md'` lists
  `skills/brand-system/SKILL.md`, `skills/design-system/SKILL.md`,
  `skills/polish-audit/SKILL.md`, and `skills/visual-qa/SKILL.md`.
- `skills/hive/skills/brand-system/SKILL.md` does not exist in this repo.
- W6 a-08 uses `skills/brand-system/SKILL.md`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:24`,
  `.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:29`).
- W6 a-09 uses `skills/design-system/SKILL.md`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:12`,
  `.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:25`).

Cross-layer dependencies are complete:
- H2 consumes H1 prompt files.
- H2 provides direct-SKILL citation and negative-inline-grep proof for H4.
- H2 is independent of H3 after H1 because edited files do not overlap.

Hidden coupling: all H2 grep commands must be rewritten to
`skills/{brand-system,design-system,polish-audit,visual-qa}/SKILL.md`, and
`polish-audit` flow must remain intact around its two-agent procedure
(`skills/polish-audit/SKILL.md:81`, `skills/polish-audit/SKILL.md:119`).

Recommendation: approve H2 after path-prefix correction; keep the direct SKILL
flow local: load persona, load prompt reference, inject placeholders, spawn,
capture.

### H3. Workflow File Extraction

Finding: blocked as written.

The seam is real. `hive/workflows/design-review.workflow.yaml` has two
`ui-designer` inline `task:` blocks at
`hive/workflows/design-review.workflow.yaml:56` and
`hive/workflows/design-review.workflow.yaml:88`; their step IDs begin at
`hive/workflows/design-review.workflow.yaml:54` and
`hive/workflows/design-review.workflow.yaml:86`.

The touched workflow file is correct, but the touched runtime/invoker set is
incomplete. `skills/design-review/SKILL.md` is the procedural consumer of the
workflow file. It currently says to execute steps by spawning each agent with
the step `task`, not with a prompt reference or external task file
(`skills/design-review/SKILL.md:95`, `skills/design-review/SKILL.md:96`).

Runtime contract evidence:
- Workflow schema documents `task:` and `step_file:`, not `task_file:`
  (`hive/references/workflow-schema.md:16`,
  `hive/references/workflow-schema.md:18`).
- Workflow schema says `step_file` replaces inline `task`, with
  `step_file` authoritative over `task`
  (`hive/references/workflow-schema.md:35`,
  `hive/references/workflow-schema.md:39`).
- The DAG loader maps `raw.get("task")` and `raw.get("step_file")`; there is
  no `task_file` mapping (`hive/lib/dag_executor/graph/loader.py:75`,
  `hive/lib/dag_executor/graph/loader.py:76`).
- The DAG model has `task` and `step_file` fields only
  (`hive/lib/dag_executor/graph/model.py:118`,
  `hive/lib/dag_executor/graph/model.py:119`).
- A repo-wide workflow grep found many `task:` and `step_file:` fields, and
  no workflow `task_file:` fields.

Cross-layer dependencies are incomplete:
- H3 consumes H1 prompt files.
- H3 provides workflow citation proof to H4.
- H3 also requires one of these additional contracts before it is feasible:
  a supported `step_file:` use path in `skills/design-review/SKILL.md`, or a
  new `task_file:`/prompt-file loader contract in the design-review runtime.

Hidden coupling:
- `skills/design-review/SKILL.md` must be in S3 scope if externalized prompt
  files are intended to be loaded at runtime.
- A citation-only `task:` scalar is not behavior-preserving. It would pass the
  citation text, not the extracted prompt body, because the design-review
  skill says to pass the workflow step `task`
  (`skills/design-review/SKILL.md:95`, `skills/design-review/SKILL.md:96`).

Recommendation: do not use `task_file:` unless S3 extends the workflow runtime
and schema. Prefer existing `step_file:` only if `skills/design-review/SKILL.md`
lines 95-99 are updated to load it before spawn. If no runtime change is
allowed, keep `task:` inline and mark S3 out of scope for Epic F extraction.

### H4. Verification + Grep Gates

Finding: feasible with corrected paths and S3 contract dependency.

The layer is valuable. S4 is the right place to make the refactor inspectable:
prompt file count, direct SKILL citation count, no inline direct-SKILL task
markers, workflow prompt references, and line deltas.

Touched files are incomplete only insofar as S4 acceptance commands contain the
wrong direct-SKILL path prefix. The plan's current commands use
`skills/hive/skills/{...}/SKILL.md`
(`.pHive/epics/ui-cluster-extract-config-deeper/docs/vertical-plan.md:189`,
`.pHive/epics/ui-cluster-extract-config-deeper/docs/vertical-plan.md:190`).
Those should be `skills/{...}/SKILL.md`.

Cross-layer dependencies are complete:
- S4 must depend on S2 and S3
  (`.pHive/epics/ui-cluster-extract-config-deeper/docs/vertical-plan.md:176`).
- S4 is not meaningful before all six prompt files exist and all five
  consumers are updated.

Hidden coupling: S4 must match the final S3 contract. If S3 uses `step_file:`,
S4 checks `step_file:` references. If S3 adds `task_file:`, S4 checks schema and
runtime loading. Citation-only `task:` would make S4 a false-positive gate.

Recommendation: keep S4 separate, fix paths before story generation, and make
workflow verification conditional on the selected S3 runtime shape.

## Pass 2: Vertical plan feasibility

### Slice S1: Convention Establishment on W6-precedent Pair

Finding: feasible with path correction.

Working state is achievable: the prompt files can be created, the original
blocks exist at `skills/brand-system/SKILL.md:32` and
`skills/design-system/SKILL.md:42`, and both SKILLs can cite the new files.

Slice boundary is clean: it creates the convention on two W6-precedent SKILLs,
does not depend on workflow runtime behavior, and leaves the remaining direct
SKILLs untouched.

`depends_on` is correct:
- `depends_on: none` is valid for S1.

Could it be cut thinner? Yes, but do not split. Both use the same extraction
motion, W6 already established the reference pattern, and the audit cap is four
stories.

Required correction:
- Change all acceptance commands from
  `skills/hive/skills/{brand-system,design-system}/SKILL.md` to
  `skills/{brand-system,design-system}/SKILL.md`
  (`.pHive/epics/ui-cluster-extract-config-deeper/docs/vertical-plan.md:57`).

### Slice S2: Full SKILL Cluster Coverage

Finding: feasible with path correction.

Working state is achievable: `skills/polish-audit/SKILL.md:85-115` and
`skills/visual-qa/SKILL.md:49-97` are discrete prompt blocks and can move while
the surrounding capture/report flow remains intact
(`skills/polish-audit/SKILL.md:117`, `skills/visual-qa/SKILL.md:99`).

Slice boundary is clean: it completes direct SKILL coverage after S1 and does
not overlap with S3 workflow YAML edits.

`depends_on` is correct:
- S2 depends on S1 because it inherits S1's prompt header and SKILL load shape.

Could it be cut thinner? Yes, but do not split unless implementation uncovers a
prompt-injection contract issue. The work is homogeneous and the plan needs the
fourth story for S4.

Required correction:
- Change all S2 direct SKILL paths from `skills/hive/skills/...` to
  `skills/...`
  (`.pHive/epics/ui-cluster-extract-config-deeper/docs/vertical-plan.md:102`,
  `.pHive/epics/ui-cluster-extract-config-deeper/docs/vertical-plan.md:103`).

### Slice S3: Workflow Extraction for Design-review

Finding: not feasible as written; feasible only after selecting and specifying
a supported external-task loading contract.

Working state is not currently achievable with `task_file:`. No `task_file:`
field is visible in workflow YAMLs, documented in the schema, read by the DAG
loader, or stored on the DAG model.

Working state is also not achievable with citation-only `task:`. The
design-review skill passes the workflow step `task` to spawned agents
(`skills/design-review/SKILL.md:95`, `skills/design-review/SKILL.md:96`), so a
citation-only task would pass a pointer instead of the original instructions.

Slice boundary is too narrow: the plan names the workflow and prompt files, but
must also name `skills/design-review/SKILL.md` if the external prompt body is
loaded before spawn.

`depends_on` is incomplete but fixable: S3 depends on S1 and on an explicit
runtime decision: `step_file:` support in the design-review skill,
`task_file:` runtime extension, or no S3 extraction.

Could it be cut thinner? Do not split by task; the two design-review tasks
share one workflow consumer and one runtime contract question. Split only if
the team chooses a larger generic workflow-runtime extension.

Required correction:
- Add `skills/design-review/SKILL.md` to S3 touched files.
- Choose one shape in the story:
  `step_file: hive/references/ui-prompts/design-review-design-critique.md`
  plus design-review skill support, or a new `task_file:` contract with
  runtime/schema changes.

### Slice S4: Verification + Grep Gates

Finding: feasible after S3 is repaired.

Working state is achievable after S3 is repaired: direct SKILL grep gates,
six-file prompt count, and workflow grep against the selected S3 field shape.

Slice boundary is clean: S4 is verification-only and should not implement
prompt movement.

`depends_on` is correct:
- S4 depends on S2 and S3.

Could it be cut thinner? No. Folding it into S2/S3 would hide the aggregate
regression proof.

Required correction:
- Update S4 commands to use `skills/{brand-system,design-system,polish-audit,visual-qa}/SKILL.md`.
- Add a workflow-runtime proof matching the S3 contract.

## Pass 3: Writer-flagged re-validation items

### 1. S3 task: vs task_file: workflow runtime

Verdict: `task_file:` is unsupported until proven otherwise; S3 is blocked as
written.

Evidence:
- `hive/workflows/design-review.workflow.yaml` uses inline `task:` at the two
  target locations (`hive/workflows/design-review.workflow.yaml:56`,
  `hive/workflows/design-review.workflow.yaml:88`).
- Workflow schema documents `task:` as the fallback task description and
  `step_file:` as the external instruction file
  (`hive/references/workflow-schema.md:16`,
  `hive/references/workflow-schema.md:18`,
  `hive/references/workflow-schema.md:35`).
- DAG loader reads only `task` and `step_file`
  (`hive/lib/dag_executor/graph/loader.py:75`,
  `hive/lib/dag_executor/graph/loader.py:76`).
- DAG model stores only `task` and `step_file`
  (`hive/lib/dag_executor/graph/model.py:118`,
  `hive/lib/dag_executor/graph/model.py:119`).
- Design-review skill currently executes the step `task`, not `step_file` or
  `task_file` (`skills/design-review/SKILL.md:95`,
  `skills/design-review/SKILL.md:96`).

Definitive call: do not author `task_file:` without runtime/schema support, and
do not use citation-only `task:` as extraction. Safer default if unresolved:
keep inline `task:` and mark S3 unshippable, or update
`skills/design-review/SKILL.md` to load supported `step_file:` content.

Feasibility impact: this is the only major blocker, and it requires escalation
because the plan promises S3 extraction without a supported loading contract.

### 2. SKILL path prefix convention

Verdict: use `skills/<skill-name>/SKILL.md`, not
`skills/hive/skills/<skill-name>/SKILL.md`.

Evidence:
- Current direct SKILL files exist at `skills/brand-system/SKILL.md`,
  `skills/design-system/SKILL.md`, `skills/polish-audit/SKILL.md`, and
  `skills/visual-qa/SKILL.md`.
- `skills/hive/skills/brand-system/SKILL.md` does not exist.
- W6 a-08 path precedent is `skills/brand-system/SKILL.md`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:24`,
  `.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:76`).
- W6 a-09 path precedent is `skills/design-system/SKILL.md`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:12`,
  `.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:67`).

Prompt reference prefix: use `hive/references/ui-prompts/...`, not
`${CLAUDE_PLUGIN_ROOT}/hive/references/ui-prompts/...`, unless a future runtime
contract requires environment interpolation.

Evidence for prompt reference prefix:
- Current SKILL references use `hive/references/...`
  (`skills/brand-system/SKILL.md:38`, `skills/brand-system/SKILL.md:44`,
  `skills/design-system/SKILL.md:47`, `skills/design-system/SKILL.md:57`).
- W6 a-08 implementation instruction uses `hive/references/brand-system-schema.yaml`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-08-brand-system-extract-config.yaml:46`).
- W6 a-09 implementation instruction uses `hive/references/design-token-spec.{md|yaml}`
  (`.pHive/epics/structural-refactor-and-gate-lift/stories/a-09-design-system-extract-config.yaml:37`).

### 3. Direct-load boilerplate (Mattpocock check)

Verdict: acceptable, not a blocker, if the boilerplate is limited to a tiny
standard load-and-inject paragraph per SKILL.

Mattpocock atomicity check: the atom to centralize is the prompt body, not the
local invocation shell. The four direct SKILLs still own different gates,
context, outputs, and report paths. A shared helper would add a new routing
surface larger than the duplicated text it removes.

Evidence:
- `brand-system` has no gate and produces brand artifacts
  (`skills/brand-system/SKILL.md:16`, `skills/brand-system/SKILL.md:71`).
- `design-system` gates on `.pHive/brand/brand-system.yaml`
  (`skills/design-system/SKILL.md:16`, `skills/design-system/SKILL.md:18`).
- `polish-audit` has a two-step specialist flow and writes a polish report
  (`skills/polish-audit/SKILL.md:81`, `skills/polish-audit/SKILL.md:119`).
- `visual-qa` performs fidelity comparison and writes a QA report
  (`skills/visual-qa/SKILL.md:45`, `skills/visual-qa/SKILL.md:101`).

Recommendation: standardize wording in S1 and reuse it in S2: read
`hive/references/ui-prompts/<name>.md`, preserve the citation in the spawned
task, inject listed placeholders, then spawn `ui-designer`. Do not create a
shared helper in Epic F.

## Pass 4: Architectural concerns + Mattpocock atomicity

### Concern: S3 currently shifts hidden behavior into an unsupported field

Severity: major.

The H/V plan correctly noticed the workflow seam, but it stops short of naming
the required consumer change. The design-review skill is a procedural runtime
for this workflow and must be updated if the prompt body is no longer inline.

Concrete fix:
- Add `skills/design-review/SKILL.md` to S3.
- Either support `step_file:` in the design-review skill or add `task_file:`
  as a real schema/runtime field.
- Add acceptance proof that both target modes still pass full prompt content.

### Concern: path-prefix drift would break every direct SKILL gate

Severity: moderate.

The plans already flagged the issue, and the spot-check resolves it
definitively. The wrong path prefix appears in H2, S1, S2, S3, and S4
acceptance examples.

Concrete fix:
- Rewrite all `skills/hive/skills/...` direct SKILL references to
  `skills/...`.
- Rewrite `skills/hive/skills/design-review/SKILL.md` to
  `skills/design-review/SKILL.md`.

### Mattpocock atomicity verdict

The prompt extraction target is atomic enough.

The plan does not merely shift the duplication if the prompt bodies become
single-source references. Repeating a small loader instruction in four SKILLs
is acceptable because each SKILL remains the local owner of its gate and output
contract. The smell threshold would be crossed if each SKILL duplicated a
multi-step placeholder parser, shared error policy, prompt-file discovery
algorithm, or fallback cascade.

None of those are required for Epic F. Keep it direct and explicit.

### Persona boundary

Do not edit `hive/agents/ui-designer.md`.

Evidence:
- The persona already separates persona identity from step execution:
  `hive/agents/ui-designer.md:43` starts `## Step files`, and
  `hive/agents/ui-designer.md:45` says step files tell HOW while the persona
  tells WHO.

## Open items remaining

- Story specs must choose the S3 external-task mechanism before implementation.
- Story specs must update all direct SKILL paths to `skills/...`.
- Story specs must refine line-delta targets against actual edited blocks.
- Prompt files need exact `## Required placeholders` formatting.
- S4 must update grep gates to match the final S3 field shape.
- If `step_file:` is chosen for S3, decide whether `hive/references/ui-prompts/*.md`
  is acceptable as a `step_file` target or whether workflow prompt files should
  live under `hive/workflows/steps/design-review/`.

## Escalation Flags (if any)

- [major] custom:`workflow-contract:audit` — S3 promises externalized
  workflow prompt loading, but `task_file:` is not a visible workflow contract
  and citation-only `task:` is not behavior-preserving. Resolve before story
  execution by choosing `step_file:` plus `skills/design-review/SKILL.md`
  support, or by adding a real `task_file:` schema/runtime contract. —
  raised_by: architect
