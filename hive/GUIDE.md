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
| `/hive:plan` | "plan this feature", "break into stories" | Decompose a requirement into an epic with stories |
| `/hive:execute` | "execute the epic", "run the workflow" | Execute stories through development phases |
| `/hive:status` | "what's the status" | Check active workflow state |
| `/hive:review` | "review this code", "review my changes" | Run structured code review |
| `/hive:brand-system` | "create brand system", "establish brand identity" | Brand identity: colors (HEX/RGB/CMYK/PMS), typography, spacing. Produces YAML + visual guide PNG. No prerequisites. |
| `/hive:design-system` | "generate design tokens", "create token file" | Convert brand YAML to W3C Design Token JSON. Requires `/hive:brand-system` first. |
| `/hive:ui-audit` | "run ui audit", "audit accessibility" | Collaborative audit: accessibility-specialist + animations-specialist + ui-designer synthesis. Requires `/hive:kickoff` first. |
| `/hive:polish-audit` | "run polish audit", "find animation opportunities" | Animation/motion opportunity pass. Requires `/hive:ui-audit` first. |
| `/hive:visual-qa` | "run visual qa", "check design fidelity" | Compare design briefs and wireframe PNGs against implementation. Requires `/hive:ui-design` on a story first. |
| `/hive:design-review` | "run design review", "review the design" | Design review ceremony with domain specialist critiques. Requires `/hive:ui-design` or `/hive:brand-system`. Supports `--skip accessibility` and `--skip animations`. |
| `/meta-optimize` | "optimize this project", "run meta improvements" | Public meta-improvement cycle for the resolved target project. Requires kickoff-time metrics opt-in for metrics-backed proposal ranking; otherwise uses backlog fallback when available. Produces PR-style artifacts rather than mutating `main`. |

---

## `/meta-optimize` Workflow

`/meta-optimize` is the shipped public meta-improvement path for a consumer's
resolved target project. Keep the public explanation lightweight here and defer
the runner contract to
[`skills/hive/skills/meta-optimize/SKILL.md`](../skills/hive/skills/meta-optimize/SKILL.md)
and
[`hive/references/meta-optimize-contract.md`](references/meta-optimize-contract.md).

### Kickoff To PR

The public flow is:

1. `/hive:kickoff` asks whether to enable metrics tracking. The default is
   `no`, so metrics stay off unless the user explicitly opts in.
2. Normal Hive use accumulates metrics only when `metrics.enabled: true`.
3. `/meta-optimize` resolves the target project from `paths.target_project`
   first, then falls back to the invoking cwd, and requires a clean git tree on
   that target.
4. The skill reads the available signal, proposes a candidate when the metrics
   path has enough ranked signal, or falls back to the consumer backlog when it
   does not.
5. It captures a baseline snapshot, executes the candidate on a feature branch
   in the target-project worktree, compares baseline versus candidate metrics,
   and closes with PR-shaped evidence.

What users see is a PR branch plus a close record with `pr_ref`, `pr_state`,
and baseline-versus-candidate metrics snapshots. The public path does not
directly mutate the target repo's `main` branch.

### Backlog Fallback

Fallback triggers when the metrics-backed proposal path does not produce a
ranked candidate above threshold. The consumer-managed backlog lives at:

`{target}/.pHive/meta-team/queue-meta-optimize.yaml`

This backlog is human-edit-only. In practice that means users maintain the file
themselves with queued improvement ideas; the skill only reads the backlog and
selects from eligible entries when fallback is needed.

`/meta-meta-optimize` remains maintainer-local only. It is not a shipped public
consumer command.

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
   │  Multi-phase planning: design discussion → H/V planning (medium+) → outline (large)
   │  Planning team: researcher, writer, analyst, architect, TPM, ui-designer
   │  User reviews and steers at each gate
   │  Agent-ready checklist validates stories
   │  User approves final plan
   │
3. EXECUTION
   │  Orchestrator loads team configs, kicks off dev team(s)
   │  Teams execute vertical slices — each producing a working state
   │  Per-story commits on feature branches
   │  Status markers track progress
   │
4. COMMIT
   │  Commit all dev work — clean checkpoint before testing
   │  Commit message references epic + stories completed
   │
