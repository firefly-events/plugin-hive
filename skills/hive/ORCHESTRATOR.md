# Hive — Workflow Orchestration

> Structured SDLC workflow orchestration. Route user requests to plan, execute, status, or review commands.

Route the user's request to the appropriate command based on their intent.

## Commands

| Command | Trigger | Purpose |
|---------|---------|---------|
| **standup** | `/hive:standup`, "start the day", "daily ceremony" | Run daily ceremony: standup → planning → execution |
| **plan** | `/hive:plan`, "plan this feature", "break into stories" | Decompose a requirement into an epic with stories |
| **execute** | `/hive:execute`, "execute the epic", "run the workflow" | Execute stories through development phases |
| **status** | `/hive:status`, "what's the status" | Check active workflow state |
| **review** | `/hive:review`, "review this code" | Run structured code review |

Parse `$ARGUMENTS` to determine which command to run. If ambiguous, ask.

---

## Standup Command (Daily Ceremony)

**Input:** None required. Optionally an epic ID to focus on.

**Process:** Load `workflows/daily-ceremony.workflow.yaml` and execute its three phases: standup → planning → execution. See the workflow file for detailed phase descriptions.

**Phase 1 — Standup:** Reconstruct state from previous sessions. Read status markers (`state/episodes/`), cycle state (`state/cycle-state/`), task tracker (pending human items), and agent memories. Present structured report to user.

**Phase 2 — Planning:** User short-lists today's work. Orchestrator evaluates whether items need new planning or are already storied. If new work, run a compressed planning swarm. Present plan with agent-ready checklist results. User approves.

**Phase 3 — Execution:** Kick off dev team(s) for approved work. Currently sequential (one team at a time). After completion, run session-end evaluation for insight promotion/discard.

**Daily restart model:** The orchestrator starts fresh each day with a 1M context window. The standup phase compresses prior state into the new session via status markers, cycle state, and task tracker — not by resuming a prior conversation.

---

## Plan Command

**Input:** A requirement, feature description, or user story. Optionally a target codebase path.

**Process:**

1. **Research the codebase.** Before decomposing, explore the target codebase to understand the tech stack, architecture, existing patterns, and relevant files. Use the researcher agent mindset — you need concrete file paths, not guesses.

2. **Decompose into stories.** Break the requirement into an **epic** containing multiple **stories**. Each story should be independently implementable and testable.

3. **Write detailed story files.** For each story, produce an individual YAML file in `state/epics/{epic-id}/stories/{story-id}.yaml`. Stories are the primary artifact — they're what agents read when executing. They must contain enough context for an agent to work autonomously without reading the full epic or other stories.

4. **Write the epic index.** Produce `state/epics/{epic-id}/epic.yaml` as a lightweight index referencing the stories.

5. **Detect UI stories.** After generating stories and before presenting for confirmation, scan each story for UI work indicators. See the UI Step Detection section below.

6. **Run agent-ready checklist.** Validate each story against the 8-point checklist in `references/agent-ready-checklist.md`. Flag stories that fail checks in the confirmation output.

7. **Present for confirmation.** Show the dependency graph, story summaries, UI detection results, and checklist results. Ask for confirmation before saving.

### UI Step Detection

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
     depends_on: [ui-design]  # was: [research]
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

**Important:** UI detection is a suggestion, not mandatory. The user reviews the plan before saving and can add or remove `ui-design` steps. The wireframe approval touchpoints (see `references/wireframe-protocol.md`) run during planning, so by execution time the stories already contain the approved wireframe context.

**Edge cases:**
- A story mentioning "button" in a backend context (e.g., "submit button handler") may false-positive. This is acceptable — the user reviews and can remove the step.
- Purely visual stories (marketing assets with no code) may only need: research → ui-design → review (skip implement and test).

### Story File Format

Each story file is the primary artifact an agent reads when executing. It must be
self-contained — an agent should be able to work autonomously from this file alone,
without reading the epic or other stories. Include ALL sections below.

