# Task-Tracking Adapter ABI

> Version: 1.0.0
> Form factor: CLI (JSON-over-stdio)
> Supersedes: task-tracking-adapter-abi-sketch.md (c-1)

---

## Overview

A Hive **task-tracking adapter** is a single executable that mediates between Hive's internal workflow engine and an external issue tracker (Linear, GitHub Issues, Trello, Jira, or any custom system). The adapter:

- Accepts a JSON-encoded method call on **stdin**.
- Writes a JSON-encoded result or error to **stdout**.
- Exits with code `0` on success, non-zero on error.

Hive dispatches every call as a **fresh subprocess** via `spawnSync`. The adapter does not maintain persistent state between calls.

This spec defines the full wire contract: method shapes, error codes, capability declaration, versioning rules, and a standalone implementation guide. Adapter authors do not need to read any existing adapter source (Linear, GitHub) to implement a conforming adapter.

---

## CLI Wire Format

### Invocation

Hive invokes the adapter as:

```
spawnSync(adapterPath, [], { input: JSON.stringify(request), encoding: "utf8" })
```

The adapter binary receives the request object on **stdin**. No command-line arguments carry request data. The adapter path is registered in `hive.config.yaml`:

```yaml
task_tracking:
  adapter: ./adapters/my-tracker-adapter   # relative to hive root, or absolute path
```

### Request envelope

```json
{
  "method": "<method-name>",
  "params": { }
}
```

- `method` — string, required. One of: `capabilities`, `createStory`, `updateStatus`, `listOpen`, `getStory`, `addComment`, `linkStories`, `setAssignee`.
- `params` — object, required. May be `{}` for zero-param methods.

### Success response envelope

Written to **stdout**. Exit code `0`.

```json
{
  "result": { }
}
```

`result` is always an object (never `null` or a bare scalar). Void-return methods emit `{"result": {}}`.

### Error response envelope

