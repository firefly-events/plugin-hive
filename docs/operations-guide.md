# Hive Operations Guide

Hive is a workflow orchestration plugin for Claude Code. It decomposes requirements into epics with dependency-tracked stories, then executes them through multi-agent development workflows — covering planning, implementation, testing, and code review with quality gates, agent memories, and human touchpoints throughout.

---

## Getting Started

### Prerequisites

- Claude Code (CLI or desktop app)
- The Hive plugin installed in your Claude Code environment
- _(Optional)_ Codex CLI for adversarial review: `npm install -g @openai/codex && codex login`
- _(Optional)_ Linear CLI for task tracking integration

### First Run

Run `/hive:kickoff` to initialize Hive for your project.

- **Brownfield project** (existing codebase): Hive discovers your structure, team configs, and existing state
- **Greenfield project**: Hive sets up fresh state directories and starter agent memories

Kickoff generates team configs in `.pHive/teams/` and migrates starter memories to `~/.claude/hive/memories/`.

After kickoff, you're ready for the daily flow.

---

## Daily Operations

Hive is designed for a **daily restart model** — each day starts fresh with a 1M Opus orchestrator session.

### Starting the Day: `/hive:standup`

Standup reads status markers, cycle state, the task tracker, and agent memories — then presents:

- What was completed yesterday
- Active blockers
- Items requiring human decision
- Work to continue today

### Planning a Feature: `/hive:plan`

Planning scales with complexity:

```
Small:   research → brief → design discussion → feedback → stories
Medium:  research → brief → design discussion → feedback → H scan → V slice plan → feedback → stories
Large:   research → brief → design discussion → feedback → H scan → V slice plan → feedback → structured outline → sign-off → stories
```

**Horizontal planning** maps breadth — what does each architectural layer need? Produces a layer map with cross-layer dependencies.

**Vertical planning** maps execution — minimum cross-stack slices that each produce a working, demo-able state. Every commit is a functional unit.

Every planning artifact includes a **verification strategy** — tools, platforms, automated vs. manual, and what's explicitly NOT being verified. Steer the approach before implementation begins.

The planning team includes: researcher, technical-writer, analyst, architect, tpm, and ui-designer (when UI work is detected).

**Visual planning (on by default).** Planning docs render as HTML sidecars with Mermaid diagrams and `<figure>` image slots, and at the end of a run `/plan` generates one **concept illustration** — an AI image of what the change "looks like," part sizing signal and part delight — embedded on the design discussion. Markdown stays the source of truth; the visuals are a rendering layer. Turn it off per-run with `/hive:plan --no-visual`, or persistently with `planning.visual: false` in `hive.config.yaml`. `--lite` keeps sidecars but skips the (most expensive) illustration step. The concept illustration uses the `openai-image` MCP server and is best-effort — if `OPENAI_API_KEY` is missing or the call fails, planning continues with a placeholder. See `hive/references/planning-format-contract.md` §7–§8.

Common flags: `--fast` (skip H/V at medium scope), `--lite` (token-economy: skip H/V + review gates + outline + illustration), `--no-visual` (opt out of visual planning), `--gate-hv`, `--skip-sign-off`, `--skip-research`, `--from-triage <id>`.

### Running Execution: `/hive:execute`

```
/hive:execute {epic-id}
/hive:execute {epic-id} --methodology tdd
```

Orchestrator loads team configs and kicks off dev team(s). Teams execute vertical slices — each producing a working state, with per-story commits on feature branches.

### Full Daily Flow

```
1. STANDUP  (/hive:standup)
   │  Read status markers, cycle state, task tracker, agent memories
   │  Present: yesterday's work, blockers, human items, continuations
   │
2. PLANNING
   │  User provides requirement → /hive:plan
   │  Multi-phase planning (researcher, writer, analyst, architect, tpm, ui-designer)
   │  Design discussion → H/V planning (medium+) → structured outline (large)
   │  User reviews and steers at each gate
   │  Agent-ready checklist validates stories (9 points)
   │  User approves final plan
   │
3. EXECUTION  (/hive:execute)
   │  Orchestrator loads team configs, kicks off dev team(s)
   │  Teams execute vertical slices — each producing a working state
   │  Per-story commits on feature branches
   │  Status markers track progress
   │
4. COMMIT
   │  Clean checkpoint before testing
   │  Commit message references epic + stories completed
   │
5. TEST HANDOFF → TESTING
   │  Cross-swarm handoff (stories, artifacts, cycle state)
   │  Test swarm 8-task pipeline:
   │    context → baseline → author → validate
   │    → execute (parallel platforms) → file bugs → report
   │  High-severity bugs → escalate to human (task tracker)
   │  Low-severity → auto-route to dev queue
   │
6. FIX LOOP
   │  Dev team picks up auto-routed bugs
   │  Fix → commit (separate commit per fix) → re-run affected tests
   │  Circuit breaker: max 3 iterations per bug
   │  Terminal issues → mark BLOCKED, push to task tracker, notify user
   │
7. FINAL REVIEW
   │  All tests pass → /hive:review on full session diff
   │  Last gate before code leaves the machine
   │  needs_revision → back to fix loop
   │  passed → proceed to push
   │
8. PUSH
   │  Push to remote (or create PR)
   │  Only after: tests pass + review passes + no blocked stories
   │
9. SESSION END
   │  Evaluate staged insights → promote to memory or discard
   │  Update cycle state with day's decisions
   │  Surface unresolved items for tomorrow's standup
   │  Clean up insight staging area
```