The format uses YAML for structured data (steps, context) and inline markdown for
prose sections (dev_notes, design_decisions). This hybrid works because agents need
both parseable structure AND rich contextual reasoning.

```yaml
id: story-id
epic: epic-id
title: One-line description
status: pending
complexity: low | medium | high
depends_on: []

description: |
  Detailed description of what needs to be built and why. Include enough
  context that an agent reading only this file understands the goal.

acceptance_criteria:
  - "Given [context], when [action], then [expected result]"
  - Use Given/When/Then format for testable behavioral criteria

steps:
  - id: step-1
    description: |
      What to do in this step. Be specific — name files to read, patterns
      to follow, commands to run. Reference key_files by path.
    agent: researcher | developer | tester | reviewer
  - id: step-2
    description: |
      Next step with concrete instructions.
    agent: developer
    depends_on: [step-1]

context:
  codebase: /path/to/target/codebase
  tech_stack:
    backend: Framework + language + DB
    frontend: Framework + language
  key_files:
    - path/to/relevant/file.ts — why it's relevant
  inputs_from_previous:
    - story-id: what output from that story feeds into this one

# Files the agent will create or modify, with the specific change needed
files_to_modify:
  - file: path/to/existing/file.ts
    change: What to change and why
  - file: path/to/new/file.ts
    change: NEW FILE — description of what it contains

# Existing code patterns the agent should follow or reference
code_examples:
  - title: Pattern to follow
    file: path/to/existing/example.ts
    description: |
      This file shows the existing convention. Follow this pattern.
  - title: Expected implementation shape
    language: typescript
    code: |
      // Concrete example of what the output should look like
      export async function newEndpoint(req: Request) { ... }

# Design decisions that prevent agents from second-guessing choices
design_decisions:
  - decision: What was decided
    rationale: Why — prevents the agent from re-evaluating settled questions

# Behavior matrices for conditional logic (use when there are state-dependent behaviors)
behavior_matrix:
  - condition: "When X"
    behavior: "Do Y"
  - condition: "When Z"
    behavior: "Do W"

# Platform-specific gotchas, known issues, or things that will bite the agent
dev_notes: |
  Free-form notes about tricky parts of the implementation. Include:
  - Cross-story dependencies and what components are shared
  - Known bugs or workarounds in the affected code
  - Performance considerations
  - Migration requirements (if any)

risks:
  - severity: high | medium | low
    description: |
      What could go wrong and why.
    mitigation: |
      How to avoid or handle it.

# Explicit source references for traceability
references:
  - path/to/source/file.ts — what it provides
  - path/to/doc.md — relevant documentation
```

### Epic Index Format

The epic YAML is a lightweight index — details live in story files:

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
  - id: dependent-story
    title: Another Story
    complexity: low
    depends_on: [story-id]
