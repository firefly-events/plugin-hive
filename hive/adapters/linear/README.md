# Linear Task-Tracking Adapter

Implements the Hive task-tracking adapter ABI against Linear's GraphQL API.

- **ABI version:** `1.0.0`
- **Hierarchy:** `hierarchical` — Linear natively supports team → project → issue with parent links.
- **Supports parent link:** `true`
- **Supported states:** dynamic per team (e.g. `Backlog`, `Todo`, `In Progress`, `Done`, `Canceled`)
- **Supported labels:** dynamic per team (resolved from team metadata)

See [`../../references/task-tracking-adapter-abi.md`](../../references/task-tracking-adapter-abi.md) for the full ABI contract.

## Authentication

The adapter reads `LINEAR_API_KEY` from the environment. The key is sent as a raw `Authorization` header value — **not** `Bearer <key>`.

```
Authorization: lin_api_xxxxxxxxxx
```

The `Bearer` prefix is reserved for OAuth tokens issued to third-party Linear apps. Personal API keys go in raw. If `LINEAR_API_KEY` is unset the adapter emits `AUTH_FAILURE`.

In addition, several methods require a team context. Set `LINEAR_TEAM` to a team key (e.g. `ACME`). Methods that need it:

- `capabilities` — to enumerate workflow state names and label names
- `createStory` (when not explicitly passing `team_value` as a Linear team UUID)
- `updateStatus` — resolves the state name to a workflow-state UUID
- `listOpen` — scopes the query to the team

Methods that operate on a known `TEAM-123` identifier (`getStory`, `addComment`, `linkStories`, `setAssignee`) work without `LINEAR_TEAM`.

## Invocation

The adapter reads JSON from stdin and writes JSON to stdout. Exit code is `0` on success, `1` on adapter-emitted error, `2` only on transport/parse failure.

```bash
# Capabilities (requires LINEAR_TEAM for dynamic states/labels)
LINEAR_TEAM=ACME echo '{"method":"capabilities","params":{}}' | ./index.ts

# Create an issue
echo '{
  "method": "createStory",
  "params": {
    "title": "Add pagination",
    "body": "Issues page maxes at 50",
    "labels": ["enhancement"]
  }
}' | LINEAR_TEAM=ACME ./index.ts

# Get a single issue
echo '{"method":"getStory","params":{"id":"ACME-42"}}' | ./index.ts
```

Argv form for ad-hoc testing:

```bash
./index.ts '{"method":"capabilities","params":{}}'
```

### Running the TypeScript entry point directly

`index.ts` carries a `#!/usr/bin/env tsx` shebang. Install [`tsx`](https://github.com/privatenumber/tsx) globally or invoke via `npx tsx`:

```bash
npm install -g tsx
tsx ./index.ts < request.json
```

For a packaged CLI, compile to `dist/index.js` with `tsc` (or `esbuild`) and register that path in `hive.config.yaml`.

## ID encoding

Hive sees story IDs as opaque strings. The Linear adapter uses Linear's native identifier:

```
TEAM-123
```

Examples: `ACME-42`, `HIVE-7`. The regex `^[A-Z][A-Z0-9_]*-\d+$` is enforced — malformed ids raise `NOT_FOUND` rather than emitting a request. Linear's GraphQL `issue(id: "TEAM-123")` accepts this identifier directly for reads; mutations that take parent/child references resolve to internal UUIDs transparently.

## Hierarchical mapping

| ABI concept | Linear mapping |
|-------------|----------------|
| Flat story | Plain `Issue` |
| Parent link | Native `parent` field on `Issue` |
| `parent_id` on `createStory` | Issue's UUID is resolved and passed as `parentId` to `issueCreate` |
| `parent_id` on `getStory` response | `issue.parent.identifier` (e.g. `ACME-3`) |
| `linkStories(parent, child)` | Single `issueUpdate(id: childUuid, input: { parentId: parentUuid })` mutation |

Compared to the GitHub adapter, `linkStories` is **one mutation** rather than two — Linear exposes parent linkage natively without a separate Sub-Issues endpoint.

## Rate limiting

Linear's rate-limit signal lives in the GraphQL response body, **not** the HTTP status. Both 200 and 400 responses can carry a rate-limit error. The adapter detects:

| Linear response | ABI mapping |
|-----------------|-------------|
| `errors[*].extensions.code === "RATELIMITED"` | `RATE_LIMIT` with `retry_after_ms` from `X-RateLimit-Requests-Reset` (epoch ms) header, falling back to `extensions.reset` if present, or default 60s |
| `errors[*].extensions.code === "AUTHENTICATION_ERROR"`, or HTTP 401/403 | `AUTH_FAILURE` |
| `errors[*].extensions.code === "ENTITY_NOT_FOUND"` or message contains "not found" | `NOT_FOUND` |
| Other GraphQL errors | `UNKNOWN_METHOD` |

`retry_after_ms` is the milliseconds Hive should wait before retrying.

## Caveats

- **Dynamic capabilities.** `supported_states` and `supported_labels` change per team. The adapter fetches them via team metadata when `LINEAR_TEAM` is set; without it the adapter falls back to Linear's default state names (`Backlog`, `Todo`, `In Progress`, `Done`, `Canceled`) and returns `null` for labels.
- **Label/state names → UUIDs.** Linear mutations take UUIDs, not names. The adapter resolves names to UUIDs using cached team metadata. An unknown label or state surfaces as `OPERATION_UNSUPPORTED`.
- **`team_value` / `project_value` field declarations.** `capabilities.metadata.team_field` is `"teamId"` (a Linear team UUID) and `project_field` is `"projectId"`. Hive may also pass a team key as `team_value` for `listOpen` (the adapter accepts either UUID or `^[A-Z][A-Z0-9_]*$` key shape).
- **Subprocess-scoped cache.** Team metadata is cached in-memory only for the lifetime of one adapter invocation. Each Hive call spawns a fresh subprocess; subsequent calls re-fetch metadata. This is fine for adapter ABI semantics but adds a metadata round-trip per call.
- **Capabilities cached per Hive session.** Restart the Hive session to pick up adapter changes (per ABI §Capability caching).