### Pipeline View

```
Planning Team ──→ Dev Team ──→ Test Swarm
  (analyst,          (researcher,     (scout, architect,
   architect,         writer,          worker, inspector,
   tpm,               frontend-dev,    sentinel)
   ui-designer)       backend-dev,
                      tester,
                      reviewer)
       │                  │                  │
       ▼                  ▼                  ▼
  Stories with       Implemented,       Test results,
  H/V plans,         tested code,       bug tickets,
  wireframes         per-story commits  session report
```

### Shipping a Release: `/hive:ship`

`/hive:ship` closes the release lifecycle after stories have executed and passed review. The command runs these steps in order:

1. **Story reconciliation** — verifies which stories shipped in this run and surfaces any in unexpected states for operator triage.
2. **Changelog authoring** — drafts a human-readable `## [Unreleased]` entry from the reconciled stories:
   - Prose is built from the authoring source chain: `outcome` field → first sentence of `description` → title + acceptance criteria. Degrade never blocks; it never invents outcomes the story data does not support.
   - Bullets synthesized from thin data (description or title + acceptance criteria rather than a real `outcome` field) receive a trailing `<!-- degraded: sourced from … -->` marker so the operator knows which lines deserve a closer read.
   - If an existing `## [Unreleased]` block is present, the skill surfaces both and asks the operator to `keep` (discard the new draft for that epic) or `merge` (operator combines them). It never silently overwrites existing prose.
   - **Operator review gate** — the draft (or merge candidate) is presented for approve/edit, judged against the format criteria in [`hive/references/changelog-entry-format.md`](../hive/references/changelog-entry-format.md). This is the quality gate; approval is final.
   - On approval, all degraded-source markers are stripped and the entry is written under `## [Unreleased]` in `CHANGELOG.md`.
3. **Version verification** — checks that version sources (package.json, pyproject.toml, etc.) are consistent and that the `## [Unreleased]` entry exists. Prompts the operator to apply a version bump if the sources are out of sync.
4. **Ship target** — runs the project's configured ship command (npm publish, gh release, etc.) with explicit operator confirmation.
5. **Release artifacts** — generates a release post, video script, and social post ideas.

All changelog entry format rules — entry shape, bullet shape, source chain, degraded-source marking, and quality criteria — are the canonical responsibility of [`hive/references/changelog-entry-format.md`](../hive/references/changelog-entry-format.md).

---

## Commands Reference

| Command | Trigger phrases | Purpose |
|---------|----------------|---------|
| `/hive:kickoff` | "initialize", "onboard", "start new project" | Initialize Hive for a project (brownfield or greenfield) |
| `/hive:standup` | "start the day", "daily ceremony" | Daily ceremony: standup → planning → execution |
| `/hive:plan` | "plan this feature", "break into stories" | Multi-phase planning with design discussion, H/V slicing, story generation |
| `/hive:execute` | "execute the epic", "run the workflow" | Execute stories through development phases |
| `/hive:status` | "what's the status" | Check active workflow state |
| `/hive:review` | "review this code", "review my changes" | Run structured code review |
| `/hive:test` | "run tests", "test swarm" | Run the test swarm pipeline |
| `/hive:ship` | "ship it", "cut a release", "release this" | Close the lifecycle: reconcile story status, author the prose changelog entry (draft → operator review → write), verify version bump, run the project's ship target, generate release post + video script + post ideas |
| `/hive:marketing-campaign` | "launch campaign", "marketing assets", "post-release campaign" | Changelog-driven campaign production: marketing-strategist derives a campaign brief from what shipped, marketing-copywriter produces copy, ad-creative produces creative concepts. Output lands in `.pHive/campaigns/<topic>/` for operator review. **Consumer-gated — not invoked for Hive's own internal work.** |

---

## Agent Roster & Model Routing

Personas are a bench — pull who you need. Having a persona doesn't mean you must use it.

### Model Tier Routing

Match the model to the job — not every agent needs Opus.

| Tier | Model | Agents | Cost |
|------|-------|--------|------|
| **Opus** | claude-opus-4-6 | orchestrator, team-lead, architect, analyst, tpm | Highest — complex reasoning |
| **Sonnet** | claude-sonnet-4-6 | researcher, technical-writer, frontend-developer, backend-developer, developer, tester, reviewer, pair-programmer, peer-validator, ui-designer, test-scout, test-architect, test-inspector, test-sentinel | Medium — analytical/implementation |
| **Haiku** | claude-haiku-4-5 | test-worker | Lowest — fast mechanical execution (consider bumping to Sonnet if context issues arise) |