```

After generating, present a summary to the user showing the dependency graph and ask for confirmation before saving.

---

## Execute Command

**Input:** An epic ID (or path to epic YAML), and optionally a methodology flag.

**Argument parsing:**
- `--methodology tdd|classic|bdd` — selects the development workflow. Default: `classic`.
- Epic ID is the positional argument (e.g., `/hive:execute hive-phase2 --methodology tdd`).

**Process:**

1. **Load the epic.** Read `state/epics/{epic-id}/epic.yaml`.

2. **Load or create cycle state.** Check `state/cycle-state/{epic-id}.yaml`. If it doesn't exist, create a minimal one with `epic_id` and `created` timestamp. The cycle state accumulates decisions across phases — see `references/cycle-state-schema.md`. Include the cycle state in all downstream agent prompts as system-level constraints.

3. **Load the workflow definition.** Based on the `--methodology` parameter (default: `classic`), load:
   ```
   workflows/development.{methodology}.workflow.yaml
   ```
   If the file does not exist, report an error listing available methodologies (files matching `workflows/development.*.workflow.yaml`). See `references/methodology-routing.md` for how methodologies control phase ordering.

3. **Topologically sort stories** by their `depends_on` fields.

4. **Choose execution mode.** Determine whether to use agent teams or sequential execution:

   1. Check: Is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set to `1`?
   2. Check: Does the topological sort reveal multiple stories at depth 0 (independent stories with no dependencies)?
   3. Check: Is `--sequential` flag NOT present in arguments?

   If all three: use **agent team execution** (step 5 below).
   Otherwise: use **sequential execution** (step 6 below).

   See `references/agent-teams-guide.md` for agent teams detection and mechanics.

5. **Agent team execution.** Generate a natural-language team creation prompt that describes the epic and its tasks. The prompt follows this shape:

   ```
   Create a team to execute the "{epic-id}" epic.

   ## Tasks

   **Task: {story-id}** (no dependencies — can start immediately)
   Read the story at state/epics/{epic-id}/stories/{story-id}.yaml
   and execute the steps described. Write episode records to
   state/episodes/{epic-id}/{story-id}/.

   **Task: {dependent-story-id}** (depends on: {dep-1}, {dep-2})
   Wait until all dependencies complete, then read and execute the story.
   Write episodes to state/episodes/{epic-id}/{dependent-story-id}/.

   ## Workflow per task
   Each task follows the development workflow phases from the loaded
   methodology (e.g., research → implement → test → review → integrate).

   ## Coordination
   Write episode records after each step. When all tasks complete, report back.
   ```

   Rules for generating the prompt:
   - Each story becomes one task. Use the story ID as the task name.
   - Stories with no `depends_on` are listed as "can start immediately."
   - Stories with dependencies list them explicitly so the team blocks correctly.
   - Do NOT inline the full story content — each teammate reads their story YAML file directly. The prompt only provides the story ID, title, a one-sentence summary, and the episode output path.
   - For large epics (10+ stories), keep task descriptions minimal (ID + title + deps only) to avoid exceeding prompt limits.

   After generating the prompt, hand it to the agent team system. The team lead spawns teammates, manages dependencies, and monitors completion. When all tasks finish, proceed to the epic summary (step 7).

6. **Sequential execution.** For each story (in dependency order):

   **a. Read the workflow steps.** Each step has an `agent` field referencing a persona in `agents/`. Read that agent's markdown file to understand their role and output format.

   **b. Execute each step sequentially** by spawning a subagent with:
   - The agent persona (from `agents/{agent}.md`) as system context
   - The step's `task` description
   - Any `inputs` from previous steps (resolved from step outputs or episode records)
   - The story's specification (description + acceptance criteria)

   **c. Capture the output** of each step. Pass outputs to downstream steps as specified in the workflow's `inputs` configuration.

   **d. Write an episode record** after each step completes, per the schema in `references/episode-schema.md`. Write to:
   ```
   state/episodes/{epic-id}/{story-id}/{step-id}.yaml
   ```
   The episode must include all required fields: `step_id`, `story_id`, `epic_id`, `agent`, `status`, `timestamp`, `conclusions`, `decisions_made`, `artifacts_produced`, and `context_for_next_phase`. The `context_for_next_phase` field is how downstream steps receive prior context.

   **e. Check review verdict.** After the review step, read the reviewer's output:
   - If verdict is `passed` with no findings, **skip** the `optimize` step (if present) and proceed directly to `integrate`.
   - If verdict is `needs_optimization`, execute the `optimize` step with review findings as input, then proceed to `integrate`.
   - Steps marked `optional: true` in the workflow YAML are candidates for skipping based on this logic.

   **f. Check other gate criteria** before advancing. For test steps, verify tests pass. For failed gates, write a `failed` episode and halt the story.

7. After all stories complete (whether via agent team or sequential execution), produce a summary of the epic execution.

**Parallel execution note:** When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set and the epic has independent stories, step 4 routes to agent team execution (step 5) for parallel story processing. See `references/agent-teams-guide.md` for team mechanics, limitations, and fallback behavior. Use `--sequential` to force sequential execution even when agent teams are available.

---

## Status Command

**Input:** None required. Optionally an epic ID to filter to a single epic.

**Process:**

This command is **read-only** — it never modifies state files. It is safe to run while a workflow is executing in another session.

### 1. Find Active Epics

Scan `state/epics/` for subdirectories. Each subdirectory containing an `epic.yaml` is an active epic. If `state/epics/` does not exist or is empty, output:

```
No active workflows. Run /hive:plan to create an epic.
```

And stop.

### 2. Load Epic Metadata

For each epic, read `state/epics/{epic-id}/epic.yaml` to get:
- `title` — epic display name
- `stories` — list of story entries with `id`, `title`, `depends_on`

### 3. Determine Story Status

For each story in the epic, check `state/episodes/{epic-id}/{story-id}/` for episode YAML files. Load the workflow definition (`workflows/development.{methodology}.workflow.yaml`, default `classic`) to know the ordered list of steps (e.g., `research`, `implement`, `test`, `review`, `integrate`).

Determine status using this logic:

| Condition | Status | Symbol |
|-----------|--------|--------|
| No episode files exist for the story | **pending** | `·` |
| Episodes exist but the last workflow step has no episode | **in-progress** | `⧖` |
| The final workflow step (e.g., `integrate`) has an episode with `status: completed` | **completed** | `✓` |
| Any episode has `status: failed` or `status: escalated` | **failed** | `✗` |
| All dependencies not yet completed | **blocked** (subset of pending) | `·` |

For **in-progress** stories, identify the current phase: find the last episode file (by step order in the workflow, not by filename), and report its `step_id` and `status`.

For **blocked** stories, list which `depends_on` stories are not yet completed.

### 4. Format Output

Use this format for each epic:

```
## Epic: {epic-id} — {title}
Progress: {completed}/{total} stories completed

