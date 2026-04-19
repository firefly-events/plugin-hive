# Agent Config Schema

Every agent persona file includes a YAML frontmatter block at the top. The frontmatter contains both **official Claude Code plugin fields** (parsed by the runtime) and **Hive-specific fields** (parsed by the orchestrator and team lead).

## Format

YAML frontmatter is delimited by `---` at the top of the agent markdown file:

```markdown
---
# === Official Claude Code fields (parsed by runtime) ===
name: agent-name
description: "Short description of what this agent does and when it's triggered."
model: sonnet
color: green
tools: ["Grep", "Glob", "Read", "Edit", "Write", "Bash"]

# === Hive-specific fields (parsed by orchestrator/team lead) ===
knowledge:
  - path: ~/.claude/hive/memories/agent-name/
    use-when: "Description of when to read/write this knowledge source"
skills:
  - path: ${CLAUDE_PLUGIN_ROOT}/skills/research-brief/SKILL.md
    use-when: "conducting deep codebase or web research"
required_tools:
  - name: firecrawl
    type: mcp
    fallback: "Use WebSearch/WebFetch built-in tools"
domain:
  - path: src/components/**
    read: true
    write: true
    delete: false
---

# Agent Name

You are a...
```

## Official Fields (Claude Code Runtime)

These fields are parsed and used by the Claude Code plugin system.

### name (required)
Kebab-case identifier for the agent. 3-50 characters, lowercase letters, numbers, and hyphens only. Must start and end with alphanumeric.

### description (required)
Describes when Claude should trigger this agent. For Hive agents (spawned by orchestrator, not auto-triggered), a short functional description suffices. For auto-triggered agents, include `<example>` blocks.

### model (required)
Which model the agent runs on.

| Value | Model | Use for |
|-------|-------|---------|
| `opus` | claude-opus-4-6 | Complex reasoning, coordination, architecture, requirements |
| `sonnet` | claude-sonnet-4-6 | Analytical work, implementation, review, test design |
| `haiku` | claude-haiku-4-5 | Fast mechanical execution (running tests, collecting results) |
| `inherit` | Same as parent | When agent should match the spawning session's model |

Must match the agent's tier in `hive.config.yaml` unless `model_overrides` applies.

### color (required)
Visual identifier in the UI. Options: `blue`, `cyan`, `green`, `yellow`, `magenta`, `red`.

Color assignments by role:
- **Red:** Orchestrator, team lead, test sentinel (coordination, gatekeeping)
- **Blue:** Architect, analyst (planning, design)
- **Green:** Developers, test worker (implementation, execution)
- **Yellow:** Tester, reviewer, peer-validator (quality, validation)
- **Cyan:** Researcher, pair-programmer, test-scout (exploration, advisory)
- **Magenta:** UI designer, technical writer (creative, document production)

### tools (optional)
Array of Claude Code tool names the agent can use. Capitalized. If omitted, agent has access to all tools.

```yaml
tools: ["Grep", "Glob", "Read", "Edit", "Write", "Bash"]
```

Common tool sets:
- Read-only: `["Grep", "Glob", "Read"]`
- Implementation: `["Grep", "Glob", "Read", "Edit", "Write", "Bash"]`
- Execution: `["Read", "Bash"]`

## Hive-Specific Fields

These fields are ignored by the Claude Code runtime but parsed by the Hive orchestrator and team lead when spawning agents.

### knowledge (required)
List of knowledge sources the agent should read or write. Each entry has:

- `path`: path to the knowledge source. Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths.
- `use-when`: description of when this knowledge source is relevant. Guides the spawner on when to load it.

The primary knowledge source for every agent is its memory directory:
```yaml
knowledge:
  - path: ~/.claude/hive/memories/{agent-name}/
    use-when: "Read past insights, patterns, and pitfalls before starting work. Write insights when encountering reusable patterns or lessons learned."
```

Additional knowledge sources can include project docs, reference materials, or shared team knowledge.

### skills (optional)
Skills this agent can use. The team lead or orchestrator injects the skill content when the trigger condition matches.

```yaml
skills:
  - path: ${CLAUDE_PLUGIN_ROOT}/skills/research-brief/SKILL.md
    use-when: "conducting deep codebase or web research"
```

- `path`: path to the skill file. Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths.
- `use-when`: one-line description of when this skill applies. The team lead evaluates this against the current task.

### tools (required)
List of Claude Code tools this agent is allowed to use. Keep this minimal — agents should only have the tools they need.

Common tool sets:
- **Research agents**: `grep`, `glob`, `read`, `bash` (read-only commands)
- **Developer agents**: `grep`, `glob`, `read`, `edit`, `write`, `bash`
- **Review agents**: `grep`, `glob`, `read`
- **Orchestrator**: `grep`, `glob`, `ls`, `read`

### required_tools (optional)
External tools (MCP servers or CLI tools) this agent needs beyond the built-in Claude Code tools. The spawner validates availability before spawning.

```yaml
required_tools:
  - name: cli-anything-frame-zero
    type: cli
    fallback: "Produce text-based layout specs instead of .f0 files"
  - name: firecrawl
    type: mcp
    fallback: "Use WebSearch/WebFetch built-in tools"
```

- `name`: tool identifier (CLI command name or MCP server name).
- `type`: `cli` or `mcp`.
- `fallback`: what the agent should do if the tool is unavailable. If no fallback, the spawn is blocked.

### domain (required)
File path patterns controlling where this agent can read, write, and delete. Each entry specifies a path glob and permissions.

```yaml
domain:
  - path: src/components/**
    read: true
    write: true
    delete: false
  - path: src/api/**
    read: true
    write: false
    delete: false
  - path: .
    read: true
    write: false
    delete: false
```

- `path`: glob pattern for files/directories.
- `read`: whether the agent can read files matching this pattern.
- `write`: whether the agent can modify or create files matching this pattern.
- `delete`: whether the agent can delete files matching this pattern.
- Enforcement is by the team lead (post-step validation) and reviewer (code review checklist).
- Team config can override agent-level domains for project-specific scoping.
- More specific paths take precedence over less specific ones.
- A catch-all `path: .` entry with `read: true, write: false, delete: false` gives read-everywhere as a safe default.

## What Goes in Frontmatter vs Agent Body

| In Frontmatter | In Agent Body |
|----------------|---------------|
| name, model_tier | Identity ("You are a...") |
| knowledge sources | Areas of expertise |
| domain restrictions | How you work (behavioral guidance) |
| skills list | Quality standards |
| tools, required_tools | Output format |
| | Scope discipline rules |

**Rule of thumb:** if the orchestrator/team lead needs it to spawn or validate the agent, it's frontmatter. If the agent needs it to do its job well, it's body.

## Interaction with hive.config.yaml

`hive.config.yaml` defines project-level defaults:
- `model_tiers`: default tier assignments for all agents
- `model_overrides`: per-agent overrides (takes precedence over agent frontmatter)

Agent frontmatter `model_tier` must match `hive.config.yaml` tiers. If `model_overrides` exists for an agent, the override wins at spawn time.

## Interaction with Team Config

Team configs (at `.pHive/teams/{team-name}.yaml`) can override agent-level domains for project-specific scoping:

```yaml
# In team config
members:
  - agent: frontend-developer
    domain:
      - path: src/app/**
        read: true
        write: true
        delete: false
```

Precedence: team config domain > agent frontmatter domain > default.