Configure tier routing in `hive.config.yaml`. Override per-agent with `model_overrides` for complex projects.

### Planning Agents

| Agent | Role | Tier |
|-------|------|------|
| **Analyst** | Requirements decomposition, gap analysis, prioritization | Opus |
| **Architect** | System design, technology evaluation, API design | Opus |
| **TPM** | Cross-system sequencing, horizontal/vertical planning, incremental delivery | Opus |
| **UI Designer** | Wireframes (Frame0), design briefs, marketing materials | Sonnet |

### Development Agents

| Agent | Role |
|-------|------|
| **Researcher** | Raw data gathering — codebase exploration, web research. Does NOT write briefs. |
| **Technical Writer** | Transforms raw data into documents (briefs, design discussions, outlines). Short-lived. |
| **Frontend Developer** | UI components, screens, styles, client-side logic |
| **Backend Developer** | APIs, services, database logic, server-side code |
| **Developer** | General-purpose (legacy — use frontend/backend for new work) |
| **Tester** | TDD or Classic test authoring and execution |
| **Reviewer** | Code review — correctness, security, conventions, domain compliance |
| **Pair Programmer** | Sidecar — challenges assumptions, surfaces alternatives. Does not write code. |

### Marketing Agents

> **Consumer-gated.** These agents are spawned only for consumer-facing epics. They are not selected for Hive's own internal development work — if dispatched to a Hive-internal epic by mistake, they stop and flag the mismatch. This gate is wired in the `/hive:ship` post-release hook and the `/hive:marketing-campaign` skill.

| Agent | Role |
|-------|------|
| **Marketing Strategist** | Positioning, audience segmentation, go-to-market strategy, and campaign brief authoring. Owns the brief that downstream copy and creative agents consume. |
| **Marketing Copywriter** | Ad copy, landing page copy, email sequences, social posts, taglines, and CTAs. Consumes the campaign brief from marketing-strategist. |
| **Ad Creative** | Visual concept direction, creative briefs, and image-gen prompts for paid and organic channels. Delegates actual asset rendering to the visual-asset skill. |

### Shared Skills (Agent-Facing)

| Skill | Purpose |
|-------|---------|
| **visual-asset** | Atomic render skill — no top-level user command. Routes a visual spec (prompt + medium) to Frame0 CLI (vector/wireframe) or `openai-image` MCP (raster/ad-creative). Adaptable by ad-creative, ui-designer, logo-exploration, and marketing-campaign. Callers supply the spec and output directory; this skill owns the tool plumbing. |

### Test Swarm Agents

| Agent | Role |
|-------|------|
| **Test Scout** | Context gathering, baseline management, discovery passes |
| **Test Architect** | Test design and authoring with framework detection |
| **Test Worker** | Test execution across platforms in parallel (Haiku tier — fast) |
| **Test Inspector** | Coverage validation against requirements |
| **Test Sentinel** | Bug triage, severity classification, adaptive auto-routing |

### Coordination Agents

| Agent | Role |
|-------|------|
| **Orchestrator** | Main session — coordinates across epics and teams |
| **Team Lead** | Per-team coordinator — staffs teams, routes developer roles, validates domain compliance |
| **Peer Validator** | Cross-team validation — consistency, conventions, integration risk |

### Agent Hierarchy

```
Orchestrator (main session — you)
  │
  ├── Evaluates: does this need a team?
  │   No  → orchestrator handles it solo
  │   Yes → assigns to team lead
  │
  └── Team Lead (per-story)
        │
        ├── Routes developer roles (frontend vs backend vs both)
        ├── Loads agent memories + team memories
        ├── Validates domain compliance after each step
        │
        ├── Frontend Developer (UI work)
        ├── Backend Developer (API/server work)
        ├── Tester
        ├── Reviewer
        └── Pair Programmer (optional sidecar)
```

**Key rule:** The orchestrator never joins a team it's coordinating. Team leads never join the orchestrator's level. Information flows up through reports.

**When to spawn vs. go solo:**

- **Solo:** editing config/markdown/YAML, all work is the same skill type, one agent finishes faster than coordination overhead, no distinct frontend/backend/test split
- **Spawn a team:** genuinely different skills needed, substantial parallel implementation work, TDD methodology (separate tester and developer), story explicitly needs specialized agents

---

## Workflows

### Development Workflows

