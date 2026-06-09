# Horizontal Planning Scan

This map preserves the architect's locked choices from PLU-303 and lays out the full breadth of the multica-plugin-ui work. It is intentionally not an execution sequence. Slice order belongs in `vertical-plan.md`.

**Source inputs**
- `.pHive/epics/multica-plugin-ui/docs/design-discussion.md`
- PLU-303 architect comment on issue `33a51d93-5809-4f53-a953-b2d2ea143283`
- Locked research findings in `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md`

## 1. Layer Inventory

1. Frontend plugin package
2. Frontend route and nav anchors
3. Auth/session/WebSocket inheritance
4. Backend route mount
5. HiveStore persistence boundary
6. Hive Postgres schema
7. Skills catalog
8. Four Hive views
9. Fork anchors and upstream seam extraction

## 2. Per-Layer Requirements

## Layer: Frontend plugin package

**Responsibility**
- Own the Hive React views, client API functions for `/api/plugins/hive/*`, view-local query keys, and UI state.
- Live as a workspace/npm package added to Multica's build graph, not a runtime drop-in.

**Required surfaces**
- `EpicTreeView`
- `ReviewGatesView`
- `PersonalQueueView`
- `HermesChatView`
- Plugin client calls to Hive API routes
- Package registration in Multica build config

**Evidence seams**
- `apps/web/next.config.ts:27`
- `apps/web/package.json:21-23`
- `packages/views/layout/dashboard-layout.tsx:21-45`
- `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12`
- `apps/web/next.config.ts:35-69`

**Dependencies**
- Needs the build-time package composition pattern already used by Multica.
- Depends on route/nav anchors and inherited auth/session/WS behavior.
- Depends on backend handlers and HiveStore for real data.

## Layer: Frontend route and nav anchors

**Responsibility**
- Expose Hive routes under `/{workspaceSlug}/hive/...`.
- Insert sidebar entries for the Hive views.
- Keep the anchor edits thin and additive.

**Required surfaces**
- Workspace-scoped path builders
- Route files for the Hive views
- Sidebar nav item insertion
- Optional legacy redirect handling if Hive ever needs it

**Evidence seams**
- `packages/core/paths/paths.ts:1-13`
- `packages/core/paths/paths.ts:17-41`
- `apps/web/app/[workspaceSlug]/(dashboard)/...`
- `packages/views/layout/app-sidebar.tsx:102-150`
- `packages/views/layout/app-sidebar.tsx:608-722`
- `apps/web/proxy.ts:4-18`

**Dependencies**
- Depends on the frontend plugin package.
- Depends on workspace slug/provider context.
- Depends on the backend route mount for live API calls.

## Layer: Auth/session/WebSocket inheritance

**Responsibility**
- Reuse Multica's existing session, API, and WebSocket boundaries.
- Avoid introducing a separate Hive auth model.

**Required surfaces**
- Existing `/api`, `/ws`, `/auth`, and `/uploads` browser paths
- Existing workspace auth gating
- Existing backend authenticated route group

**Evidence seams**
- `apps/web/next.config.ts:35-69`
- `apps/web/app/[workspaceSlug]/layout.tsx:26-90`
- `server/cmd/server/router.go:301-304`

**Dependencies**
- Depends on routing the plugin inside the same Next.js app and the same backend auth group.
- Supports all four views without extra auth plumbing.

## Layer: Backend route mount

**Responsibility**
- Mount `/api/plugins/hive/*` inside the existing authenticated chi group.
- Build-link the Hive handlers instead of using runtime Go plugin loading.

**Required surfaces**
- `hive.Router(store HiveStore, authz WorkspaceAuthorizer)` or equivalent
- One append-point in `server/cmd/server/router.go`
- Request handling under the existing auth middleware

**Evidence seams**
- `server/cmd/server/router.go:96-112`
- `server/cmd/server/router.go:111-142`
- `server/cmd/server/router.go:301-304`
- `server/cmd/server/router.go:535-590`

**Dependencies**
- Depends on the server's pgx pool and auth middleware.
- Depends on HiveStore and Hive schema readiness.
- Underpins every Hive API call from the frontend package.

