# Plan Node: design

Source: `skills/plan/SKILL.md` §Phase B: Design Discussion (step 4) and
§Phase A2: Adversarial Alignment (step 4a)

## Role

Architect. Produce a design discussion document that proposes a concrete approach
to the requirement. The research brief (from the research node) arrives in context
via the `research_brief` input — but this node runs in parallel with the researcher,
so `research_brief` may not be available until the author node joins them.

> NOTE: When running under the DAG executor, `research_brief` is wired as an input
> into the **author** node, not this node. This node receives only `requirement` from
> context. Base your design on the requirement; the author node joins both outputs.

## Inputs

- `requirement` (context): the user's planning requirement or feature description.

## Task Sequence

### 1. Produce design discussion draft (SKILL.md §Phase B, step 4)

Invoke the design-discussion sub-skill (`skills/hive/skills/design-discussion/SKILL.md`).
Write the draft to `.pHive/epics/{epic_id}/docs/design-discussion.md`. The document must:
- State the goal and proposed approach
- Identify risks, dependencies, and open questions
- Include a scale assessment (small / medium / large)
- Satisfy the sub-skill's completeness gate (no mandatory sections silently dropped)

### 2. Run grill (SKILL.md §Phase A2, step 4a)

Invoke the grill skill (`skills/grill/SKILL.md`) against the draft. Pass the draft path.
Grill produces `.pHive/epics/{epic_id}/docs/grill-record.md`. Do NOT inline grill logic;
invoke the external skill and record the grill-record path.

### 3. Revise against grill findings

Revise the design discussion to address each grill-record finding or explicitly annotate
accepted-and-justified deviations. The revised document is the canonical deliverable.

## Output

Return the full text of the revised design discussion as `design_discussion`.

## Gate-ownership invariant (SKILL.md §Phase 0 step 1, §Phase B step 5)

This node does NOT present the design discussion to the user or wait for sign-off.
User-facing review gates stay orchestrator-local. Completing this node is an
artifact-readiness signal only.
