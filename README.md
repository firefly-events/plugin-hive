# Hive — Capability Summary & Operations Guide

## What Hive Is

Hive is a workflow orchestration plugin for Claude Code. It decomposes requirements into epics with dependency-tracked stories, then executes them through multi-agent development workflows. It supports planning, implementation, testing, and code review — with quality gates, agent memories, and human touchpoints woven throughout.

Hive runs as a set of Claude Code skills. The orchestrator is always the main session — it coordinates but never becomes a teammate on the teams it manages.

---

## Commands

| Command | Trigger | Purpose |
|---------|---------|---------|
| `/hive:kickoff` | "initialize", "onboard", "start new project" | Initialize Hive for a project (brownfield or greenfield) |
| `/hive:standup` | "start the day", "daily ceremony" | Daily ceremony: standup → planning → execution |
| `/hive:plan` | "plan this feature", "break into stories" | Multi-phase planning: design discussion → H/V planning → stories |
| `/hive:execute` | "execute the epic", "run the workflow" | Execute stories through development phases |
| `/hive:status` | "what's the status" | Check active workflow state |
| `/hive:review` | "review this code", "review my changes" | Run structured code review |
| `/hive:test` | "run tests", "test swarm" | Run the test swarm pipeline |

---

## Planning Process

Planning scales with the complexity of the request:

```
Small:   research → brief → design discussion → feedback → stories
Medium:  research → brief → design discussion → feedback → H scan → V slice plan → feedback → stories
Large:   research → brief → design discussion → feedback → H scan → V slice plan → feedback → structured outline → sign-off → stories
```

### Planning Artifacts

| Artifact | Skill | When | Size |
|----------|-------|------|------|
| **Design Discussion** | `skills/hive/skills/design-discussion/` | Always (all scopes) | ~200 lines |
| **Horizontal Scan** | `skills/hive/skills/horizontal-plan/` | Medium + Large | ~200-400 lines |
| **Vertical Slice Plan** | `skills/hive/skills/vertical-plan/` | Medium + Large | ~300-500 lines |
| **Structured Outline** | `skills/hive/skills/structured-outline/` | Large only | ~1000 lines |

### Horizontal + Vertical Planning

**Horizontal planning** maps breadth — what does each architectural layer need overall? Produces a layer map with cross-layer dependencies.

**Vertical planning** maps execution — minimum cross-stack slices that each produce a working, demo-able state. Every commit is a functional unit. Issues are caught when they arrive, not after five unknowns pile up.

### Verification Strategy

Every planning artifact includes an explicit verification section — tools, platforms, automated vs manual, and what's NOT being verified. The user can course-correct the verification approach before implementation begins.

---

## Daily Operations

Hive is designed for a daily restart model. Each day starts fresh with a 1M Opus orchestrator session.

### Full Daily Flow

```
1. STANDUP  (/hive:standup)
   │  Read status markers, cycle state, task tracker, agent memories
   │  Present: yesterday's work, blockers, human items, continuations
   │
2. PLANNING
   │  User provides requirement
   │  Orchestrator runs multi-phase planning (researcher, writer, analyst,
   │    architect, TPM, ui-designer as needed)
   │  Design discussion → H/V planning (if medium+) → structured outline (if large)
   │  User reviews and steers at each gate
   │  Agent-ready checklist validates stories
   │  User approves final plan
   │
3. EXECUTION
   │  Orchestrator loads team configs and kicks off dev team(s)
   │  Teams execute vertical slices — each producing a working state
   │  Per-story commits on feature branches
   │  Status markers track progress
   │
4. REVIEW
   │  Claude reviewer evaluates implementation (default gate)
   │  Codex adversarial review (optional, configurable second-model perspective)
   │
5. TEST HANDOFF → TESTING
   │  Test swarm runs pipeline: context → baseline → author → validate
   │  → execute (parallel platforms) → file bugs → report
   │
6. FIX LOOP
   │  Dev team picks up bugs via SendMessage
   │  Fix → commit → re-run affected tests
   │  Circuit breaker: max 3 attempts per bug
   │
7. SESSION END
   │  Evaluate staged insights → promote to system memory or discard
   │  Promote team-level insights to project team memory
   │  Update cycle state, clean up staging
```

### Pipeline View

```
Planning Team ──→ Dev Team ──→ Test Swarm
  (analyst,         (researcher,     (scout, architect,
   architect,        writer,          worker, inspector,
   tpm,              frontend-dev,    sentinel)
   ui-designer)      backend-dev,
                     tester,
                     reviewer)
       │                  │                  │
       ▼                  ▼                  ▼
  Stories with       Implemented,       Test results,
  H/V plans,         tested code,       bug tickets,
  wireframes         per-story commits  session report
```

