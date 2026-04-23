---
name: plan
description: Decompose a requirement into an epic with dependency-tracked stories.
---

# Hive Plan

> **State Directory Note:** Paths shown as `.pHive/...` assume the default
> state directory. If you have relocated state via `paths.state_dir`,
> substitute your configured location. See
> [state-relocation.md](../../hive/references/state-relocation.md) (or
> `hive/references/state-relocation.md` from repo root).

Decompose a requirement into an epic with dependency-tracked stories.

**Input:** `$ARGUMENTS` contains the requirement or feature description. Optionally a target codebase path. Supports optional flags (see `$ARGUMENTS` section below).

## $ARGUMENTS

Parse `$ARGUMENTS` as natural language. Flags are optional; all have defined defaults.

**`--fast`**
Skips H/V planning entirely at medium scope — proceeds from design discussion directly to stories. No effect at small scope (H/V is not run anyway). No effect at large scope (H/V is required regardless of this flag).

**`--validate`**
Forces approach validation (context7 + web research) regardless of scope size or context7 confidence level. Use when the tech stack is known to be in flux and explicit full validation is needed even for small-scope changes. Without this flag, web escalation is uncertainty-triggered.

**`--gate-hv`**
Retains the H/V user-facing review gate at medium scope (opt-in conservative path). Default at medium scope is to auto-proceed after collaborative review (no user gate). This flag restores the gate. No effect at large scope — the gate is always present at large scope regardless of this flag.

## Kickoff Gate

**Before doing anything else**, check whether Hive has been initialized for this project:

1. Check if `.pHive/project-profile.yaml` exists in the project root
2. If it exists, verify it has a populated `tech_stack` field (not empty, not null)
3. As a secondary check, verify `hive.config.yaml` exists (check both `hive/hive.config.yaml` and `hive.config.yaml` in the project root — either location is valid)

If **any** of these checks fail, display this message and **stop** — do not proceed with planning:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — it takes a few minutes and ensures every agent has full context about your codebase, preferences, and available tools.

If all checks pass, proceed normally.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read configuration with root-first precedence:
   - Read ROOT `hive.config.yaml` first for routing and execution settings:
     `agent_backends`, `model_overrides`, `planning.collaborative_review`,
     `execution.default_methodology`, `execution.parallel_teams`,
     `circuit_breakers.*`.
   - For any key missing from the root file, fall through to the shipped
     baseline at `hive/hive.config.yaml` (neutral consumer-safe defaults).
   - Graceful fallback: if the root `hive.config.yaml` is absent or its
     `agent_backends:` key is missing, proceed with an EMPTY routing map
     — all personas default to direct TeamCreate, no backend routing is
     applied. Do NOT crash and do NOT substitute values from the shipped
     baseline for `agent_backends` specifically (that would reintroduce
     the consumer-pollution bug Slice 0 fixed).
   - Reference `hive/references/state-boundary.md` for the two-file
     precedence contract that applies here.
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Process

### Phase 0: Assemble Planning Team

