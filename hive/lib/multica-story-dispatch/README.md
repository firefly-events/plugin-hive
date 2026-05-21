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