---

## Agent Roster (20 Personas)

Personas are a bench — pull who you need. Having a persona doesn't mean you must use it.

All agents have YAML frontmatter with both official Claude Code fields (`name`, `description`, `model`, `color`, `tools`) and Hive-specific fields (`knowledge`, `skills`, `domain`, `required_tools`). See `references/agent-config-schema.md`.

### Model Tier Routing

| Tier | Model | Agents | Cost |
|------|-------|--------|------|
| **Opus** | claude-opus-4-6 | orchestrator, team-lead, architect, analyst, tpm | Highest — complex reasoning |
| **Sonnet** | claude-sonnet-4-6 | researcher, technical-writer, frontend-developer, backend-developer, developer, tester, reviewer, pair-programmer, peer-validator, ui-designer, test-scout, test-architect, test-inspector, test-sentinel | Medium — analytical/implementation |
| **Haiku** | claude-haiku-4-5 | test-worker | Lowest — fast mechanical execution (consider bumping to Sonnet if context issues arise) |

Configure in `hive.config.yaml`. Override per-agent with `model_overrides`.

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
| **Test Scout** | Context gathering, baseline management |
| **Test Architect** | Test design and authoring with framework detection |
| **Test Worker** | Test execution across platforms (Haiku tier — fast) |
| **Test Inspector** | Coverage validation against requirements |
| **Test Sentinel** | Bug triage, severity routing, adaptive auto-approval |

### Coordination Agents
| Agent | Role |
|-------|------|
| **Orchestrator** | Main session — coordinates across epics and teams |
| **Team Lead** | Per-team coordinator — staffs teams, manages story execution, routes developer roles |
| **Peer Validator** | Cross-team validation — consistency, conventions, integration risk |

---

## Hierarchy

