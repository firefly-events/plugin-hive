# multica-story-dispatch

## Purpose

`hive/lib/multica-story-dispatch` translates Hive story data into a Multica issue brief and dispatches that issue to a Multica agent. It is intended for downstream mode skill calls that run once per story, after Multica has already been initialized and agents have been bootstrapped.

## Function Reference

`serializeStoryBrief(story) -> string` formats a Hive story into Markdown. It reads `description`, `acceptance_criteria`, `files_to_modify`, `code_examples`, and `references`, omits missing sections, and appends a generated footer.

`resolveAgentUuidByName(serverUrl, token, workspaceId, agentName) -> Promise<string>` fetches workspace agents and returns the matching agent UUID. It throws `BOOTSTRAP_REQUIRED` when the workspace has no agents or the requested name is absent.

`ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief) -> Promise<{was_updated: boolean, current_brief: string}>` reads the issue description and updates it with `PUT` only when it differs from the generated brief.

`dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid) -> Promise<object>` assigns the issue to an agent with `PUT {assignee_type: 'agent', assignee_id}` and returns the full Multica issue response.

`moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid) -> Promise<{was_moved: boolean}>` reads issue status and moves `backlog` issues to `todo`. Non-backlog statuses are left untouched.

`__resetCache() -> void` clears the module-level agent cache for tests.

## Caching

`AGENT_CACHE` stores agent lists per server URL, workspace ID, and token fingerprint. The token component is a SHA-256 digest truncated to 16 hex characters, so raw Multica tokens are never stored in cache keys.

## Error Envelope

All API helpers throw structured objects:

```js
{ code, message, hint? }
```

Transport failures use `TRANSPORT`. Non-2xx HTTP responses use `HTTP_<status>`. Bootstrap misses use `BOOTSTRAP_REQUIRED`. Messages and hints redact `mul_*`, `Bearer *`, `pat_*`, and the literal token when available.

## Reuses

This module reuses the direct-fetch, timeout, JSON parsing, response error envelope, token redaction, trailing-slash trimming, and token-fingerprint cache patterns from [`hive/lib/multica-bootstrap/index.mjs`](../multica-bootstrap/index.mjs).

## Forward Link

The per-story execute-mode caller is expected to be documented in [`skills/hive/skills/execute-mode-multica/SKILL.md`](../../../skills/hive/skills/execute-mode-multica/SKILL.md) in the s3 follow-up.

## Stateless MCP compat note

This bridge has two distinct wires, governed by two different contracts. Both are
already tolerant of the stateless MCP spec cutover (effective 2026-07-28); this
note records the audit (PLU-542) so a future edit doesn't reintroduce session
affinity on either wire.

- **stdio JSON-RPC** (`mcp-tools.mjs`, `handleRpcMessage` / `writeMessage`) — the
  local MCP client transport. `handleRpcMessage` dispatches purely on
  `message.method` per call; it stores no session state anywhere, so an
  `initialize` call never gates or unlocks any other method. The server does
  implement an `initialize` method handler (returns `protocolVersion` /
  `capabilities` / `serverInfo`) and silently ignores
  `notifications/initialized`, but this is a **spec-compliance flag, not a live
  handshake**: `tools/list` and `tools/call` work identically whether or not
  `initialize` was ever sent first. Post-cutover, if a client stops sending
  `initialize`, the bridge's behavior is unchanged — the handler just never
  fires, which is a no-op, not a break.
- **REST + Bearer** (`httpJson`, duplicated in `index.mjs`, `cli.mjs`, and
  `episode-sync.mjs` — all three hit the same Multica server and must stay
  session-header-free) — the wire to the Multica server.
  This is not MCP transport; `Mcp-Session-Id` / sticky-routing semantics do not
  apply here regardless of spec version. Every call is a fresh
  `fetch(url, { headers, signal })` carrying only `Accept`, `User-Agent`, and
  (when present) `Authorization: Bearer <token>` / `Content-Type` — no session
  or affinity header is ever set or read. On the response side,
  `__tests__/index-stateless.test.mjs` simulates a legacy endpoint that DOES
  send Set-Cookie / Mcp-Session-Id and asserts resolution succeeds
  unchanged — `httpJson` never reads response headers, demonstrating
  stateless tolerance on this wire.

When a client's `initialize` call omits `protocolVersion`, the stdio JSON-RPC
handler negotiates against the shared supported-version list in
[`../mcp-protocol-version.js`](../mcp-protocol-version.js). A supported client
version is echoed; an omitted or unsupported version resolves to the newest
published version the server supports. The same helper is used by
`openai-image-mcp-server.js`, so both hand-rolled servers move together.

Guard: do not add an `Mcp-Session-Id` header, a cookie jar, or any per-connection
state to either wire. If a future Multica API version requires session
continuity, that is a deliberate protocol change requiring its own story — not
something to bolt onto `httpJson` or the JSON-RPC handler incidentally.