5. TEST HANDOFF → TESTING
   │  Create cross-swarm handoff (stories, artifacts, cycle state)
   │  Test swarm runs 8-task pipeline:
   │  context → baseline → author tests → validate coverage
   │  → execute (parallel platforms) → file bugs → report
   │  High-severity bugs → escalate to human (task tracker)
   │  Low-severity bugs → auto-route to dev queue
   │
6. FIX LOOP
   │  Dev team picks up auto-routed bugs
   │  Fix → commit (separate commit per fix) → re-run affected tests
   │  Repeat until all auto-routable bugs resolved
   │
   │  TERMINAL ISSUES: If a bug can't be fixed by dev (architectural flaw,
   │  missing dependency, environment issue, needs human judgment):
   │  → STOP fix loop for that story
   │  → Mark story BLOCKED
   │  → Push to task tracker with full context
   │  → Notify user immediately (don't bury in report)
   │  → Continue with remaining non-blocked work
   │
7. FINAL REVIEW
   │  All tests pass → run code review on full session diff
   │  Last quality gate before code leaves the machine
   │  If needs_revision → back to fix loop
   │  If passed → proceed to push
   │
8. PUSH
   │  Push to remote branch (or create PR)
   │  Only after: tests pass + review passes + no blocked stories
   │
9. SESSION END
   │  Evaluate staged insights → promote or discard
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

## Agent Roster (20 Personas)

Personas are a bench — pull who you need. Having a persona doesn't mean you must use it.

### Model Tier Routing

Match the model to the job — not every agent needs Opus.

| Tier | Model | Agents | Cost |
|------|-------|--------|------|
| **Opus** | claude-opus-4-6 | orchestrator, team-lead, architect, analyst, tpm | Highest — complex reasoning |
| **Sonnet** | claude-sonnet-4-6 | researcher, technical-writer, frontend-developer, backend-developer, developer, tester, reviewer, pair-programmer, peer-validator, ui-designer, test-scout, test-architect, test-inspector, test-sentinel | Medium — analytical/implementation |
| **Haiku** | claude-haiku-4-5 | test-worker | Lowest — fast mechanical execution (consider bumping to Sonnet if context issues arise) |

Configure in `hive.config.yaml`. Override per-agent with `model_overrides` for complex projects.

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
| Agent | File | Role |
|-------|------|------|
| **Test Scout** | `agents/test-scout.md` | Context gathering, baseline management, discovery passes |
| **Test Architect** | `agents/test-architect.md` | Test authoring with framework detection |
| **Test Worker** | `agents/test-worker.md` | Test execution across platforms in parallel |
| **Test Inspector** | `agents/test-inspector.md` | Coverage validation against requirements |
| **Test Sentinel** | `agents/test-sentinel.md` | Bug triage, severity classification, adaptive auto-routing |

### Coordination Agents
| Agent | Role |
|-------|------|
| **Orchestrator** | Main session — coordinates across epics and teams |
| **Team Lead** | Per-team coordinator — staffs teams, routes developer roles, validates domains |
| **Peer Validator** | Cross-team validation — consistency, conventions, integration risk |

---

## Hierarchy

```
Orchestrator (main session — you)
  │
  ├── Evaluates: does this need a team?
  │   No  → orchestrator handles it solo
  │   Yes → assigns to team lead
  │
  └── Team Lead (per-story)
        │
        ├── Evaluates: who do I need from the bench?
        │   Simple task → team lead handles solo
        │   Complex task → pulls agents
        │
        ├── Frontend Developer
        ├── Backend Developer
        ├── Tester
        └── Pair Programmer (optional sidecar)
```

**Key rule:** The orchestrator never joins a team it's coordinating. Team leads never join the orchestrator's level. Information flows up through reports.

---

## Workflows (6)

### Development Workflows
| Workflow | File | Phase Order |
|----------|------|-------------|
| **Classic** | `workflows/development.classic.workflow.yaml` | preflight → research → write-brief → implement → test → review → (codex-review) → optimize → integrate |
| **TDD** | `workflows/development.tdd.workflow.yaml` | research → write-brief → test-spec → implement → review → optimize → integrate |
| **BDD** | `workflows/development.bdd.workflow.yaml` | research → write-brief → behavior-spec → implement → test → review → optimize → integrate |

### Other Workflows
| Workflow | File | Purpose |
|----------|------|---------|
| **Code Review** | `workflows/code-review.workflow.yaml` | analyze → review → summarize |
| **Test Swarm** | `workflows/test-swarm.workflow.yaml` | 8-task pipeline: context → baseline → author → validate → execute → bugs → report |
| **Daily Ceremony** | `workflows/daily-ceremony.workflow.yaml` | standup → planning → execution |
| **Design Review** | `workflows/design-review.workflow.yaml` | accessibility-critique (optional) → animations-critique (optional) → design-critique → synthesis |

Select development methodology: `/hive:execute {epic} --methodology tdd`

---

## Swarm Types

### Planning Team
**When:** `/hive:plan` or during daily ceremony planning phase
**Agents:** researcher, technical-writer, analyst, architect, tpm, ui-designer (if UI work detected)
**Output:** Design discussion, H/V plans (medium+), structured outline (large), epic with stories
**Key features:** Multi-phase planning (small/medium/large), horizontal+vertical slicing, verification strategy, UI step detection

### Development Team
**When:** `/hive:execute {epic}`
**Agents:** researcher, technical-writer, frontend-developer, backend-developer, tester, reviewer, pair-programmer (optional)
**Output:** Implemented, tested, reviewed code with per-story commits
**Key features:** Developer role routing (frontend/backend), domain validation, optional Codex adversarial review

### Test Swarm
**When:** After dev swarm completes (cross-swarm handoff) or manual trigger
**Agents:** test-scout, test-architect, test-worker, test-inspector, test-sentinel
**Output:** Test results, coverage report, bug tickets, session report
**Key feature:** Framework detection — auto-detects Maestro, Playwright, pytest, etc.

### Code Review
**When:** Final review gate before push (step 7 in daily ceremony), or ad-hoc via `/hive:review`
**Agents:** researcher (scope analysis), reviewer (findings)
**Output:** Structured review with verdict (passed / needs_optimization / needs_revision)
**In the daily flow:** Reviews the full session diff after all tests pass — last gate before code leaves the machine

---

## Error Handling

Every failure falls into one of three categories:

| Category | Response | Example |
|----------|----------|---------|
| **Transient** | Retry (max 2-3) | Agent timeout, file write failed, Linear API blip |
| **Story issue** | **Back to planning** | Wrong assumptions, unimplementable criteria, flawed approach |
| **Human blocker** | Escalate | Missing credentials, business decision, env access |

**The key rule:** If it's not a human blocker, it goes back to planning — not into an infinite fix loop.

### Back to Planning triggers:
- Story assumptions are wrong (architecture, tech stack, API protocol)
- Tests reveal the approach is fundamentally flawed (not just a bug)
- Reviewer says the approach is wrong (not just the code)
- Fix loop exceeds 3 iterations without convergence

### Stays in fix loop:
- Simple code bugs (null check, missing import, off-by-one)
- Lint/format failures
- Test failures with clear code-level fixes

See `references/error-handling.md` for the full playbook with per-phase failure tables.

---

## Quality System

### Three-Tier Gates
| Tier | Score | Action |
|------|-------|--------|
| Auto-pass | ≥ 0.9 | Proceed immediately |
| Peer review | 0.3–0.9 | Validation handshake (submit → validate → verify) |
| Human escalation | < 0.3 | Push to task tracker, halt |

### Trust Scoring
- Per-agent-pair trust scores (0.0–1.0)
- High trust (≥0.8) → skip full validation
- Low trust (≤0.5) → enforce full handshake
- Trust decays over time if not recently validated

### Gate Retry
When gates fail, findings are fed back into the next attempt. Configurable per step in workflow YAML. Default: 2 attempts before escalation.

### Gate Policies
YAML-defined quality rules per workflow at `gate-policies/{workflow}.yaml`. Types: structural, consistency, coverage, custom.

---

## State & Persistence

| What | Where | Purpose |
|------|-------|---------|
| Epic definitions | `.pHive/epics/{epic-id}/epic.yaml` | Epic index with story list |
| Story specs | `.pHive/epics/{epic-id}/stories/{story-id}.yaml` | Self-contained story definitions |
| Episode records | `.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml` | Progress tracking |
| Cycle state | `.pHive/cycle-state/{epic-id}.yaml` | Accumulated decisions across phases |
| Staged insights | `.pHive/insights/{epic-id}/{story-id}/` | Insights pending session-end evaluation |
| Agent memories | `~/.claude/hive/memories/{agent}/` | System-level, cross-project |
| Team memories | `.pHive/team-memories/{team}/` | Project-level team knowledge |
| Team configs | `.pHive/teams/{team-name}.yaml` | Loadable team compositions |
| Test baselines | `.pHive/test-baseline/{project}/` | Project test knowledge |
| Audit reports | `.pHive/audits/{audit-type}/{timestamp}/report.md` | Ad-hoc audit output (ui-audit, polish-audit, visual-qa, design-review) |
| Latest audit pointer | `.pHive/audits/{audit-type}/latest.yaml` | Pointer to most recent completed audit of each type |
| Design briefs | `.pHive/design/briefs/{story-id}.md` | Stable canonical design briefs (written by ui-design workflow) |
| Design brief manifest | `.pHive/design/index.yaml` | Lists all brief paths and wireframe export paths (gate file for visual-qa, design-review) |
| Brand system | `.pHive/brand/brand-system.yaml` | Brand identity data (gate file for design-system, design-review) |
| Design tokens | `.pHive/brand/tokens.json` | W3C Design Token JSON (produced by design-system skill) |
| Handoffs | `.pHive/handoffs/{handoff-id}.yaml` | Cross-swarm artifact transfers |

---

## Agent Memory System (Layered Architecture)

Agents accumulate memories across sessions. The memory system uses a four-layer architecture with graceful degradation:

| Layer | What | Status |
|-------|------|--------|
| **L0: Raw memories** | `.md` files at `~/.claude/hive/memories/{agent}/` | Baseline fallback |
| **L1: Compiled wiki** | LLM-synthesized topic articles at `~/.claude/hive/memory-wiki/` | Primary retrieval |
| **L2: Obsidian UI** | Open `~/.claude/hive/` as an Obsidian vault | Opt-in, zero config |
| **L3: Vector backend** | Qdrant semantic search | Future (corpus > ~400k words) |

### Storage

**System-level** (`~/.claude/hive/memories/{agent}/`): Agent memories span projects — cross-project expertise that builds over time. Frontmatter includes TTL fields (`last_verified`, `ttl_days`) and provenance tracking (`source`, `imported_from`).

**Compiled wiki** (`~/.claude/hive/memory-wiki/`): LLM-authored topic articles with `[[wikilinks]]`. Replaces keyword matching with topic-based navigation. Cross-agent sharing is organic — memories from different agents converge by topic.

**Project-level** (`.pHive/team-memories/{team}/`): Team memories are scoped to the current project — collective patterns that don't travel.

### Memory Types
- `pattern` — repeatable approach that worked (TTL: 90 days)
- `pitfall` — lesson learned, avoid this (TTL: 180 days)
- `override` — supersedes an existing memory (no expiry)
- `codebase` — project-specific understanding (TTL: 60 days)
- `reference` — curated knowledge list with append semantics (no expiry)

### Flow
```
Agent executes step
  → encounters something non-obvious
  → writes insight to .pHive/insights/ staging
  → session ends
  → orchestrator evaluates: promote or discard?
  → agent insights → ~/.claude/hive/memories/{agent}/
  → team insights → .pHive/team-memories/{team}/
  → reference insights → append to existing reference memory
  → wiki compilation (incremental, affected topics only)
  → next session: wiki-first retrieval at spawn time
```

### Memory Loading (Wiki-First Retrieval)

At every spawn, agent-spawn step 5 checks the compiled wiki first:
1. If wiki fresh → navigate topic index → load relevant articles as "Prior Knowledge"
2. If wiki stale/absent → fall back to L0 keyword scan
3. Flag memories past TTL with `⚠ last verified: N days ago`
4. Surface override count at session-start

### Onboarding & Federation

Starter memories ship with the plugin and migrate to the live path on first kickoff. Export/import via MemoryBundle format enables cross-user memory sharing with provenance tracking. See `references/onboarding-guide.md`.

### What Gets Discarded
- One-off execution details
- Ephemeral context
- Already captured in existing memories
- Derivable from reading current code
- Secrets, credentials, or PII

---

## Cross-Swarm Handoffs

Structured artifact transfer between swarms:

```
Planning Swarm → [handoff] → Dev Swarm → [handoff] → Test Swarm
```

Handoff includes: story specs, implementation artifacts, cycle state, constraints, naming conventions. Status lifecycle: pending → consumed → expired.

---

## Task Tracking Modes

Hive works in two modes based on `hive.config.yaml` → `task_tracking.adapter`:

**Local mode** (`adapter: null`, default):
- All tracking via status markers (`.pHive/episodes/`) and cycle state (`.pHive/cycle-state/`)
- Blockers surfaced via cycle state "blocked" status
- No external tool required — works out of the box

**External tracker mode** (`adapter: linear`):
- Local tracking PLUS Linear board integration
- Tickets created, claimed (assignment-locked), transitioned through the ceremony
- Branch naming enables GitHub auto-link, merge auto-closes tickets
- See `references/linear-integration.md` for per-phase operations

Every ceremony phase works in both modes. External tracker operations are additive — they enhance but never replace local tracking.

---

## Configuration

All settings in `skills/hive/hive.config.yaml`:
- Quality gate thresholds
- Trust scoring parameters
- Token budgets and context window limits
- Task tracking adapter (Linear, GitHub, Jira — or null for local-only)
- Default methodology
- Retry attempts
- Model tier routing

---

## Reference Docs

| Doc | File | What it covers |
|-----|------|---------------|
| Workflow Schema | `references/workflow-schema.md` | YAML workflow format, step fields, retry config |
| Methodology Routing | `references/methodology-routing.md` | Classic/TDD/BDD/FDD phase ordering |
| Status Markers | `references/episode-schema.md` | Lightweight progress tracking format |
| Agent Memory | `references/agent-memory-schema.md` | Memory types, capture, evaluation, loading |
| Cycle State | `references/cycle-state-schema.md` | Decision accumulation across phases |
| Quality Gates | `references/quality-gates.md` | Three-tier gates, trust scoring, validation handshake, control plane |
| Knowledge Layer | `references/knowledge-layer.md` | External docs, project knowledge, capability catalog |
| Agent-Ready Checklist | `references/agent-ready-checklist.md` | 9-point story validation before execution |
| Wireframe Protocol | `references/wireframe-protocol.md` | UI touchpoints during planning |
| Task Tracking | `references/task-tracking-adapter.md` | Full lifecycle adapter — Linear, GitHub, or local-only |
| Error Handling | `references/error-handling.md` | Failure categories, per-phase recovery, back-to-planning protocol |
| Linear Integration | `references/linear-integration.md` | Per-phase Linear operations, GitHub setup |
| Linear Commands | `references/linear-commands.md` | Copy-paste linearis CLI commands |
| Token Management | `references/token-management.md` | Budgets, context window, fresh instance spawning |
| Sandboxing | `references/sandboxing-patterns.md` | Git worktrees for parallel agent isolation |
| Test Swarm | `references/test-swarm-architecture.md` | 8-task test pipeline, framework detection, bug triage |
| Configuration | `references/configuration.md` | All config settings and defaults |
| Agent Teams | `references/agent-teams-guide.md` | Claude Code agent teams mechanics |
| Cross-Swarm Handoff | `references/cross-swarm-handoff.md` | Artifact transfer between swarms |
| MemoryStore Interface | `references/memory-store-interface.md` | Memory retrieval/persistence contract (6 methods) |
| MemoryBundle Format | `references/memory-bundle-format.md` | Export/import federation format |
| Wiki Compilation | `references/wiki-compilation-guide.md` | Compiled wiki structure, templates, procedure |
| Onboarding Guide | `references/onboarding-guide.md` | Starter memories, kickoff migration, federation |
| Cross-Cutting Concerns | `references/cross-cutting-concerns.md` | Per-project concern evaluation (documentation default) |

---

## Team Evaluation — When to Spawn vs Solo

**Solo (no team) when:**
- Editing config, markdown, or YAML
- All work is the same skill type
- One agent finishes faster than coordination overhead
- No distinct frontend/backend/test split

**Spawn a team when:**
- Genuinely different skills needed (frontend + backend + tests)
- Substantial parallel implementation work
- TDD methodology (separate tester and developer)
- Story explicitly needs specialized agents

**The test:** If you're about to spawn 6 agents to edit 5 files, stop. Just do it.