0. **Assemble the planning team.** The orchestrator (main agent) stays as coordinator, directing work via `SendMessage`.

   **Step 0.1: Build team composition.**

   **Core team (always spawned):**
   - **Researcher** (`hive/agents/researcher.md`) — codebase/web exploration, raw findings
   - **Technical Writer** (`hive/agents/technical-writer.md`) — produces all formatted documents
   - **TPM** (`hive/agents/tpm.md`) — delivery sequencing, horizontal/vertical thinking

   **Conditional team members (spawned when applicable):**
   - **Architect** (`hive/agents/architect.md`) — added when the requirement involves architecture decisions, multi-system integration, or when scale assessment is medium/large
   - **UI Designer** (`hive/agents/ui-designer.md`) — added when the requirement involves UI work (screens, components, visual design, wireframes). Not spawned for purely backend/infrastructure work

   **How to decide conditional members:** The orchestrator evaluates the requirement text at team assembly time. Use the same detection keywords from the UI Step Detection section below for the UI designer. For the architect, look for signals like: multiple systems, API design, data model changes, infrastructure, or the word "architecture" itself.

   Routing happens only after this assembled persona list is finalized. Do not let backend routing change team composition.

   **Step 0.2: Build routing decisions.**

   Before spawning anyone, consult `agent_backends` using the root-first precedence contract loaded in the pre-flight config step above. For each persona in the assembled list, compare the configured backend (if any) against the `skills/hive/skills/codex-invoke/SKILL.md` contract under `Supported personas (PoC)` and `Known-incompatible personas`.

   Produce a `routing_decisions` map for the assembled personas with one value per persona: `codex` or `direct`.

   - If `agent_backends[persona] == codex` and the persona is in codex-invoke `Supported personas (PoC)`, set that persona to `codex`.
   - If `agent_backends[persona] == codex` and the persona is in codex-invoke `Known-incompatible personas`, set that persona to `direct` and INFO-log that the Codex backend is known-incompatible for that persona.
   - If `agent_backends[persona] == codex` but the persona is in neither contract list, set that persona to `direct` and INFO-log that the persona is unvalidated for Codex, so routing stays conservative.
   - If `agent_backends[persona]` is unset, or `agent_backends` is absent, set that persona to `direct` and keep current direct-TeamCreate behavior.

   Apply this per assembled persona, including optional members only when they were added in Step 0.1. `ui-designer` is always routed `direct` even when configured to `codex`, because codex-invoke marks that persona as known-incompatible.

   Use these INFO-log directives when the route is decided:
   - `[info] planning routing: {persona} -> codex (validated, agent_backends configured) - supported + configured`
   - `[info] planning routing: {persona} -> direct (known-incompatible with codex) - e.g., ui-designer`
   - `[info] planning routing: {persona} -> direct (agent_backends not configured) - default fallback`

   If a persona is configured to `codex` but is neither supported nor known-incompatible in the codex-invoke contract, INFO-log that the persona is unvalidated for Codex and route `direct`.

   **Step 0.3: Spawn the team across two paths.**

   Use the `routing_decisions` map to assemble one conceptual planning team that may be created through two backend paths:

   - **Direct path (`TeamCreate`):** collect every persona routed `direct` and create them in a single `TeamCreate` call. Use the existing planning-team prompt template, but include only the direct-routed personas in the `## Team Members` section.
   - **Codex path (`agent-spawn` -> `codex-invoke`):** for each persona routed `codex`, create a separate teammate through the `agent-spawn` skill, which in turn invokes the Codex backend via `codex-invoke`. Use persistent pane mode and pass the full persona context, resolved paths, memory loading context, and the same planning-team coordination context that the direct teammates receive.

   Mixed teams are valid. Some planning personas may come from `TeamCreate` while others come from `agent-spawn` -> `codex-invoke`; they are still the same planning team. The orchestrator remains the single coordination point, uses `SendMessage` for all work assignment and review loops, and keeps collaborative review gates identical for both backend paths.

   **Step 0.4: Mixed-team prompt template.**

   Use this `TeamCreate` prompt template for the direct path only:
   ```
   Create a planning team for requirement: "{requirement-summary}"

   ## Team Members

   [include only personas whose routing_decisions entry is direct]

   **researcher** — Explore the target codebase. Read persona from hive/agents/researcher.md.
   Load memories from the agent's knowledge paths. Gather raw findings: file paths, patterns,
   constraints, risks.

   **technical-writer** — Produce formatted planning documents. Read persona from
   hive/agents/technical-writer.md. Load memories from the agent's knowledge paths.
   Transform raw findings into research briefs, design discussions, H/V plans, structured outlines.

   **tpm** — Sequence delivery planning. Read persona from hive/agents/tpm.md.
   Load memories from the agent's knowledge paths. Own horizontal/vertical thinking.
   Review all documents for delivery feasibility.

   [if architect is in the assembled list and routed direct]
   **architect** — Evaluate technical feasibility. Read persona from hive/agents/architect.md.
   Load memories from the agent's knowledge paths. Review designs for architectural soundness.

   [if ui-designer is in the assembled list and routed direct]
   **ui-designer** — Produce wireframes and review UI aspects. Read persona from
   hive/agents/ui-designer.md. Load memories from the agent's knowledge paths.
   Scan existing design language before proposing new UI.

   ## Coordination
   - Orchestrator assigns work via SendMessage
   - All agents review documents before user presentation (collaborative review gate)
   - Each agent reads their full persona file and loads their memory directory
   - Use agent-spawn skill patterns: load full persona, resolve paths, load memories
   ```

   If at least one persona is routed through Codex and at least one persona is routed direct, the `TeamCreate` prompt still includes only the direct-routed personas. Codex-routed personas participate via separate panes; they read the team context from their own `agent-spawn` prompt, not the `TeamCreate` prompt.

   **Agent-spawn compliance:** Every codex-routed teammate must follow the agent-spawn skill (`skills/hive/skills/agent-spawn/SKILL.md`) patterns — full persona injection, path resolution (`~`, `${CLAUDE_PLUGIN_ROOT}`), memory loading, domain constraints, and required tool validation. The direct `TeamCreate` prompt must still instruct each direct teammate to read their persona file and load their knowledge paths on startup.

