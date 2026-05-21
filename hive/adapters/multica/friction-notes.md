# Multica Adapter — Friction Notes vs ABI 1.0.0

Recorded during s1-multica-adapter implementation so follow-on wiring and test
phases can pin the observed Multica contract.

## 1. Update uses PUT, not PATCH

`PATCH /api/issues/<uuid>` returns HTTP 405. The adapter uses
`PUT /api/issues/<uuid>?workspace_id=<uuid>` with body `{ "status": "done" }`.

## 2. Comment text field is `content`, not `body`

The ABI method is `addComment({ id, body })`, but Multica expects
`POST /api/issues/<uuid>/comments?workspace_id=<uuid>` with
`{ "content": "<text>" }`. Sending `body` produces HTTP 400.

## 3. Workspace id is a query parameter

Issue create, update, comment, and get calls require
`?workspace_id=<workspace-uuid>`. Putting the workspace in the JSON body fails.
The adapter reads `workspace_id` from `~/.multica/config.json` when present, or
resolves the slug `plugin-hive` through `GET /api/workspaces` and caches the UUID
for the process lifetime.

## 4. Issue responses have no URL

Multica returns `id` (UUID) and `identifier` (`PLU-N`) but no browser URL. The
adapter synthesizes `<app-or-server-url>/plugin-hive/issues/<N>`. This path is
provisional until the Multica frontend route is confirmed.

## 5. Slug/identifier must resolve to UUID

Hive stores the round-trip key as `plugin-hive/PLU-N`, while Multica mutation
paths require the internal UUID. The adapter resolves cold keys with
`GET /api/issues?workspace_id=<uuid>&identifier=PLU-N` first and falls back to
listing issues and finding the matching identifier if the filter is unsupported.

## 6. Labels do not round-trip

Create accepts a `labels` array, but current Multica reads may return
`labels: []`. The adapter passes labels through on create and does not treat
missing label round-trip as an error.

## 7. Invalid statuses can surface as server errors

Invalid status values can produce raw database constraint failures. The adapter
validates the enum locally: `todo`, `in_progress`, `in_review`, `done`,
`cancelled`.
