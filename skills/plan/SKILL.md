---
name: plan
description: Decompose a requirement into an epic with dependency-tracked stories.
---

# Hive Plan

Decompose a requirement into an epic with dependency-tracked stories.

**Input:** `$ARGUMENTS` contains the requirement or feature description. Optionally a target codebase path.

## Process

1. **Research the codebase.** Before decomposing, explore the target codebase to understand the tech stack, architecture, existing patterns, and relevant files. Use the researcher agent mindset — you need concrete file paths, not guesses.

2. **Load cross-cutting concerns.** Check for `state/cross-cutting-concerns.yaml`. If found, load the concerns — they will be evaluated per-story in step 6. See `hive/references/cross-cutting-concerns.md` for the full specification.

3. **Decompose into stories.** Break the requirement into an **epic** containing multiple **stories**. Each story should be independently implementable and testable.

4. **Requirements traceability check.** Before finalizing stories, verify every aspect of the original requirement is covered by at least one story:
   - Re-read the original requirement/PRD
   - List every distinct capability, feature, or behavior mentioned
   - Map each to at least one story
   - Flag any unmapped capabilities as **GAPS**
   - Present gaps to the user before proceeding — missing stories are cheaper to add now than discover during testing

   ```
   TRACEABILITY:
     Mapped: 8 of 10 capabilities covered
     GAPS:
     - SMS/email invites to non-users — not covered by any story
     - Contact permission flow — not covered by any story
   ```

5. **Write detailed story files.** For each story, produce an individual YAML file in `state/epics/{epic-id}/stories/{story-id}.yaml`. Stories are the primary artifact — they're what agents read when executing. They must contain enough context for an agent to work autonomously without reading the full epic or other stories.

6. **Evaluate cross-cutting concerns per story.** For each story, evaluate each concern's `applies_when` condition. For applicable concerns, determine the specific action needed and add a `cross_cutting` section to the story YAML. See `hive/references/cross-cutting-concerns.md` for format and examples.

7. **Write the epic index.** Produce `state/epics/{epic-id}/epic.yaml` as a lightweight index referencing the stories.

8. **Detect UI stories.** After generating stories and before presenting for confirmation, scan each story for UI work indicators. See the UI Step Detection section below.

9. **Run agent-ready checklist.** Validate each story against the 9-point checklist in `hive/references/agent-ready-checklist.md` (including check #9: cross-cutting concerns). Flag stories that fail checks in the confirmation output.

10. **Present for confirmation.** Show the dependency graph, story summaries, traceability results, cross-cutting concerns applied, UI detection results, and checklist results. Ask for confirmation before saving.

## UI Step Detection

After generating stories, scan each story's description and acceptance criteria for keywords indicating net-new UI work. If detected, the UI designer agent should be involved during planning to produce wireframes before execution begins.

**Detection keywords** (case-insensitive):
- Screen terms: "screen", "view", "page", "modal", "dialog", "sheet", "bottom sheet", "drawer"
- Component terms: "button", "form", "input", "component", "widget", "card", "list item"
- Design terms: "redesign", "layout", "visual", "UI", "UX", "mockup", "wireframe"
- Marketing terms: "marketing", "landing page", "ad creative", "banner", "promotional", "app store"

**When keywords match:**

1. Add a `ui-design` step to the story, after `research` and before `implement`:
   ```yaml
   - id: ui-design
     description: |
       Create wireframes for the UI components described in this story.
       Follow the wireframe workflow in agents/ui-designer.md and the
       approval protocol in references/wireframe-protocol.md.
     agent: ui-designer
     depends_on: [research]
   ```

2. Update the `implement` step to depend on `ui-design` and receive wireframe context:
   ```yaml
   - id: implement
     depends_on: [ui-design]
     inputs:
       - source: step_output
         step: ui-design
         key: wireframe_brief
   ```

3. In the plan confirmation output, mark UI stories:
   ```
   Stories:
     · cache-strategy — Design Redis Caching [3 steps]
     · event-detail — Redesign Event Detail View [4 steps, includes UI design]
   ```

4. **BLOCKING GATE:** Stories with `ui-design` steps MUST NOT proceed to execution until wireframes are approved. The planning phase blocks on the wireframe touchpoints (see `hive/references/wireframe-protocol.md`).

**Edge cases:**
- A story mentioning "button" in a backend context may false-positive. Acceptable — the user reviews and can remove the step.
- Purely visual stories may only need: research → ui-design → review (skip implement and test).

## Story File Format

See `hive/references/story-schema.md` if available, or use this template:

```yaml
id: story-id
epic: epic-id
title: One-line description
status: pending
complexity: low | medium | high
depends_on: []

description: |
  Detailed description of what needs to be built and why.

acceptance_criteria:
  - "Given [context], when [action], then [expected result]"

steps:
  - id: step-1
    description: What to do
    agent: researcher | developer | tester | reviewer

context:
  codebase: /path/to/target/codebase
  tech_stack: {}
  key_files: []

files_to_modify:
  - file: path/to/file
    change: What to change

code_examples:
  - title: Pattern to follow
    file: path/to/example

design_decisions:
  - decision: What was decided
    rationale: Why

cross_cutting:
  - concern: caching
    action: "Cache event list, 5min TTL, invalidate on mutation"

risks:
  - severity: high | medium | low
    description: What could go wrong
    mitigation: How to avoid it

references:
  - path/to/relevant/file
```

## Epic Index Format

```yaml
name: epic-id
title: Epic Title
description: What this epic accomplishes
target_codebase: /path/to/codebase

stories:
  - id: story-id
    title: Story Title
    complexity: medium
    depends_on: []
```

## Key References

- `hive/references/agent-ready-checklist.md` — 9-point story validation
- `hive/references/cross-cutting-concerns.md` — per-project concern evaluation
- `hive/references/wireframe-protocol.md` — UI wireframe approval touchpoints
- `hive/agents/analyst.md` — requirements analysis persona
- `hive/agents/architect.md` — system design persona