### Phase A: Research

1. **Research the codebase.** `SendMessage` to the researcher to explore the target codebase — tech stack, architecture, existing patterns, relevant files. The researcher delivers raw findings (not a formatted brief). Use the researcher agent mindset — you need concrete file paths, not guesses.

   The researcher runs **context7 validation always-on** for any library/SDK/API in the requirement. Web research escalation is uncertainty-triggered (stale docs, missing coverage, conflicting info) — not scope-gated. Findings include a validation note with confidence level. If context7 is unavailable, the researcher proceeds codebase-only and notes the gap.

2. **Produce research brief.** `SendMessage` to the technical writer with the research-brief skill to transform raw findings into a formatted brief. This brief feeds into the design discussion. Write to `.pHive/epics/{epic-id}/docs/research-brief.md`.

3. **Load cross-cutting concerns.** Check for `.pHive/cross-cutting-concerns.yaml`. If found, load the concerns — they will be evaluated per-story later. See `hive/references/cross-cutting-concerns.md`.

### Phase B: Design Discussion (always runs)

4. **Produce design discussion.** `SendMessage` to the technical writer with the `design-discussion` skill (`skills/hive/skills/design-discussion/SKILL.md`). Input: the research brief + the original user request. Output: a ~200-line design discussion document covering goal, proposed approach, risks, dependencies, open questions, and a scale assessment.

4b. **Collaborative review gate (if enabled).** Check `hive.config.yaml → planning.collaborative_review`. If `true` (default), run the collaborative review gate (see Collaborative Review Gate section below). `SendMessage` the design discussion to all active team agents for review. Collect feedback, have the writer revise if needed, then proceed. If `false`, skip the review gate and present the document directly to the user.

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

6. **TPM plans the delivery.** `SendMessage` to the TPM with the design discussion, user feedback, research brief, and any architect outputs. The TPM:
   a. Maps all architectural layers and cross-layer dependencies (horizontal thinking)
   b. Cuts vertical slices — minimum cross-stack increments that each produce a working state
   c. Directs the technical writer to produce both documents using the horizontal-plan and vertical-plan skills

   The TPM is the owner of this step. The architect (if present) has already contributed their perspective in earlier phases — the TPM now sequences their inputs into an executable delivery plan.

7. **Collaborative review gate (if enabled).** If `hive.config.yaml → planning.collaborative_review` is `true` (default), run the collaborative review gate on the H/V outputs. `SendMessage` both documents to all active team agents. The researcher verifies findings are accurately reflected, the architect (if present) validates technical soundness, and the UI designer (if present) flags any UI layer gaps. Collect feedback, have the writer revise if needed. If `false`, skip and proceed directly.

8. **H/V gate (conditional).** Behavior depends on scope and flags:

   - **Large scope:** Always present both documents to the user for review. Collect feedback, incorporate, then proceed to Phase B3.
   - **Medium scope + `--gate-hv`:** Present both documents to the user for review. Collect feedback, incorporate, then proceed to Phase C.
   - **Medium scope (default, no `--gate-hv`):** Auto-proceed to Phase C without presenting a gate — the collaborative review in step 7 is sufficient.
   - **Medium scope + `--fast`:** H/V planning was skipped entirely at step 5 — this step is never reached.

   **When the gate runs (large or medium + `--gate-hv`), the user reviews:**
   - Are the layers correctly identified? (horizontal)
   - Are the slice boundaries logical? (vertical)
   - Is the first slice thin enough to be a real proof of concept?
   - Does each slice produce a genuinely working state?
   - Are deferred items acceptable?

