# Multica Adapter — Friction Notes vs ABI 1.1.0

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

---

## ABI 1.1.0 delta (2026-06-14)

### 8. Squad evaluations live in the timeline, not on the issue or a squad endpoint

The original PLU-104 spec assumed a dedicated squad endpoint (`GET
/api/issues/{id}/squad-activity`) and a free-text `evaluation` field. Both were
wrong. Squad-leader evaluations land in the unified activity log and are read via:

```
GET /api/issues/{id}/timeline?workspace_id=<uuid>
```

Response: `{ entries: [...], next_cursor }`. Each entry carries `type`
(`activity`|`comment`), `action`, `actor_type`, `actor_id`, `created_at`, and a
`details` blob. Squad evals have `action == 'squad_leader_evaluated'` with
`details: { outcome, reason }`.

### 9. outcome is a fixed enum, not free text

`outcome` is constrained to `action | no_action | failed`. The adapter validates
this and throws `TRANSPORT` if an unexpected value is returned, rather than
silently passing it upstream.

### 10. updateIssueStatus deliberately NOT added

The description note confirmed this is read-side only. `updateStory({status})`
already covers status transitions; a separate `updateIssueStatus` would be
redundant.
