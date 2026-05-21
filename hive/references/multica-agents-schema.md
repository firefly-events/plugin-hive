# Multica Agents Schema

See the canonical workspace config at [.pHive/multica/agents.yaml](../../.pHive/multica/agents.yaml).

## Purpose

`.pHive/multica/agents.yaml` declares the initial non-interactive Multica agent set that can be bootstrapped from tracked repo state.

## Schema reference

Top-level fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `schema_version` | integer | yes | none | Current value is `1`. |
| `agents` | array | yes | none | Ordered list of agent definitions. |

Per-agent fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `name` | string | yes | none | Stable agent identifier. |
| `provider` | string | yes | none | Runtime provider name. |
| `model` | string | yes | none | Provider model identifier. |
| `persona_ref` | string | yes | none | Repo-relative markdown persona path. |
| `max_concurrent_tasks` | integer | no | `1` | Maximum simultaneous work items for this agent. |
| `custom_env` | object | no | `{}` | Extra environment values for the agent runtime. |
| `custom_args` | array | no | `[]` | Extra command arguments for the agent runtime. |
| `mcp_config` | object \| null | no | `null` | Agent-specific MCP configuration. Use `null` (or omit) to skip passing `--mcp-config` to the claude CLI; `{}` is rejected by claude as `mcpServers: expected record, received undefined`. |
| `skills` | array | no | `[]` | Agent-specific skills to load. |
| `visibility` | string | no | `workspace` | Visibility scope for the declaration. |

## Required fields

Every agent entry must define `name`, `provider`, `model`, and `persona_ref`.

## Optional fields with defaults

When omitted, optional fields default to `max_concurrent_tasks=1`, `custom_env={}`, `custom_args=[]`, `mcp_config=null`, `skills=[]`, and `visibility='workspace'`.

## schema_version semantics

`schema_version: 1` is the current schema. Bootstrap rejects unknown future versions instead of guessing how to interpret them.

## persona_ref resolution rules

`persona_ref` is resolved as a path relative to the repo root. The file must exist and be plain markdown.

## Concrete example

```yaml
schema_version: 1
agents:
  - name: developer
    provider: claude
    model: claude-sonnet-4-6
    max_concurrent_tasks: 1
    persona_ref: hive/agents/developer.md
    custom_env: {}
    custom_args: []
    mcp_config: null
    skills: []
    visibility: workspace
  - name: tester
    provider: claude
    model: claude-sonnet-4-6
    max_concurrent_tasks: 1
    persona_ref: hive/agents/tester.md
    custom_env: {}
    custom_args: []
    mcp_config: null
    skills: []
    visibility: workspace
  - name: reviewer
    provider: claude
    model: claude-opus-4-7
    max_concurrent_tasks: 1
    persona_ref: hive/agents/reviewer.md
    custom_env: {}
    custom_args: []
    mcp_config: null
    skills: []
    visibility: workspace
```

## Drift contract

The config is re-runnable. Disk wins when generated or checked again. Updates should patch existing entries and fields, not delete unrelated state.

## Relationship to hive.config.yaml

`hive.config.yaml` remains the broader Hive configuration surface. `.pHive/multica/agents.yaml` is the Multica bootstrap agent declaration and should stay focused on persona-backed agent runtime settings.

## Out-of-scope personas

`researcher`, `technical-writer`, `tpm`, `architect`, and `ui-designer` remain interactive personas and are not part of this scaffold.

## Forward link

Future S3 initialization details belong in [skills/multica-init/SKILL.md](../../skills/multica-init/SKILL.md).