Stories:
  ✓ {story-id} — {title} [completed]
  ⧖ {story-id} — {title} [{current-step} → {step-status}]
  · {story-id} — {title} [pending]
  · {story-id} — {title} [blocked: {dep-1}, {dep-2}]
  ✗ {story-id} — {title} [failed: {step} — {conclusion-summary}]
```

For **in-progress** stories, the bracket shows `[{step_id} → {status}]` from the most recent episode. For **failed** stories, include the first `conclusions` entry from the failed episode as a brief summary.

### 5. Dependency Graph

After the story list, render a text-based dependency graph. Group stories by their dependency layer (topological depth):

```
Dependency Graph:
  {story-a} ──┐
  {story-b} ──┼──→ {story-d}
  {story-c} ──┘        │
  {story-e}             └──→ {story-f}
  {story-g}  (no dependencies)
```

**Rules for the graph:**
- Stories with no dependencies appear at the left edge
- Arrows (`──→`) point from dependencies to dependents
- Use `──┐`, `──┤`, `──┘` connectors for multiple dependencies merging
- Stories with no dependents and no dependencies appear standalone at the bottom
- For large epics (10+ stories), skip the graph and instead show blocked/unblocked status inline with each story

### 6. In-Progress Story Detail

For each in-progress story, show a one-line summary from the most recent episode's `context_for_next_phase` field (first 120 characters, truncated with `…`):

```
  ⧖ cache-strategy — Design Redis Caching [research → completed]
    ↳ "Redis cluster topology evaluated. Single-node sufficient for…"
```

### 7. Multi-Epic Display

If multiple epics are active, display each epic as a separate block separated by a blank line. Order epics by most recently modified (check episode timestamps).

---

## Review Command

**Input:** No arguments, a branch name, a PR number (`#123`), or file paths.

**Argument parsing:**

| Argument | Interpretation | Diff command |
|----------|---------------|--------------|
| *(none)* | Review staged changes (fall back to unstaged if nothing staged) | `git diff --cached` (or `git diff` if empty) |
| `feature-branch` | Review branch diff against main | `git diff main..feature-branch` |
| `#123` or PR URL | Review a pull request | `gh pr diff 123` |
| `src/foo.ts src/bar.ts` | Review only those files | `git diff -- src/foo.ts src/bar.ts` |

**Pre-flight:** If the argument starts with `#` or looks like a PR URL, verify `gh auth status` succeeds. If `gh` is not authenticated, report the error and suggest using a branch name instead.

