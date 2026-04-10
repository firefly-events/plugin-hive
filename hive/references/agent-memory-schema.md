# Agent Memory Schema

Agent memories are persistent, per-agent files that capture reusable insights across sessions. They make agents better at future tasks by carrying forward patterns, pitfalls, and codebase understanding.

## Two-Tier Storage Model

### System-level: Agent memories (cross-project)

```
~/.claude/hive/memories/{agent-name}/{slug}.md
```

Agent memories live at the system level — outside any project directory. A backend developer working on Go Project A and Python Project B accumulates cross-project expertise. These memories span projects and build real depth over time.

- **Location:** `~/.claude/hive/memories/{agent-name}/`
- **Scope:** all projects, all sessions
- **Written by:** session-end insight promotion
- **Read by:** orchestrator, team lead, agent-spawn skill at spawn time
- **Bootstrapped by:** kickoff protocol creates directories if they don't exist

### Project-level: Team memories (project-scoped)

```
state/team-memories/{team-name}/{slug}.md
```

Team memories are scoped to the current project. They capture collective patterns specific to THIS codebase and THIS team composition. They do not travel to other projects.

- **Location:** `state/team-memories/{team-name}/`
- **Scope:** current project only
- **Written by:** team leads during execution
- **Read by:** team leads when assembling the same team
- **Bootstrapped by:** kickoff protocol creates `state/team-memories/`

### Migration from old path

The old path (`skills/hive/agents/memories/{agent}/`) shipped with the plugin as bootstrap templates.

Migration is **per-agent and idempotent** — it runs on every kickoff, not just the first:

1. For each agent in the roster:
   a. Check if `skills/hive/agents/memories/{agent}/` contains any `.md` files (beyond `.gitkeep`)
   b. For each `.md` file found, check if a file with the same name already exists at `~/.claude/hive/memories/{agent}/`
   c. If the file does NOT exist at the system path: copy it and log `MIGRATED: {agent}/{file}`
   d. If the file already exists at the system path: skip it and log `SKIPPED (already exists): {agent}/{file}`
2. Always create `~/.claude/hive/memories/{agent}/` directories if missing (even when no migration is needed)
3. After migration, log a summary: `Migrated: N files, Skipped: M files`

This ensures:
- New projects with existing repo-local memories get them migrated even if `~/.claude/hive/memories/` already exists from another project
- Previously migrated files are not overwritten (system-level memories may have been updated since migration)
- The migration log is observable so users can audit what happened

Each agent on the roster has their own memory directory. Memories are markdown files with YAML frontmatter.

## Memory File Format

```markdown
---
name: Short descriptive title
description: One-line summary for relevance matching during story ingestion
type: pattern | pitfall | override | codebase
agent: developer
timestamp: 2026-03-25
source_epic: hive-phase5
last_verified: 2026-03-25      # date agent last confirmed accuracy (YYYY-MM-DD, optional)
ttl_days: 90                   # time-to-live in days; null/omitted = no expiry (optional)
source: agent                  # 'agent' (default) | 'imported' (optional)
imported_from: ""              # label for import origin, e.g. "team-alpha-export" (optional)
---

Detail of the insight and how to apply it in future work. Be specific —
name files, patterns, commands, or approaches. Include enough context that
the agent reading this in a future session understands both WHAT and WHY.
```

## Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| `pattern` | Repeatable approach that worked | "When porting blueprints, map capabilities to 'What you do' and quality_standards to 'Quality standards' sections" |
| `pitfall` | Lesson learned — avoid this | "Don't spawn 6 agents for markdown-editing tasks. Coordination overhead exceeds the work." |
| `override` | Supersedes an existing memory | "Previous memory said X, but actually Y. Updated because..." |
| `codebase` | Project-specific understanding | "This project uses .f0 files (UTF-8 JSON) for wireframes. Frame0 CLI has offline and live modes." |
| `reference` | Curated knowledge list with appendable entries and external docs | "Go Concurrency Patterns — accumulated channel patterns, context propagation rules, and links to official docs" |

## TTL Defaults

Default `ttl_days` values per memory type. These are starting recommendations — users can override per-memory.

| Type | Default ttl_days | Rationale |
|------|-----------------|-----------|
| `pattern` | 90 | Patterns may become outdated as codebases evolve |
| `pitfall` | 180 | Pitfalls are more durable — the underlying causes persist longer |
| `codebase` | 60 | Codebases change frequently; stale codebase insights are actively misleading |
| `override` | no expiry | Overrides are explicit corrections that remain valid until superseded |
| `reference` | no expiry | Living documents with their own `last_updated` timestamp |

Enforcement: TTL is surfaced as a staleness warning during memory loading (see wiki-retrieval). Memories past their TTL are flagged with `⚠ last verified: N days ago` — they are not auto-deleted.

## Reference Memories

Reference memories are a special type: living documents that accumulate knowledge over time rather than capturing a single insight. They are **appendable** — new entries are added, never auto-removed.