## Layer: HiveStore persistence boundary

**Responsibility**
- Own Hive SQL, migrations, and typed read/write APIs.
- Keep Hive persistence separate from Multica sqlc-generated core DB code.

**Required surfaces**
- `Migrate(ctx) error`
- `ListEpicTree(ctx, workspaceID)`
- `UpsertEpicNode(ctx, workspaceID, input)`
- Future methods for gates, queue, chat, and catalog materialization

**Evidence seams**
- `server/cmd/server/main.go:142-160`
- `server/cmd/server/router.go:96-112`

**Dependencies**
- Depends on the Postgres pool already created by Multica.
- Depends on the `hive` schema and its migration ledger.
- Feeds the backend route mount.

## Layer: Hive Postgres schema

**Responsibility**
- Own all Hive tables in the same Postgres database but in a separate `hive` schema.
- Maintain `hive.schema_migrations` locally.
- Avoid touching Multica's numbered migration stream.

**Required surfaces**
- `hive.epic_nodes`
- `hive.review_gates`
- `hive.personal_queue_items`
- `hive.hermes_threads`
- `hive.hermes_messages`
- `hive.plugin_skill_catalog_state`
- `hive.schema_migrations`

**Evidence seams**
- `server/internal/migrations/migrations.go:13-16`
- `server/internal/migrations/migrations.go:50-69`
- `server/cmd/migrate/main.go:46-56`
- `server/cmd/migrate/main.go:105-109`
- `server/sqlc.yaml:1-10`
- `server/migrations` duplicate numeric prefixes: `091_*`, `095_*`, `096_*`

**Dependencies**
- Depends on the existing Postgres instance and pool.
- Must not feed `server/sqlc.yaml`.
- Must not add files to `server/migrations`.

## Layer: Skills catalog

**Responsibility**
- Ship a versioned plugin catalog in the Hive package.
- Let users browse it before materialization.
- Materialize selected skills into Multica DB only on enable/customize/import.

**Required surfaces**
- `GET /api/plugins/hive/skills/catalog`
- `POST /api/plugins/hive/skills/{catalogKey}/materialize`
- `GET /api/plugins/hive/skills/materializations`
- `hive.plugin_skill_catalog_state`

**Evidence seams**
- `server/migrations/008_structured_skills.up.sql:4-31`
- `server/internal/handler/skill.go:212-307`
- `server/internal/handler/skill.go:1582-1660`
- `server/internal/handler/runtime_local_skills.go:717-731`
- `server/internal/handler/skill.go:1750-1838`
- `server/internal/handler/runtime_local_skills.go:478-495`
- `server/internal/handler/runtime_local_skills.go:580-637`

**Dependencies**
- Depends on the Hive route mount and HiveStore.
- Depends on the existing Multica `skill`, `skill_file`, and `agent_skill` tables for materialized state.
- Depends on explicit provenance/version rules to avoid overwriting user customization.

## Layer: Four Hive views

**Responsibility**
- Provide four separate frontend view modules backed by the same Hive API/store boundary.
- Preserve a single set of routes, auth, and state context.

**Required surfaces**
- `EpicTreeView`
- `ReviewGatesView`
- `PersonalQueueView`
- `HermesChatView`
- Shared workspace-scoped route/nav anchors

**Evidence seams**
- `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12`
- `packages/views/layout/dashboard-layout.tsx:21-45`
- `packages/views/layout/app-sidebar.tsx:102-150`
- `packages/views/layout/app-sidebar.tsx:608-722`

**Dependencies**
- All views depend on the frontend package, route/nav anchors, and auth/session/WS inheritance.
- EpicTree is the proof view for Slice 1.
- ReviewGates, PersonalQueue, and HermesChat all rely on the same backend/store seam.

## Layer: Fork anchors and upstream seam extraction

**Responsibility**
- Keep the initial implementation as a thin fork patch set.
- Extract only the proven generic seam later, after Slice 1 and the remaining slices are grounded.

**Required surfaces**
- Workspace package registration
- One route group import
- One nav slot import
- One backend route mount
- Optional generic seam abstraction after proof

