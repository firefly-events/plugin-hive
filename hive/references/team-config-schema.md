# Team Config Schema

Team configs give teams permanence. Instead of the orchestrator deciding team composition from scratch each time, team configs define reusable, editable team compositions that can be re-summoned across epics.

## Storage

```
state/teams/{team-name}.yaml
```

Team configs are project-scoped — they live in `state/` alongside other project-specific data. Different projects get different team compositions based on their structure and needs.

## Lifecycle

1. **Generated** during kickoff or planning — discovery identifies project structure (frontend, backend, infra, etc.) and matches it to roster capabilities
2. **Reviewed** by the user — the config is human-readable YAML, users can adjust before execution
3. **Loaded** by the orchestrator when assigning stories — instead of evaluating from scratch, load the team config
4. **Read** by the team lead for staffing decisions — the config tells the lead who to pull
5. **Evolved** over time — users edit configs as the project grows, new agents join, domains shift

## Format

```yaml
name: fullstack-team
description: Full-stack development team for the project
lead: team-lead
methodology: classic  # from hive.config.yaml → execution.default_methodology

members:
  - agent: frontend-developer
    role: UI implementation
    tool_access: [frame0]  # only if Frame0 detected
    domain:
      - path: src/components/**
        read: true
        write: true
        delete: false
      - path: src/styles/**
        read: true
        write: true
        delete: false

  - agent: backend-developer
    role: API and server logic
    domain:
      - path: src/api/**
        read: true
        write: true
        delete: false
      - path: src/services/**
        read: true
        write: true
        delete: false

  - agent: tester
    role: Test authoring and execution
    tool_access: [maestro]  # only if Maestro detected
    domain:
      - path: tests/**
        read: true
        write: true
        delete: false
      - path: "**/*.test.*"
        read: true
        write: true
        delete: false

  - agent: reviewer
    role: Code review
    tool_access: [codex]  # only if Codex detected
    # reviewer has no domain override — uses agent default (read-only everywhere)

context:
  tech_stack:
    frontend: react-native
    backend: go
    database: postgresql
  lint_commands:
    - "npx eslint ."
  commit_granularity: medium
  pr_style: squash-merge
  review_depth: thorough
  notes: |
    Generated from project discovery.
    Add project-specific notes here (frameworks, conventions, etc.).

team_memory_path: state/team-memories/fullstack-team/
```

## Fields

### name (required)
Kebab-case team identifier. Used for the config filename and team memory directory.

### description (required)
Human-readable description of the team's purpose and scope.

### lead (required)
Agent name for the team lead. Usually `team-lead` but could be any agent with coordination capabilities.

### methodology (optional)
Preferred workflow methodology for this team: `classic`, `tdd`, or `bdd`. If omitted, uses the project default from `hive.config.yaml`.

### members (required)
List of agents on the team. Each member has:

- `agent` (required): roster agent name (must exist in `hive/agents/`)
- `role` (required): one-line description of this agent's role on the team
- `domain` (optional): project-specific domain overrides. If present, these override the agent's default domain from its frontmatter. If absent, the agent uses its own default domain.
- `tool_access` (optional): list of integration tools this agent can use (e.g., `[maestro]`, `[frame0]`). Only populated for integrations detected during kickoff. Agents should not reference tools not in this list.

### context (optional)
Project-specific context that helps agents understand the codebase:

- `tech_stack`: key technology choices (frontend framework, backend language, database, etc.)
- `lint_commands`: list of lint commands from discovered linters (e.g., `["npx eslint .", "ruff check ."]`). Populated from `project-profile.yaml → code_quality.linters[].lint_command`. Code agents use these to validate changes before submitting.
- `commit_granularity`: developer preference for commit size (`fine`, `medium`, `coarse`). From `hive.config.yaml → developer.commit_granularity`.
- `pr_style`: developer preference for PR structure (`single-commit`, `squash-merge`, `atomic-prs`, `bundled`). From `hive.config.yaml → developer.pr_style`. Relevant for reviewer agents.
- `review_depth`: developer preference for review thoroughness (`thorough`, `standard`, `light`). From `hive.config.yaml → developer.review_depth`. Relevant for reviewer agents.
- `notes`: free-form text with project-specific information

### team_memory_path (required)
Path to the team's memory directory: `state/team-memories/{team-name}/`

## Domain Precedence

When a team config specifies a domain for a member, it overrides the agent's frontmatter domain:

```
team config domain > agent frontmatter domain > default (allow all)
```

This lets the same agent have different domains in different teams or projects. A `backend-developer` might have write access to `src/api/` in one project and `pkg/` in another.

## How the Orchestrator Uses Team Configs

When the orchestrator receives an epic for execution:

1. Check `state/teams/` for team configs
2. If configs exist: evaluate which team matches the epic's scope
3. Load the team config and pass it to the team lead alongside the story
4. The team lead uses the config for staffing instead of evaluating from scratch

If no team configs exist (new project, pre-kickoff), the orchestrator falls back to the current behavior: evaluate complexity and staff ad-hoc per the orchestrator persona's team evaluation criteria.

## How the Team Lead Uses Team Configs

When a team lead receives a story:

1. Read the team config passed by the orchestrator
2. Use `members` to know who's available and what their roles/domains are
3. Use `context` to understand the project's tech stack and conventions
4. Load team memories from `team_memory_path`
5. Staff based on the config — don't re-evaluate from scratch unless the story requires someone not on the team

## Generating Team Configs

During kickoff or planning, the orchestrator generates team configs based on project discovery:

1. Identify project domains from codebase structure (frontend dir, backend dir, test dir, etc.)
2. Match domains to roster agents (frontend dir → frontend-developer, etc.)
3. Generate domain restrictions based on the actual directory structure
4. Set tech_stack from discovered technologies
5. Write the config to `state/teams/{team-name}.yaml`
6. Present to the user for review before execution

Multiple teams can be generated for large projects (e.g., `api-team`, `mobile-team`, `infra-team`).

## Example Configs

### API-only team
```yaml
name: api-team
description: Backend API team — no frontend work
lead: team-lead
methodology: tdd
members:
  - agent: backend-developer
    role: API implementation
    domain:
      - path: src/api/**
        read: true
        write: true
        delete: false
  - agent: tester
    role: API test authoring
  - agent: reviewer
    role: Code review
context:
  tech_stack:
    backend: go
    database: postgresql
team_memory_path: state/team-memories/api-team/
```

### Documentation team
```yaml
name: docs-team
description: Documentation and specification writing
lead: team-lead
members:
  - agent: researcher
    role: Gather context and references
  - agent: technical-writer
    role: Write formatted documents
  - agent: reviewer
    role: Review for accuracy and completeness
context:
  notes: No code changes — documentation only
team_memory_path: state/team-memories/docs-team/
```