| Workflow | File | Phase Order |
|----------|------|-------------|
| **Classic** | `workflows/development.classic.workflow.yaml` | preflight → research → write-brief → implement → test → review → (codex-review) → optimize → integrate |
| **TDD** | `workflows/development.tdd.workflow.yaml` | research → write-brief → test-spec → implement → review → optimize → integrate |
| **TDD-Codex** | `workflows/development.tdd-codex.workflow.yaml` | research → write-brief → test-spec → open-codex-pane → implement → review → fix-loop → integrate → shutdown |
| **BDD** | `workflows/development.bdd.workflow.yaml` | research → write-brief → behavior-spec → implement → test → review → optimize → integrate |

Select methodology at execution time:

```
/hive:execute {epic-id} --methodology tdd
```

### Other Workflows

| Workflow | File | Purpose |
|----------|------|---------|
| **Code Review** | `workflows/code-review.workflow.yaml` | analyze → review → summarize |
| **Test Swarm** | `workflows/test-swarm.workflow.yaml` | 8-task pipeline: context → baseline → author → validate → execute → bugs → report |
| **Daily Ceremony** | `workflows/daily-ceremony.workflow.yaml` | standup → planning → execution |

### Codex Integration (Optional)

Codex can be used in two ways: as an adversarial review pass after Claude review, or as the execution backend for specific agent personas.

Enable in `hive.config.yaml`:
```yaml
external_models:
  codex:
    enabled: true

agent_backends:
  backend-developer: codex
  # Planning agents — Codex produces artifacts, Claude agents gate them:
  # technical-writer: codex    # skill-driven structured output; review gate catches issues
  # architect: codex           # design artifacts gated by Claude TPM before stories
  # tpm: codex                 # story YAMLs, sequencing; gated by collaborative review

execution:
  terminal_mux: auto
  idle_timeout_seconds: 300
```

`agent_backends` controls per-agent backend selection. Unset agents stay on the default Claude path; configured agents can route through Codex instead of `TeamCreate`.

`execution.terminal_mux` controls how visible panes are opened for agent execution:
- `tmux` uses the standard tmux path
- `cmux` requires cmux and opens Codex-backed agents in cmux panes
- `auto` prefers cmux when available, otherwise falls back to tmux

`execution.idle_timeout_seconds` sets the idle safety timeout for persistent Codex panes used by cross-model workflows.

The cross-model TDD workflow is `workflows/development.tdd-codex.workflow.yaml`: Claude writes the failing tests, Codex implements in a persistent pane, Claude reviews, and if review fails the findings go back to the same Codex pane for the fix loop.

For the Codex-backed path, install prerequisites:
- `npm install -g @openai/codex && codex login`
- `brew install --cask cmux`

Persistent pane lifecycle for TDD-Codex:
- The Codex pane opens once before implementation
- The same pane stays alive across implement and fix-loop prompts
- The pane closes during workflow shutdown or after the idle timeout safety net triggers

#### Cross-Model Planning

Planning agents can also route through Codex. The key principle: **Codex produces artifacts, Claude agents gate them.** This reduces cost on artifact-heavy planning phases while maintaining quality through cross-model review.

| Codex agent | Claude gate | What's checked |
|-------------|-------------|----------------|
| technical-writer | collaborative review | Formatting, completeness, Hive conventions |
| architect | TPM | Feasibility, sequencing, risk, constraint adherence |
| tpm | collaborative review / analyst | Story dependencies, acceptance criteria quality |

Agents that **must stay on Claude**: orchestrator and team-lead (they invoke tools and manage the workflow). The analyst is recommended to stay on Claude for horizontal/vertical planning that feeds the architect.

No new workflow is needed — the existing planning flow already has review gates between these agents. Just set `agent_backends` in config.

---

## DAG-on-Multica Substrate

Hive's four flows (`/plan`, `/execute`, `/test`, `/review`) are each backed by a YAML-described DAG graph. In **local mode** (default), the executor shells `claude --print` directly. In **Multica mode**, each agent node becomes a Multica issue; an agent run is dispatched against it, the result is reconciled back into the working tree, and a gate validates the committed files. The graphs are identical in both modes — only the `AgentSpawn` binding changes.

### Architecture

| Concern | Home | Deterministic? |
|---------|------|----------------|
| Flow, gate evaluation, routing, schema validation, resume | DAG graph + executor | Yes |
| One node's work (implement, research, review…) | Agent behind `AgentSpawn` (local or Multica) | No — contained |
| Which persona fills a node | Roster / workflow YAML | Yes |
| Project output, config | Project repo `.pHive/` | n/a |

The DAG executor never trusts an agent's self-report. Gates read committed files on disk after the reconcile node materializes the agent's commit. An agent that writes nothing fails the gate even if it says it succeeded.

### Enabling Multica mode

```yaml
# hive.config.yaml
planning:
  mode: multica    # /plan personas dispatched as Multica issues

execution:
  mode: multica    # /execute, /test, /review nodes dispatched as Multica issues
```

Env override for a single run: `HIVE_EXECUTION_MODE=multica`.

Precedence: explicit binding arg → `HIVE_EXECUTION_MODE` → config knob → default (`local`).

