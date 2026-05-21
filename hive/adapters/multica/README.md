# Multica Task-Tracking Adapter

Implements the Hive task-tracking adapter ABI against Multica's REST API.

- **ABI version:** `1.0.0`
- **Hierarchy:** workspace → issue, with parent issue links on create
- **Supports parent link:** `true`
- **Supported states:** `todo`, `in_progress`, `in_review`, `done`, `cancelled`

## Authentication

The adapter reads credentials from environment variables first, then from
`~/.multica/config.json`.

| Setting | Env override | Config field |
|---------|--------------|--------------|
| API token | `MULTICA_TOKEN` | `token` |
| REST server URL | `MULTICA_SERVER_URL` | `server_url` |
| App URL for synthesized issue links | none | `app_url` |
| Workspace UUID cache | none | `workspace_id` |

Requests use:

```text
Authorization: Bearer <token>
```

If the token or server URL is missing, the adapter emits `AUTH_FAILURE`. Run
`/hive:multica-init` or set the environment variables before invoking it.

## Invocation

The adapter reads JSON from stdin and writes JSON to stdout. Exit code is `0` on
success, `1` on adapter-emitted error, and `2` on malformed JSON or stdin
transport failure.

```bash
echo '{"method":"capabilities","params":{}}' | ./index.ts

echo '{
  "method": "createStory",
  "params": {
    "title": "Add pagination",
    "body": "Issues page maxes at 50",
    "labels": ["hive:ready"]
  }
}' | MULTICA_TOKEN=mul_xxx MULTICA_SERVER_URL=http://localhost:8080 ./index.ts

echo '{"method":"updateStory","params":{"id":"plugin-hive/PLU-4","status":"done"}}' | ./index.ts

echo '{"method":"addComment","params":{"id":"plugin-hive/PLU-4","body":"Ready for review"}}' | ./index.ts

echo '{"method":"getStory","params":{"id":"plugin-hive/PLU-4"}}' | ./index.ts
```

Argv form for ad-hoc testing:

```bash
./index.ts '{"method":"capabilities","params":{}}'
```

## Install

The entry point carries a `#!/usr/bin/env -S npx tsx` shebang. For local use:

```bash
npm install
npx tsx ./index.ts < request.json
```

For packaged use, register the `multica-adapter` bin from this package.

## ID encoding

Hive sees story IDs as opaque strings. The Multica adapter uses:

```text
<workspace-slug>/<identifier>
```

Example: `plugin-hive/PLU-4`. Multica mutations require the issue UUID, so the
adapter resolves `PLU-4` to UUID via `GET /api/issues?workspace_id=<UUID>&identifier=PLU-4`
and falls back to listing issues when that filter is unsupported. Resolved UUIDs
are cached for the process lifetime.

## Debug

- Confirm `MULTICA_TOKEN` or `~/.multica/config.json` `token` exists.
- Confirm `MULTICA_SERVER_URL` or `~/.multica/config.json` `server_url` points
  at the REST API server, for example `http://localhost:8080`.
- Confirm `~/.multica/config.json` has `workspace_id`, or that
  `GET /api/workspaces` returns a workspace with slug `plugin-hive`.
- Adapter stderr contains human-readable hints only; the JSON ABI envelope is
  always written to stdout.
