> **Superseded by [task-tracking-adapter-abi.md](task-tracking-adapter-abi.md) (c-2).** Kept for historical traceability.

# Task-Tracking Adapter ABI Sketch

**Form factor selected:** CLI contract  
**Status:** Input to c-2-abi-specification  
**Decision rationale:** See `.pHive/epics/task-tracking-adapter-abi/docs/form-factor-decision.md`

---

## Overview

A Hive task-tracking adapter is a single executable that:

1. Reads a JSON-encoded method call from **stdin**.
2. Writes a JSON-encoded result (or error) to **stdout**.
3. Exits with code `0` on success, non-zero on error.

Hive dispatches via `spawnSync(adapterPath, [], { input: JSON.stringify(call) })`.

The adapter is registered in `hive.config.yaml`:

```yaml
task_tracking:
  adapter: ./adapters/my-tracker-adapter   # relative to hive root, or absolute
```

---

## Primary Sketch — CLI Contract

### Wire format

**Request (stdin):**

```json
{
  "method": "<method-name>",
  "params": { ... }
}
```

**Success response (stdout):**

```json
{
  "result": { ... }
}
```

**Error response (stdout, exit 1):**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Issue #42 not found"
  }
}
```

---

### `capabilities` method

Returns the adapter's capability declaration. Called by Hive at dispatch-time to determine hierarchy mode.

**Request:**

```json
{ "method": "capabilities", "params": {} }
```

**Response:**

```json
{
  "result": {
    "hierarchy": "flat | hierarchical | mixed",
    "supports_parent_link": true,
    "metadata": {
      "team_field": "string | null",
      "project_field": "string | null"
    }
  }
}
```

**Hierarchy values:**

| Value | Example tracker | Meaning |
|-------|----------------|---------|
| `flat` | atoshell (if revisited), Trello | All stories at same level; `parent_id` ignored |
| `hierarchical` | Linear | Stories nest under parent issues/projects; `parent_id` required for sub-tasks |
| `mixed` | GitHub | Issues are flat; GitHub Projects add hierarchical grouping; `parent_id` optional |

**Capability stubs by tracker:**

```json
// Linear adapter capabilities
{
  "result": {
    "hierarchy": "hierarchical",
    "supports_parent_link": true,
    "metadata": {
      "team_field": "teamId",
      "project_field": "projectId"
    }
  }
}
```

```json
// GitHub adapter capabilities
{
  "result": {
    "hierarchy": "mixed",
    "supports_parent_link": true,
    "metadata": {
      "team_field": "owner",
      "project_field": "project"
    }
  }
}
```

```json
// Flat tracker capabilities (e.g., atoshell-if-revisited)
{
  "result": {
    "hierarchy": "flat",
    "supports_parent_link": false,
    "metadata": {
      "team_field": null,
      "project_field": null
    }
  }
}
```

---

### `createStory` method

Creates a new story/issue in the tracker.

**Request:**

```json
{
  "method": "createStory",
  "params": {
    "title": "string",
    "body": "string",
    "labels": ["string"],
    "parent_id": "string | null"
  }
}
```

- `parent_id`: optional. Hive passes `null` when no parent context. Adapters with `hierarchy: flat` MUST silently ignore this field. Adapters with `hierarchy: hierarchical` SHOULD surface it as a sub-task link. Adapters with `hierarchy: mixed` SHOULD apply it only when non-null and a project context is active.

**Response:**

```json
{
  "result": {
    "id": "string",
    "url": "string"
  }
}
```

---

### `updateStatus` method

**Request:**

```json
{
  "method": "updateStatus",
  "params": {
    "id": "string",
    "status": "open | in_progress | done | cancelled"
  }
}
```

**Response:**

```json
{
  "result": { "ok": true }
}
```

---

### `listOpen` method

**Request:**

```json
{
  "method": "listOpen",
  "params": {
    "limit": 50,
    "team_field": "string | null",
    "project_field": "string | null"
  }
}
```

**Response:**

```json
{
  "result": {
    "stories": [
      { "id": "string", "title": "string", "status": "string", "url": "string" }
    ]
  }
}
```

---

### `getStory` method

**Request:**

```json
{
  "method": "getStory",
  "params": { "id": "string" }
}
```

**Response:**

```json
{
  "result": {
    "id": "string",
    "title": "string",
    "body": "string",
    "status": "string",
    "labels": ["string"],
    "parent_id": "string | null",
    "url": "string"
  }
}
```

---

### Example custom adapter (10–15 lines)

```bash
#!/usr/bin/env bash
# my-tracker-adapter — minimal CLI adapter skeleton
# Register in hive.config.yaml: task_tracking.adapter: ./my-tracker-adapter
set -euo pipefail