```
Orchestrator (main session)
  │
  ├── Evaluates: does this need a team?
  │   No  → orchestrator handles it solo
  │   Yes → loads team config, assigns to team lead
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

Teams use `TeamCreate` for spawning (separate tmux panes, `SendMessage` for communication).

---

## Workflows

### Development Workflows
| Workflow | File | Phase Order |
|----------|------|-------------|
| **Classic** | `development.classic.workflow.yaml` | preflight → research → write-brief → implement → test → review → (codex-review) → optimize → integrate |
| **TDD** | `development.tdd.workflow.yaml` | research → write-brief → test-spec → implement → review → optimize → integrate |
| **BDD** | `development.bdd.workflow.yaml` | research → write-brief → behavior-spec → implement → test → review → optimize → integrate |

### Other Workflows
| Workflow | Purpose |
|----------|---------|
| **Code Review** | analyze → review → summarize |
| **Test Swarm** | 8-task pipeline: context → baseline → author → validate → execute → bugs → report |
| **Daily Ceremony** | standup → planning → execution |

### Codex Integration (Optional)

When enabled (`hive.config.yaml` → `external_models.codex.enabled: true`), a Codex adversarial review runs after the Claude review step. Provides a second-model perspective. Requires `npm install -g @openai/codex` and `codex login`.

---

## Memory System (Layered Architecture)

Four-layer architecture with graceful degradation:

| Layer | What | Status |
|-------|------|--------|
| **L0: Raw memories** | `.md` files at `~/.claude/hive/memories/{agent}/` | Baseline fallback |
| **L1: Compiled wiki** | LLM-synthesized topic articles at `~/.claude/hive/memory-wiki/` | Primary retrieval |
| **L2: Obsidian UI** | Open `~/.claude/hive/` as an Obsidian vault | Opt-in, zero config |
| **L3: Vector backend** | Qdrant semantic search | Future (corpus > ~400k words) |

### System-Level: Agent Memories (cross-project)

```
~/.claude/hive/memories/{agent-name}/{slug}.md
```

Agent memories span projects. Memory types: `pattern` (90d TTL), `pitfall` (180d), `override` (no expiry), `codebase` (60d), `reference` (no expiry, append semantics). Frontmatter includes staleness fields (`last_verified`, `ttl_days`) and provenance tracking (`source`, `imported_from`).

### Compiled Wiki (L1)

```
~/.claude/hive/memory-wiki/
├── index.md              ← master topic index
├── topics/{slug}.md      ← synthesized articles with [[wikilinks]]
├── agents/{name}.md      ← per-agent digests with backlinks
└── meta/compiled-at.md   ← compilation timestamp
```

Replaces keyword matching with topic-based navigation. Cross-agent sharing is organic — memories from different agents converge by topic. All files use `[[wikilinks]]` for Obsidian compatibility. Compiled incrementally at session-end.

### Project-Level: Team Memories (project-scoped)

```
state/team-memories/{team-name}/{slug}.md
```

Team memories capture collective patterns specific to THIS codebase. Types: `convention`, `handoff-pattern`, `tooling`, `process`.

### Memory Loading (Wiki-First Retrieval)

At every spawn, agent-spawn step 5 checks the compiled wiki first:
1. If wiki fresh → navigate topic index → load relevant articles
2. If wiki stale/absent → fall back to L0 keyword scan
3. Flag memories past TTL with staleness warnings
4. Surface override count at session-start

### Onboarding & Federation

Starter memories ship with the plugin and migrate on first kickoff. Export/import via MemoryBundle format for cross-user sharing with provenance tracking. See `references/onboarding-guide.md`.

---

## Team Configs

```
state/teams/{team-name}.yaml
```

Team configs give teams permanence — generated during kickoff, editable by users, loadable by the orchestrator. Define team name, lead, members with roles, domain restrictions, methodology, and project context.

See `references/team-config-schema.md` for full format.

---

## Domain Access Control

Agents have domain restrictions controlling which files they can write. Declared in agent frontmatter (defaults) and overridden by team configs (project-specific).

- Domain restricts WRITE, not READ — agents need broad read access for context
- Enforcement: team lead validates post-step, reviewer checks during review
- Precedence: team config > agent frontmatter > default (allow all)

See `references/domain-access-control.md` for full protocol.

---

## State & Persistence

| What | Where | Purpose |
|------|-------|---------|
| Epic definitions | `state/epics/{epic-id}/epic.yaml` | Epic index with story list |
| Story specs | `state/epics/{epic-id}/stories/{story-id}.yaml` | Self-contained story definitions |
| Episode records | `state/episodes/{epic-id}/{story-id}/{step-id}.yaml` | Progress tracking |
| Cycle state | `state/cycle-state/{epic-id}.yaml` | Accumulated decisions across phases |
| Staged insights | `state/insights/{epic-id}/{story-id}/` | Insights pending session-end evaluation |
| Agent memories | `~/.claude/hive/memories/{agent}/` | System-level, cross-project |
| Team memories | `state/team-memories/{team}/` | Project-level team knowledge |
| Team configs | `state/teams/{team-name}.yaml` | Loadable team compositions |
| Test baselines | `state/test-baseline/{project}/` | Project test knowledge |

---

## Configuration

All settings in `hive/hive.config.yaml`:
- Quality gate thresholds and trust scoring
- Token budgets and context window limits
- Task tracking adapter (Linear, GitHub, Jira)
- Model tier routing and per-agent overrides
- Circuit breakers (timeouts, retry limits)
- External model integrations (Codex)
- Example codebases (user's own projects for agents to learn from)
- Execution defaults (methodology, parallel teams)

---

## Reference Docs

| Doc | File | What it covers |
|-----|------|---------------|
| Agent Config Schema | `references/agent-config-schema.md` | Frontmatter format (official + Hive fields) |
| Agent Memory Schema | `references/agent-memory-schema.md` | Layered storage, memory types, TTL/staleness, loading, migration |
| Team Config Schema | `references/team-config-schema.md` | Loadable team compositions and lifecycle |
| Domain Access Control | `references/domain-access-control.md` | Per-agent write restrictions and enforcement |
| Workflow Schema | `references/workflow-schema.md` | YAML workflow format, step fields |
| Methodology Routing | `references/methodology-routing.md` | Classic/TDD/BDD phase ordering |
| Episode Schema | `references/episode-schema.md` | Status marker format |
| Cycle State Schema | `references/cycle-state-schema.md` | Decision accumulation across phases |
| Quality Gates | `references/quality-gates.md` | Three-tier gates, trust scoring |
| Knowledge Layer | `references/knowledge-layer.md` | External docs, project knowledge, capability catalog |
| Agent-Ready Checklist | `references/agent-ready-checklist.md` | 9-point story validation |
| Insight Capture | `references/insight-capture.md` | When and how agents capture insights |
| Cross-Cutting Concerns | `references/cross-cutting-concerns.md` | Per-project concern evaluation |
| Vertical Planning | `references/vertical-planning.md` | H/V planning methodology |
| MemoryStore Interface | `references/memory-store-interface.md` | Memory retrieval/persistence contract (6 methods) |
| MemoryBundle Format | `references/memory-bundle-format.md` | Export/import federation format |
| Wiki Compilation | `references/wiki-compilation-guide.md` | Compiled wiki structure, templates, procedure |
| Onboarding Guide | `references/onboarding-guide.md` | Starter memories, kickoff migration, federation |