Written to **stdout**. Exit code **non-zero** (conventionally `1`).

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Issue LIN-42 does not exist",
    "retry_after_ms": null
  }
}
```

- `code` — string, required. One of the closed error enum (see [Error Model](#error-model)).
- `message` — string, required. Human-readable detail; logged by Hive for debugging.
- `retry_after_ms` — integer | null. Present and non-null **only** when `code` is `RATE_LIMIT`.

### Exit codes

| Exit code | Meaning |
|-----------|---------|
| `0` | Success — `result` object present on stdout |
| `1` | Error — `error` object present on stdout |
| Any other non-zero | Unhandled crash — Hive treats as `UNKNOWN_METHOD` with message "adapter crashed" |

---

## Subprocess Lifecycle

### Fresh-per-call model

Every method call spawns a **new adapter process**. There is no persistent adapter daemon. Adapters MUST NOT rely on in-memory state surviving between calls. Any state that must persist (tokens, configuration) must be read from disk or environment variables on each invocation.

### Capability caching

The `capabilities` method is the sole exception to stateless dispatch. Hive calls `capabilities` **once per session** at session start and caches the result in cycle state for the duration of the session. Subsequent calls within the same session read from the cache; the adapter is not re-spawned for capability lookups.

Implication: a running session will not pick up capability changes made to the adapter binary mid-session. To refresh capabilities, restart the Hive session.

### Hive-side timeout

Hive enforces a **30-second default timeout** on every adapter subprocess (configurable via `task_tracking.adapter_timeout_ms` in `hive.config.yaml`). If the subprocess does not exit within the timeout, Hive sends `SIGTERM`, waits 2 seconds, then sends `SIGKILL`. The call is treated as a terminal error equivalent to `AUTH_FAILURE` in severity — the epic is paused and the user is notified. Adapters should complete within 10 seconds to leave adequate headroom.

### Configuration

Adapters read their own configuration (API keys, base URLs, project IDs) from:

1. **Environment variables** — preferred for secrets (e.g., `LINEAR_API_KEY`).
2. **Adapter-local config files** — e.g., `.my-tracker-adapter.json` adjacent to the binary.

Hive does not pass configuration to the adapter beyond the method call envelope.

---

## Capability Declaration

### Method

```json
{ "method": "capabilities", "params": {} }
```

### Response shape

```json
{
  "result": {
    "abi_version": "1.0.0",
    "hierarchy": "flat | hierarchical | mixed",
    "supports_parent_link": true,
    "supported_states": ["open", "in_progress", "done", "cancelled"],
    "supported_labels": ["bug", "enhancement"] ,
    "metadata": {
      "team_field": "string | null",
      "project_field": "string | null"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `abi_version` | string | yes | Semver string the adapter implements (e.g., `"1.0.0"`). Used by Hive compatibility check. |
| `hierarchy` | `"flat" \| "hierarchical" \| "mixed"` | yes | Story nesting model. See table below. |
| `supports_parent_link` | boolean | yes | Whether the adapter can accept a `parent_id` in `createStory`. Must be `false` when `hierarchy` is `"flat"`. |
| `supported_states` | string[] | yes | Non-empty list of valid `state` values accepted by `updateStatus`. Hive validates `state` arguments against this list. |
| `supported_labels` | string[] \| null | yes | List of valid label strings accepted by `createStory`, or `null` if the tracker accepts arbitrary labels. |
| `metadata.team_field` | string \| null | yes | The **field name** in this tracker for team/workspace grouping (e.g., `"teamId"`, `"owner"`). `null` if tracker has no team concept. |
| `metadata.project_field` | string \| null | yes | The **field name** in this tracker for project/board grouping (e.g., `"projectId"`, `"board"`). `null` if not applicable. |

> `team_field` and `project_field` are **capability metadata** (field name declarations), not runtime values. Runtime filter values are passed as `team_value` / `project_value` params in individual method calls.

### Hierarchy values

| Value | Example tracker | Meaning |
|-------|----------------|---------|
| `flat` | Trello, any flat tracker | All stories at the same level; `parent_id` is always ignored |
| `hierarchical` | Linear | Stories nest under parent issues/projects; `parent_id` used for sub-tasks |
| `mixed` | GitHub Issues + Projects | Issues are flat; Projects add hierarchical grouping; `parent_id` optional |

### Example capability objects

**Flat tracker (e.g., Trello):**

```json
{
  "result": {
    "abi_version": "1.0.0",
    "hierarchy": "flat",
    "supports_parent_link": false,
    "supported_states": ["open", "done"],
    "supported_labels": null,
    "metadata": {
      "team_field": null,
      "project_field": "board"
    }
  }
}
```

**Hierarchical tracker (e.g., Linear):**

```json
{
  "result": {
    "abi_version": "1.0.0",
    "hierarchy": "hierarchical",
    "supports_parent_link": true,
    "supported_states": ["backlog", "in_progress", "in_review", "done", "cancelled"],
    "supported_labels": ["bug", "feature", "improvement", "chore"],
    "metadata": {
      "team_field": "teamId",
      "project_field": "projectId"
    }
  }
}
```

**Mixed tracker (e.g., GitHub Issues):**

```json
{
  "result": {
    "abi_version": "1.0.0",
    "hierarchy": "mixed",
    "supports_parent_link": true,
    "supported_states": ["open", "closed"],
    "supported_labels": null,
    "metadata": {
      "team_field": "owner",
      "project_field": "project"
    }
  }
}
```

### Hive behavior driven by hierarchy

| `hierarchy` | Hive behavior on `createStory` |
|-------------|-------------------------------|
| `flat` | Sets `parent_id` to `null`; hides `--parent-ticket` flag |
| `hierarchical` | Passes `parent_id` when sub-task context is active; shows `--parent-ticket` flag |
| `mixed` | Passes `parent_id` when non-null; shows `--parent-ticket` flag but marks it optional |

---

## Methods

### `createStory`

Creates a new story or issue in the tracker.

#### Request

```json
{
  "method": "createStory",
  "params": {
    "title": "string",
    "body": "string",
    "labels": ["string"],
    "parent_id": "string | null",
    "team_value": "string | null",
    "project_value": "string | null"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Story title / issue headline |
| `body` | string | yes | Full description; may contain Markdown |
| `labels` | string[] | yes | Zero or more label strings. Must be values from `supported_labels`, or any string if `supported_labels` is `null` |
| `parent_id` | string \| null | no | Parent issue ID. Adapters with `hierarchy: flat` (i.e., `supports_parent_link: false`) SHOULD return `OPERATION_UNSUPPORTED` if `parent_id` is provided — do not silently ignore it. Hive-side dispatch guards `parent_id` usage via `supports_parent_link` and will not pass a non-null `parent_id` to flat adapters. Adapters with `hierarchy: hierarchical` SHOULD surface it as a sub-task link. Adapters with `hierarchy: mixed` SHOULD apply it only when non-null. |
| `team_value` | string \| null | no | Runtime value for the team/workspace identified by `capabilities.metadata.team_field` |
| `project_value` | string \| null | no | Runtime value for the project/board identified by `capabilities.metadata.project_field` |

#### Response

```json
{
  "result": {
    "id": "string",
    "url": "string"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable tracker-assigned identifier for the new story |
| `url` | string | Browser-navigable URL to the created issue |

#### Error variants

| Code | When |
|------|------|
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit; includes `retry_after_ms` |
| `UNKNOWN_METHOD` | Adapter does not recognize `createStory` |

#### Example

Request:
```json
{
  "method": "createStory",
  "params": {
    "title": "Add pagination to story list",
    "body": "The `listOpen` endpoint returns at most 50 items. Add cursor-based pagination.",
    "labels": ["feature"],
    "parent_id": "LIN-10",
    "team_value": "team_abc123",
    "project_value": "proj_xyz789"
  }
}
```

Response:
```json
{
  "result": {
    "id": "LIN-42",
    "url": "https://linear.app/myteam/issue/LIN-42"
  }
}
```

---

### `updateStatus`

Transitions a story to a new workflow state.

#### Request

```json
{
  "method": "updateStatus",
  "params": {
    "id": "string",
    "state": "string"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Tracker-assigned story ID |
| `state` | string | yes | Target state. MUST be one of `capabilities.supported_states` |

#### Response

Full story object reflecting the updated state:

```json
{
  "result": {
    "id": "string",
    "title": "string",
    "body": "string",
    "state": "string",
    "labels": ["string"],
    "parent_id": "string | null",
    "url": "string"
  }
}
```

#### Error variants

| Code | When |
|------|------|
| `NOT_FOUND` | Story ID does not exist or has been deleted |
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit |
| `UNKNOWN_METHOD` | Adapter does not recognize `updateStatus` |

#### Example

Request:
```json
{
  "method": "updateStatus",
  "params": {
    "id": "LIN-42",
    "state": "in_progress"
  }
}
```

Response:
```json
{
  "result": {
    "id": "LIN-42",
    "title": "Add pagination to story list",
    "body": "The `listOpen` endpoint returns at most 50 items. Add cursor-based pagination.",
    "state": "in_progress",
    "labels": ["feature"],
    "parent_id": "LIN-10",
    "url": "https://linear.app/myteam/issue/LIN-42"
  }
}
```

---

### `listOpen`

Returns stories that are not in a terminal state (i.e., not `done` or `cancelled`). "Open" is interpreted relative to `capabilities.supported_states`; adapters SHOULD exclude states semantically equivalent to done/closed.

#### Request

```json
{
  "method": "listOpen",
  "params": {
    "limit": 50,
    "team_value": "string | null",
    "project_value": "string | null"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | integer | no | Maximum number of stories to return. Default `50`. |
| `team_value` | string \| null | no | Filter by team/workspace (runtime value for the field named by `capabilities.metadata.team_field`) |
| `project_value` | string \| null | no | Filter by project/board (runtime value for the field named by `capabilities.metadata.project_field`) |

#### Response

```json
{
  "result": {
    "stories": [
      {
        "id": "string",
        "title": "string",
        "state": "string",
        "labels": ["string"],
        "url": "string"
      }
    ]
  }
}
```

Adapters MAY return an empty array when no open stories match.

#### Error variants

| Code | When |
|------|------|
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit |
| `UNKNOWN_METHOD` | Adapter does not recognize `listOpen` |

#### Example

Request:
```json
{
  "method": "listOpen",
  "params": {
    "limit": 10,
    "team_value": "team_abc123",
    "project_value": null
  }
}
```

Response:
```json
{
  "result": {
    "stories": [
      {
        "id": "LIN-42",
        "title": "Add pagination to story list",
        "state": "in_progress",
        "labels": ["feature"],
        "url": "https://linear.app/myteam/issue/LIN-42"
      },
      {
        "id": "LIN-41",
        "title": "Fix rate-limit handling",
        "state": "open",
        "labels": ["bug"],
        "url": "https://linear.app/myteam/issue/LIN-41"
      }
    ]
  }
}
```

---

### `getStory`

Returns full detail for a single story.

#### Request

```json
{
  "method": "getStory",
  "params": {
    "id": "string"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Tracker-assigned story ID |

#### Response

```json
{
  "result": {
    "id": "string",
    "title": "string",
    "body": "string",
    "state": "string",
    "labels": ["string"],
    "parent_id": "string | null",
    "url": "string"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable tracker ID |
| `title` | string | Issue headline |
| `body` | string | Full description |
| `state` | string | Current workflow state |
| `labels` | string[] | Applied labels (may be empty) |
| `parent_id` | string \| null | Parent issue ID, or `null` if none |
| `url` | string | Browser-navigable URL |

#### Error variants

| Code | When |
|------|------|
| `NOT_FOUND` | Story ID does not exist or has been deleted |
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit |
| `UNKNOWN_METHOD` | Adapter does not recognize `getStory` |

#### Example

Request:
```json
{
  "method": "getStory",
  "params": { "id": "LIN-42" }
}
```

Response:
```json
{
  "result": {
    "id": "LIN-42",
    "title": "Add pagination to story list",
    "body": "The `listOpen` endpoint returns at most 50 items. Add cursor-based pagination.",
    "state": "in_progress",
    "labels": ["feature"],
    "parent_id": "LIN-10",
    "url": "https://linear.app/myteam/issue/LIN-42"
  }
}
```

---

### `addComment`

Appends a comment to an existing story.

#### Request

```json
{
  "method": "addComment",
  "params": {
    "id": "string",
    "body": "string"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Tracker-assigned story ID |
| `body` | string | yes | Comment body; may contain Markdown |

#### Response

```json
{
  "result": {
    "comment_id": "string"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `comment_id` | string | Stable tracker-assigned identifier for the new comment |

#### Error variants

| Code | When |
|------|------|
| `NOT_FOUND` | Story ID does not exist |
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit |
| `UNKNOWN_METHOD` | Adapter does not recognize `addComment` |

#### Example

Request:
```json
{
  "method": "addComment",
  "params": {
    "id": "LIN-42",
    "body": "Pagination implemented using `endCursor` from the GraphQL response. See PR #88."
  }
}
```

Response:
```json
{
  "result": {
    "comment_id": "comment_8f3a1b"
  }
}
```

---

### `linkStories`

**Conditional method.** Hive-side dispatch guards this call with `capabilities.supports_parent_link` — adapters declaring `supports_parent_link: false` will never receive a `linkStories` invocation. Flat adapters do not need to implement this method. If called on an adapter that does not support it, return `OPERATION_UNSUPPORTED` (see Error Model).

Establishes a parent-child relationship between two existing stories.

#### Request

```json
{
  "method": "linkStories",
  "params": {
    "parent_id": "string",
    "child_id": "string"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `parent_id` | string | yes | Tracker-assigned ID of the parent story |
| `child_id` | string | yes | Tracker-assigned ID of the child story |

#### Response

Void return. Response is an empty result object:

```json
{
  "result": {}
}
```

#### Error variants

| Code | When |
|------|------|
| `NOT_FOUND` | Either `parent_id` or `child_id` does not exist |
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit |
| `UNKNOWN_METHOD` | Adapter does not recognize the `linkStories` method at all (version mismatch) |
| `OPERATION_UNSUPPORTED` | Adapter recognizes the method but its declared hierarchy does not support parent linking |

#### Example

Request:
```json
{
  "method": "linkStories",
  "params": {
    "parent_id": "LIN-10",
    "child_id": "LIN-42"
  }
}
```

Response:
```json
{
  "result": {}
}
```

---

### `setAssignee`

Assigns or unassigns a user on a story. Included because Hive's standup and ceremony phases need to display and update ownership; every major tracker (Linear, GitHub, Jira, Trello) exposes assignment as a first-class operation.

#### Request

```json
{
  "method": "setAssignee",
  "params": {
    "id": "string",
    "assignee_id": "string | null"
  }
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Tracker-assigned story ID |
| `assignee_id` | string \| null | yes | Tracker-assigned user/member ID to assign, or `null` to remove current assignee |

#### Response

Void return. Response is an empty result object:

```json
{
  "result": {}
}
```

#### Error variants

| Code | When |
|------|------|
| `NOT_FOUND` | Story ID or `assignee_id` does not exist |
| `AUTH_FAILURE` | Credentials missing or expired |
| `RATE_LIMIT` | Tracker API rate limit hit |
| `UNKNOWN_METHOD` | Adapter does not recognize `setAssignee` |

#### Example

Request:
```json
{
  "method": "setAssignee",
  "params": {
    "id": "LIN-42",
    "assignee_id": "user_don123"
  }
}
```

Response:
```json
{
  "result": {}
}
```

Unassign example:
```json
{
  "method": "setAssignee",
  "params": {
    "id": "LIN-42",
    "assignee_id": null
  }
}
```

Response:
```json
{
  "result": {}
}
```

---

## Error Model

### Error envelope

All errors share a single envelope shape written to stdout with a non-zero exit code:

```json
{
  "error": {
    "code": "RATE_LIMIT",
    "message": "Linear API: 429 Too Many Requests",
    "retry_after_ms": 5000
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | yes | One of the closed error codes below (adapter-emitted) or a Hive-generated virtual code (see Schema drift) |
| `message` | string | yes | Human-readable detail for logging. Not parsed by Hive. |
| `retry_after_ms` | integer \| null | yes | Non-null **only** when `code` is `RATE_LIMIT`. Milliseconds Hive should wait before retrying. |

> `retry_after_ms` MUST be omitted or `null` for all non-`RATE_LIMIT` errors. Hive ignores this field when the code is not `RATE_LIMIT`.

### Error code enum

#### Adapter-emitted codes (closed)

Adapters MUST only emit codes from this set. Codes are matched by Hive to determine retry and escalation behavior.

| Code | Terminal? | Hive action | When to use |
|------|-----------|-------------|-------------|
| `NOT_FOUND` | Terminal | Hive aborts the current operation; logs the error | The referenced story, project, or user does not exist or has been deleted |
| `AUTH_FAILURE` | Terminal | Hive halts the epic and emits a credential error | API credentials are missing, expired, or insufficient |
| `RATE_LIMIT` | Recoverable | Hive waits `retry_after_ms` then retries the call (up to 3 times) | Tracker API rate limit exceeded |
| `UNKNOWN_METHOD` | Terminal | Hive emits an ABI version mismatch error | The adapter does not implement the requested method at all; typically a version mismatch |
| `OPERATION_UNSUPPORTED` | Terminal | Hive skips or degrades the operation and notifies the user | The method exists in the ABI but this adapter's declared hierarchy does not support it (e.g., `linkStories` on a flat adapter that was called despite `supports_parent_link: false`) |

**Distinction between `UNKNOWN_METHOD` and `OPERATION_UNSUPPORTED`:** `UNKNOWN_METHOD` means the adapter has no handler for the method name — a version or wiring issue. `OPERATION_UNSUPPORTED` means the adapter recognizes the method but its tracker's hierarchy model precludes it.

Adapters MUST NOT emit codes outside this set. If an underlying error does not map cleanly, use `UNKNOWN_METHOD` with a descriptive `message` for programming errors, or surface it as the closest applicable code.

#### Hive-generated virtual codes (not adapter-emitted)

These codes are synthesized by Hive itself and never appear in adapter output. They are documented here so that error logs and user notifications are interpretable.

| Code | Terminal? | Hive action | When generated |
|------|-----------|-------------|----------------|
| `SCHEMA_MISMATCH` | Terminal | Adapter is paused; user is notified | Hive validates each adapter response against the published JSON Schema for the method (at `hive/references/task-tracking-adapter-abi-schemas/{method}.json`). If the response fails validation, Hive treats it as a terminal adapter contract violation and synthesizes this code. The adapter is not at fault for a missing error code — `SCHEMA_MISMATCH` is entirely Hive-side. |

### Terminal vs. recoverable

- **Terminal errors** (`NOT_FOUND`, `AUTH_FAILURE`, `UNKNOWN_METHOD`, `OPERATION_UNSUPPORTED`, `SCHEMA_MISMATCH`): Hive does not retry. The operation is aborted and the error is surfaced to the user or logged to the cycle state.
- **Recoverable errors** (`RATE_LIMIT`): Hive retries with an exponential back-off floor of `retry_after_ms`. Maximum 3 automatic retries; after exhaustion, Hive treats the error as terminal.

### Retry semantics for RATE_LIMIT

1. Adapter emits `{"error": {"code": "RATE_LIMIT", "message": "...", "retry_after_ms": 3000}}`.
2. Hive waits at least `retry_after_ms` milliseconds.
3. Hive re-invokes the adapter with the **identical** request.
4. After 3 failed retries, Hive logs the error and aborts the operation.

---

## ABI Versioning

### Semver scheme

The adapter ABI follows [Semantic Versioning 2.0](https://semver.org/):

| Version component | Increment when |
|-------------------|---------------|
| **MAJOR** | A breaking change: method removed, required param renamed or type-changed, error code enum changed, response field removed or type-changed |
| **MINOR** | A non-breaking addition: new optional method added, new optional response field added |
| **PATCH** | Documentation fix, clarification, or non-behavioral change |

Current ABI version: **1.0.0**.

### Adapter declares version

Every `capabilities` response MUST include `abi_version`:

```json
{
  "result": {
    "abi_version": "1.0.0",
    ...
  }
}
```

### Hive compatibility check algorithm

Hive performs this check after fetching capabilities:

```
adapter_version = parse_semver(capabilities.abi_version)
hive_version    = parse_semver(HIVE_ABI_VERSION)   # e.g., "1.0.0"

if adapter_version.MAJOR != hive_version.MAJOR:
    FAIL — "ABI major version mismatch: adapter={adapter_version}, hive={hive_version}"

if adapter_version.MINOR > hive_version.MINOR:
    FAIL — "Adapter ABI too new: adapter={adapter_version}, hive supports up to {hive_version}"

# PATCH is ignored for compatibility purposes
PASS
```

- **MAJOR must match exactly.** An adapter at `2.x.x` is incompatible with Hive targeting `1.x.x`.
- **MINOR: adapter must be ≤ Hive supported.** If an adapter declares `1.3.0` but Hive supports `1.1.0`, Hive rejects it — the adapter may rely on methods Hive doesn't yet support.
- **PATCH is ignored.** `1.0.1` and `1.0.9` are both compatible with Hive `1.0.0`.

### Forward-version dispatch (adapter older than Hive)

If Hive supports ABI 1.5 and an adapter declares ABI 1.0, Hive MUST guard new method dispatch by the adapter's declared MINOR version. Methods introduced in ABI 1.x where x > the adapter's declared minor version MUST NOT be called. Hive should degrade gracefully — either skip the operation or substitute with a lower-ABI equivalent — rather than calling a method the adapter does not yet know about.

### Breaking changes (require MAJOR bump)

- Removing any of the 6 unconditionally required methods (`createStory`, `updateStatus`, `listOpen`, `getStory`, `addComment`, `setAssignee`), or removing `linkStories` when `supports_parent_link: true`
- Renaming a required request parameter (e.g., `state` → `status`)
- Changing the type of any required request or response field
- Removing a response field
- Adding or removing error codes from the closed enum
- Changing `capabilities` response field names or types

### Non-breaking changes (MINOR bump)

- Adding a new optional method
- Adding a new optional request parameter
- Adding a new optional response field

---

## Implementing a Custom Adapter

This guide is self-contained. You do not need to read any existing adapter source code.

### Step 1 — Choose a runtime

An adapter can be any executable: a shell script, a Node.js script, a compiled Go binary, a Python script. The only requirement is that it reads JSON from stdin and writes JSON to stdout.

### Step 2 — Register the adapter

Add the adapter path to `hive.config.yaml` in your Hive project root:

```yaml
task_tracking:
  adapter: ./adapters/my-tracker-adapter
```

The path is resolved relative to the Hive project root. Use an absolute path if the adapter lives outside the project.

Ensure the binary is executable:

```bash
chmod +x ./adapters/my-tracker-adapter
```

### Step 3 — Implement `capabilities`

This is the first method Hive calls. Return a complete capability declaration:

```json
{
  "result": {
    "abi_version": "1.0.0",
    "hierarchy": "flat",
    "supports_parent_link": false,
    "supported_states": ["open", "done"],
    "supported_labels": null,
    "metadata": {
      "team_field": null,
      "project_field": "board"
    }
  }
}
```

Choose `hierarchy` carefully:
- `flat` — your tracker has no parent-child concept (e.g., Trello boards).
- `hierarchical` — your tracker requires parent context for sub-tasks (e.g., Linear).
- `mixed` — your tracker supports both flat and hierarchical depending on context (e.g., GitHub Issues + Projects).

`supported_states` must list every state value your adapter accepts in `updateStatus`. Hive validates against this list at call time.

`supported_labels` is `null` if your tracker accepts arbitrary label strings, or a string array if labels must come from a fixed set.

`metadata.team_field` and `metadata.project_field` are the **field names** in your tracker (not runtime values). They tell Hive what to label the `team_value` and `project_value` params. Set to `null` if not applicable.

### Step 4 — Implement the 7 required methods

For each method:

1. Parse the JSON request from stdin.
2. Extract `params` and call your tracker's API.
3. Write the success or error JSON to stdout.
4. Exit `0` on success, `1` on error.

Map tracker API errors to the adapter-emitted error codes:
- 401/403 responses → `AUTH_FAILURE`
- 404 responses → `NOT_FOUND`
- 429 responses → `RATE_LIMIT` (include `retry_after_ms` from the `Retry-After` header, in milliseconds)
- Unrecognized method name / unhandled branch → `UNKNOWN_METHOD`
- Method recognized but hierarchy precludes it (e.g., `parent_id` on flat adapter) → `OPERATION_UNSUPPORTED`

### Step 5 — Minimal skeleton (Bash)

```bash
#!/usr/bin/env bash
# my-tracker-adapter — minimal CLI adapter skeleton
# Register: task_tracking.adapter: ./adapters/my-tracker-adapter
set -euo pipefail

payload=$(cat)   # read full stdin
method=$(printf '%s' "$payload" | jq -r '.method')

ok()    { printf '%s\n' "$1"; exit 0; }
err()   { printf '%s\n' "$1"; exit 1; }

case "$method" in
  capabilities)
    ok '{"result":{"abi_version":"1.0.0","hierarchy":"flat","supports_parent_link":false,"supported_states":["open","done"],"supported_labels":null,"metadata":{"team_field":null,"project_field":null}}}'
    ;;

  createStory)
    title=$(printf '%s' "$payload" | jq -r '.params.title')
    body=$(printf '%s' "$payload" | jq -r '.params.body')
    # Call your tracker CLI or REST API here
    id=$(my-tracker-cli create --title "$title" --body "$body" --json | jq -r '.id')
    ok "{\"result\":{\"id\":\"$id\",\"url\":\"https://tracker.example.com/issues/$id\"}}"
    ;;

  updateStatus)
    id=$(printf '%s' "$payload" | jq -r '.params.id')
    state=$(printf '%s' "$payload" | jq -r '.params.state')
    result=$(my-tracker-cli update --id "$id" --state "$state" --json)
    # Return a full story object
    ok "{\"result\":$(printf '%s' "$result" | jq '{id,title,body,state,labels,parent_id,url}')}"
    ;;

  listOpen)
    limit=$(printf '%s' "$payload" | jq -r '.params.limit // 50')
    stories=$(my-tracker-cli list --open --limit "$limit" --json)
    ok "{\"result\":{\"stories\":$stories}}"
    ;;

  getStory)
    id=$(printf '%s' "$payload" | jq -r '.params.id')
    story=$(my-tracker-cli get --id "$id" --json)
    ok "{\"result\":$story}"
    ;;

  addComment)
    id=$(printf '%s' "$payload" | jq -r '.params.id')
    body=$(printf '%s' "$payload" | jq -r '.params.body')
    cid=$(my-tracker-cli comment --id "$id" --body "$body" --json | jq -r '.comment_id')
    ok "{\"result\":{\"comment_id\":\"$cid\"}}"
    ;;

  linkStories)
    parent_id=$(printf '%s' "$payload" | jq -r '.params.parent_id')
    child_id=$(printf '%s' "$payload" | jq -r '.params.child_id')
    my-tracker-cli link --parent "$parent_id" --child "$child_id"
    ok '{"result":{}}'
    ;;

  setAssignee)
    id=$(printf '%s' "$payload" | jq -r '.params.id')
    assignee_id=$(printf '%s' "$payload" | jq -r '.params.assignee_id')
    my-tracker-cli assign --id "$id" --assignee "$assignee_id"
    ok '{"result":{}}'
    ;;

  *)
    err "{\"error\":{\"code\":\"UNKNOWN_METHOD\",\"message\":\"Unknown method: $method\",\"retry_after_ms\":null}}"
    ;;
esac
```

### Step 6 — Minimal skeleton (Node.js)

```javascript
#!/usr/bin/env node
// my-tracker-adapter.js — minimal Node.js CLI adapter skeleton
// Register: task_tracking.adapter: ./adapters/my-tracker-adapter.js

const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", async () => {
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const { method, params } = request;

  const ok  = (result) => { process.stdout.write(JSON.stringify({ result })); process.exit(0); };
  const err = (code, message, retry_after_ms = null) => {
    process.stdout.write(JSON.stringify({ error: { code, message, retry_after_ms } }));
    process.exit(1);
  };

  try {
    switch (method) {
      case "capabilities":
        ok({
          abi_version: "1.0.0",
          hierarchy: "flat",
          supports_parent_link: false,
          supported_states: ["open", "done"],
          supported_labels: null,
          metadata: { team_field: null, project_field: null },
        });
        break;

      case "createStory": {
        const { title, body, labels = [], parent_id = null, team_value, project_value } = params;
        // Call your tracker API here
        const issue = await myTracker.createIssue({ title, body, labels, parent_id, team_value, project_value });
        ok({ id: issue.id, url: issue.url });
        break;
      }

      case "updateStatus": {
        const { id, state } = params;
        const issue = await myTracker.updateState(id, state);
        ok({ id: issue.id, title: issue.title, body: issue.body, state: issue.state,
             labels: issue.labels, parent_id: issue.parent_id ?? null, url: issue.url });
        break;
      }

      case "listOpen": {
        const { limit = 50, team_value, project_value } = params;
        const stories = await myTracker.listOpen({ limit, team_value, project_value });
        ok({ stories: stories.map((s) => ({ id: s.id, title: s.title, state: s.state, labels: s.labels, url: s.url })) });
        break;
      }

      case "getStory": {
        const issue = await myTracker.getIssue(params.id);
        if (!issue) { err("NOT_FOUND", `Issue ${params.id} not found`); return; }
        ok({ id: issue.id, title: issue.title, body: issue.body, state: issue.state,
             labels: issue.labels, parent_id: issue.parent_id ?? null, url: issue.url });
        break;
      }

      case "addComment": {
        const comment = await myTracker.addComment(params.id, params.body);
        ok({ comment_id: comment.id });
        break;
      }

      case "linkStories": {
        await myTracker.linkIssues(params.parent_id, params.child_id);
        ok({});
        break;
      }

      case "setAssignee": {
        await myTracker.setAssignee(params.id, params.assignee_id);
        ok({});
        break;
      }

      default:
        err("UNKNOWN_METHOD", `Unknown method: ${method}`);
    }
  } catch (e) {
    if (e.status === 404) { err("NOT_FOUND", e.message); }
    else if (e.status === 401 || e.status === 403) { err("AUTH_FAILURE", e.message); }
    else if (e.status === 429) { err("RATE_LIMIT", e.message, parseInt(e.headers?.["retry-after"] ?? "5") * 1000); }
    else { err("UNKNOWN_METHOD", e.message); }
  }
});
```

### Step 7 — Test your adapter locally

Before wiring into Hive, validate each method with `echo ... | ./your-adapter`:

```bash
# Test capabilities
echo '{"method":"capabilities","params":{}}' | ./adapters/my-tracker-adapter

# Test createStory
echo '{"method":"createStory","params":{"title":"Test story","body":"Body text","labels":[]}}' \
  | ./adapters/my-tracker-adapter

# Test unknown method (should return UNKNOWN_METHOD error with exit 1)
echo '{"method":"nonexistent","params":{}}' | ./adapters/my-tracker-adapter; echo "Exit: $?"
```

Verify:
- `capabilities` returns all required fields including `abi_version`, `supported_states`, and `supported_labels`.
- `createStory` returns `id` and `url`.
- `updateStatus` returns a full story object (not just `{"ok": true}`).
- `listOpen` params use `team_value`/`project_value`, not `team_field`/`project_field`.
- Unknown method exits non-zero with `UNKNOWN_METHOD` code.
- Rate-limit errors include `retry_after_ms` as an integer.

### Step 8 — Common pitfalls

| Pitfall | Fix |
|---------|-----|
| Returning `{"result": true}` or `{"result": null}` | Always return `{"result": {...}}` — an object |
| Void methods returning `{"result": {"ok": true}}` | Return `{"result": {}}` for `linkStories` and `setAssignee` |
| Using `team_field`/`project_field` as runtime params | Runtime params are `team_value`/`project_value`; `team_field`/`project_field` are metadata (field name declarations in capabilities only) |
| Hardcoding `state` values in your adapter | Derive from your tracker's actual states; expose them all in `supported_states` |
| Missing `retry_after_ms` on RATE_LIMIT | Always include it (as an integer in milliseconds). Hive depends on it for retry scheduling. |
| Emitting a custom error code | Use only the 5 adapter-emitted codes (`NOT_FOUND`, `AUTH_FAILURE`, `RATE_LIMIT`, `UNKNOWN_METHOD`, `OPERATION_UNSUPPORTED`); map unknown errors to `UNKNOWN_METHOD` |

---

## Quick Reference

### Method summary

| Method | Required params | Returns | Void? |
|--------|----------------|---------|-------|
| `capabilities` | — | capability object | no |
| `createStory` | `title`, `body`, `labels` | `{id, url}` | no |
| `updateStatus` | `id`, `state` | full story object | no |
| `listOpen` | — | `{stories: [...]}` | no |
| `getStory` | `id` | full story object | no |
| `addComment` | `id`, `body` | `{comment_id}` | no |
| `linkStories` | `parent_id`, `child_id` | `{}` | yes |
| `setAssignee` | `id`, `assignee_id` | `{}` | yes |

### Error code summary

| Code | Source | Terminal | Has `retry_after_ms` |
|------|--------|----------|---------------------|
| `NOT_FOUND` | adapter | yes | no |
| `AUTH_FAILURE` | adapter | yes | no |
| `RATE_LIMIT` | adapter | no | **yes (required)** |
| `UNKNOWN_METHOD` | adapter | yes | no |
| `OPERATION_UNSUPPORTED` | adapter | yes | no |
| `SCHEMA_MISMATCH` | Hive (virtual) | yes | no |

### Full story object shape

Used by `updateStatus` and `getStory`:

```json
{
  "id": "string",
  "title": "string",
  "body": "string",
  "state": "string",
  "labels": ["string"],
  "parent_id": "string | null",
  "url": "string"
}
```
