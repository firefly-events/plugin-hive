---
name: plan
description: Decompose a requirement into an epic with dependency-tracked stories.
---

# Hive Plan

Decompose a requirement into an epic with dependency-tracked stories.

**Input:** `$ARGUMENTS` contains the requirement or feature description. Optionally a target codebase path.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `state/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with planning:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed normally.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Process

### Phase 0: Assemble Planning Team

0. **Spawn the planning team.** Use `TeamCreate` to assemble the planning team before any work begins. The orchestrator (main agent) stays as coordinator, directing work via `SendMessage`.

   **Core team (always spawned):**
   - **Researcher** (`hive/agents/researcher.md`) — codebase/web exploration, raw findings
   - **Technical Writer** (`hive/agents/technical-writer.md`) — produces all formatted documents
   - **TPM** (`hive/agents/tpm.md`) — delivery sequencing, horizontal/vertical thinking

   **Conditional team members (spawned when applicable):**
   - **Architect** (`hive/agents/architect.md`) — added when the requirement involves architecture decisions, multi-system integration, or when scale assessment is medium/large
   - **UI Designer** (`hive/agents/ui-designer.md`) — added when the requirement involves UI work (screens, components, visual design, wireframes). Not spawned for purely backend/infrastructure work

   **How to decide conditional members:** The orchestrator evaluates the requirement text at team assembly time. Use the same detection keywords from the UI Step Detection section below for the UI designer. For the architect, look for signals like: multiple systems, API design, data model changes, infrastructure, or the word "architecture" itself.

   **TeamCreate prompt template:**
   ```
   Create a planning team for requirement: "{requirement-summary}"

   ## Team Members

   **researcher** — Explore the target codebase. Read persona from hive/agents/researcher.md.
   Load memories from the agent's knowledge paths. Gather raw findings: file paths, patterns,
   constraints, risks.

   **technical-writer** — Produce formatted planning documents. Read persona from
   hive/agents/technical-writer.md. Load memories from the agent's knowledge paths.
   Transform raw findings into research briefs, design discussions, H/V plans, structured outlines.

   **tpm** — Sequence delivery planning. Read persona from hive/agents/tpm.md.
   Load memories from the agent's knowledge paths. Own horizontal/vertical thinking.
   Review all documents for delivery feasibility.

   [if architect needed]
   **architect** — Evaluate technical feasibility. Read persona from hive/agents/architect.md.
   Load memories from the agent's knowledge paths. Review designs for architectural soundness.

   [if UI designer needed]
   **ui-designer** — Produce wireframes and review UI aspects. Read persona from
   hive/agents/ui-designer.md. Load memories from the agent's knowledge paths.
   Scan existing design language before proposing new UI.

   ## Coordination
   - Orchestrator assigns work via SendMessage
   - All agents review documents before user presentation (collaborative review gate)
   - Each agent reads their full persona file and loads their memory directory
   - Use agent-spawn skill patterns: load full persona, resolve paths, load memories
   ```

   **Agent-spawn compliance:** Each teammate must follow the agent-spawn skill (`skills/hive/skills/agent-spawn/SKILL.md`) patterns — full persona injection, path resolution (`~`, `${CLAUDE_PLUGIN_ROOT}`), memory loading, domain constraints, and required tool validation. The TeamCreate prompt must instruct each teammate to read their persona file and load their knowledge paths on startup.

### Phase A: Research

1. **Research the codebase.** `SendMessage` to the researcher to explore the target codebase — tech stack, architecture, existing patterns, relevant files. The researcher delivers raw findings (not a formatted brief). Use the researcher agent mindset — you need concrete file paths, not guesses.

   The researcher runs **context7 validation always-on** for any library/SDK/API in the requirement. Web research escalation is uncertainty-triggered (stale docs, missing coverage, conflicting info) — not scope-gated. Findings include a validation note with confidence level. If context7 is unavailable, the researcher proceeds codebase-only and notes the gap.

2. **Produce research brief.** `SendMessage` to the technical writer with the research-brief skill to transform raw findings into a formatted brief. This brief feeds into the design discussion. Write to `state/epics/{epic-id}/docs/research-brief.md`.

3. **Load cross-cutting concerns.** Check for `state/cross-cutting-concerns.yaml`. If found, load the concerns — they will be evaluated per-story later. See `hive/references/cross-cutting-concerns.md`.

### Phase B: Design Discussion (always runs)

4. **Produce design discussion.** `SendMessage` to the technical writer with the `design-discussion` skill (`skills/hive/skills/design-discussion/SKILL.md`). Input: the research brief + the original user request. Output: a ~200-line design discussion document covering goal, proposed approach, risks, dependencies, open questions, and a scale assessment.

4b. **Collaborative review gate.** Run the collaborative review gate (see Collaborative Review Gate section below). `SendMessage` the design discussion to all active team agents for review. Collect feedback, have the writer revise if needed, then proceed.

5. **Present design discussion to user.** Show the full document, including a summary of what the team flagged and resolved during collaborative review. The user reads it and provides feedback:
   - Affirm or correct the understanding of the goal
   - Answer open questions (numbered for easy reference)
   - Flag any risks or approaches they disagree with
   - Confirm or override the scale assessment recommendation

   After collecting user feedback, evaluate the scale and **announce the routing decision inline** — no separate confirmation step:

   ```
   SCALE DECISION: [Small | Medium | Large]

   Small  → Proceeding directly to stories (Phase C)
   Medium → Running H/V planning, then stories (Phase B2 → C)
   Medium + --fast → Skipping H/V entirely, proceeding to stories (Phase C)
   Large  → Running H/V planning + structured outline, then stories (Phase B2 → B3 → C)
   ```

   **Routing rules:**
   - **Small** (~5-15 min, 1-3 files, single layer): design discussion is sufficient context → Phase C
   - **Medium** (multi-file, multiple layers, cross-stack): needs H/V planning to slice correctly → Phase B2 (unless `--fast`, which skips H/V entirely)
   - **Large** (multi-system, migration, long-horizon): needs full H/V + structured outline with elicitation → Phase B2 + B3

### Phase B2: Horizontal + Vertical Planning (medium and large scope)

7. **TPM plans the delivery.** `SendMessage` to the TPM with the design discussion, user feedback, research brief, and any architect outputs. The TPM:
   a. Maps all architectural layers and cross-layer dependencies (horizontal thinking)
   b. Cuts vertical slices — minimum cross-stack increments that each produce a working state
   c. Directs the technical writer to produce both documents using the horizontal-plan and vertical-plan skills

   The TPM is the owner of this step. The architect (if present) has already contributed their perspective in earlier phases — the TPM now sequences their inputs into an executable delivery plan.

8. **Collaborative review gate.** Run the collaborative review gate on the H/V outputs. `SendMessage` both documents to all active team agents. The researcher verifies findings are accurately reflected, the architect (if present) validates technical soundness, and the UI designer (if present) flags any UI layer gaps. Collect feedback, have the writer revise if needed.

9. **H/V gate (conditional).** Behavior depends on scope and flags:

   - **Large scope:** Always present both documents to the user for review. Collect feedback, incorporate, then proceed to Phase B3.
   - **Medium scope + `--gate-hv`:** Present both documents to the user for review. Collect feedback, incorporate, then proceed to Phase C.
   - **Medium scope (default, no `--gate-hv`):** Auto-proceed to Phase C without presenting a gate — the collaborative review in step 8 is sufficient.
   - **Medium scope + `--fast`:** H/V planning was skipped entirely at step 5 — this step is never reached.

   **When the gate runs (large or medium + `--gate-hv`), the user reviews:**
   - Are the layers correctly identified? (horizontal)
   - Are the slice boundaries logical? (vertical)
   - Is the first slice thin enough to be a real proof of concept?
   - Does each slice produce a genuinely working state?
   - Are deferred items acceptable?

### Phase B3: Structured Outline (large scope only)

10. **Produce structured outline.** `SendMessage` to the technical writer with the `structured-outline` skill (`skills/hive/skills/structured-outline/SKILL.md`). Input: H/V plans + design discussion + user feedback + research brief. Output: a ~1000-line structured outline with detailed approach, file manifest, risk registry, and elicitation questions. The outline now builds ON the vertical slice plan — each phase in the outline maps to a vertical slice.

10b. **Collaborative review gate.** Run the collaborative review gate on the structured outline. This is the most critical review — all active team agents review the full outline. The TPM validates sequencing, the researcher confirms technical accuracy, the architect (if present) stress-tests feasibility, and the UI designer (if present) validates UI approach. Collect feedback, have the writer revise if needed.

11. **Present structured outline to user.** Show the full document, including a summary of team review findings. The elicitation section (Part 7) contains the agent team's own stress-test of the plan — the user reads the team's answers to evaluate whether the thinking is sound. The user then:
    - Flags any elicitation answers that seem weak or wrong
    - Responds to the decision points (Part 8) — numbered affirm/change items
    - Provides final sign-off or requests revisions

    Incorporate feedback into the planning context before proceeding.

### Phase C: Story Decomposition

11c. **Resolve methodology.** Before decomposing stories, determine the development methodology:

   1. Check `hive.config.yaml` for a `methodology` field (project-level default)
   2. Check `epic.yaml` for a `methodology` override (if the epic specifies one)
   3. Fall back to `classic` if neither exists

   Available methodologies (must match a workflow YAML in `hive/workflows/`):
   - `classic` — Research → Implement → Test → Review → Integrate
   - `tdd` — Research → Test Spec → Implement → Review → Integrate
   - `bdd` — Research → Behavior Spec → Implement → Test → Review → Integrate

   The resolved methodology determines what steps each story gets (see step 14).

12. **Decompose into stories.** Break the requirement into an **epic** containing multiple **stories**. Use all available planning context (design discussion, H/V plans if produced, structured outline if produced).

    **If vertical slice plan exists:** Stories map to vertical slices. Each slice becomes one or more stories. Stories within a slice can run in parallel, but slices execute sequentially (each depends_on the prior slice's stories). Every story's completion leaves the product in a working state — this is the vertical planning invariant.

    **If no vertical slice plan:** Decompose as before — independently implementable stories with dependency tracking.

13. **Requirements traceability check.** Before finalizing stories, verify every aspect of the original requirement is covered by at least one story:
    - Re-read the original requirement/PRD
    - List every distinct capability, feature, or behavior mentioned
    - Map each to at least one story
    - Flag any unmapped capabilities as **GAPS**
    - Present gaps to the user before proceeding

    ```
    TRACEABILITY:
      Mapped: 8 of 10 capabilities covered
      GAPS:
      - SMS/email invites to non-users — not covered by any story
      - Contact permission flow — not covered by any story
    ```

14. **Write detailed story files.** For each story, produce an individual YAML file in `state/epics/{epic-id}/stories/{story-id}.yaml`. Stories are the primary artifact — they're what agents read when executing. They must contain enough context for an agent to work autonomously without reading the full epic or other stories.

    **Self-containment rule:** Stories must work identically whether read from local disk or pulled from an external tracker (e.g., Linear). To achieve this, **inline relevant context snippets** alongside file references:

    - For `code_examples`: extract the relevant lines (~10 max) into a `snippet` field. The agent gets the pattern without needing the source file on disk.
    - For `references`: change from a flat path list to objects with a `relevant_excerpt` field containing the 3-5 most relevant lines from that document.
    - For `key_files`: add a `purpose` field explaining why each file matters to this story.

    Snippets are optional but strongly encouraged. Skip only when the reference is an entire file that would be read in full anyway. The file path always stays for traceability — humans can look up the full document. The snippet is what makes the story portable.

    **Methodology-aware steps:** Generate story steps that match the resolved methodology (from step 11c). Add a `methodology` field to each story YAML. Use these step templates:

    **Classic** (default):
    ```yaml
    methodology: classic
    steps:
      - id: research
        description: Explore the codebase for relevant patterns, files, and constraints
        agent: researcher
      - id: implement
        description: Implement the story according to spec and research findings
        agent: developer
        depends_on: [research]
      - id: test
        description: Write tests covering acceptance criteria and verify they pass
        agent: tester
        depends_on: [implement]
      - id: review
        description: Review implementation and tests for correctness and convention compliance
        agent: reviewer
        depends_on: [test]
      - id: integrate
        description: Commit and push to feature branch
        agent: developer
        depends_on: [review]
    ```

    **TDD:**
    ```yaml
    methodology: tdd
    steps:
      - id: research
        description: Explore the codebase for relevant patterns, files, and constraints
        agent: researcher
      - id: test-spec
        description: |
          Write failing tests from the story spec and acceptance criteria.
          Do NOT read implementation code — tests define expected behavior independently.
        agent: tester
        depends_on: [research]
      - id: implement
        description: Write code to make the failing tests pass. Do not modify the tests.
        agent: developer
        depends_on: [test-spec]
      - id: review
        description: Review implementation and tests for correctness and convention compliance
        agent: reviewer
        depends_on: [implement]
      - id: integrate
        description: Commit and push to feature branch
        agent: developer
        depends_on: [review]
    ```

    **BDD:**
    ```yaml
    methodology: bdd
    steps:
      - id: research
        description: Explore the codebase for relevant patterns, files, and constraints
        agent: researcher
      - id: behavior-spec
        description: |
          Write Gherkin/Given-When-Then behavior specifications from the story's
          acceptance criteria. These specs define the contract before implementation.
        agent: tester
        depends_on: [research]
      - id: implement
        description: Implement the story to satisfy the behavior specifications
        agent: developer
        depends_on: [behavior-spec]
      - id: test
        description: Derive test cases from behavior specs and verify they pass
        agent: tester
        depends_on: [implement]
      - id: review
        description: Review implementation, behavior specs, and tests for correctness
        agent: reviewer
        depends_on: [test]
      - id: integrate
        description: Commit and push to feature branch
        agent: developer
        depends_on: [review]
    ```

    Customize step descriptions per story as needed — these templates provide the ordering and agent assignments. For low-complexity stories, the `research` step may be skipped regardless of methodology.

15. **Evaluate cross-cutting concerns per story.** For each story, evaluate each concern's `applies_when` condition. For applicable concerns, determine the specific action needed and add a `cross_cutting` section to the story YAML. See `hive/references/cross-cutting-concerns.md` for format and examples.

16. **Write the epic index.** Produce `state/epics/{epic-id}/epic.yaml` as a lightweight index referencing the stories.

17. **Detect UI stories.** After generating stories and before presenting for confirmation, scan each story for UI work indicators. See the UI Step Detection section below.

18. **Run agent-ready checklist.** Validate each story against the 9-point checklist in `hive/references/agent-ready-checklist.md` (including check #9: cross-cutting concerns). Flag stories that fail checks in the confirmation output.

19. **Present for confirmation.** Show the dependency graph (using Mermaid format — see Diagram Format section below), story summaries, traceability results, cross-cutting concerns applied, UI detection results, and checklist results. Ask for final confirmation before saving.

    Example dependency graph:
    ````
    ```mermaid
    graph LR
      cache-layer --> api-integration
      cache-layer --> event-detail
      api-integration --> e2e-tests
      event-detail --> e2e-tests
    ```
    ````

### Flow Summary

```
Small:   team assembly → research → brief → design discussion → team review → feedback → stories → confirm
Medium:  team assembly → research → brief → design discussion → team review → feedback → H scan → V slice plan → team review → feedback → stories → confirm
Large:   team assembly → research → brief → design discussion → team review → feedback → H scan → V slice plan → team review → feedback → structured outline → team review → sign-off → stories → confirm
```

## Collaborative Review Gate

A collaborative review gate runs before every user-facing document presentation. This ensures all team agents align on the content and catch gaps before the user sees it.

**When to run:** After steps 4, 8, and 10b — i.e., after each major document is produced and before it's presented to the user.

**Protocol:**

1. **Distribute.** The orchestrator `SendMessage`s the document to all active team agents.
2. **Review.** Each agent reviews through their specific lens:
   - **Researcher**: "Are findings accurately represented? Is anything missing from the codebase analysis?"
   - **TPM**: "Is this sequenceable? Are dependencies realistic? Are there delivery risks?"
   - **Architect** (if present): "Is this technically sound? Any feasibility concerns or architectural gaps?"
   - **UI Designer** (if present): "Are UI implications identified? Does the proposed UX align with existing design language?"
3. **Respond.** Each agent returns structured feedback via `SendMessage`:
   ```
   REVIEW: {agent-name}
   VERDICT: approve | flag
   COMMENTS: {specific issues or confirmation}
   ```
4. **Revise if needed.** If any agent flags issues, the orchestrator `SendMessage`s the feedback to the technical writer for revision. Max 1 revision cycle to avoid loops.
5. **Proceed.** Once all agents approve (or after 1 revision cycle), present the document to the user. Include a brief summary of what the team flagged and resolved:
   ```
   TEAM REVIEW SUMMARY:
   - TPM flagged dependency gap between auth and data layers → resolved by adding explicit sequencing
   - Architect approved with no concerns
   - Researcher confirmed all file paths verified
   ```

**Key constraint:** The review gate adds quality but must not spiral. One revision cycle maximum. If fundamental disagreements remain after revision, surface them to the user as open questions rather than continuing to iterate.

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
methodology: classic | tdd | bdd
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
  key_files:
    - path: path/to/relevant/file
      purpose: Why this file matters to this story

files_to_modify:
  - file: path/to/file
    change: What to change

code_examples:
  - title: Pattern to follow
    file: path/to/example
    snippet: |
      # Optional but strongly encouraged (~10 lines max)
      # The relevant code pattern extracted from the file
      def example_function():
          pass

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
  - path: path/to/relevant/file
    relevant_excerpt: |
      Optional but encouraged — the 3-5 most relevant lines from this document.
      Provides self-containment so the story works without the source file on disk.
```