### Operational prerequisites

1. **Multica daemon** — `multica daemon start`. The executor calls the Multica CLI; the daemon must be running.
2. **Workspace credentials** — `~/.multica/config.json` with `server_url`, `token`, `workspace_id` (or env vars `MULTICA_SERVER_URL`, `MULTICA_TOKEN`, `MULTICA_WORKSPACE_ID`).
3. **Repo bind** — `/hive:multica-init` binds the project's git repository URL to the workspace. Without this, Multica task worktrees have no repo and agents cannot commit. Binding is idempotent.
4. **Headless agents (R1)** — Multica Studio's keychain/launchd root means Claude agents 401 without a GUI session. For unattended runs, route agent nodes to Codex via `agent_backends` in `hive.config.yaml`:

   ```yaml
   agent_backends:
     developer: codex
     backend-developer: codex
   ```

   Codex runs headless without a keychain dependency. Gates and orchestration stay on Claude (they invoke tools and cannot be moved to Codex).

### Authoring a flow graph

Each flow maps to a YAML workflow file in `hive/workflows/`. The schema is the same across flows. Four node types are used:

| Node type | Purpose |
|-----------|---------|
| `agent` | Dispatches one persona via `AgentSpawn`. Produces output dict (e.g. `commit_sha`, `epic_dir`). |
| `reconcile` | Fetches the agent's commit into the working tree. No-op for local binding (files already on disk). |
| `gate` | Reads committed files and asserts a condition. Fails deterministically if files are absent or malformed. Supports `retry` with `max_attempts`. |
| `script` / `validate` | Runs a deterministic script (e.g. Python schema validation). |

#### Minimal graph example

```yaml
# hive/workflows/myflow.workflow.yaml
name: myflow

nodes:
  research:
    node_type: agent
    agent: researcher
    step_file: step-files/myflow/research.md
    depends_on: []

  implement:
    node_type: agent
    agent: developer
    step_file: step-files/myflow/implement.md
    depends_on: [research]
    inputs:
      research_brief: "{{ research.outputs.brief }}"

  reconcile:
    node_type: reconcile
    depends_on: [implement]
    inputs:
      sha: "{{ implement.outputs.commit_sha }}"   # optional — absent → no-op on local

  gate-output:
    node_type: gate
    predicate: "output_dir must not be empty"
    depends_on: [reconcile]
    inputs:
      output_dir: "{{ implement.outputs.output_dir }}"
    retry:
      max_attempts: 3
      on: gate_failed
```

#### Step files

Each agent node references a **step file** (`step-files/<flow>/<node>.md`). Step files are passed **verbatim** to the agent — no paraphrasing, no summarization. The agent receives the exact bytes. Write step files as self-contained briefs: they must fully specify what the agent should do, what to read, and what to commit.

```markdown
<!-- step-files/myflow/implement.md -->
# Implement: <title>

## Context
…

## Task
…

## Output contract
Commit your changes to the branch. Output JSON: `{"commit_sha": "<sha>", "output_dir": "<path>"}`.
```

#### Reconcile node

Every flow that can run on Multica must include a reconcile node **between** the last agent node and the first gate. The reconcile node calls `cli.mjs reconcile`, which fetches the agent's commit from the remote bare repo and fast-forward merges it into the working tree. Without reconcile, the gate reads stale or absent files.

- If `inputs.sha` is absent or empty (local binding — files already on disk), reconcile is a no-op.
- If `inputs.sha` is set (Multica binding — agent committed to a remote branch), reconcile fetches and merges.

#### Gate node