Reference memories have **append semantics** — new information is added to the existing file, not replacing it. The compiled wiki (see memory-store-interface) treats reference memories as living documents: when compiling topic articles, reference content is appended to existing topic sections rather than regenerating them.

### Reference memory format

```markdown
---
name: Go Concurrency Patterns
description: Accumulated patterns and references for Go concurrency
type: reference
agent: backend-developer
topic: go-concurrency
created: 2026-03-15
last_updated: 2026-03-28
---

## Entries

- **Channel direction pattern** (2026-03-15, source: my-project)
  Use directional channels in function signatures to enforce send/receive intent.
  Observed in `pkg/events/broadcaster.go`.

- **Context cancellation propagation** (2026-03-28, source: my-project)
  Always propagate parent context to goroutines. Found missing in worker pool —
  caused leaked goroutines under load.

## Sources

- [Go Concurrency Patterns](https://go.dev/blog/pipelines) — official blog
- `internal/docs/concurrency-guidelines.md` — team ADR
- [errgroup package](https://pkg.go.dev/golang.org/x/sync/errgroup) — stdlib extension
```

### When to create vs append

During session-end evaluation, when a new insight matches an existing reference memory's `topic`:
- **Append** a new entry to the `## Entries` section with date and source
- **Add** any new external sources to `## Sources`
- **Update** the `last_updated` timestamp in frontmatter

Create a new reference memory when:
- The insight covers a topic not represented by any existing reference
- The topic is broad enough to accumulate future entries (not a one-off)
- The agent will likely encounter this topic across multiple projects

### Loading priority

Reference memories load with higher priority than other types — they represent accumulated expertise on a topic. When filtering by relevance, `reference` type memories that match by topic keyword should always be included (up to the 5-memory cap).

## Keep Criteria (what gets promoted)

Promote an insight to permanent memory when it is:

