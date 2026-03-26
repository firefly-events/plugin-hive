# Agent Memory Schema

Agent memories are persistent, per-agent files that capture reusable insights across sessions. They make agents better at future tasks by carrying forward patterns, pitfalls, and codebase understanding.

## Storage

```
skills/hive/agents/memories/{agent-name}/{slug}.md
```

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
```

Staged insights are evaluated at session end (see Session-End Evaluation below).

## When to Capture Insights

Agents should note an insight when they encounter:

- "This approach worked — I should do it again in similar contexts" → `pattern`
- "This failed because X — avoid in the future" → `pitfall`
- "This contradicts what I previously knew" → `override`
- "This codebase does X in a non-obvious way" → `codebase`

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
   - Check against existing memories in `agents/memories/{agent}/` for duplicates
   - If `override` type: find and update the existing memory it supersedes
   - If new and meets criteria: promote to `agents/memories/{agent}/{slug}.md`
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

When an agent persona comes off the bench for a task:

1. Team lead reads `skills/hive/agents/memories/{agent}/` for all memory files
2. Reads each memory's `description` field
3. Filters for relevance to the current story (keyword match: memory descriptions vs story description/context)
4. Includes relevant memories in the agent's task prompt alongside the persona and step instructions

Not all memories load into every task. The team lead filters for relevance.

## Roster Memory Paths

| Agent | Memory Path |
|-------|-------------|
| researcher | `agents/memories/researcher/` |
| developer | `agents/memories/developer/` |
| tester | `agents/memories/tester/` |
| reviewer | `agents/memories/reviewer/` |
| architect | `agents/memories/architect/` |
| analyst | `agents/memories/analyst/` |
| orchestrator | `agents/memories/orchestrator/` |
| ui-designer | `agents/memories/ui-designer/` |
| team-lead | `agents/memories/team-lead/` |
| pair-programmer | `agents/memories/pair-programmer/` |
| peer-validator | `agents/memories/peer-validator/` |