Gate predicates follow the pattern `"{output_key} must not be empty"`. The `GateHandler` asserts that the named key (from the node's inputs) is non-null and non-empty. For structural validation beyond emptiness, use a `script` node that calls `python3 -m hive.lib.dag_executor.validate_output --target <target> --epic-dir <path>`.

Built-in validation targets: `plan-epic` (validates `epic.yaml` + per-story YAMLs). Add custom targets to `VALIDATORS` in `hive/lib/dag_executor/validate_output.py`.

### Adding a new flow

1. **Write the workflow YAML** — `hive/workflows/<flowname>.workflow.yaml`. Follow the pattern above: agent nodes → reconcile → gate.

2. **Write step files** — one `.md` per agent node in `hive/workflows/step-files/<flowname>/`. Make them self-contained briefs with an explicit output contract.

3. **Wire the front door** — in the CLI skill or command that invokes your flow, call `run()` from `hive.lib.dag_executor.run` with:
   - `workflow_path` pointing to your new YAML
   - `flow` label matching the relevant config section (use `"execution"` for execute-side flows)
   - `episode_hook=emit_run_episode` (from `hive.lib.dag_executor.episode`) to record `dag-run.yaml` markers

4. **Register a validator** (optional) — if your flow produces structured artifacts that need schema validation, add an entry to `VALIDATORS` in `validate_output.py` keyed to a `--target` name.

5. **Test locally first** — run with `execution.mode: local` (default). Swap to `multica` once the graph is validated end-to-end. The graphs behave identically in both modes.

### Resume

If a run is interrupted, the executor records `run_state.yaml` under `.pHive/runs/{run_id}/`. On re-invoke, the `resume_run()` function:

1. Loads `run_state.yaml`, checks status (SUSPENDED → resumable; COMPLETED → error).
2. Replays completed nodes from the saved output graph (no re-dispatch).
3. Re-executes from the first non-completed node onward.

Episode markers (`dag-run.yaml`) are written to `.pHive/episodes/{flow}/{run_id}/dag-run.yaml` after a successful run and record the `run_id`, workflow name, status, completed nodes, and emit timestamp.

### Existing graphs (reference)

| Flow | Workflow file | Key nodes |
|------|--------------|-----------|
| Plan | `hive/workflows/plan.workflow.yaml` | research ‖ design → author → reconcile → output-validation |
| Execute (TDD) | `hive/workflows/development.tdd.workflow.yaml` | research → write-brief → test-spec → implement → reconcile-implement → gate-tests → review → integrate |
| Execute (Classic) | `hive/workflows/development.classic.workflow.yaml` | preflight → research → write-brief → implement → test → review → integrate |
| Test swarm | `hive/workflows/test-swarm.workflow.yaml` | …12-node pipeline… → reconcile-report → gate-test-report |
| Review | `hive/workflows/review.workflow.yaml` | reviewer → reconcile-review → gate-review-artifact |

Step files live in `hive/workflows/step-files/{flow}/`.

---

## Memory System

Agents accumulate knowledge across sessions. The memory system uses a four-layer architecture with graceful degradation.

### Layers

| Layer | Location | Status |
|-------|----------|--------|
| **L0: Raw memories** | `~/.claude/hive/memories/{agent}/` | Baseline fallback |
| **L1: Compiled wiki** | `~/.claude/hive/memory-wiki/` | Primary retrieval |
| **L2: Obsidian UI** | Open `~/.claude/hive/` as an Obsidian vault | Opt-in, zero config |
| **L3: Vector backend** | Qdrant semantic search | Future (corpus > ~400k words) |

### System-Level vs. Project-Level

**Agent memories** (`~/.claude/hive/memories/{agent}/`): Span all projects — cross-project expertise that builds over time.

**Compiled wiki** (`~/.claude/hive/memory-wiki/`): LLM-authored topic articles with `[[wikilinks]]`. Replaces keyword matching with topic-based navigation. Cross-agent sharing is organic — memories from different agents converge by topic.

**Team memories** (`.pHive/team-memories/{team}/`): Scoped to the current project — collective patterns that don't travel.

### Memory Types

| Type | TTL | Purpose |
|------|-----|---------|
| `pattern` | 90 days | Repeatable approach that worked |
| `pitfall` | 180 days | Lesson learned, avoid this |
| `override` | No expiry | Supersedes an existing memory |
| `codebase` | 60 days | Project-specific understanding |
| `reference` | No expiry | Curated knowledge list (append semantics) |

### Session Lifecycle

```
Agent executes step
  → encounters something non-obvious
  → writes insight to .pHive/insights/ (staging)
  → session ends
  → orchestrator evaluates: promote or discard?
  → promoted insights → ~/.claude/hive/memories/{agent}/
  → team insights → .pHive/team-memories/{team}/
  → reference insights → append to existing reference memory
  → wiki compilation (incremental, affected topics only)
  → next session: wiki-first retrieval at spawn time
```

### Memory Loading at Spawn

At every agent spawn, step 5 loads memories:

1. If wiki fresh → navigate topic index → load relevant articles as "Prior Knowledge"
2. If wiki stale/absent → fall back to L0 keyword scan
3. Flag memories past TTL with `⚠ last verified: N days ago`
4. Surface override count at session-start

### Onboarding & Federation

Starter memories ship with the plugin and migrate to the live path on first `/hive:kickoff`. Export/import via MemoryBundle format enables cross-user memory sharing with provenance tracking. See `references/onboarding-guide.md`.

### Agent lifecycle across stories

Under the Multica/sandcastle execution substrate, **each story is dispatched as a fresh agent invocation**. The agent starts with no memory of prior stories in the same epic, executes exactly the work described in its issue, then exits. Context isolation is guaranteed by the substrate — not by any Hive-level config key.

This means:

- **No stale context accumulates.** An agent implementing story N cannot be confused by story N−1's working state, partial writes, or in-flight tool calls.
- **No explicit teardown is needed.** There is no long-lived teammate to respawn, recycle, or reset between stories.
- **Continuity across stories flows through artifacts, not agent memory.** Episode markers, commits, and the knowledge graph carry state forward. A fresh agent reads those artifacts at the start of its run and picks up where the prior agent left off.

**Why a respawn-per-task lifecycle mode was never built (Workstream B).** The 2026-04 plan included a Workstream B that would have added a `respawn_per_task` lifecycle option (configurable via a `teammate_lifecycle` key) for development teammates running inside a long-lived session. That design made sense against the in-session TeamCreate execution model, where a single teammate persists across stories and must be deliberately cycled to reset context. When the execution substrate moved to Multica/sandcastle — where per-story fresh-agent dispatch is native — the problem Workstream B was solving ceased to exist. Building a separate config-driven respawn mechanism would have duplicated what the substrate already guarantees for free. The feature was dropped in June 2026 and replaced with this note. There is no `teammate_lifecycle` key and no `respawn_per_task` flag; neither was ever shipped.

---

## Configuration

All settings live in `hive/hive.config.yaml`.

| Setting Area | What it controls |
|-------------|-----------------|
| Quality gate thresholds | Auto-pass score, peer review range, human escalation cutoff |
| Trust scoring | Per-agent-pair trust scores, decay behavior |
| Token budgets | Context window limits, fresh instance spawning |
| Task tracking adapter | `linear`, `github`, `jira`, or `null` (local-only, default) |
| Default methodology | `classic`, `tdd`, or `bdd` |
| Retry attempts | Per-step gate retry counts |
| Model tier routing | Base tier assignments |
| `model_overrides` | Per-agent model overrides for complex projects |
| Circuit breakers | Timeouts, max retry limits |
| External models | Codex adversarial review toggle |
| `agent_backends` | Per-agent backend routing (`claude` or `codex`) |
| Example codebases | User's own projects for agents to learn from |
| Execution defaults | `parallel_teams`, methodology, `terminal_mux`, `idle_timeout_seconds` |

### Task Tracking Modes

**Local mode** (`adapter: null`, default):
- All tracking via status markers (`.pHive/episodes/`) and cycle state (`.pHive/cycle-state/`)
- Works out of the box — no external tool required

**External tracker mode** (`adapter: linear`):
- Local tracking PLUS Linear board integration
- Tickets created, claimed, and transitioned through the daily ceremony
- Branch naming enables GitHub auto-link; merge auto-closes tickets
- See `references/linear-integration.md`

---

## Troubleshooting

### Error Categories

Every failure falls into one of three categories:

| Category | Response | Examples |
|----------|----------|---------|
| **Transient** | Retry (max 2–3) | Agent timeout, file write failed, Linear API blip |
| **Story issue** | Back to planning | Wrong assumptions, unimplementable criteria, flawed approach |
| **Human blocker** | Escalate | Missing credentials, business decision, env access |

**Key rule:** If it's not a human blocker, it goes back to planning — not into an infinite fix loop.

### When to Return to Planning

- Story assumptions are wrong (architecture, tech stack, API protocol)
- Tests reveal the approach is fundamentally flawed (not just a bug)
- Reviewer says the approach is wrong (not just the code)
- Fix loop exceeds 3 iterations without convergence

### When to Stay in the Fix Loop

- Simple code bugs (null check, missing import, off-by-one)
- Lint/format failures
- Test failures with clear code-level fixes

### Quality Gates

Three-tier system governing when work auto-proceeds vs. needs review:

| Tier | Score | Action |
|------|-------|--------|
| Auto-pass | ≥ 0.9 | Proceed immediately |
| Peer review | 0.3–0.9 | Validation handshake (submit → validate → verify) |
| Human escalation | < 0.3 | Push to task tracker, halt |

Trust scores (0.0–1.0) track per-agent-pair reliability. High trust (≥ 0.8) skips full validation; low trust (≤ 0.5) enforces full handshake. Trust decays over time if not recently validated.

When gates fail, findings feed back into the next attempt. Default: 2 retries before escalation.

### Stuck Agents

If a teammate goes stale (no progress in a few minutes):

1. Check task output via `TaskOutput`
2. Determine if it's blocked on input vs. in a loop
3. Bypass and respawn with corrected context if needed

See `references/error-handling.md` for the full per-phase failure playbook.

---

## State & Persistence Reference

| What | Where | Purpose |
|------|-------|---------|
| Epic definitions | `.pHive/epics/{epic-id}/epic.yaml` | Epic index with story list |
| Story specs | `.pHive/epics/{epic-id}/stories/{story-id}.yaml` | Self-contained story definitions |
| Episode records | `.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml` | Progress tracking per step |
| DAG run episodes | `.pHive/episodes/{flow}/{run-id}/dag-run.yaml` | DAG run summary (run_id, workflow, status, completed nodes) |
| DAG run state | `.pHive/runs/{run-id}/run_state.yaml` | In-flight executor state; used for resume |
| DAG spawn state | `.pHive/dag-spawn-state/{run-id}/{step-id}/tracker.json` | Multica issue ID per node (idempotency) |
| Cycle state | `.pHive/cycle-state/{epic-id}.yaml` | Accumulated decisions across phases |
| Staged insights | `.pHive/insights/{epic-id}/{story-id}/` | Insights pending session-end evaluation |
| Agent memories | `~/.claude/hive/memories/{agent}/` | System-level, cross-project |
| Team memories | `.pHive/team-memories/{team}/` | Project-level team knowledge |
| Team configs | `.pHive/teams/{team-name}.yaml` | Loadable team compositions |
| Test baselines | `.pHive/test-baseline/{project}/` | Project test knowledge |
| Handoffs | `.pHive/handoffs/{handoff-id}.yaml` | Cross-swarm artifact transfers |

---

## Hermes Orchestrator Skills (lights-on loop)

The Hive orchestrator is codified as a set of **Hermes-side skills** so a persistent
Hermes cron can run the software factory toward the north star: **a human gates only
planning and review; the orchestrator and agents own the rest.** The skills are
native hermes-agent `SKILL.md` files under `skills/orchestration/` in the
hermes-agent repo, ported from the canonical runbook sources in plugin-hive at
`hive/references/orchestrator-skills/`. Format + binding spec:
`.pHive/epics/hermes-orchestrator-skills/docs/hermes-skill-format-spec.md`.

| Skill | Human gate | Wraps | Source runbook |
|-------|-----------|-------|----------------|
| `monitor-epic` | none (read-only) | epic-status + context-snapshot + poll | `orchestrator-skills/monitor-epic.md` |
| `reconcile-tick` | **review verdict** | 7-position phase machine; watchdog; ff-merge verify | `orchestrator-skills/reconcile-tick.md` |
| `kickoff-plan` | **plan approval** | starts `/plan`, routes gates to human | `orchestrator-skills/kickoff-plan.md` |
| `kickoff-exec` | none (epic pre-approved) | starts the reconcile loop over a `pre_approved` epic | `orchestrator-skills/kickoff-exec.md` |
| `watch-cron` | none (alert-only) | RemoteTrigger routines + `multica daemon status` health | `orchestrator-skills/watch-cron.md` |

**The loop:** a human approves an epic (`gate_state: pre_approved`, the latch in
`hive/lib/hermes-reconciler/state.mjs`) → `kickoff-exec` starts → `reconcile-tick`
advances each story implementation → review → **halts at `review_terminal`** and
surfaces the verdict to the human via the Slack notify-and-await transport
(`hive/lib/hermes-reconciler/slack-notify-await.mjs`) → human continues/rejects →
loop resumes. `monitor-epic` + `watch-cron` provide read-only visibility throughout.

**Invariants:** the tick never auto-advances past a review verdict, never marks a
story done on an agent's claimed "pushed" status (verifies ff-merge), never advances
an epic that is not `pre_approved`, and **never mints stories** — backlog authorship
stays human-gated via `/plan` and `/triage --hand-off` only.

**MCP binding:** the skills reach the tracker through `multica_*` MCP tools
(`hive/lib/multica-story-dispatch/mcp-tools.mjs`, a thin wrapper over `cli.mjs`),
registered in the hermes runtime config (`~/.hermes/config.yaml` → `mcp_servers.multica`).

---

## Further Reading

| Doc | What it covers |
|-----|---------------|
| `references/changelog-entry-format.md` | Canonical changelog entry format — entry shape, bullet shape, authoring source chain, degraded-source marking, quality criteria |
| `references/agent-config-schema.md` | Agent frontmatter format (official + Hive fields) |
| `references/agent-memory-schema.md` | Memory types, TTL, loading, migration |
| `references/team-config-schema.md` | Loadable team compositions and lifecycle |
| `references/domain-access-control.md` | Per-agent write restrictions and enforcement |
| `references/workflow-schema.md` | YAML workflow format, node types, step fields, retry config |
| `references/methodology-routing.md` | Classic/TDD/BDD phase ordering |
| `references/episode-schema.md` | Status marker format |
| `references/quality-gates.md` | Three-tier gates, trust scoring, validation handshake |
| `references/error-handling.md` | Failure categories, per-phase recovery, back-to-planning |
| `references/configuration.md` | All config settings and defaults |
| `references/test-swarm-architecture.md` | 8-task test pipeline, framework detection, bug triage |
| `references/linear-integration.md` | Per-phase Linear operations, GitHub setup |
| `references/token-management.md` | Budgets, context window, fresh instance spawning |
| `references/memory-store-interface.md` | Memory retrieval/persistence contract (6 methods) |
| `references/memory-bundle-format.md` | Export/import federation format |
| `references/wiki-compilation-guide.md` | Compiled wiki structure, templates, procedure |
| `references/onboarding-guide.md` | Starter memories, kickoff migration, federation |
| `references/cross-swarm-handoff.md` | Artifact transfer between swarms |
| `references/vertical-planning.md` | H/V planning methodology |
| `references/agent-teams-guide.md` | Claude Code agent teams mechanics |