- **A repeatable pattern** — an approach that worked and should be applied again in similar contexts
- **An override** — a finding that contradicts or supersedes an existing memory (update the existing memory, don't duplicate)
- **A pitfall warning** — a lesson learned from failure that prevents the same mistake in the future
- **Codebase-specific understanding** — architectural context, conventions, or constraints that help frame future work in this project

## Discard Criteria (what gets thrown away)

Discard when the insight is:

- **One-off execution detail** — "step completed", "files modified" (this is what status markers are for)
- **Only relevant to the immediate next step** — ephemeral context passed via prompts
- **Already captured** in an existing memory
- **Derivable** from reading the current code, config, or git history
- **Secrets, credentials, or PII** — API keys, auth tokens, passwords, private keys, or personally identifiable information (names, emails, phone numbers of real people). Memory files are plaintext on disk and may be exported/shared across users.

## Insight Staging

During execution, agents write insights to a staging area before promotion:

```
state/insights/{epic-id}/{story-id}/{agent}-{slug}.yaml
```

### Staged Insight Format

```yaml
agent: developer
type: pitfall
summary: "One-line description"
detail: |
  Full explanation of what was found and why it matters for future work.
scope: codebase | universal
related_files:
  - path/to/relevant/file

# Additional fields for reference type only:
topic: null          # kebab-case topic identifier (e.g., "go-concurrency")
sources: []          # external URLs or doc paths to include in ## Sources
append_to: null      # slug of existing reference memory to append to, if known
```

- `topic`, `sources`, and `append_to` are only used when `type: reference`
- For all other types, these fields are omitted or null
- `append_to` is optional — session-end evaluation can match by `topic` keyword if not specified

Staged insights are evaluated at session end (see Session-End Evaluation below).

## When to Capture Insights

Agents should note an insight when they encounter:

- "This approach worked — I should do it again in similar contexts" → `pattern`
- "This failed because X — avoid in the future" → `pitfall`
- "This contradicts what I previously knew" → `override`
- "This codebase does X in a non-obvious way" → `codebase`
- "I keep finding useful information about this topic across sessions" → `reference`

Agents should NOT capture:
- Routine step completion
- Expected behavior
- Information derivable from reading the code

**Most steps produce zero insights.** That's normal and correct.

## Session-End Evaluation

After epic execution (or at session end), the orchestrator evaluates staged insights:

1. Scan `state/insights/` for staged files
2. For each insight:
   - Check type against keep criteria
   - Check against existing memories in `~/.claude/hive/memories/{agent}/` for duplicates
   - If `override` type: find and update the existing memory it supersedes
   - If new and meets criteria: promote to `~/.claude/hive/memories/{agent}/{slug}.md`
   - If doesn't meet criteria: discard (delete from staging)
3. Clean up: remove the `state/insights/{epic-id}/` staging directory

### Promotion

Convert staged YAML to memory markdown:

```markdown
---
name: {summary}
description: {summary for relevance matching}
type: {type}
agent: {agent}
timestamp: {today}
source_epic: {epic-id}
---

{detail from staged insight}
```

### Borderline Cases

For insights where keep/discard isn't obvious, the orchestrator may present them to the user for a decision. But most should be auto-evaluated based on the criteria above.

## Memory Loading

Memory loading is mandatory at every spawn point. Skipping it is the most common memory system failure.

### Loading procedure

When an agent persona comes off the bench for a task:

1. Read the agent's `knowledge` paths from its frontmatter
2. Scan the memory directory for all `.md` files
3. Read each memory's frontmatter `description` field
4. Filter for relevance to the current story (keyword match: memory descriptions vs story description/context)
5. Load the full content of relevant memories
6. Include relevant memories in the agent's task prompt as a "Prior Knowledge" section, after the persona and before the task instructions

### Where loading happens

| Point | Who loads | What's loaded |
|-------|-----------|---------------|
| Session start | Orchestrator | Own memories from `agents/memories/orchestrator/` |
| Ceremony step 2 | Orchestrator | All agent memories, pre-filtered into a per-agent index |
| Agent spawn (via agent-spawn skill) | Spawner | Target agent's memories from its `knowledge` paths |
| Team lead activation | Team lead | Memories for each agent it plans to spawn |

### Injection format

Include memories in the agent's prompt like this:

```
## Prior Knowledge

The following insights are from your memory — patterns and lessons from prior sessions:

### [memory-name] (type: pattern, from: epic-id)
[full memory content]

### [memory-name] (type: pitfall, from: epic-id)
[full memory content]
```

### Relevance filtering

Not all memories load into every task. Filter by:
- **Keyword match:** memory `description` vs story `description` and `context` fields
- **Type priority:** `override` and `pitfall` types always load (they correct behavior); `pattern` and `codebase` load when keywords match
- **Recency:** prefer recent memories when many match (check `timestamp` field)
- **Cap:** inject at most 5 memories per agent to avoid context bloat

## Roster Memory Paths

| Agent | Memory Path |
|-------|-------------|
| researcher | `~/.claude/hive/memories/researcher/` |
| technical-writer | `~/.claude/hive/memories/technical-writer/` |
| frontend-developer | `~/.claude/hive/memories/frontend-developer/` |
| backend-developer | `~/.claude/hive/memories/backend-developer/` |
| tester | `~/.claude/hive/memories/tester/` |
| reviewer | `~/.claude/hive/memories/reviewer/` |
| architect | `~/.claude/hive/memories/architect/` |
| analyst | `~/.claude/hive/memories/analyst/` |
| orchestrator | `~/.claude/hive/memories/orchestrator/` |
| ui-designer | `~/.claude/hive/memories/ui-designer/` |
| team-lead | `~/.claude/hive/memories/team-lead/` |
| pair-programmer | `~/.claude/hive/memories/pair-programmer/` |
| peer-validator | `~/.claude/hive/memories/peer-validator/` |
| tpm | `~/.claude/hive/memories/tpm/` |

## Team Collective Memories

Team memories capture collective patterns specific to a project and team composition. They are distinct from agent memories: agent memories travel across projects (cross-project expertise), team memories stay with the project (project-specific collective knowledge).

### Storage

```
state/team-memories/{team-name}/{slug}.md
```

### When it's a team memory vs agent memory

- **Agent memory:** One agent could have learned this working alone. Example: "Go channels need direction annotations." Travels to the next project.
- **Team memory:** Required multiple agents coordinating to discover. Example: "The frontend-backend handoff on this project needs X auth flow for mutations." Stays with this project.

### Team memory format

```markdown
---
name: API mutation auth flow
description: Mutations require re-auth token refresh before the request
type: convention
team: fullstack-team
timestamp: 2026-03-28
source_epic: my-epic
---

The event mutation endpoints (POST/PUT/DELETE on /api/events/*) require a fresh
auth token. The frontend must call refreshToken() before any mutation request.
This was discovered when batch updates silently failed with 401s — the token
had expired mid-session but GET requests were cached and appeared to work.
```

### Team memory types

| Type | Purpose | Example |
|------|---------|---------|
| `convention` | Project-specific team agreement | "We use X pattern for API error responses in this codebase" |
| `handoff-pattern` | Cross-agent coordination pattern | "Frontend sends X format to backend; backend expects Y" |
| `tooling` | Project-specific tooling knowledge | "This project's test suite requires Redis running locally" |
| `process` | Team workflow adjustment | "Splitting stories by API boundary works better than by feature for this codebase" |

### Who reads and writes team memories

- **Written by:** Team leads only. Individual agents capture agent-level insights. Team-level patterns emerge from the team lead's coordination perspective.
- **Read by:** Team leads when assembling teams for work on this project.
- **Organized by:** team config name, not by epic. Teams can be re-summoned, and their memories persist across epics within the same project.

### Loading team memories

Team leads load team memories during activation, alongside agent memories:

1. Check for `state/team-memories/{team-name}/` matching the team's config
2. Scan for `.md` files
3. Load all team memories (no relevance filtering — they're already project-scoped)
4. Include in the team lead's context as "Team Knowledge" section