## Epic Index Format

```yaml
name: epic-id
title: Epic Title
description: What this epic accomplishes
target_codebase: /path/to/codebase
methodology: classic | tdd | bdd  # optional, overrides project config for this epic

stories:
  - id: story-id
    title: Story Title
    complexity: medium
    depends_on: []
```

## Diagram Format

All diagrams in Hive output (dependency graphs, flow diagrams) use **Mermaid** syntax. Mermaid renders natively in GitHub, Linear, and most markdown viewers.

- Use `graph LR` (left-to-right) for dependency graphs
- Use `graph TD` (top-down) for hierarchical or flow diagrams
- Arrow syntax: `story-a --> story-b` means story-b depends on story-a
- Keep node IDs matching story IDs for consistency

## Planning Document Paths

All planning documents are written to `state/epics/{epic-id}/docs/{document-type}.md`.

| Document type | Sub-skill | Output path |
|---------------|-----------|-------------|
| research-brief | None (no sub-skill — see note) | `state/epics/{epic-id}/docs/research-brief.md` |
| design-discussion | `skills/hive/skills/design-discussion/SKILL.md` | `state/epics/{epic-id}/docs/design-discussion.md` |
| horizontal-plan | `skills/hive/skills/horizontal-plan/SKILL.md` | `state/epics/{epic-id}/docs/horizontal-plan.md` |
| vertical-plan | `skills/hive/skills/vertical-plan/SKILL.md` | `state/epics/{epic-id}/docs/vertical-plan.md` |
| structured-outline | `skills/hive/skills/structured-outline/SKILL.md` | `state/epics/{epic-id}/docs/structured-outline.md` |