### Phase B3: Structured Outline (large scope only)

9. **Produce structured outline.** `SendMessage` to the technical writer with the `structured-outline` skill (`skills/hive/skills/structured-outline/SKILL.md`). Input: H/V plans + design discussion + user feedback + research brief. Output: a ~1000-line structured outline with detailed approach, file manifest, risk registry, and elicitation questions. The outline now builds ON the vertical slice plan — each phase in the outline maps to a vertical slice.

9b. **Collaborative review gate (if enabled).** If `hive.config.yaml → planning.collaborative_review` is `true` (default), run the collaborative review gate on the structured outline. This is the most critical review — all active team agents review the full outline. The TPM validates sequencing, the researcher confirms technical accuracy, the architect (if present) stress-tests feasibility, and the UI designer (if present) validates UI approach. Collect feedback, have the writer revise if needed. If `false`, skip and proceed directly.

   **UI Designer SCALE_CALL revision (step 9b only) — two-gate precedence rule:** If ui-designer emits a `SCALE_CALL` field in their step 9b review response, apply **last gate wins**:
   - **Revised to `pre-exec`:** delete any existing ui-designer escalation entry in cycle state, then write the step 9b `ESCALATION:` block as a fresh entry. Log: `"ui-designer scale call revised at step 9b to pre-exec — writing fresh escalation"`
   - **Revised to `in-planning`:** delete any existing ui-designer escalation entry in cycle state (step 4b pre-exec call is superseded). Log: `"ui-designer scale call revised at step 9b to in-planning — escalation removed"`
   - **No step 9b revision:** step 4b value stands unchanged; no action needed

10. **Present structured outline to user.** Show the full document, including a summary of team review findings. The elicitation section (Part 7) contains the agent team's own stress-test of the plan — the user reads the team's answers to evaluate whether the thinking is sound. The user then:
    - Flags any elicitation answers that seem weak or wrong
    - Responds to the decision points (Part 8) — numbered affirm/change items
    - Provides final sign-off or requests revisions

    Incorporate feedback into the planning context before proceeding.

### Phase C: Story Decomposition

10c. **Resolve methodology.** Before decomposing stories, determine the development methodology:

   1. Check `hive.config.yaml` for a `methodology` field (project-level default)
   2. Check `epic.yaml` for a `methodology` override (if the epic specifies one)
   3. Fall back to `classic` if neither exists

   Available methodologies (must match a workflow YAML in `hive/workflows/`):
   - `classic` — Research → Implement → Test → Review → Integrate
   - `tdd` — Research → Test Spec → Implement → Review → Integrate
   - `bdd` — Research → Behavior Spec → Implement → Test → Review → Integrate

   The resolved methodology determines what steps each story gets (see step 14).

