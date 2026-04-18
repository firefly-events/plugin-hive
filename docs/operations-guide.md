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

Kickoff generates team configs in `state/teams/` and migrates starter memories to `~/.claude/hive/memories/`.

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

**Team memories** (`state/team-memories/{team}/`): Scoped to the current project — collective patterns that don't travel.

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
  → writes insight to state/insights/ (staging)
  → session ends
  → orchestrator evaluates: promote or discard?
  → promoted insights → ~/.claude/hive/memories/{agent}/
  → team insights → state/team-memories/{team}/
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
- All tracking via status markers (`state/episodes/`) and cycle state (`state/cycle-state/`)
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
| Epic definitions | `state/epics/{epic-id}/epic.yaml` | Epic index with story list |
| Story specs | `state/epics/{epic-id}/stories/{story-id}.yaml` | Self-contained story definitions |
| Episode records | `state/episodes/{epic-id}/{story-id}/{step-id}.yaml` | Progress tracking per step |
| Cycle state | `state/cycle-state/{epic-id}.yaml` | Accumulated decisions across phases |
| Staged insights | `state/insights/{epic-id}/{story-id}/` | Insights pending session-end evaluation |
| Agent memories | `~/.claude/hive/memories/{agent}/` | System-level, cross-project |
| Team memories | `state/team-memories/{team}/` | Project-level team knowledge |
| Team configs | `state/teams/{team-name}.yaml` | Loadable team compositions |
| Test baselines | `state/test-baseline/{project}/` | Project test knowledge |
| Handoffs | `state/handoffs/{handoff-id}.yaml` | Cross-swarm artifact transfers |

---

## Further Reading

| Doc | What it covers |
|-----|---------------|
| `references/agent-config-schema.md` | Agent frontmatter format (official + Hive fields) |
| `references/agent-memory-schema.md` | Memory types, TTL, loading, migration |
| `references/team-config-schema.md` | Loadable team compositions and lifecycle |
| `references/domain-access-control.md` | Per-agent write restrictions and enforcement |
| `references/workflow-schema.md` | YAML workflow format, step fields, retry config |
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