**Process:**

1. **Obtain the diff.** Run the appropriate diff command from the table above. If the diff is empty, report "No changes to review" and stop.

2. **Load the review workflow.** Read `workflows/code-review.workflow.yaml`. This defines the ordered steps for a code review (e.g., `analyze`, `review`, `summarize`). If the file does not exist, fall back to the inline two-step process described below.

3. **Execute workflow steps sequentially.** For each step in the workflow:

   **a.** Read the agent persona referenced by the step's `agent` field from `agents/{agent}.md`. The two primary agents are:
   - **Researcher** (`agents/researcher.md`) — analyzes scope, complexity, and affected modules
   - **Reviewer** (`agents/reviewer.md`) — evaluates correctness, security, conventions, and performance

   **b.** Spawn a subagent with:
   - The agent persona as system context
   - The step's `task` description
   - The diff content as input
   - Any `inputs` from previous steps (e.g., the researcher's analysis feeds into the reviewer)

   **c.** Capture the step output for downstream steps.

   If `agents/reviewer.md` does not exist yet, use the developer persona (`agents/developer.md`) in review mode.

4. **Write episode records.** After each step, write an episode to:
   ```
   state/episodes/review/{timestamp}/{step-id}.yaml
   ```
   Follow the schema in `references/episode-schema.md`. This provides traceability for review history.

5. **Display structured findings.** Format the output as:

   ```
   ## Code Review Results

   ### Analysis (Researcher)
   - {N} files changed, {M} modules affected
   - Changes touch {summary of affected areas}

   ### Review (Reviewer)
   **Verdict: {passed | needs_optimization | needs_revision}**

   #### Critical
   - **[{category}]** `{file}:{line}` — {finding}

   #### Improvements
   - **[{category}]** `{file}:{line}` — {suggestion}

   #### Nits
   - **[{category}]** `{file}:{line}` — {minor suggestion}

   ### Summary
   {One-sentence overall assessment and recommended action.}
   ```

   Categories include: `security`, `correctness`, `performance`, `convention`, `clarity`, `testing`.

   Verdicts:
   - **passed** — No critical findings, safe to merge
   - **needs_optimization** — No blockers, but improvements recommended
   - **needs_revision** — Critical issues that must be addressed before merge

---

## Session End — Insight Evaluation

After epic execution completes (or at the end of a session with staged insights), evaluate and promote or discard insights. This is an orchestrator responsibility.

**Process:**

1. **Scan for staged insights.** Check `state/insights/` for any staged files.
2. **For each insight:**
   - Read the insight's `type`, `summary`, and `detail`
   - Check against keep criteria: is it a repeatable pattern, a pitfall warning, an override, or codebase-specific understanding?
   - Check `skills/hive/agents/memories/{agent}/` for duplicates or memories to override
   - **Promote:** write to `agents/memories/{agent}/{slug}.md` with frontmatter (name, description, type, agent, timestamp, source_epic)
   - **Discard:** delete from staging
3. **Clean up.** Remove `state/insights/{epic-id}/` staging directories.

For borderline cases, present to the user for a keep/discard decision. Most insights should be auto-evaluated.

See `references/agent-memory-schema.md` for the full schema, memory types, and keep/discard criteria.

---

## Key References

Read these when you need detailed information:
- `references/workflow-schema.md` — YAML workflow definition format
- `references/methodology-routing.md` — How methodologies control phase ordering
- `references/episode-schema.md` — Status marker format for progress tracking
- `references/agent-memory-schema.md` — Agent memory format, insight capture, and session-end evaluation
- `references/wireframe-protocol.md` — Wireframe approval touchpoints for UI stories
- `agents/researcher.md` — Research agent persona and output format
- `agents/developer.md` — Developer agent persona and output format
- `agents/tester.md` — Test agent persona (TDD and Classic modes)
- `agents/reviewer.md` — Reviewer agent persona and verdict format
- `agents/orchestrator.md` — Main session coordination guidance
- `agents/team-lead.md` — Per-team coordination and staffing decisions