**Evidence seams**
- `apps/web/next.config.ts:27`
- `packages/views/layout/app-sidebar.tsx:102-150`
- `packages/views/layout/app-sidebar.tsx:608-722`
- `server/cmd/server/router.go:301-304`
- `server/cmd/server/router.go:535-590`

**Dependencies**
- Depends on evidence from the shipped EpicTree, views, and skills slices.
- Must stay generic-looking enough to upstream later.

## 3. Cross-Layer Dependencies

DEPENDENCIES:

- Frontend plugin package -> frontend route/nav anchors because the views must be imported into the app shell and routed under workspace context.
- Frontend plugin package -> auth/session/WebSocket inheritance because the views need the existing session and `/ws` behavior without extra auth code.
- Frontend route/nav anchors -> backend route mount because the visible routes must resolve to live handlers.
- Backend route mount -> HiveStore because the mounted handlers must call a typed persistence boundary.
- HiveStore -> Hive Postgres schema because durable writes and reads go through `hive.*`.
- Hive Postgres schema -> HiveStore because migrations and ledger setup must exist before reads and writes.
- Skills catalog -> Hive Postgres schema because materialized skills must land in DB-backed tables and keep provenance in `hive.plugin_skill_catalog_state`.
- Skills catalog -> existing Multica skill tables because enable/customize/import converges on `skill`, `skill_file`, and `agent_skill`.
- Four Hive views -> route/nav anchors because each view needs a workspace-scoped entry point.
- Four Hive views -> backend route mount and HiveStore because each view is only meaningful if it can talk to the same authenticated API/store boundary.
- Fork anchors -> every other layer because the fork surface must stay thin while the plugin package owns the logic.
- Upstream seam extraction -> all layers because the seam can only be generalized after the concrete route/package/nav/store shape is proven.

## 4. Layer Map Diagram

```text
HORIZONTAL LAYER MAP
────────────────────────────────────────────────────────────────────────────────────────────

Layer                          │ What it owns now                         │ Key seam
───────────────────────────────┼───────────────────────────────────────────┼──────────────────────
Frontend plugin package        │ Hive React views, client API, state      │ build-time package
Frontend route and nav anchors │ workspace routes, sidebar entries        │ thin route/nav edits
Auth/session/WS inheritance    │ existing cookies, `/ws`, workspace auth  │ inherited free seam
Backend route mount            │ `/api/plugins/hive/*` handlers           │ one router anchor
HiveStore                      │ typed persistence boundary               │ store interface
Hive Postgres schema           │ `hive.*`, `hive.schema_migrations`       │ separate schema
Skills catalog                 │ versioned catalog + materialization      │ hybrid catalog model
Four Hive views                │ EpicTree, ReviewGates, Queue, Chat       │ shared API/store
Fork anchors                   │ patch set now, upstream seam later       │ thin anchor diff
────────────────────────────────────────────────────────────────────────────────────────────

Frontend package and route/nav anchors feed the same browser shell.
Backend route mount, HiveStore, and Hive schema form the durable data path.
Skills catalog and the four views both depend on that same route/store boundary.
Fork anchors stay thin until the concrete behavior proves a generic seam is worth upstreaming.
```

## 5. Scope Summary

HORIZONTAL SCOPE:
- Layers affected: 9
- Total items: 9 layer entries, 16+ concrete surfaces, and 4 views
- New vs modified: mostly new plugin-owned code, with a small number of thin Multica anchors modified
- Estimated total effort: large

LARGEST LAYER:
- Four Hive views, because each view has its own UI, API, and persistence shape.

RISKIEST LAYER:
- Hive Postgres schema, because it is the fork-maintenance trap if it leaks into Multica's numbered migration stream.

ESCALATION FLAGS:
- `security:plan-audit` is raised because the epic adds a new authenticated API surface under `/api/plugins/hive/*`, a new Hive-owned schema, and cross-system skill materialization.
- `performance:audit` is raised because EpicTree, PersonalQueue, and HermesChat can all involve large hierarchical/list/chat datasets and new query patterns.

RISK NOTES:
- Slice 1 must prove that the plugin can own storage without deep router surgery or new core migration files.
- If that fails, the remainder of the epic should not be expanded.
