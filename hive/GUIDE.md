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
   │  User short-lists today's work
   │  Orchestrator runs compressed planning (analyst, architect, ui-designer if needed)
   │  Agent-ready checklist validates stories
   │  User approves plan
   │
3. EXECUTION
   │  Orchestrator kicks off dev team(s)
   │  One team at a time (sequential across epics)
   │  Status markers track progress
   │  Gate retry with feedback on failures
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
Planning Swarm ──→ Dev Swarm ──→ Test Swarm
  (analyst,          (researcher,     (scout, architect,
   architect,         developer,       worker, inspector,
   ui-designer)       tester,          sentinel)
                      reviewer)
       │                  │                  │
       ▼                  ▼                  ▼
  Stories with       Implemented,       Test results,
  wireframes         tested code        bug tickets,
  + cycle state      + cycle state      session report
```

---

## Agent Roster (16 Personas)

Personas are a bench — pull who you need. Having a persona doesn't mean you must use it.

### Model Tier Routing

Match the model to the job — not every agent needs Opus.

| Tier | Model | Agents | Cost |
|------|-------|--------|------|
| **Opus** | claude-opus-4-6 | orchestrator, team-lead, architect, analyst | Highest — complex reasoning |
| **Sonnet** | claude-sonnet-4-6 | researcher, developer, tester, reviewer, pair-programmer, peer-validator, ui-designer, test-scout, test-architect, test-inspector, test-sentinel | Medium — analytical/implementation |
| **Haiku** | claude-haiku-4-5 | test-worker | Lowest — fast mechanical execution |

Configure in `hive.config.yaml`. Override per-agent with `model_overrides` for complex projects.

### Planning Agents
| Agent | File | Role | Tier |
|-------|------|------|------|
| **Analyst** | `agents/analyst.md` | Requirements decomposition, gap analysis, prioritization, success metrics | Opus |
| **Architect** | `agents/architect.md` | System design, technology evaluation, API design, scalability | Opus |
| **UI Designer** | `agents/ui-designer.md` | Wireframes (Frame0), design briefs, marketing materials | Sonnet |

### Development Agents
| Agent | File | Role |
|-------|------|------|
| **Researcher** | `agents/researcher.md` | Codebase exploration, pattern analysis, research briefs, web research |
| **Developer** | `agents/developer.md` | Implementation — translates specs into code |
| **Tester** | `agents/tester.md` | TDD (tests first) or Classic (tests after) modes |
| **Reviewer** | `agents/reviewer.md` | Code review — correctness, security, conventions, performance |
| **Pair Programmer** | `agents/pair-programmer.md` | Sidecar to developer — challenges assumptions, flags risks |

### Test Swarm Agents
| Agent | File | Role |
|-------|------|------|
| **Test Scout** | `agents/test-scout.md` | Context gathering, baseline management, discovery passes |
| **Test Architect** | `agents/test-architect.md` | Test authoring with framework detection |
| **Test Worker** | `agents/test-worker.md` | Test execution across platforms in parallel |
| **Test Inspector** | `agents/test-inspector.md` | Coverage validation against requirements |
| **Test Sentinel** | `agents/test-sentinel.md` | Bug triage, severity classification, adaptive auto-routing |

### Coordination Agents
| Agent | File | Role |
|-------|------|------|
| **Orchestrator** | `agents/orchestrator.md` | Main session guidance — coordinates across epics and teams |
| **Team Lead** | `agents/team-lead.md` | Per-team coordinator — staffs team, manages story execution |
| **Peer Validator** | `agents/peer-validator.md` | Cross-team validation — consistency, convention enforcement |

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
| **Classic** | `workflows/development.classic.workflow.yaml` | research → implement → test → review → optimize → integrate |
| **TDD** | `workflows/development.tdd.workflow.yaml` | research → test-spec → implement → review → optimize → integrate |
| **BDD** | `workflows/development.bdd.workflow.yaml` | research → behavior-spec → implement → test → review → optimize → integrate |

### Other Workflows
| Workflow | File | Purpose |
|----------|------|---------|
| **Code Review** | `workflows/code-review.workflow.yaml` | analyze → review → summarize |
| **Test Swarm** | `workflows/test-swarm.workflow.yaml` | 8-task pipeline: context → baseline → author → validate → execute → bugs → report |
| **Daily Ceremony** | `workflows/daily-ceremony.workflow.yaml` | standup → planning → execution |

Select development methodology: `/hive:execute {epic} --methodology tdd`

---

## Swarm Types

### Planning Swarm
**When:** `/hive:plan` or during daily ceremony planning phase
**Agents:** analyst, architect, ui-designer (if UI work detected)
**Output:** Epic with dependency-tracked stories, wireframes embedded in story specs
**Key feature:** UI step detection — auto-detects stories needing wireframes

### Development Swarm
**When:** `/hive:execute {epic}`
**Agents:** researcher, developer, tester, reviewer, pair-programmer (optional)
**Output:** Implemented, tested, reviewed code
**Key feature:** Gate retry with feedback — failures get injected back for retry

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
| Epic definitions | `state/epics/{epic-id}/epic.yaml` | Epic index with story list |
| Story specs | `state/epics/{epic-id}/stories/{story-id}.yaml` | Self-contained story definitions |
| Status markers | `state/episodes/{epic-id}/{story-id}/{step-id}.yaml` | Lightweight progress tracking (4 fields) |
| Cycle state | `state/cycle-state/{epic-id}.yaml` | Accumulated decisions across phases |
| Staged insights | `state/insights/{epic-id}/{story-id}/` | Insights pending session-end evaluation |
| Agent memories | `skills/hive/agents/memories/{agent}/` | Promoted insights that persist across sessions |
| Test baselines | `state/test-baseline/{project}/` | Project test knowledge |
| Handoffs | `state/handoffs/{handoff-id}.yaml` | Cross-swarm artifact transfers |

---

## Agent Memory System

Agents accumulate memories across sessions — patterns, pitfalls, codebase understanding.

### Flow
```
Agent executes step
  → encounters something non-obvious
  → writes insight to state/insights/ staging
  → session ends
  → orchestrator evaluates: promote or discard?
  → promoted insights → agents/memories/{agent}/
  → next session: team lead loads relevant memories for assigned agents
```

### What Gets Kept
- Repeatable patterns ("do this in similar contexts")
- Pitfall warnings ("don't do X because Y")
- Override insights (supersede existing memory)
- Codebase-specific understanding

### What Gets Discarded
- One-off execution details
- Ephemeral context
- Already captured in existing memories
- Derivable from reading current code

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
- All tracking via status markers (`state/episodes/`) and cycle state (`state/cycle-state/`)
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
| Agent-Ready Checklist | `references/agent-ready-checklist.md` | 8-point story validation before execution |
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
