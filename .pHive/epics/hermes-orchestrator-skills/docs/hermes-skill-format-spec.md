# h-01 — Hermes-Agent Native Skill Format Spec

**Recon target:** Studio (`mac.lan`, user `hive`) → `~/Code/hermes-agent` (hermes-agent v0.14.0, Python).
**Method:** SSH recon of the live fork (plan-off-repo-bridge), not upstream docs.
**Source of truth in-repo:** `skills/software-development/hermes-agent-skill-authoring/SKILL.md` + `tools/skill_manager_tool.py::_validate_frontmatter`.

## 1. Skills ARE SKILL.md

hermes-agent's native skill format is **`SKILL.md`** — YAML frontmatter + markdown body. A close cousin of the Claude Code skill format, so the plugin-hive canonical runbooks port near-mechanically (wrap body, swap frontmatter).

Two locations:
1. **In-repo (use this for the orchestrator skills):** `~/Code/hermes-agent/skills/<category>/<name>/SKILL.md` — committed, ships with the package. Authored via `write_file` + `git add` (NOT `skill_manage(action='create')`, which only targets user-local).
2. **User-local:** `~/.hermes/skills/<category>/<name>/SKILL.md` — personal, via `skill_manage(action='create')`.

## 2. Required frontmatter (validator-enforced)

`_validate_frontmatter` hard requirements:
- Starts with `---` as the first bytes (no leading blank line).
- Closes with `\n---\n` before the body.
- Parses as a YAML mapping.
- `name` present (lowercase, hyphens, ≤64 chars = `MAX_NAME_LENGTH`).
- `description` present, ≤ **1024 chars** (`MAX_DESCRIPTION_LENGTH`).
- Non-empty body after the closing `---`.

Peer-matched shape (every `skills/software-development/` skill uses it):

```yaml
---
name: my-skill-name
description: Use when <trigger>. <one-line behavior>.
version: 1.1.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [short, descriptive, tags]
    related_skills: [other-skill]
---
```

`version`/`author`/`license`/`metadata` are NOT enforced but every peer has them.

## 3. Size + invocation

- SKILL.md ≤ **100,000 chars** (`MAX_SKILL_CONTENT_CHARS`, ~36k tokens).
- Peers sit at **8–14k chars**. Split to `references/*.md` if past ~20k.
- Skills are **model-invoked**: the `description` is paid every turn. Keep descriptions trigger-focused; push detail into the body / `references/`.

**Implication for our runbooks:** monitor-epic (247L), kickoff-exec (256L), watch-cron (277L), kickoff-plan (346L), slack-notify-await (236L) fit a single SKILL.md. **reconcile-tick (474L, ~17k chars)** is near the ceiling — port with a `references/` split (move the per-position transition detail out of SKILL.md).

## 4. MCP binding (how skills reach multica_* tools)

hermes connects external MCP servers via the **`cli-config.yaml` MCP section** (`cli-config.yaml.example` §"MCP (Model Context Protocol) Servers"): "Each server's tools are automatically discovered and registered." Two transports:
- **stdio**: `command` + `args` + `env` (spawn subprocess).
- **HTTP**: `url` + `headers`.

So the h-02 `mcp-tools.mjs` registers as a stdio MCP server in hermes' `cli-config.yaml`:

```yaml
mcp_servers:
  multica:
    command: node
    args: ["/Users/hive/Code/plugin-hive/hive/lib/multica-story-dispatch/mcp-tools.mjs"]
    env:
      MULTICA_WORKSPACE_ID: "<workspace-uuid>"
```

hermes skills then call `multica_dispatch_story`, `multica_poll_task`, `multica_epic_status`, `multica_write_state` (+ episode/comment/cancel) as auto-discovered tools.

hermes ALSO ships its own `mcp_serve.py` (exposes hermes conversations/messages/approvals as an MCP server — the OpenClaw 9-tool channel bridge). This is the OTHER direction and is the natural carrier for the **Slack notify-await human gate** (h-06): `permissions_list_open` / `permissions_respond` / `messages_send` map directly onto notify-and-await.

## 5. Categories

`skills/<category>/<name>/`. Existing categories include `apple`, `software-development`, `health`. **Recommendation:** port the orchestrator skills under `skills/orchestration/` (new category) — monitor-epic, reconcile-tick, kickoff-plan, kickoff-exec, watch-cron.

## 6. h-10 port checklist (derived)

1. On Studio, pull `feat/hermes-orchestrator-skills` into `~/Code/plugin-hive` (gets canonical runbooks).
2. For each of the 5 runbooks → `~/Code/hermes-agent/skills/orchestration/<name>/SKILL.md` with hermes frontmatter (name, trigger-focused description ≤1024, version/author/license/metadata.hermes). reconcile-tick → SKILL.md + `references/`.
3. Register the multica MCP server in `cli-config.yaml` (§4).
4. Wire the h-06 Slack gate to `mcp_serve.py` permissions surface (or the configured Slack channel).
5. Parity check: each ported skill's behavior matches its plugin-hive canonical source; validator passes.
6. `git add` + commit in `~/Code/hermes-agent`; docs in plugin-hive README/operations-guide.
