# Contributing to Plugin Hive

Thank you for your interest in contributing to Plugin Hive. This document explains how collaboration works, what you can contribute, and the conventions we follow.

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.

---

## How Contributing Works: Issue-First Model

Plugin Hive uses an **issue-first, vetting-required** model. We do not accept unsolicited pull requests.

### The Process

1. **Open an issue** describing the bug, improvement, or new capability you want to address.
2. **Indicate collaboration interest** — the issue template includes a yes/no question: "Do you want to work on this yourself?" If yes, briefly describe your approach.
3. **Wait for maintainer response** — the maintainer reviews the proposal and your background. Access is not automatic.
4. **Receive access** — if vetted, you'll be granted collaborator access and assigned the issue.
5. **Implement on a feature branch** using the conventions below.
6. **Open a pull request** referencing the issue.

> **Why this model?** Plugin Hive is an opinionated framework where agents, workflows, and protocols have carefully designed interdependencies. Vetting ensures contributors understand the architecture before touching core components.

---

## What You Can Contribute

### Agents (Persona Files)

Each agent is a markdown file with YAML frontmatter in `hive/agents/`.

**Minimum structure:**

```markdown
---
name: agent-name
description: "Short description — when this agent is triggered."
model: sonnet
color: green
tools: ["Grep", "Glob", "Read", "Edit", "Write", "Bash"]

knowledge:
  - path: ~/.claude/hive/memories/agent-name/
    use-when: "Read past insights before starting. Write insights when encountering reusable patterns."

domain:
  - path: .
    read: true
    write: false
    delete: false
---

# Agent Name

You are a...
```

**Guidelines:**
- Name: kebab-case, 3–50 characters, start/end with alphanumeric
- Model: use `sonnet` minimum — `haiku` is too small for Hive agents
- Color by role: `red` = orchestrator/lead, `blue` = architect/analyst, `green` = developer/worker, `yellow` = reviewer/tester, `cyan` = researcher, `magenta` = writer/designer
- Create a matching memory directory: `hive/agents/{name}/` (can be empty)
- Add the agent to `hive/agents/` and reference it in `hive/roster.md` if appropriate

See `hive/references/agent-config-schema.md` for the full field reference.

---

### Skills (SKILL.md Files)

Skills are instruction files that extend an agent's capabilities for a specific task. They live in `hive/skills/{skill-name}/SKILL.md`.

**Structure:**
```
hive/skills/your-skill/
  SKILL.md          # The skill instructions
  README.md         # Optional: usage notes
```

**Guidelines:**
- Skills should be reusable across agents — avoid encoding agent-specific assumptions
- The `SKILL.md` content is injected into the agent's context at invocation time
- Document the trigger condition: when should this skill be used?
- Keep skills focused — one skill, one concern

---

### Workflows (YAML Files)

Workflows define sequences of agent steps with dependencies and data flow. They live in `hive/workflows/`.

**Minimum structure:**

```yaml
name: workflow-name
description: What this workflow does
version: "1.0.0"
methodology: classic  # classic | tdd | bdd | fdd

steps:
  - id: step-name
    agent: researcher
    task: >
      What the agent should do.
    depends_on: []
```

**Guidelines:**
- Steps without `depends_on` can run in parallel — be explicit about dependencies
- Use `step_file` for complex steps that need detailed instructions
- Step files live at `hive/workflows/steps/{workflow-name}/step-{NN}-{kebab-name}.md`
- Avoid circular dependencies

See `hive/references/workflow-schema.md` for the full field reference.

---

### Teams (Team Configs)

Team configs define reusable agent compositions. They live in `.pHive/teams/{team-name}.yaml` in the consuming project (not the plugin itself), but you can contribute example team configs to `hive/examples/teams/`.

**Minimum structure:**

```yaml
name: team-name
description: What this team does
lead: team-lead
methodology: classic

members:
  - agent: developer
    role: Implementation
    domain:
      - path: src/**
        read: true
        write: true
        delete: false

team_memory_path: .pHive/team-memories/team-name/
```

See `hive/references/team-config-schema.md` for the full field reference.

---

## Branch Conventions

```
{type}/{scope}-{short-description}
```

| Type | Use for |
|------|---------|
| `feat` | New agents, skills, workflows, or capabilities |
| `fix` | Bug fixes |
| `docs` | Documentation only |
| `refactor` | Restructuring without behavior change |
| `chore` | Maintenance, dependency updates |

Examples:
- `feat/hive-memory-redesign`
- `fix/orchestrator-retry-loop`
- `docs/agent-config-schema`

---

## Commit Message Format

```
type(scope): short description

Optional longer body explaining why, not what.

Co-Authored-By: Your Name <email>
```

- Type: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`
- Scope: component name (e.g., `hive`, `oss`, `kickoff`, `meta-team`)
- Description: lowercase, imperative, no period
- Body: explain motivation and context, not the diff

---

## Apache 2.0 Patent Grant

Plugin Hive is licensed under the [Apache License 2.0](LICENSE). By contributing, you:

- Grant the project a **perpetual, worldwide, non-exclusive, royalty-free patent license** to make, use, sell, and distribute your contribution and derivative works
- Confirm that you have the right to submit your contribution under this license

This patent grant applies to any patents you hold that are necessarily infringed by your contribution. If you work for a company, ensure you have the right to assign this grant.

For more details, see [Section 5 of the Apache 2.0 License](LICENSE) or the [Apache Foundation's contributor FAQ](https://www.apache.org/legal/resolved.html).

---

## Questions

Open an issue with the `question` label. We read them.