payload=$(cat)
method=$(echo "$payload" | jq -r '.method')

case "$method" in
  capabilities)
    echo '{"result":{"hierarchy":"flat","supports_parent_link":false,"metadata":{"team_field":null,"project_field":"board"}}}'
    ;;
  createStory)
    title=$(echo "$payload" | jq -r '.params.title')
    body=$(echo "$payload" | jq -r '.params.body')
    id=$(my-tracker-cli create --title "$title" --body "$body" --json | jq -r '.id')
    echo "{\"result\":{\"id\":\"$id\",\"url\":\"https://tracker.example.com/issues/$id\"}}"
    ;;
  *)
    echo "{\"error\":{\"code\":\"UNKNOWN_METHOD\",\"message\":\"Unknown method: $method\"}}"
    exit 1
    ;;
esac
```

---

## Secondary Sketch — MCP Server (Dual Sketch per AC §5)

> **Status:** Reference only. Three axes tied (Pluggability, Cross-process boundary, Hierarchy-agnostic carry) between CLI and MCP, triggering AC §5 mandatory dual sketch. CLI was selected as primary. This sketch is the migration target if batch-operation volume makes 52ms-per-call CLI cost prohibitive.

### Architecture

An MCP adapter is a persistent subprocess exposing tools via JSON-RPC over stdio. Hive maintains a long-lived `McpClient` instance per adapter, amortizing the ~62–70ms cold spawn across all calls in a session. Persistent IPC round-trip is ~0.1–0.5ms.

### `capabilities` resource

Exposed as an MCP resource at `hive://adapter/capabilities`:

```json
{
  "hierarchy": "mixed",
  "supports_parent_link": true,
  "metadata": {
    "team_field": "owner",
    "project_field": "project"
  }
}
```

### `createStory` tool

```json
{
  "name": "createStory",
  "description": "Create a new story/issue in the tracker",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title":     { "type": "string" },
      "body":      { "type": "string" },
      "labels":    { "type": "array", "items": { "type": "string" } },
      "parent_id": { "type": ["string", "null"] }
    },
    "required": ["title", "body", "labels"]
  }
}
```

### Example MCP adapter (Python, 10–15 lines)

```python
#!/usr/bin/env python3
# my_tracker_mcp/server.py  — minimal MCP adapter skeleton
from mcp.server import Server
from mcp.server.stdio import stdio_server

app = Server("my-tracker-adapter")

@app.resource("hive://adapter/capabilities")
async def capabilities():
    return {"hierarchy": "flat", "supports_parent_link": False,
            "metadata": {"team_field": None, "project_field": "board"}}

@app.tool()
async def create_story(title: str, body: str, labels: list[str], parent_id: str | None = None):
    issue = my_tracker.create(title=title, body=body, labels=labels)
    return {"id": issue.id, "url": issue.url}

if __name__ == "__main__":
    stdio_server(app)
```

### Hive-side requirements for MCP (not yet built)

- `McpClient` singleton per adapter, initialized at first call, kept alive for session duration.
- Capability fetched once at session start via `resources/read`.
- Tools called via `tools/call` JSON-RPC.
- Migration from CLI: adapter authors replace stdin/stdout dispatch with MCP server skeleton; JSON contract is identical.

---

## Hierarchy-Agnostic Carry — Decision Table

Hive uses `capabilities.hierarchy` to determine `--parent-ticket` behavior:

| `hierarchy` | Hive behavior on `createStory` |
|-------------|-------------------------------|
| `flat` | `parent_id` set to `null`; `--parent-ticket` flag hidden |
| `hierarchical` | `parent_id` required when sub-task context active; `--parent-ticket` flag shown |
| `mixed` | `parent_id` passed when non-null; `--parent-ticket` flag shown but optional |

This replaces today's `--parent-ticket` optional flag (boolean) with a capability-driven enum. GitHub's mixed model is the motivating case — it cannot be expressed as a boolean.