**Note on research-brief:** No sub-skill file exists for the research brief format. The technical writer produces it using the research-brief pattern from memory, based on raw findings from the researcher. Output path: `state/epics/{epic-id}/docs/research-brief.md`. See `hive/agents/technical-writer.md`.

Existing planning documents at the `state/` root are not moved — this convention applies to new planning sessions going forward.

## Key References

- `hive/references/agent-ready-checklist.md` — 9-point story validation
- `hive/references/cross-cutting-concerns.md` — per-project concern evaluation
- `hive/references/wireframe-protocol.md` — UI wireframe approval touchpoints
- `hive/references/agent-teams-guide.md` — TeamCreate mechanics and coordination patterns
- `hive/agents/researcher.md` — raw data gathering (core team)
- `hive/agents/technical-writer.md` — document production (core team)
- `hive/agents/tpm.md` — delivery sequencing (core team)
- `hive/agents/architect.md` — system design (conditional)
- `hive/agents/ui-designer.md` — wireframes and UI review (conditional)
- `hive/agents/analyst.md` — requirements analysis persona
- `skills/hive/skills/agent-spawn/SKILL.md` — persona injection, memory loading, path resolution
- `skills/hive/skills/design-discussion/SKILL.md` — ~200-line brain dump format
- `skills/hive/skills/structured-outline/SKILL.md` — ~1000-line detailed plan with elicitation