11. **Decompose into stories.** Break the requirement into an **epic** containing multiple **stories**. Use all available planning context (design discussion, H/V plans if produced, structured outline if produced).

    **If vertical slice plan exists:** Stories map to vertical slices. Each slice becomes one or more stories. Stories within a slice can run in parallel, but slices execute sequentially (each depends_on the prior slice's stories). Every story's completion leaves the product in a working state — this is the vertical planning invariant.

    **If no vertical slice plan:** Decompose as before — independently implementable stories with dependency tracking.

    **Escalation stories[] backfill (always runs after story IDs are determined):**
    Once canonical story YAML IDs are finalized, iterate every entry in `escalations:` in `.pHive/cycle-state/{epic-id}.yaml`:
    - For each entry, inspect its `stories` list — entries may contain topic area strings from raise time
    - For each topic area string, attempt a match against decomposed story IDs:
      - **Exact match:** topic area string equals a story ID → replace in place
      - **Fuzzy match:** topic area string overlaps with a story's `title` or `description` keywords (case-insensitive substring match) → replace with the matched canonical ID
    - **Already canonical:** if an entry already matches a story YAML ID exactly, leave it unchanged (no re-matching needed)
    - After replacement, write the updated `stories` list back to the escalation entry in cycle state
    - For any topic area with **no match found:** preserve the original string as-is and log:
      ```
      WARNING: escalation "{trigger}" stories[] entry "{topic-area}" could not be matched to a canonical story ID — leaving as topic area string
      ```
    - Entries whose `stories` list is already canonical IDs (from a prior run or manual edit) require no change

    > **Two-phase population pattern:** `escalations[].stories[]` is populated in two phases: (1) topic areas at raise time by the raising agent, (2) canonical IDs at plan step 11 by orchestrator backfill. Execute reads the backfilled canonical IDs.

12. **Requirements traceability check.** Before finalizing stories, verify every aspect of the original requirement is covered by at least one story:
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

13. **Write detailed story files.** For each story, produce an individual YAML file in `.pHive/epics/{epic-id}/stories/{story-id}.yaml`. Stories are the primary artifact — they're what agents read when executing. They must contain enough context for an agent to work autonomously without reading the full epic or other stories.

    **Self-containment rule:** Stories must work identically whether read from local disk or pulled from an external tracker (e.g., Linear). To achieve this, **inline relevant context snippets** alongside file references:

    - For `code_examples`: extract the relevant lines (~10 max) into a `snippet` field. The agent gets the pattern without needing the source file on disk.
    - For `references`: change from a flat path list to objects with a `relevant_excerpt` field containing the 3-5 most relevant lines from that document.
    - For `key_files`: add a `purpose` field explaining why each file matters to this story.

    Snippets are optional but strongly encouraged. Skip only when the reference is an entire file that would be read in full anyway. The file path always stays for traceability — humans can look up the full document. The snippet is what makes the story portable.

    **Methodology-aware steps:** Generate story steps that match the resolved methodology (from step 10c). Add a `methodology` field to each story YAML. Use these step templates:

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

14. **Evaluate cross-cutting concerns per story.** For each story, evaluate each concern's `applies_when` condition. For applicable concerns, determine the specific action needed and add a `cross_cutting` section to the story YAML. See `hive/references/cross-cutting-concerns.md` for format and examples.

15. **Write the epic index.** Produce `.pHive/epics/{epic-id}/epic.yaml` as a lightweight index referencing the stories.

16. **Detect UI stories.** After generating stories and before presenting for confirmation, scan each story for UI work indicators. See the UI Step Detection section below.

17. **Run agent-ready checklist.** Validate each story against the 9-point checklist in `hive/references/agent-ready-checklist.md` (including check #9: cross-cutting concerns). Flag stories that fail checks in the confirmation output.

18. **Present for confirmation.** Show the dependency graph (using Mermaid format — see Diagram Format section below), story summaries, traceability results, cross-cutting concerns applied, UI detection results, and checklist results. Ask for final confirmation before saving.

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

**Opt-out:** Set `hive.config.yaml → planning.collaborative_review: false` to skip all collaborative review gates. When disabled, documents are presented directly to the user without team review. This saves time on smaller projects or when the user prefers to be the sole reviewer.

**When to run (if enabled):** After steps 4, 7, and 9b — i.e., after each major document is produced and before it's presented to the user.

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
   VERDICT: approve | flag | approve-with-escalation
   COMMENTS: {specific issues or confirmation}
   ```

3b. **Extract escalations from agent review responses (orchestrator only).** After collecting all agent review responses for a gate, check each response for escalation signals. Only the orchestrator writes to cycle state — planning agents signal via their review gate responses.

   **Generic extraction pattern:** For each agent response in the review gate, check for an `ESCALATION_FLAGS` signal. Apply dedup-on-write for every flag found. This pattern is intentionally extensible — future emitters add their signal format here; the dedup-on-write rule handles all collisions automatically.

   **Active emitters:**

   **Architect** — look for an `## Escalation Flags` section with line entries in the format:
   ```
   - [severity] trigger-id — reason
   ```
   For each line: parse `trigger`, `severity`, `reason`. Look up `placement` from the specialist-triggers catalog. Set `raised_by: architect` (orchestrator adds this — architect does not emit it).

   **TPM** — look for an `ESCALATION_FLAGS:` block with YAML list entries in the format:
   ```
   ESCALATION_FLAGS:
     - trigger: performance:audit
       placement: post-exec
       severity: major
       stories: [topic-area-1, ...]
       reason: "explanation"
       raised_by: tpm
   ```
   For each entry: read all fields directly. `placement` is provided by the TPM (taken from catalog). Set `raised_by: tpm`.

   **UI Designer** — look for a `SCALE_CALL:` field in the review response:
   - **`SCALE_CALL: in-planning`** → no write to cycle state; wireframes proceed during planning as normal
   - **`SCALE_CALL: pre-exec`** → extract the `ESCALATION:` block that follows the field; write to cycle state using the same dedup-on-write logic as architect/TPM extraction. Set `raised_by: ui-designer`
   - **No `SCALE_CALL` field** → ui-designer not on planning team or didn't emit; skip — no write to cycle state

   **For all emitters:**
   - Set `raised_at` to the current ISO 8601 timestamp (orchestrator sets this at extraction time)
   - Set `stories` to topic areas from the agent's response context if not provided (canonical IDs backfilled at step 11)
   - `placement` source precedence: if the agent provides `placement` in their response (TPM, ui-designer), use the agent-provided value. If not (architect), look up `placement` from the specialist-triggers catalog

   **Dedup-on-write:** Before writing any extracted flag to `.pHive/cycle-state/{epic-id}.yaml`, check whether an entry with the same `trigger` ID already exists:
   - **If exists:** merge into the existing entry — do NOT append a second entry:
     - `stories`: union of existing and new stories[] lists (deduplicated, existing entries first, then new entries)
     - `reason`: concatenate existing and new reason with `" | "` separator
     - `raised_at`: keep the **earliest** timestamp (preserves when the concern was first raised)
     - `raised_by`: if different agents, concatenate with `", "` separator (e.g. `"architect, tpm"`)
     - `severity`: keep the **maximum** severity using ordering `major > moderate > minor`. Example: existing `moderate` + incoming `major` → merged value is `major`. Ties keep the existing value.
   - **If not exists:** write the new 7-field entry as normal

   ```yaml
   # Example entry written to cycle state (architect raises first)
   escalations:
     - trigger: security:plan-audit
       placement: pre-exec
       severity: major
       stories: [auth-flow]  # topic areas at raise time; backfilled to canonical story IDs at step 11
       reason: "human-readable explanation from architect flag"
       raised_by: architect
       raised_at: "2026-04-12T09:15:00Z"

   # Example after dedup merge (TPM also raised security:plan-audit later in same gate)
   escalations:
     - trigger: security:plan-audit
       placement: pre-exec
       severity: major
       stories: [auth-flow, data-layer]   # unioned topic areas
       reason: "architect: token storage risk | tpm: compliance deadline requires audit"
       raised_by: "architect, tpm"
       raised_at: "2026-04-12T09:15:00Z"  # earliest timestamp kept (architect raised first)
   ```

   **If no escalation signal is found in a response:** skip — do not write an empty `escalations:` block or modify cycle state.

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

All planning documents are written to `.pHive/epics/{epic-id}/docs/{document-type}.md`.

| Document type | Sub-skill | Output path |
|---------------|-----------|-------------|
| research-brief | None (no sub-skill — see note) | `.pHive/epics/{epic-id}/docs/research-brief.md` |
| design-discussion | `skills/hive/skills/design-discussion/SKILL.md` | `.pHive/epics/{epic-id}/docs/design-discussion.md` |
| horizontal-plan | `skills/hive/skills/horizontal-plan/SKILL.md` | `.pHive/epics/{epic-id}/docs/horizontal-plan.md` |
| vertical-plan | `skills/hive/skills/vertical-plan/SKILL.md` | `.pHive/epics/{epic-id}/docs/vertical-plan.md` |
| structured-outline | `skills/hive/skills/structured-outline/SKILL.md` | `.pHive/epics/{epic-id}/docs/structured-outline.md` |

**Note on research-brief:** No sub-skill file exists for the research brief format. The technical writer produces it using the research-brief pattern from memory, based on raw findings from the researcher. Output path: `.pHive/epics/{epic-id}/docs/research-brief.md`. See `hive/agents/technical-writer.md`.

Existing planning documents at the `.pHive/` root are not moved — this convention applies to new planning sessions going forward.

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
