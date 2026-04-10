# Domain Access Control

Domain restrictions control which files each agent can modify. This is a trust-but-verify enforcement model — agents are told their boundaries, and the team lead and reviewer validate compliance.

## How Domains Work

### Declaration

Domains are declared in two places:

1. **Agent frontmatter** — default domain for the agent across all projects
2. **Team config** — project-specific override that narrows or adjusts the agent's domain

Precedence: `team config domain > agent frontmatter domain > default (allow all)`

### Format

```yaml
domain:
  - path: src/components/**
    read: true
    write: true
    delete: false
  - path: src/api/**
    read: true
    write: false    # can read API code for context, can't modify it
    delete: false
  - path: .
    read: true      # catch-all: read everything
    write: false
    delete: false
```

- `path`: glob pattern matching files/directories
- `read`: can the agent read files matching this pattern
- `write`: can the agent create or modify files matching this pattern
- `delete`: can the agent delete files matching this pattern
- More specific paths take precedence over less specific ones
- A catch-all `path: .` entry provides the default for unmatched paths

### Key principle: domain restricts WRITE, not READ

Agents need broad read access to understand context (research phase reads many files). Domain restrictions prevent agents from **modifying** files outside their zone. A frontend developer can read the API code for context but can't edit it.

## Enforcement

Domain enforcement happens at two checkpoints:

### Checkpoint 1: Team Lead Post-Step Validation

After each implementation or optimization step, the team lead:

1. Read the agent's domain from the team config (or agent frontmatter if no config)
2. List all files the agent modified (from the step output or git diff)
3. Check each modified file against the agent's write-allowed patterns
4. If all files are within domain: proceed to the next step
5. If violations found: reject the output, flag the violation, re-scope the task

**Violation report format:**
```
DOMAIN VIOLATION:
  Agent: frontend-developer
  File: src/api/handlers/event.go
  Agent domain allows: src/components/**, src/styles/**, src/hooks/**
  Action: reject output, re-scope task to frontend-only changes
```

### Multi-agent steps

When the team lead splits an `implement` step across two agents (e.g., backend-developer then frontend-developer for a full-stack story):

1. Validate each agent's changes against its own domain — not the merged set
2. The team lead must track which files were modified by which agent (record in the episode as `agent_file_map`)
3. The reviewer receives the merged output but also the `agent_file_map` to validate per-agent domain compliance

### Checkpoint 2: Reviewer Code Review

During the review step, the reviewer checks domain compliance as part of the standard review:

1. Read the story's team config for domain assignments
2. For each modified file, verify the modifying agent had write access (use `agent_file_map` if the step was split across agents)
3. Flag domain violations as review findings with severity "high"

### What happens on violation

1. **Reject the output** — the violating changes are not accepted
2. **Re-scope the task** — the team lead narrows the task to the agent's domain
3. **Log the violation** — record it in the episode file for the step
4. **Do NOT auto-fix** — domain violations indicate a scope problem, not a code problem

## Glob Pattern Matching

Domain paths use standard glob patterns:

| Pattern | Matches |
|---------|---------|
| `src/components/**` | All files under src/components/ at any depth |
| `**/*.test.*` | All test files anywhere in the project |
| `src/api/*.go` | Go files directly in src/api/ (not subdirs) |
| `.` | Everything (catch-all) |
| `docs/**` | All files under docs/ |

## Common Domain Configurations

### Frontend developer
```yaml
domain:
  - path: src/components/**
    read: true
    write: true
    delete: false
  - path: src/styles/**
    read: true
    write: true
    delete: false
  - path: src/hooks/**
    read: true
    write: true
    delete: false
  - path: .
    read: true
    write: false
    delete: false
```

### Backend developer
```yaml
domain:
  - path: src/api/**
    read: true
    write: true
    delete: false
  - path: src/services/**
    read: true
    write: true
    delete: false
  - path: src/models/**
    read: true
    write: true
    delete: false
  - path: .
    read: true
    write: false
    delete: false
```

### Tester
```yaml
domain:
  - path: tests/**
    read: true
    write: true
    delete: false
  - path: "**/*.test.*"
    read: true
    write: true
    delete: false
  - path: .
    read: true
    write: false
    delete: false
```

### Reviewer (read-only everywhere)
```yaml
domain:
  - path: .
    read: true
    write: false
    delete: false
```

## Failure Modes

- **Not checking domains** — team lead skips validation, violations go undetected. Mitigated by reviewer providing a second checkpoint.
- **Over-restrictive domains** — agent can't complete the task within its domain. Team lead should re-evaluate scope or temporarily expand domain with documentation.
- **Domain doesn't match project structure** — team config domains reference directories that don't exist. Kickoff-generated configs avoid this by using actual discovered paths.
