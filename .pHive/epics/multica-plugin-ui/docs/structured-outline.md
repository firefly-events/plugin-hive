# Structured Outline — multica-plugin-ui

---

## Part 1: Executive Summary

This epic delivers Hive as a build-time-bundled plugin surface inside Multica rather than as a runtime-loaded drop-in. The architectural lock is deliberate and consequential: every decision downstream follows from the choice to bundle Hive at build time rather than discover it at runtime. Frontend behavior anchors through thin workspace-scoped Next.js routes and sidebar navigation entries. Backend behavior anchors through a single authenticated chi route mount at `/api/plugins/hive/*`. Neither surface invents new infrastructure; both parasitize proven Multica machinery, which is the entire point of this architectural choice.

The frontend composition model is already demonstrated by the existing workspace. `apps/web/next.config.ts:27` shows the `transpilePackages` list that build-time-registers workspace packages, and `apps/web/package.json:21-23` shows the pattern by which `@multica/core`, `@multica/ui`, and `@multica/views` enter `apps/web` as workspace dependencies. Adding `@multica/hive` follows the exact same convention — there is no novel mechanism involved, only a new package added to an established pattern. The route structure is equally well-established: `apps/web/app/[workspaceSlug]/layout.tsx:26-90` gates every workspace route on auth and workspace lookup, `packages/views/layout/dashboard-layout.tsx:21-45` provides the shell that Hive views will inhabit, and `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12` shows the thin-adapter pattern that all Hive pages will follow. A Hive page adapter is five lines of import and render; it is not a place for business logic.

On the backend, `server/cmd/server/router.go:301-304` defines the protected API route group behind `middleware.Auth`, and `server/cmd/server/router.go:535-590` shows how existing feature handlers are mounted inside that group with explicit chi route registrations. Hive gets one mount in that same group: `r.Mount("/api/plugins/hive", hive.NewRouter(store, authz))`. Nothing about the core router changes shape — Hive is an occupant of an existing structure, not a structural change. The pgx pool is already created in `server/cmd/server/main.go:142-160`; HiveStore receives it as a constructor argument rather than creating a second database connection.

Auth, session, and WebSocket behavior are inherited from the Multica shell. This inheritance is not the same as complete authorization. Auth inheritance establishes that the caller has a valid session — that they are a known user — but it says nothing about what workspaces they may access. Every Hive handler must still verify that the user belongs to the workspace named in the request. The `WorkspaceAuthorizer` interface is the enforcement mechanism, and calling it on every handler is non-negotiable. Its absence from any Hive handler is a security defect, not a reasonable shortcut. The difference between "authenticated" and "authorized for this workspace" is the difference between a locked front door and a locked door that opens only if you're a registered tenant.

Hive data lives in a separate Postgres schema named `hive` within the same database. The core migration stream (`server/migrations/`) and its sqlc configuration (`server/sqlc.yaml:1-10`) must not receive Hive SQL. The reason this constraint is hard and not advisory: `server/internal/migrations/migrations.go:13-16` and `server/internal/migrations/migrations.go:50-69` show how core migrations are loaded by lexical sort order. Adding Hive files with their own numeric prefixes (e.g., `008_hive_tables.sql`) creates a fork-maintenance trap. Every time Multica adds a core migration at a number that was also used by Hive's local fork, a merge conflict or execution order problem appears. The Hive-owned migration ledger (`hive.schema_migrations`) and the separate runner (`server/internal/hive/migrations.go`) prevent this problem structurally: Hive's migration history never enters the core sort order.

Design feedback changed two things. The team rejected speculative generic loader work before proof. This means Phase 6 seam extraction only happens after Phases 1-5 demonstrate working concrete anchors, and only if measured fork churn justifies the abstraction cost. Abstracting before evidence is a form of premature optimization applied to architecture. The team also rejected automatic workspace skill seeding at install time. Automatic seeding creates version and ownership ambiguity that is hard to unwind: users cannot distinguish which skills Hive installed from which skills they created, and any catalog update becomes a potential overwrite of user-customized content.

Three architectural decisions were explicitly ruled out and will not be revisited within this epic. First, runtime plugin loading: Hive is a build-time-bundled package, not a runtime-discoverable extension. This closes off dynamic plugin discovery, hot-reloading of Hive views, and any architecture where Hive routes are mounted at runtime rather than at startup. Second, separate data store: Hive uses the same Postgres database as Multica, separated only by schema name. A separate database, a SQLite sidecar, an embedded key-value store, or any other storage architecture for Hive data is out of scope. This means there is no separate connection pool to manage, no cross-database transactions, and no data synchronization problem between Hive and core Multica. Third, automatic workspace seeding: no Hive capability materializes automatically in a workspace without explicit user action. This applies to skills (no auto-materialization), epic nodes (no demo data injection), and review gates (no default templates). These three rejections are not hedged; they are architectural commitments that downstream decisions depend on.

The six-phase sequence is ordered by a specific risk principle: each phase either (a) proves a structural assumption that all subsequent phases depend on, or (b) adds user-facing capability through the proven seam without reopening the seam. Phase 1 proves the seam — all other phases assume it works. Phase 2 proves that a second Hive view can be added without Phase 1 rework. Phases 3 and 4 add queue and chat capability using exactly the patterns established in Phases 1 and 2. Phase 5 adds the cross-system write path, which is the only place the Hive/Multica boundary is crossed at the data layer. Phase 6 is conditional cleanup. This ordering means that when Phase 5 is being implemented, the auth model, the HiveStore pattern, the migration isolation, the nav anchors, and the API client are already working and tested. Phase 5 implementers do not make architectural decisions; they add new capabilities to an established foundation. The risk decreases with each completed phase, which is the correct direction for a multi-phase delivery.

The five layers that every Hive view touches — route, nav, API, store, and schema — must all be addressed in Phase 1 for the proof to be meaningful. Addressing only route and schema in Phase 1 and deferring nav and API would mean that Phase 2 is still doing foundational work. A view that touches all five layers and can be demonstrated end-to-end in a browser is the only acceptable definition of "Phase 1 complete." An EpicTree that renders from real data, writes through the API to the store, persists to the database, and loads again on refresh has touched all five layers. A route that returns a 200 with hardcoded JSON has touched two. The Phase 1 acceptance criteria must explicitly require all five layers.

The strategy is ordered by risk. Slice 1 proves the route/store seam before any subsequent work begins. The proof gate has three hard bail criteria: if the route mount requires deep router surgery beyond one authenticated `r.Mount`, the epic stops; if the seam cannot complete one durable write and read through `hive.epic_nodes`, the epic stops; if Hive schema requires tables in core migrations or sqlc input, the epic stops. EpicTree is the proof view because it is the most minimal representation that exercises all five layers simultaneously — route, nav, API, store, and schema. Passing the proof gate means all five layers compose correctly. The four user-facing views (EpicTree, ReviewGates, PersonalQueue, HermesChat), the skills catalog, and the upstream seam extraction are each separate slices that follow in order, with each post-proof slice constrained to not reopen the route/store/auth architecture established in Phase 1.

**Out of scope for this epic** — not deferred, not planned, not eligible for scope creep:

- A general runtime plugin loader or a general plugin platform framework
- Separate database, SQLite sidecar, or any Hive data store other than the shared Postgres database
- Automatic workspace skill seeding at install or at upgrade time
- Bulk skill import or bulk skill removal
- Skill version upgrade workflows (materialized-to-newer-version flows)
- Agent execution flows triggered from within Hive views
- A public API for third-party plugin integration
- Admin delegation for PersonalQueue or cross-user queue visibility (unless confirmed in sign-off)
- Realtime HermesChat (unless the sign-off decision requires it from Phase 4)
- Phase 6 extraction unless Phases 1-5 produce measurable fork churn that justifies it
- UI polish, animation, accessibility remediation, or responsive design work beyond functional correctness

---

## Part 2: Detailed Approach

### Phase 1: Proof Gate — Backend Route Mount, HiveStore, Minimal EpicTree

Phase 1 is the decisive slice. Its purpose is not to deliver a polished user-facing feature; its purpose is to answer one question: can Hive establish a clean route/store seam without requiring structural changes to core Multica router or migration infrastructure? All six subsequent slices assume the answer is yes. If the answer is no, Phase 1 produces its most valuable output — a verified stopping point — and avoids wasting implementation effort on a broken foundation.

**Frontend package setup.** The Hive frontend package is created at `packages/hive/` with three initial files: `package.json` defining package exports and workspace dependencies, `tsconfig.json` extending the local TypeScript convention used by existing packages, and `src/index.ts` exporting the minimal `EpicTreeView` and proof-gate client surfaces. `apps/web/package.json` gains `@multica/hive` as a workspace dependency, which mirrors lines 21-23 of the existing file. `apps/web/next.config.ts` gains `@multica/hive` in `transpilePackages`, matching the existing build-time package pattern at line 27. The `pnpm-workspace.yaml` file needs modification only if the Hive package is placed outside the existing `packages/*` glob; at `packages/hive`, the glob already covers it.

**Workspace route and navigation.** The page adapter at `apps/web/app/[workspaceSlug]/(dashboard)/hive/page.tsx` is thin by design: import `EpicTreeView` from `@multica/hive`, render it inside the workspace context, and stop. This follows the same pattern as `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12`. An optional canonical route at `hive/epics/page.tsx` provides an alternative URL if the product decision from sign-off decision 6 favors `/hive/epics` over `/hive`. Route builders for `hive()` and `hiveEpicTree()` are added to `packages/core/paths/paths.ts`, following the workspace-scoped builder pattern shown at lines 17-41 of that file. `packages/views/layout/app-sidebar.tsx` gains a Hive nav key, label key, and a sidebar entry using the static nav array at lines 102-150, rendered through the slot shown at lines 608-722. A locale entry is added to the existing layout locale file for the Hive nav label text.

**API client layer.** The `packages/hive/src/api/` directory contains four files: `client.ts` for direct HTTP calls to `/api/plugins/hive/*`; `types.ts` for shared frontend DTOs (`EpicNode`, `EpicNodeInput`); `queries.ts` for React Query option factory functions; and `mutations.ts` for write operations with query invalidation logic. React Query keys must include workspace ID at the outermost scope to prevent cross-workspace cache bleed — this is not a Phase 5+ concern, it must be established in the initial key structure.

**Backend mount.** The change to `server/cmd/server/router.go` is intentionally minimal: one `hive` package import, one construction of `hive.NewRouter(store, authz)`, and one `r.Mount("/api/plugins/hive", ...)` inside the existing protected route group. The implementation is surgical by requirement. `server/cmd/server/main.go` constructs HiveStore after the pgx pool is connected at lines 142-160 and marks startup unhealthy or readiness as failing if the Phase 1 migration cannot be applied or verified.

**Hive backend package structure.** `server/internal/hive/` contains: `router.go` (chi router and EpicTree route registrations), `store.go` (the `HiveStore` interface with `Migrate`, `ListEpicTree`, and `UpsertEpicNode` and their pgx implementations), `migrations.go` (migration runner that writes to `hive.schema_migrations` rather than the core ledger), `authz.go` (the `WorkspaceAuthorizer` interface and its implementation), and `epic_nodes.go` (proof read/write request handlers with DTO mapping). SQL migrations live in `server/internal/hive/migrations/001_epic_nodes.up.sql` — which creates the `hive` schema, `hive.schema_migrations`, and `hive.epic_nodes` — and `001_epic_nodes.down.sql` for local and test rollback. No file under `server/migrations/` is touched. `server/sqlc.yaml` is unchanged.

**Key interfaces for Phase 1.** `hive.NewRouter(store HiveStore, authz WorkspaceAuthorizer) chi.Router`. `HiveStore` interface: `Migrate(ctx context.Context) error`, `ListEpicTree(ctx context.Context, workspaceID uuid.UUID) ([]EpicNode, error)`, `UpsertEpicNode(ctx context.Context, workspaceID uuid.UUID, input EpicNodeInput) (EpicNode, error)`. `WorkspaceAuthorizer` interface: `RequireWorkspace(ctx context.Context, r *http.Request, workspaceID uuid.UUID) error`. Frontend paths: `paths.workspace(slug).hive(): string`, `paths.workspace(slug).hiveEpicTree(): string`. Frontend view: `function EpicTreeView(): JSX.Element`. API endpoints: `GET /api/plugins/hive/epic-tree?workspace_id={uuid}`, `PUT /api/plugins/hive/epic-tree/nodes/{nodeId}`. DTO types: `EpicNode = { id, workspaceId, parentId, title, status, updatedAt }`, `EpicNodeInput = { title, parentId?, status? }`. Error responses follow existing Multica conventions: 401 for absent auth, 403 for workspace membership failure, 400 for malformed identifiers, 409 for node ordering or parent constraint conflicts, 500 for store or migration failures.

**Tests for Phase 1.** `router_test.go` proves the route returns 401/403 for unauthenticated or unauthorized requests, and 200 for valid test auth context. `store_test.go` proves migration runs cleanly and one write/read round-trips correctly against a real test Postgres instance. `epic-tree-view.test.tsx` covers rendering, empty state, error state, and successful data display with mocked API responses.

---

### Phase 2: ReviewGates View

Phase 2 adds one capability through the proven seam. The governing constraint is architectural discipline: no changes to the auth model, router structure, or HiveStore interface pattern established in Phase 1. `server/cmd/server/router.go` must not be modified again in Phase 2. The single `r.Mount("/api/plugins/hive", ...)` in the protected group already covers all future Hive routes — new Hive routes register inside `server/internal/hive/router.go`, not at the top-level server router. Passing the proof gate means the seam is proven; Phase 2 is about expanding Hive capability within that proven seam, not revalidating it.

ReviewGates allows a user to list gates scoped to an epic and workspace, inspect the evidence attached to each gate, and update gate state. The list view shows all gates for a given epic with their current state and a summary of attached evidence. The detail view shows the full evidence set for a selected gate. The update path allows changing state between `pending`, `passed`, and `failed` with an optional note. Phase 2 does not implement a complex state machine; that is deferred if sign-off identifies specific state transition constraints that require it.

The backend adds `review_gates.go` containing handlers for list, detail, and update operations; migration `002_review_gates.up.sql` creating `hive.review_gates`; and HiveStore method extensions `ListReviewGates(ctx, workspaceID, epicID uuid.UUID) ([]ReviewGate, error)`, `GetReviewGate(ctx, workspaceID, gateID uuid.UUID) (ReviewGate, error)`, and `UpdateReviewGate(ctx, workspaceID, gateID uuid.UUID, input UpdateReviewGateInput) (ReviewGate, error)`. The `hive.review_gates` table stores `id`, `workspace_id`, `epic_id`, `name`, `state`, `evidence` (JSON), and `updated_at`. The index should cover `(workspace_id, epic_id)` to support the list-by-epic access pattern efficiently.

The frontend adds `review-gates-view.tsx` implementing the list/detail/update UI using existing Multica UI primitives, the thin page adapter at `hive/review-gates/page.tsx`, a `hiveReviewGates()` route builder in `packages/core/paths/paths.ts`, and extensions to `types.ts`, `client.ts`, `queries.ts`, and `mutations.ts` — all scoped additions to the package established in Phase 1. The update mutation must invalidate both the list query key (to reflect the new state in the list view) and the detail query key (to reflect the update in any open detail view).

Key interfaces: `ReviewGate = { id, workspaceId, epicId, name, state: "pending"|"passed"|"failed", evidence: ReviewGateEvidence[], updatedAt }`. `ReviewGateEvidence = { kind, summary, url?, createdAt }`. `UpdateReviewGateInput = { state, note? }`. Endpoints: `GET /api/plugins/hive/review-gates?workspace_id={uuid}&epic_id={uuid}`, `GET /api/plugins/hive/review-gates/{gateId}?workspace_id={uuid}`, `PATCH /api/plugins/hive/review-gates/{gateId}`. Additional error responses: 404 when a gate is absent or outside the workspace (preferred over 403 to avoid confirming the ID's existence in another workspace), 409 when state transition rules reject an update, 422 when the evidence payload shape is invalid.

WorkspaceAuthorizer is applied on every endpoint, not just the write path. A read that exposes gate names and evidence across workspace boundaries is also an authorization failure. The detail endpoint must return 404 for a gate ID that exists in a different workspace — the calling user should not learn that the ID refers to a real object at all. This 404-not-403 choice for cross-workspace object access is consistent across all Hive endpoints and must be established as a convention in `authz.go` rather than implemented ad hoc per handler.

---

### Phase 3: PersonalQueue View

Phase 3 adds queue functionality. Queue results carry a double scoping requirement that is security-critical rather than merely organizational: every query filters by workspace and by the current user's identity extracted from the auth context. A queue that returns another user's items exposes sensitive assignment data — the equivalent of reading another employee's task list. A queue that returns another workspace's items is a cross-tenant data breach. Both failures share the same root cause: relying on caller-supplied parameters for scoping rather than auth-context-derived identity. The rule is simple and must be enforced in SQL, not just in application logic: list and update operations use workspace ID and assignee user ID from the auth context, not from the request body.

The PersonalQueue view renders the current user's queue items in the current workspace. Each item shows status, priority, the kind of work it represents (which Hive feature area generated it), and a link to the linked target record. The default query returns active-status items for the current user. A user can update an item's status (e.g., marking it done) or snooze it until a future timestamp. The view includes links to four target types: Hive epic, Hive review gate, Multica issue, and Multica project.

Backend additions: `personal_queue.go` with list and update handlers that enforce dual workspace/user scoping in both handler logic and SQL; migration `003_personal_queue_items.up.sql` creating `hive.personal_queue_items`; and HiveStore method extensions. The table schema must include `workspace_id UUID NOT NULL`, `assignee_user_id UUID NOT NULL`, `status TEXT NOT NULL`, `priority TEXT`, `kind TEXT NOT NULL`, `title TEXT NOT NULL`, a target column (JSONB or typed columns for target type, ID, and href), and `updated_at`. The composite index `(workspace_id, assignee_user_id, status)` must be present from the first migration — the default active-items query uses all three columns and must be bounded by index seeks, not full table scans, even in Phase 3.

The frontend additions are `personal-queue-view.tsx` rendering the item list with status, priority, kind label, and a clickable target link; the thin page adapter at `hive/queue/page.tsx`; a `hiveQueue()` route builder in `packages/core/paths/paths.ts`; and extensions to `types.ts`, `client.ts`, `queries.ts`, and `mutations.ts`. React Query keys for queue data must include both workspace ID and user ID to ensure that if the user navigates between workspaces, the queue cache is not shared between them.

Key interfaces: `PersonalQueueItem = { id, workspaceId, assigneeUserId, kind, title, status, priority?, target: QueueTarget, updatedAt }`. `QueueTarget = { type: "hive_epic"|"hive_gate"|"multica_issue"|"multica_project", id, href }`. `UpdateQueueItemInput = { status?, snoozedUntil? }`. `HiveStore.ListPersonalQueue(ctx, workspaceID, userID uuid.UUID) ([]PersonalQueueItem, error)`, `HiveStore.UpdateQueueItem(ctx, workspaceID, userID, itemID uuid.UUID, input UpdateQueueItemInput) (PersonalQueueItem, error)`. The WHERE clause for update operations must include item ID, workspace ID, and current user ID as SQL conditions — an update with only item ID would allow any authenticated user to modify any queue item by guessing the ID. Error responses: 403 when a user attempts to update another user's item, 404 for absent or cross-workspace items.

The `QueueTarget.href` field encodes a cross-system link at the data layer rather than computing it at render time. This makes link rendering stateless and fast, but it means that when a linked core issue or project is deleted, the href becomes a dead link with no automatic detection or repair path. Phase 3 should ensure the `QueueTarget.type` field is modeled as a Go enum and a TypeScript discriminated union — this allows a future link resolver to pattern-match on type and check liveness without a schema migration.

---

### Phase 4: HermesChat View

Phase 4 delivers conversational threading within the Hive surface. Two constraints govern this slice and must not be compromised. First, no second authentication stack: Hive chat uses the same session auth that the rest of the Multica application uses. Second, no second WebSocket stack: the existing `/ws` rewrite at `apps/web/next.config.ts:35-69` routes WebSocket traffic to the Multica backend, and `packages/core/api/ws-client.ts` exists for WebSocket client usage. If realtime is justified by the sign-off decision for Phase 4, Hive reuses that existing path. If polling or manual refresh satisfies the Phase 4 acceptance criteria, that is the right default — it requires no additional backend infrastructure, no new WebSocket endpoint, and does not foreclose realtime integration in a follow-up slice. A second WebSocket client or a second WebSocket server endpoint is never acceptable regardless of the refresh decision.

Message pagination is mandatory from first implementation and is non-negotiable. An endpoint that returns all messages in a thread without a cursor establishes that behavior as the observable API contract. Callers will build UI that assumes a single response delivers the full thread. Retrofitting cursor-based pagination after users exist is a breaking API change requiring frontend refactor and backend API versioning. The first implementation must accept a cursor parameter and return a structured `Page[HermesMessage]` response containing the messages for the page and a cursor for the next page. Messages in `hive.hermes_messages` must be indexed on `(thread_id, created_at)` so that paginated queries seek by index rather than scanning the full messages table.

Backend additions: `hermes_chat.go` implementing thread create, thread list, message send, and paginated message read handlers; migration `004_hermes_chat.up.sql` creating `hive.hermes_threads` (with columns `id`, `workspace_id`, `title`, `created_by`, `updated_at`, `last_message_at`) and `hive.hermes_messages` (with columns `id`, `thread_id`, `workspace_id`, `sender_user_id`, `body`, `created_at`); and HiveStore method extensions. Thread visibility scoping must enforce workspace membership: a user should not be able to read another workspace's threads. Message send must verify the thread belongs to the current workspace before writing.

Frontend additions: `hermes-chat-view.tsx` rendering a thread list panel, a message timeline for the selected thread, and a message composer; the page adapter at `hive/chat/page.tsx`; a `hiveChat()` route builder; and standard type/client/query/mutation extensions. The React Query key for messages must include both workspace ID and thread ID to prevent cross-thread or cross-workspace cache bleed. The send-message mutation must optimistically append the message to the timeline and invalidate the message list query on settlement.

Key interfaces: `HermesThread = { id, workspaceId, title, createdBy, updatedAt, lastMessageAt? }`. `HermesMessage = { id, threadId, workspaceId, senderUserId, body, createdAt }`. `CreateHermesThreadInput = { workspaceId, title? }`. `SendHermesMessageInput = { workspaceId, body }`. `HiveStore.ListHermesThreads(ctx, workspaceID, userID uuid.UUID) ([]HermesThread, error)`, `HiveStore.CreateHermesThread(ctx, workspaceID, userID uuid.UUID, input CreateHermesThreadInput) (HermesThread, error)`, `HiveStore.ListHermesMessages(ctx, workspaceID, threadID uuid.UUID, cursor PageCursor) (Page[HermesMessage], error)`, `HiveStore.SendHermesMessage(ctx, workspaceID, threadID, userID uuid.UUID, input SendHermesMessageInput) (HermesMessage, error)`. Error responses: 413 if message body exceeds a configured size limit, 429 if rate limiting is added later, 404 for absent or unauthorized threads.

---

### Phase 5: Skills Catalog

Phase 5 is architecturally distinct from the view slices because it crosses the Hive/Multica boundary at the data layer. The view slices read and write only `hive.*` tables. Phase 5 also writes into core Multica tables — specifically `skill`, `skill_file`, and optionally `agent_skill` — defined in `server/migrations/008_structured_skills.up.sql:4-31`. This cross-store write is the operationally most sensitive operation in the entire epic and requires special care around transaction boundaries, provenance recording, and conflict handling.

The critical distinction between runtime-local skill discovery and Hive packaged catalog materialization: `server/internal/handler/runtime_local_skills.go:46-62` and `server/internal/handler/runtime_local_skills.go:478-495` demonstrate that runtime-local skill discovery depends on online runtime callbacks and live daemon state. That code cannot be reused or mimicked for Hive catalog browse — the Hive catalog must browse from packaged static metadata, not from a running service. The code is useful only as proof that the downstream write path (external content → DB-backed skills) is already proven. The existing CRUD in `server/internal/handler/skill.go:212-307` is the native representation that materialized skills become — Hive feeds it, not replaces it.

The materialization flow: a user browses `packages/hive/src/skills/catalog.ts` to see available catalog entries, selects one, and issues `POST /api/plugins/hive/skills/{catalogKey}/materialize`. The `skill_materializer.go` handler opens a single pgx transaction and writes `skill`, `skill_file`, optional `agent_skill`, and `hive.plugin_skill_catalog_state`. These four writes are atomic: if any fails, all roll back. Provenance fields (`catalogKey`, `catalogVersion`, target `skillId`, state) in `hive.plugin_skill_catalog_state` allow the system to distinguish materialized, customized, and superseded skills. On name collision — existing `skill` rows are unique by `(workspace_id, name)` per `server/migrations/008_structured_skills.up.sql:4-15` — the endpoint returns 409 unless the request body explicitly requests customize or import semantics.

No workspace is seeded automatically at install time. This is a design principle, not a performance choice. Users own their skill inventory, and automatic seeding means they cannot distinguish which skills they created from which skills Hive planted. Any upgrade to the catalog version could silently overwrite user work. The explicit-materialization model puts user intent in the execution path for every skill that appears in their workspace.

Before any materialization can succeed, the Hive materializer must validate that the catalog entry's file paths do not escape the expected directory, that the file content checksums match the packaged values, and that the calling actor has both `create_skill` permission and (when `assignToAgentId` is specified) `assign_agent_skill` permission. These checks must happen before any database writes. If any check fails, the transaction must not begin — no partial writes, no orphaned skill rows. The file path validation reuses the logic from `server/internal/handler/skill.go:212-307`; the Hive materializer does not implement its own weaker equivalent.

Key interfaces: `HiveSkillCatalogEntry = { key, version, name, description, files: CatalogSkillFile[], defaultConfig? }`. `CatalogSkillFile = { path, content, checksum }`. `SkillMaterialization = { catalogKey, catalogVersion, skillId, workspaceId, state: "materialized"|"customized"|"superseded", materializedAt }`. `MaterializeSkillInput = { workspaceId, name?, customize?, assignToAgentId? }`. Endpoints: `GET /api/plugins/hive/skills/catalog?workspace_id={uuid}` (returns all catalog entries with per-workspace materialization state), `GET /api/plugins/hive/skills/materializations?workspace_id={uuid}` (returns all materialization records for the workspace), `POST /api/plugins/hive/skills/{catalogKey}/materialize`. The catalog browse endpoint must return results even when no skills have been materialized and even when no runtime is connected — it reads from the packaged `catalog.ts`, not from a service. Additional error responses: 409 on name collision without explicit semantics, 422 on catalog file path validation failure, 403 when actor lacks permission to create skills or assign agent skills.

---

### Phase 6: Upstream Seam Extraction

Phase 6 is conditional. It proceeds only if measured fork churn from Phases 1-5 demonstrates that the concrete Hive anchors create rebase pain sufficient to justify an abstraction layer. "Fork churn" means the practical difficulty of rebasing the Hive feature branch onto upstream Multica changes — how many files conflict, how frequently they conflict, and how much manual resolution is required. If the concrete anchors produce a fork diff that fits in a manageable set of files and rebases cleanly with minor effort, Phase 6 produces documentation only. If the anchors create consistent rebase friction in specific locations (e.g., `app-sidebar.tsx` and `router.go` conflict on nearly every upstream merge), those specific locations become candidates for extraction.

The candidate extractions are each narrow and evidence-gated. A `transpilePackages` append point in `apps/web/next.config.ts` reduces package registration churn only if adding packages to that array is a frequent rebase conflict point. A plugin path helper in `packages/core/paths/paths.ts` is justified only if the Hive path function additions create conflicts and the helper remains type-safe, testable, and equivalent to the explicit functions in developer ergonomics. A nav slot or append helper in `packages/views/layout/app-sidebar.tsx` is justified only if the Hive nav entry additions conflict reliably with upstream nav changes. A generic `MountAuthenticatedPluginRoutes(r, ...PluginRouteMount)` helper in `server/cmd/server/router.go` is justified only after all Hive routes pass and the mount code in that file is a measured conflict source. Each extraction must be independently justified — Phase 6 is not a bundled refactor of all four candidates at once.

Phase 6 seam interfaces (if extraction is justified): `PluginRouteMount = { basePath string; router chi.Router }`, `func MountAuthenticatedPluginRoutes(r chi.Router, mounts ...PluginRouteMount)`, `type PluginNavItem = { key, href: (paths: WorkspacePaths) => string, labelKey, icon }`, `function createWorkspacePluginPath(slug, segment)`. The concrete `hive.NewRouter(store, authz)` remains unchanged regardless of extraction — the seam helper wraps mount registration at the server level, it does not replace the Hive router's internal construction. Documentation in `docs/plugin-seams.md` (or the accepted path) cites specific file paths, test references, and fork diff measurements from Phases 1-5. It describes what was done, not what could theoretically be done. It explicitly states that Multica does not have a general plugin platform — only that these specific extraction points reduce fork maintenance for this specific plugin.

### Frontend Routes and Views Summary

Each phase adds one or more Next.js page adapter files and a corresponding view package. The thin-adapter pattern means each page file is approximately five lines — import view, export a default function that renders it.

| Phase | Route (under `[workspaceSlug]/(dashboard)/`) | View component | Path builder |
|---|---|---|---|
| 1 | `hive/page.tsx` | `EpicTreeView` | `paths.workspace(slug).hive()` |
| 1 | `hive/epics/page.tsx` (optional redirect) | redirect to `/hive` | `paths.workspace(slug).hiveEpicTree()` |
| 2 | `hive/review-gates/page.tsx` | `ReviewGatesView` | `paths.workspace(slug).hiveReviewGates()` |
| 3 | `hive/queue/page.tsx` | `PersonalQueueView` | `paths.workspace(slug).hiveQueue()` |
| 4 | `hive/chat/page.tsx` | `HermesChatView` | `paths.workspace(slug).hiveChat()` |
| 5 | `hive/skills/page.tsx` (optional) | `SkillsCatalogView` | `paths.workspace(slug).hiveSkills()` |

All routes are inside the `(dashboard)` route group, which means they inherit the workspace layout at `[workspaceSlug]/layout.tsx:26-90` and the dashboard shell from `packages/views/layout/dashboard-layout.tsx:21-45`. Hive page files are not allowed to contain business logic, API calls, or data transformation — those belong in the view package. The page adapter's only job is to call the view component inside the correct context.

### API Endpoints Summary

All Hive endpoints live under `/api/plugins/hive/` and are mounted inside the `middleware.Auth` protected group. This summary records the intended complete endpoint surface across all six phases.

**Phase 1 — EpicTree**
- `GET /api/plugins/hive/epic-tree?workspace_id={uuid}` — list all epic nodes for the workspace
- `PUT /api/plugins/hive/epic-tree/nodes/{nodeId}` — upsert an epic node

**Phase 2 — ReviewGates**
- `GET /api/plugins/hive/review-gates?workspace_id={uuid}&epic_id={uuid}` — list gates for an epic
- `GET /api/plugins/hive/review-gates/{gateId}?workspace_id={uuid}` — get gate detail with evidence
- `PATCH /api/plugins/hive/review-gates/{gateId}` — update gate state and/or note

**Phase 3 — PersonalQueue**
- `GET /api/plugins/hive/queue?workspace_id={uuid}` — list current user's queue items (user from auth context)
- `PATCH /api/plugins/hive/queue/{itemId}` — update item status or snooze (current user only)

**Phase 4 — HermesChat**
- `GET /api/plugins/hive/chat/threads?workspace_id={uuid}` — list threads for the workspace
- `POST /api/plugins/hive/chat/threads` — create a new thread
- `GET /api/plugins/hive/chat/threads/{threadId}/messages?workspace_id={uuid}&cursor={cursor}` — paginated message list
- `POST /api/plugins/hive/chat/threads/{threadId}/messages` — send a message

**Phase 5 — Skills Catalog**
- `GET /api/plugins/hive/skills/catalog?workspace_id={uuid}` — browse packaged catalog with per-workspace materialization state
- `GET /api/plugins/hive/skills/materializations?workspace_id={uuid}` — list all materialization records for the workspace
- `POST /api/plugins/hive/skills/{catalogKey}/materialize` — materialize a catalog entry into the workspace

Every endpoint above requires `workspace_id` either in the query string or derivable from the URL. Every endpoint calls `WorkspaceAuthorizer.RequireWorkspace` before any data operation. Queue endpoints additionally extract user identity from the auth context rather than accepting a `user_id` parameter.

### HiveStore Interface Summary

The `HiveStore` interface grows across phases. The complete interface after Phase 5:

**Phase 1**
- `Migrate(ctx context.Context) error`
- `ListEpicTree(ctx context.Context, workspaceID uuid.UUID) ([]EpicNode, error)`
- `UpsertEpicNode(ctx context.Context, workspaceID uuid.UUID, input EpicNodeInput) (EpicNode, error)`

**Phase 2 additions**
- `ListReviewGates(ctx context.Context, workspaceID, epicID uuid.UUID) ([]ReviewGate, error)`
- `GetReviewGate(ctx context.Context, workspaceID, gateID uuid.UUID) (ReviewGate, error)`
- `UpdateReviewGate(ctx context.Context, workspaceID, gateID uuid.UUID, input UpdateReviewGateInput) (ReviewGate, error)`

**Phase 3 additions**
- `ListPersonalQueue(ctx context.Context, workspaceID, userID uuid.UUID) ([]PersonalQueueItem, error)`
- `UpdateQueueItem(ctx context.Context, workspaceID, userID, itemID uuid.UUID, input UpdateQueueItemInput) (PersonalQueueItem, error)`

**Phase 4 additions**
- `ListHermesThreads(ctx context.Context, workspaceID uuid.UUID) ([]HermesThread, error)`
- `CreateHermesThread(ctx context.Context, workspaceID, userID uuid.UUID, input CreateHermesThreadInput) (HermesThread, error)`
- `ListHermesMessages(ctx context.Context, workspaceID, threadID uuid.UUID, cursor PageCursor) (Page[HermesMessage], error)`
- `SendHermesMessage(ctx context.Context, workspaceID, threadID, userID uuid.UUID, input SendHermesMessageInput) (HermesMessage, error)`

**Phase 5 additions**
- `ListSkillCatalogEntries(ctx context.Context, workspaceID uuid.UUID) ([]CatalogEntryWithState, error)`
- `GetSkillMaterializations(ctx context.Context, workspaceID uuid.UUID) ([]SkillMaterialization, error)`
- `MaterializeSkill(ctx context.Context, workspaceID, actorID uuid.UUID, catalogKey string, input MaterializeSkillInput) (SkillMaterialization, error)`

At twelve methods after Phase 5, the interface is approaching the boundary where splitting into per-domain stores should be evaluated (see Section 7.4 Regrets item on HiveStore breadth). The split threshold is not a hard rule but a smell: if adding a test double for a Phase 3 handler requires implementing all twelve methods, split.

---

## Part 3: Verification Plan

Verification follows the vertical slices because the slices are the delivery units and each must leave a working testable vertical path. Phase 1 is the hard gate. Later phases do not reopen route/store/auth architecture unless Phase 1 evidence was wrong.

**Phase 1 automated verification.**

`pnpm --filter @multica/hive typecheck` and `pnpm --filter @multica/web typecheck` must both pass clean — no new type errors in Hive files and no type regressions in the web app caused by adding `@multica/hive` as a dependency. Path tests in `packages/core/paths/paths.test.ts` verify that `paths.workspace(slug).hive()` and `paths.workspace(slug).hiveEpicTree()` return the expected URL shapes. EpicTree component tests in `epic-tree-view.test.tsx` cover four states: render with a non-empty node list, render with an empty list (should show empty state UI, not an error), render with a fetch error (should show error state UI with a retry affordance), and render with in-flight loading (should show a loading indicator). These four states are the minimal component contract — later phases do not add to Phase 1's view tests.

Hive migration tests in `store_test.go` apply the Phase 1 migration against a test Postgres instance and then query `hive.schema_migrations` and `hive.epic_nodes` to confirm both objects exist with the expected columns. HiveStore round-trip tests call `UpsertEpicNode` and then `ListEpicTree`, verify the node appears in the list, and then call `UpsertEpicNode` again to confirm idempotent update behavior. The round-trip test must use a test-scoped workspace UUID that is distinct from any other test to ensure isolation. Hive router tests in `router_test.go` confirm that `GET /api/plugins/hive/epic-tree` returns 401 when no session is present, returns 403 when a session is present but the workspace ID does not match any membership the test authorizer has been configured with, and returns 200 with a valid JSON body when the test auth context is properly set. Regression grep confirms no file in `server/migrations/` contains `CREATE TABLE hive.` or `hive.schema_migrations`. `server/sqlc.yaml` diff confirms the file is unchanged.

**Phase 1 manual verification.**

Start Multica locally with a running Postgres instance. Log in through the existing auth flow (not a test shortcut — the goal is to confirm that auth inheritance works for a real browser session). Navigate to the workspace Hive route in a browser tab. Confirm the dashboard shell renders, the sidebar shows the Hive entry, and the EpicTree view renders (empty state is acceptable; an error state is a Phase 1 defect). Create one EpicTree node through the UI. Hard-refresh the page and confirm the node persists, confirming that the write went to `hive.epic_nodes` and the read fetches from the same table. Inspect browser network traffic and confirm all calls are going to `/api/plugins/hive/*` and receiving 200 responses. Deliberately corrupt a Hive migration file (add an invalid SQL statement), restart the server, and confirm the failure appears in server logs or the health endpoint — not silently producing an empty EpicTree. Restore the migration file and confirm the server recovers on restart.

**Phase 2 automated/manual verification.**

Integration tests in `review_gates_test.go` cover gate list with workspace-scoped filter (seed two workspaces with gates and confirm each endpoint only returns its workspace's gates), gate detail (correct gate returned by ID within workspace), gate update (state changes persist), and cross-workspace gate access (a gate ID from workspace A is not returned when querying from workspace B's context — expect 404, not 403). Frontend component tests in `review-gates-view.test.tsx` cover loading state, empty state (no gates for the epic), gate list render, gate detail selection and display, evidence display within a gate, update submission with success response, and update submission with error response. Route path test in `paths.test.ts` verifies `paths.workspace(slug).hiveReviewGates()` is present and returns the correct URL. Migration test confirms `hive.review_gates` is created with the expected columns after Phase 2 migration. Manual: navigate to ReviewGates in a browser, select a gate, update its state, refresh, and confirm the new state persists. Open a browser tab for a different workspace, attempt to navigate to the same gate ID URL with the different workspace context, and confirm the response is 404.

**Phase 3 automated/manual verification.**

Queue API tests in `personal_queue_test.go` cover list with user-scope enforcement (seed two users in one workspace with queue items; list as user A and confirm user B's items are absent), list with workspace-scope enforcement (seed items in two workspaces; list in workspace A context and confirm workspace B items are absent), update with owner enforcement (attempt to update a user A item as user B, expect 403), and cross-system link presence (item records include a non-null `QueueTarget.href`). Frontend tests in `personal-queue-view.test.tsx` cover empty state, item list render with status and priority display, link rendering for each `QueueTarget.type`, and update submission. Migration test confirms `hive.personal_queue_items` with the `(workspace_id, assignee_user_id, status)` index is created. Manual: log in as user A, open PersonalQueue, confirm only user A's items appear. Seed a cross-system link (to a Multica issue) and confirm the link renders and navigates correctly. Update an item status and confirm persistence. Log in as a different user and confirm no items from user A's queue are visible.

**Phase 4 automated/manual verification.**

HermesChat tests in `hermes_chat_test.go` cover thread creation (new thread appears in list), message send (message appears in paginated response for the thread), pagination correctness (cursor from first page retrieves next page, final page has no cursor), message chronological ordering (messages are returned in `created_at` ascending order within each page), and thread workspace scoping (thread from workspace A is not accessible in workspace B context). An explain-plan or index-usage test confirms that `SELECT * FROM hive.hermes_messages WHERE thread_id = $1 ORDER BY created_at LIMIT $2 OFFSET $3` or equivalent cursor-based query uses the `(thread_id, created_at)` index. Frontend tests cover thread list render, message timeline render with multiple messages, send form submission and optimistic append, and send failure handling. Migration test confirms `hive.hermes_threads` and `hive.hermes_messages` with the `(thread_id, created_at)` index are created. Manual: create a thread, send multiple messages, verify they appear in correct order, refresh, confirm messages persist, confirm the chosen refresh strategy (polling or realtime) does not require a second login or session.

**Phase 5 automated/manual verification.**

Catalog structure tests in `catalog.test.ts` validate that every entry in `packages/hive/src/skills/catalog.ts` has a `key`, `version`, `name`, `description`, and at least one file entry, and that no two entries share the same key. Catalog endpoint test confirms `GET /api/plugins/hive/skills/catalog` returns a non-empty list when no runtime is connected and when no skills have been materialized in the workspace — the catalog is static and must not depend on runtime state. Materialization tests in `skill_materializer_test.go` confirm: a valid materialize call creates exactly one `skill` row, the expected `skill_file` rows, and one `hive.plugin_skill_catalog_state` row with `state = "materialized"`. Conflict test: materialize the same catalog key twice in the same workspace without explicit semantics and confirm the second call returns 409 with no new rows created. Partial-write test: inject a failure after `skill` is written but before `skill_file` is written, and confirm the transaction rolls back completely — no orphaned `skill` row. File path validation test: attempt materialization with a catalog entry containing a path like `../../etc/passwd`, confirm 422 response and no rows written. Migration test confirms `hive.plugin_skill_catalog_state` is created. Manual: browse catalog, materialize one skill, open the Multica Skills page, confirm the skill appears with the correct files and owner attribution. Confirm that a second workspace does not contain the materialized skill (workspace scoping).

**Phase 6 automated/manual verification.**

Re-run the complete Phase 1-5 test suite after Phase 6 extraction and confirm all tests pass without modification. Route mount tests specifically confirm that `middleware.Auth` still wraps all Hive routes after the generic seam is introduced — add an explicit test for this if it is not already covered. Path and nav tests confirm that existing Hive route builders and sidebar entries are stable and produce identical results before and after extraction. If a generic `MountAuthenticatedPluginRoutes` helper is introduced, write a dedicated test confirming it wraps the provided router with the auth middleware. Measure the fork diff size before and after Phase 6 and document the result in `docs/plugin-seams.md` — if the diff is not smaller after extraction, document why the extraction was still justified. Manual: full browser smoke path across every Hive route; confirm that the sidebar, API paths, page content, and seam documentation all match the actual code; confirm that no new Hive functionality was added beyond seam cleanup.

### Coverage Matrix

| Area | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|---|---|---|---|---|---|---|
| Build-time package composition | automated + manual | regression | regression | regression | regression | extraction review |
| Workspace routes | EpicTree | ReviewGates | Queue | Chat | Catalog optional | seam tests |
| Sidebar nav | EpicTree/Hive entry | optional sub-entry | optional sub-entry | optional sub-entry | optional sub-entry | seam tests |
| Auth inheritance | proof gate | regression | regression | regression | regression | mount tests |
| Workspace authorization | proof gate | gate scoping | user/workspace scoping | thread/message scoping | materialization permissions | regression |
| HiveStore boundary | epic nodes | gates | queue | chat | catalog state | unchanged |
| Hive migrations | `epic_nodes` | `review_gates` | `personal_queue_items` | `hermes_*` | `plugin_skill_catalog_state` | no new tables |
| Core migration isolation | file review | file review | file review | file review | file review | file review |
| Existing skill tables | not used | not used | not used | not used | materialization | regression |
| Performance-sensitive reads | tree baseline | gate list baseline | queue filters | chat pagination | catalog size | diff review |

### Cross-Phase Non-Regression Baseline

Each phase must not break the deliverables of prior phases. The following tests constitute the non-regression baseline — they must pass at the end of every phase, not just the phase that introduced them.

After Phase 2: typecheck for `@multica/hive` and `@multica/web`. Phase 1 router auth tests (401/403/200). Phase 1 migration tests (`hive.schema_migrations`, `hive.epic_nodes` created). Phase 1 EpicTree component tests (render, empty, error, data). Phase 1 round-trip write/read test. Core migration isolation grep (no Hive SQL in `server/migrations/`). `server/sqlc.yaml` unchanged.

After Phase 3: all Phase 2 regression items plus Phase 2 gate list/detail/update workspace-scoping tests. Phase 2 cross-workspace 404 test. Phase 2 migration test (`hive.review_gates`).

After Phase 4: all Phase 3 regression items plus Phase 3 queue user-scoping tests. Phase 3 cross-user update 403 test. Phase 3 migration test (`hive.personal_queue_items`).

After Phase 5: all Phase 4 regression items plus Phase 4 pagination cursor tests. Phase 4 index-usage test. Phase 4 migration test (`hive.hermes_threads`, `hive.hermes_messages`).

After Phase 6: the full Phase 1-5 test suite, re-run without modification. Any test that breaks due to Phase 6 extraction is a defect in the extraction, not a test that should be updated to pass the new code. The extraction must be a behavior-preserving refactor.

### Not Verified and Why

Production-scale EpicTree sizes with thousands of nodes are not verified in Phase 1. Phase 1 is a proof gate, not a performance benchmark; large-tree optimization belongs after the seam is proven with real data shapes and real customer usage patterns. The Phase 1 proof requires one successful write and read of a node, not a bounded performance guarantee.

Full realtime chat is not verified in Phase 4 if the sign-off decision selects polling. The vertical plan explicitly allows this choice, and a second WebSocket stack is explicitly out of scope regardless of the refresh decision. If the product owner decides after Phase 4 that realtime is needed, that becomes a follow-up slice — it is not a Phase 4 regression.

Upstream acceptance of the Phase 6 extracted seam is not verified. Phase 6 produces working code and documentation, but whether the Multica upstream project accepts the seam interfaces as a contribution is a stakeholder conversation outside the scope of this epic.

Automatic workspace skill seeding is not verified because the locked design explicitly rejects it. Seeding behavior was considered and rejected in design feedback; a test for seeding behavior would be a test of rejected scope. Similarly, SQLite and sidecar storage are not verified because the locked decision is same-database separate schema, and generic runtime plugin loading is not verified because the locked architecture is build-time bundled.

Every possible skill catalog upgrade policy — version-diff presentation, selective upgrade, bulk upgrade, rollback of a specific skill version — is not verified. Phase 5 defines minimum provenance and collision rules; richer upgrade workflows are follow-up requiring their own design and sign-off. Phase 5 tests only that the minimum specified behaviors (create if absent, 409 on collision) work correctly.

---

## Part 3b: Cross-Cutting Concerns

### Error Handling

Hive API responses use the same error shape conventions as existing Multica handlers wherever possible. The error code taxonomy is: 401 when no valid session or token exists — the consequence of auth inheritance being absent; 403 when the user is authenticated but lacks the required workspace access or role; 404 when a cross-workspace object lookup must not confirm the object's existence in another workspace; 400 for malformed identifiers or invalid JSON bodies; 409 for domain-level state conflicts such as ordering constraint violations and gate state transition rejections; 422 for well-formed but semantically invalid domain payloads; and 500 for store and migration failures. Migration failures deserve special treatment: they must surface at startup or readiness and must never be silently converted into empty UI states. An empty EpicTree is ambiguous between "no data" and "missing schema"; the two must be distinguishable from logs and health endpoints. Mutation error responses must preserve enough detail for operators to diagnose failures without exposing sensitive internal state like connection strings, stack traces, or SQL query text. Frontend views must distinguish empty states from API errors with distinct UI treatment — a spinner that resolves to an empty list on a 500 is a user experience defect that also hides operational problems.

Frontend error handling follows a layered model. React Query's `error` state is the primary signal; views must check `isError` explicitly and render an actionable error state rather than leaving the component in an empty or loading state indefinitely. Mutation errors that are recoverable (409 conflict, 422 validation failure) should be shown inline near the form or action that triggered them, not as global toast-style notifications. Non-recoverable errors (500, network failure) can use a global error boundary or toast mechanism. The specific error message shown to users must not contain API response bodies directly — the frontend must translate status codes into user-readable messages using the locale system. This prevents raw JSON or server stack traces from appearing in the product UI.

The error handling contract also covers the distinction between "Hive not yet migrated" and "Hive has no data." If a Hive migration has not been applied and the Hive router is not ready, the `GET /api/plugins/hive/epic-tree` response should be a structured error (503 or a custom readiness code) that the frontend translates to a "Hive is not yet available" message — distinct from the empty-list state that means "no epic nodes have been created." Without this distinction, operators cannot tell from user reports whether the problem is a deployment issue or a data issue.

### Migration

Every Hive migration file lives under `server/internal/hive/migrations/`. Every Hive migration writes to the `hive` schema and records version history in `hive.schema_migrations` rather than the core `schema_migrations` table. No Hive SQL file enters `server/migrations/` or appears as input to `server/sqlc.yaml`. Each schema-adding phase provides paired up/down migrations — the down migration supports local and test rollback even if production rollback policy never runs it automatically. Startup applies or verifies Hive migrations before serving Hive routes; if the deployment model requires manual migration commands, readiness must detect unapplied Hive migrations and refuse to report healthy. Migration version names are plugin-local with no numeric relationship to core migration numbering. All Hive tables include a `workspace_id` column with an index appropriate to that table's query patterns. Chat messages are indexed by `(thread_id, created_at)`. Queue items are indexed by `(workspace_id, assignee_user_id, status)`. Catalog state is indexed by `(workspace_id, catalog_key)`.

### Rollback

Phase 1 rollback removes the frontend package dependency, route/nav anchors, backend mount, and Hive migration infrastructure. Database rollback runs Hive down migrations in local and test environments. In production, rollback prefers disabling route/nav exposure before any destructive data operation — removing the sidebar entry and returning 404 from the Hive routes prevents user-visible failures without requiring immediate table drops. Later view rollbacks remove that view's route and API handlers while leaving earlier HiveStore tables intact unless explicit schema rollback is intended. Skill materialization rollback is not a simple table drop: it writes into core `skill` and `skill_file`, which may have been user-customized after materialization. Provenance records in `hive.plugin_skill_catalog_state` allow identification of Hive-originated skills, but a skill marked `customized` must not be deleted automatically — that would destroy user work. Phase 6 seam extraction rollback reverts to the concrete Hive anchors from Phases 1-5 without losing functionality.

### Performance

EpicTree needs workspace filtering and predictable ordering. Large trees may eventually require pagination, lazy child loading, or subtree queries, but Phase 1 should not prematurely design for dataset sizes that do not yet exist. The proof table schema should be minimal and well-indexed for the workspace-scoped list query; additional optimization happens after real usage patterns are known. ReviewGates lists are bounded by epic and workspace. PersonalQueue defaults to current user and active statuses — the `(workspace_id, assignee_user_id, status)` index must support this query at O(matches) rather than O(table). HermesChat messages must be paginated from first implementation; this is not optional. Catalog browse can be served from static or in-memory catalog data if the catalog size is small, but materialization state queries join `hive.plugin_skill_catalog_state` with workspace scope and must be indexed for that access pattern. React Query keys must include workspace ID at every cache level to prevent cross-workspace data bleeding between browser sessions.

The performance-sensitive query patterns that need index coverage from the first migration, not added later, are: `SELECT ... FROM hive.epic_nodes WHERE workspace_id = $1` (needs index on `workspace_id`); `SELECT ... FROM hive.review_gates WHERE workspace_id = $1 AND epic_id = $2` (needs composite index on `(workspace_id, epic_id)`); `SELECT ... FROM hive.personal_queue_items WHERE workspace_id = $1 AND assignee_user_id = $2 AND status = ANY($3)` (needs composite index on `(workspace_id, assignee_user_id, status)`); `SELECT ... FROM hive.hermes_messages WHERE thread_id = $1 ORDER BY created_at LIMIT $2` (needs composite index on `(thread_id, created_at)`); and `SELECT ... FROM hive.plugin_skill_catalog_state WHERE workspace_id = $1` (needs index on `workspace_id`, composite with `catalog_key` for per-key lookups). These indexes are specified in the migration files, not deferred to a separate optimization pass. A migration without the appropriate index on a table that will see filtered queries under load is a latent performance defect, not an acceptable starting point.

The React Query stale-time and refetch configuration should be conservative: data that is modified via mutations must be invalidated on mutation settlement, not relied on to refetch automatically on a timer. Workspace-scoped cache isolation requires that whenever the active workspace changes (e.g., the user navigates between workspaces), all Hive-related query keys for the previous workspace are invalidated or garbage-collected. This prevents a user from seeing stale data from workspace A after switching to workspace B.

### Documentation Impact

Developer documentation must clearly state the Hive schema ownership rule: `hive.*` tables are never added to `server/migrations/` and never appear in `server/sqlc.yaml`. Documentation must describe the build-time package registration steps so future contributors know how to add packages correctly without disrupting the existing workspace graph. The `/api/plugins/hive/*` boundary and the manual smoke path for each phase slice must be written before code review begins. Materialized skill provenance rules — what `materialized`, `customized`, and `superseded` states mean and when transitions occur — must be documented before Phase 5 is implemented, because implementer confusion about state semantics is where user data gets corrupted. Phase 6 documentation describes only the seam proven by the implementation; it explicitly avoids claiming a general plugin platform exists, because that would be a false claim unsupported by the code.

### Security

This epic introduces two categories of new attack surface: authenticated API routes for Hive views, and cross-system skill materialization that writes executable agent skill content into database-backed skill tables. Both warrant a `security:plan-audit` before execution begins. Every Hive route must enforce workspace membership through `WorkspaceAuthorizer` — auth inheritance alone is insufficient. Queue endpoints must enforce current-user identity so that a user cannot read or modify another user's queue items. Chat endpoints must enforce both workspace scope and thread visibility. ReviewGate update endpoints must enforce the role or permission requirements agreed in sign-off decision 8. Skill materialization must enforce permission to create workspace skills and, when requested, to assign agent skills — these permissions may be different from general workspace membership. Skill file paths from the catalog must be validated using the existing rules in `server/internal/handler/skill.go:212-307` or an equivalent, never with weaker custom validation. Catalog content must originate from packaged files only — accepting catalog entries from arbitrary remote URLs in this epic is out of scope and must be rejected as a feature request for a separate security review. Audit log entries should be considered for ReviewGate state changes and skill materializations. Security review should examine whether packaged catalog files can influence agent execution in unexpected ways before Phase 5 ships.

The security review for Phase 5 should specifically examine: whether catalog file content can contain tool definitions or skill instructions that bypass existing skill permission checks; whether materialized skills receive the same permission enforcement as manually-created skills; whether the `assignToAgentId` parameter in a materialize request can be used to assign skills to agents in other workspaces; and whether the 409-conflict behavior leaks information about what skill names exist in a workspace to an unauthorized requester. These are the materialization-specific questions that supplement the general API surface review covering workspace scoping and auth inheritance. The security review must be completed before Phase 5 code review begins — not before Phase 5 deploys, but before the implementation is written, so that design-level security issues can be addressed in the implementation rather than patched in.

Input validation for all Hive endpoints must reject obviously malformed UUIDs rather than passing them to the database layer. A request with `workspace_id=not-a-uuid` should return 400 at the handler entry point, not proceed to a failing SQL query whose error message might expose schema information. The convention for workspace and entity ID validation should be established in Phase 1 handler scaffolding and reused in all subsequent phases rather than reimplemented ad hoc.

### Hive Schema Evolution Summary

Each phase introduces exactly one migration. The cumulative schema after all six phases forms the complete Hive data layer. Recording the intended schema per phase here prevents implementers from over-building in early phases or under-building in later ones.

**Phase 1 — Foundation.** `hive` schema created. `hive.schema_migrations` created as the independent version ledger (version text, applied_at timestamp). `hive.epic_nodes` created with columns: `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `parent_id UUID REFERENCES hive.epic_nodes(id)`, `title TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'active'`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Index on `workspace_id`. This table is the proof vehicle — no additional columns until a follow-up migration demonstrates a measured need.

**Phase 2 — ReviewGates.** `hive.review_gates` created with columns: `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `epic_id UUID NOT NULL`, `name TEXT NOT NULL`, `state TEXT NOT NULL DEFAULT 'pending'`, `evidence JSONB NOT NULL DEFAULT '[]'`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Composite index on `(workspace_id, epic_id)` to support list-by-epic queries efficiently.

**Phase 3 — PersonalQueue.** `hive.personal_queue_items` created with columns: `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `assignee_user_id UUID NOT NULL`, `kind TEXT NOT NULL`, `title TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'active'`, `priority TEXT`, `target JSONB NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Composite index on `(workspace_id, assignee_user_id, status)` — this index is the primary performance guarantee for the default active-items query.

**Phase 4 — HermesChat.** Two tables. `hive.hermes_threads` with columns: `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `title TEXT`, `created_by UUID NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `last_message_at TIMESTAMPTZ`. Index on `workspace_id`. `hive.hermes_messages` with columns: `id UUID PRIMARY KEY`, `thread_id UUID NOT NULL REFERENCES hive.hermes_threads(id)`, `workspace_id UUID NOT NULL`, `sender_user_id UUID NOT NULL`, `body TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Composite index on `(thread_id, created_at)` — this index is mandatory from the first migration, not added in a later optimization pass.

**Phase 5 — Skill Catalog State.** `hive.plugin_skill_catalog_state` created with columns: `id UUID PRIMARY KEY`, `workspace_id UUID NOT NULL`, `catalog_key TEXT NOT NULL`, `catalog_version TEXT NOT NULL`, `skill_id UUID NOT NULL`, `state TEXT NOT NULL DEFAULT 'materialized'`, `materialized_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Unique constraint on `(workspace_id, catalog_key)` to prevent duplicate materialization records per catalog entry per workspace. Index on `(workspace_id, catalog_key)` to support per-workspace catalog state queries.

**Phase 6 — No new tables.** Phase 6 is a seam extraction, not a data model change. If Phase 6 produces code changes at all (as opposed to documentation only), no new Hive tables, no new core tables, and no migration files are added. Any Phase 6 implementation that requires a schema change is out of scope.

---

## Part 4: File Change Manifest

| Action | Path | Phase | Notes |
|---|---|---|---|
| MODIFY | `~/Code/spikes/multica/pnpm-workspace.yaml` | 1 | Only if Hive package path is outside existing `packages/*` glob. |
| MODIFY | `~/Code/spikes/multica/apps/web/package.json` | 1 | Add `@multica/hive` workspace dependency. |
| MODIFY | `~/Code/spikes/multica/apps/web/next.config.ts` | 1, 6 | Add transpile package; possibly extract package seam in Phase 6. |
| CREATE | `~/Code/spikes/multica/packages/hive/package.json` | 1 | Hive frontend package metadata and exports. |
| CREATE | `~/Code/spikes/multica/packages/hive/tsconfig.json` | 1 | TypeScript package config extending local convention. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/index.ts` | 1 | Export Hive views and client surfaces. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/client.ts` | 1 | Hive API HTTP client. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/types.ts` | 1 | Shared frontend DTOs. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/queries.ts` | 1 | React Query option factories. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/mutations.ts` | 1 | Mutation definitions with query invalidation. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/epic-tree-view.tsx` | 1 | Proof EpicTree view. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/epic-tree-view.test.tsx` | 1 | Proof view tests: render, empty, error, data. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/review-gates-view.tsx` | 2 | ReviewGates UI. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/review-gates-view.test.tsx` | 2 | ReviewGates tests: loading, empty, detail, update error. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/personal-queue-view.tsx` | 3 | PersonalQueue UI with status, priority, source, and link. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/personal-queue-view.test.tsx` | 3 | Queue tests: empty, filtered items, link rendering, update failure. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/hermes-chat-view.tsx` | 4 | HermesChat thread list, composer, and message timeline. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/hermes-chat-view.test.tsx` | 4 | Chat tests: thread create, send success/failure, message display. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/skills-catalog-view.tsx` | 5 | Optional catalog browse/materialize UI. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/skills-catalog-view.test.tsx` | 5 | Catalog tests: browse state, materialized state, materialization errors. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/skills/catalog.ts` | 5 | Packaged versioned skill catalog. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/skills/catalog.test.ts` | 5 | Catalog structure validation: keys, versions, file paths, metadata. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/page.tsx` | 1 | Thin EpicTree page adapter. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/epics/page.tsx` | 1 | Optional canonical EpicTree route. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/review-gates/page.tsx` | 2 | Thin ReviewGates page adapter. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/queue/page.tsx` | 3 | Thin queue page adapter. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/chat/page.tsx` | 4 | Thin HermesChat page adapter. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/skills/page.tsx` | 5 | Optional skills catalog page adapter. |
| MODIFY | `~/Code/spikes/multica/packages/core/paths/paths.ts` | 1–6 | Add Hive path builders; possibly extract seam in Phase 6. |
| MODIFY | `~/Code/spikes/multica/packages/core/paths/paths.test.ts` | 1–6 | Route builder coverage per phase. |
| MODIFY | `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx` | 1–6 | Add Hive nav entries; possibly extract seam in Phase 6. |
| MODIFY | `~/Code/spikes/multica/packages/views/layout/app-sidebar.test.tsx` | 1–6 | Add/adjust nav tests if present or conventional. |
| MODIFY | `~/Code/spikes/multica/packages/views/locales/en/layout.json` | 1–5 | Add Hive nav labels; exact locale path follows repo convention. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/layout.tsx` | 1–6 | Continues to provide workspace/auth context. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx` | 1–6 | Dashboard route group hosts Hive pages. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/packages/views/layout/dashboard-layout.tsx` | 1–6 | Existing dashboard shell hosts Hive pages. |
| MODIFY | `~/Code/spikes/multica/server/cmd/server/main.go` | 1 | Construct/migrate HiveStore after pgx pool connection. |
| MODIFY | `~/Code/spikes/multica/server/cmd/server/router.go` | 1, 6 | Add authenticated Hive mount; extract generic seam only if fork churn justifies it. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/router.go` | 1 | Hive chi router definition. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/store.go` | 1–5 | HiveStore interface and pgx-backed implementation. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations.go` | 1 | Plugin-local migration runner using `hive.schema_migrations`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/authz.go` | 1 | WorkspaceAuthorizer implementation and helpers. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/epic_nodes.go` | 1 | EpicTree handlers and store/DTO mapping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/review_gates.go` | 2 | ReviewGates handlers and store/DTO mapping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/personal_queue.go` | 3 | PersonalQueue handlers with dual workspace/user scoping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/hermes_chat.go` | 4 | Thread create/list and paginated message send/read handlers. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skills_catalog.go` | 5 | Catalog browse and materialization endpoints. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skill_materializer.go` | 5 | Cross-store writes to `skill`, `skill_file`, `agent_skill`, and catalog state. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/router_test.go` | 1 | Auth and route coverage. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/store_test.go` | 1 | Migration and epic node write/read tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/review_gates_test.go` | 2 | Gate list/detail/update with workspace scoping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/personal_queue_test.go` | 3 | User and workspace filter enforcement. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/hermes_chat_test.go` | 4 | Thread/message workspace scoping, ordering, pagination. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skills_catalog_test.go` | 5 | Catalog endpoint and conflict behavior. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skill_materializer_test.go` | 5 | Cross-store materialization correctness. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/001_epic_nodes.up.sql` | 1 | Creates `hive` schema, `hive.schema_migrations`, `hive.epic_nodes`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/001_epic_nodes.down.sql` | 1 | Reversible local/test rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/002_review_gates.up.sql` | 2 | Creates `hive.review_gates`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/002_review_gates.down.sql` | 2 | Reversible rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/003_personal_queue_items.up.sql` | 3 | Creates `hive.personal_queue_items`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/003_personal_queue_items.down.sql` | 3 | Reversible rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/004_hermes_chat.up.sql` | 4 | Creates `hive.hermes_threads` and `hive.hermes_messages`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/004_hermes_chat.down.sql` | 4 | Reversible rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/005_plugin_skill_catalog_state.up.sql` | 5 | Creates `hive.plugin_skill_catalog_state`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/005_plugin_skill_catalog_state.down.sql` | 5 | Reversible rollback. |
| UNCHANGED | `~/Code/spikes/multica/server/migrations` | 1–6 | Must not receive Hive tables. |
| UNCHANGED | `~/Code/spikes/multica/server/sqlc.yaml` | 1–6 | Must not include Hive migrations. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/server/migrations/008_structured_skills.up.sql` | 5 | Defines skill/materialization target tables (`skill`, `skill_file`, `agent_skill`). |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/server/internal/handler/skill.go` | 5 | Existing skill CRUD remains native representation after materialization. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/server/internal/handler/runtime_local_skills.go` | 5 | Runtime-local flow informs materialization precedent; not the catalog mechanism. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/packages/core/api/ws-client.ts` | 4 | Reuse for realtime if needed; no second WS client. |
| CREATE or MODIFY | `~/Code/spikes/multica/docs/plugin-seams.md` | 6 | Proof-backed seam documentation if docs path is accepted. |

---

## Part 5: Risk Registry

| Risk | Severity | Likelihood | Mitigation | Owner |
|---|---|---|---|---|
| Route mount requires deep `server/cmd/server/router.go` surgery rather than one authenticated mount | High | Medium | Keep Phase 1 to a single `r.Mount` inside the protected group; stop epic if router must be reorganized | Backend implementer |
| Hive tables leak into `server/migrations` or `server/sqlc.yaml` | High | Medium | File review + CI checks: no Hive SQL in `server/migrations/`; `server/sqlc.yaml` unchanged | Backend implementer |
| Auth inheritance mistaken for complete authorization | High | High | Require `WorkspaceAuthorizer` call in every Hive handler; tests for cross-workspace object access | Backend implementer |
| Skill materialization overwrites user-customized skills | High | Medium | Provenance in `hive.plugin_skill_catalog_state`; 409 on collision unless explicit semantics given; no auto-seeding | Skills implementer |
| Materialized skill files introduce unsafe paths or executable content confusion | High | Medium | Reuse path validation from `server/internal/handler/skill.go:212-307`; packaged content only; security review | Skills implementer |
| Startup succeeds with stale or missing Hive schema | High | Medium | Hive migration failure surfaces at startup/readiness; Phase 1 must observe this by breaking a migration intentionally | Backend implementer |
| Cross-store writes appear atomic but are not | High | Low | Materializer opens one pgx transaction for `skill`, `skill_file`, `agent_skill`, `hive.plugin_skill_catalog_state` | Backend implementer |
| Queue endpoint exposes another user's work items | High | Medium | SQL must filter `workspace_id` AND `assignee_user_id` from auth context; update requires both constraints | Backend implementer |
| Chat messages become unbounded client-side render | Medium | High | Mandatory cursor-based pagination and `(thread_id, created_at)` index from first implementation | Frontend + backend |
| EpicTree grows beyond a single read response | Medium | Medium | Baseline indexes and bounded proof in Phase 1; lazy subtree loading only after measured need | Frontend + backend |
| ReviewGate state transitions are under-specified | Medium | Medium | Define minimum allowed states and conflict behavior in Phase 2; mark advanced workflow rules as follow-up | Product + implementer |
| Sidebar becomes cluttered with too many Hive entries | Medium | Medium | Decide single parent entry vs. separate view entries at sign-off before Phase 2-5 nav work | Product + frontend |
| Phase 6 over-generalizes into an unproven plugin platform | Medium | Medium | Limit extraction to anchors proven by working Hive slices; reject dynamic loader abstractions | Architect + implementer |
| Runtime-local skill flow confused with Hive packaged catalog | Medium | Medium | Catalog browse independent of online runtime; runtime-local code is precedent only | Skills implementer |
| Same-database separate schema missed by backup/restore docs | Medium | Low | Operations docs must state `hive.*` is in the same Postgres backup target | Docs owner |
| Frontend cache leaks across workspaces | Medium | Medium | Workspace ID in every React Query key, established in Phase 1 and maintained across phases | Frontend implementer |
| API error shapes drift from existing Multica conventions | Low | Medium | Use existing response helpers or mirror their shape exactly | Backend implementer |
| Package export paths become unstable during view additions | Low | Medium | Keep `@multica/hive` exports explicit and covered by typecheck each phase | Frontend implementer |
| Optional catalog UI delays mandatory materialization work | Medium | Low | Browse endpoint and materialization are mandatory; catalog UI can remain minimal | Product + implementer |
| Upstream seam docs claim more than the code proves | Medium | Medium | Docs must cite specific file paths and tests from Phases 1-5 | Architect + writer |
| Same-database schema perceived as "core DB coupling" by maintainers | Medium | Low | Document separation discipline; enforce with file review and CI checks | Backend implementer |
| Hive schema permissions unavailable in hosted deployments | Medium | Low | Verify `CREATE SCHEMA hive` permission in target environment before Phase 1 migration attempt | Infrastructure owner |

### Detailed Mitigation for High-Severity Risks

**Route mount risk.** The protected API route group is defined at `server/cmd/server/router.go:301-304`. The only acceptable Phase 1 change to this file is: one `hive` package import, one construction call `hive.NewRouter(store, authz)`, and one `r.Mount("/api/plugins/hive", ...)` inside that group. Any implementation that requires a second server process, a new middleware chain, a broad router refactor, or an unauthenticated mount path is an unacceptable change — it means the seam assumption was wrong and the epic must stop for architecture review. Phase 1 includes a router test proving that unauthenticated requests return 401 before reaching Hive handlers, and a manual browser check proving that authenticated dashboard traffic reaches Hive routes. If the thin mount cannot satisfy both checks, the team stops rather than working around the constraint.

**Core migration leakage risk.** The migration resolver shown in `server/internal/migrations/migrations.go:13-16` and `server/internal/migrations/migrations.go:50-69` loads files from the configured directory and sorts them lexically. Adding Hive files with independent numeric prefixes — for example `008_hive_epic_nodes.sql` alongside an existing core `008_something.sql` — creates a prefix collision that produces unpredictable migration execution order on any merge. Hive migrations must live in `server/internal/hive/migrations/` and record their versions in `hive.schema_migrations`. `server/sqlc.yaml:1-10` currently points at `server/migrations/` only and must remain that way. Code review must reject any Hive SQL file in `server/migrations/`, and a CI check should grep for `CREATE TABLE hive.` in that directory and fail on any match.

**Authorization drift risk.** Mounting under `middleware.Auth` establishes that the caller is a valid user with an active session. It does not establish workspace membership. Every Hive endpoint that accepts a `workspace_id` — whether in the URL, query string, or request body — must call `WorkspaceAuthorizer.RequireWorkspace` to verify the caller belongs to that workspace before performing any data operation. Object-level queries (gates, queue items, threads) must additionally constrain by workspace in SQL rather than trusting the caller-supplied workspace ID alone. PersonalQueue must further constrain by current user identity extracted from the auth context. Test suites must include cross-workspace fixtures: seed an object in workspace A, call the endpoint as a valid member of workspace B with that object's ID, and confirm the response is 404 or 403 — not the object's data.

**Skill overwrite risk.** The `skill` table uniqueness constraint is `(workspace_id, name)` per `server/migrations/008_structured_skills.up.sql:4-15`. A naive `INSERT ... ON CONFLICT DO UPDATE` by name would silently destroy a user's custom skill if the Hive catalog includes a skill with the same name. The materializer must never execute an upsert by name. On any collision, the endpoint returns 409 unless the request body explicitly includes `customize: true` or equivalent semantics that the user has acknowledged. The state field in `hive.plugin_skill_catalog_state` is authoritative: if a skill is `customized`, the system treats it as user-owned and does not overwrite it regardless of catalog version. Only skills in `materialized` state with matching catalog key and version may be updated on explicit catalog refresh request.

**Skill file safety risk.** `server/internal/handler/skill.go:212-307` contains the existing skill creation path including file path validation before writing `skill_file` rows. The Hive materializer must call the same validation logic, not reimplement it. Catalog content must originate from packaged files whose paths and checksums are known at build time — the materializer must not accept file content or paths from request bodies or remote URLs in this epic. If file path validation fails for any catalog file, the endpoint must return 422 or 400 and the transaction must roll back with no partial writes — no orphaned `skill` rows without corresponding `skill_file` rows, and no `hive.plugin_skill_catalog_state` entries pointing at non-existent skills. A security review should examine whether catalog files can influence agent execution in ways that bypass permission checks before Phase 5 ships.

**Stale schema risk.** Because Hive has an independent migration ledger, the fact that core migrations completed successfully says nothing about whether Hive's schema is ready. A deployment that applies only core migrations leaves the server trying to query tables that do not exist. The mitigation requires that the server apply or verify Hive migrations at startup before the Hive router begins accepting requests. If operational policy forbids automatic migration execution, the server must check `hive.schema_migrations` for completeness and refuse to report healthy if Hive migrations are pending. Phase 1 must verify this behavior by breaking a migration file on purpose, starting the server, and confirming the failure is visible in logs or health checks — not silently swallowed and transformed into an empty EpicTree response.

**Cross-store transaction risk.** Hive tables and core Multica tables share a Postgres instance but have no automatic transactional coupling. Skill materialization is the only Phase 5 operation that writes to both. If the materializer writes a `skill` row, then fails on `skill_file`, then no partial cleanup occurs without explicit rollback logic. The correct implementation is: open one pgx transaction at the start of `Materializer.Materialize`, execute all writes (`skill`, `skill_file`, optional `agent_skill`, `hive.plugin_skill_catalog_state`) inside that transaction, and defer `tx.Rollback()` in case of any error before `tx.Commit()`. This transaction boundary must be documented in `skill_materializer.go` so future implementers who add new write operations know they must join the existing transaction rather than opening a second one.

**Queue exposure risk.** Queue items contain assignment information, priority, linked records, and status that reveal the work a user is responsible for. This data must not be accessible to other users or workspace members without explicit delegation. The SQL for `ListPersonalQueue` must include `WHERE workspace_id = $workspace_id AND assignee_user_id = $current_user_id` with both values sourced from the authenticated request context. The SQL for `UpdateQueueItem` must include `WHERE id = $item_id AND workspace_id = $workspace_id AND assignee_user_id = $current_user_id`. Test suites must seed two users in the same workspace, call the list endpoint as one user, and verify the response contains only that user's items. Update tests must seed an item owned by user A, attempt the update as user B, and confirm 403.

---

## Part 6: Dependency Map

The frontend package depends on `apps/web/package.json` and `apps/web/next.config.ts` for build-time registration. It depends on `@multica/core` for API client conventions, the workspace path builder pattern at `packages/core/paths/paths.ts:17-41`, workspace context (workspace slug, member identity), and React Query patterns established in the existing package suite. It depends on `@multica/ui` and `@multica/views` for dashboard-compatible UI primitives, icons, and layout components. The thin page adapters in `apps/web/app/[workspaceSlug]/(dashboard)/hive/` depend on the workspace route group and the auth and workspace lookup context provided by `apps/web/app/[workspaceSlug]/layout.tsx:26-90`. The sidebar entries depend on the static nav array structure at `packages/views/layout/app-sidebar.tsx:102-150` and the render slot at lines 608-722.

The backend Hive router depends on the protected route group in `server/cmd/server/router.go:301-304` and the existing explicit mount style at lines 535-590. HiveStore depends on the pgx connection pool constructed in `server/cmd/server/main.go:142-160`; the pool is passed as a constructor argument. Hive migrations depend on Postgres permissions to create the `hive` schema — this permission must be verified in target environments before any Phase 1 migration attempt. Hive tables reference workspace and user UUIDs from core tables; the coupling design (plain unconstrained UUIDs vs. foreign keys) is deferred to sign-off decision, with the default preference being unconstrained UUIDs to avoid cross-schema constraint dependencies.

Phase 5 introduces the most significant external dependencies. Materialization depends on `server/migrations/008_structured_skills.up.sql:4-31` which defines `skill`, `skill_file`, and `agent_skill`. It depends on `server/internal/handler/skill.go:212-307` for the file path validation logic that must be reused. It references `server/internal/handler/runtime_local_skills.go:46-62` and `server/internal/handler/runtime_local_skills.go:478-495` as existence proof that external-origin content can become DB-backed skills — this precedent informs the materialization architecture but must not be imported into the catalog path.

Phase 6 seam extraction carries a hard dependency on Phases 1-5 completion and on measured fork churn evidence. It cannot begin until the concrete anchors are working and the diff between the fork and upstream has been measured.

### Blocking Questions

**Before Phase 1.** The frontend package name (`@multica/hive`) and location (`packages/hive`) must be confirmed before any files are created. Once pages import from `@multica/hive` and the name is established in `apps/web/package.json`, renaming requires a find-and-replace across the codebase. Similarly, the backend package location (`server/internal/hive`) must be confirmed because the import path appears in `server/cmd/server/router.go` and cannot be moved without touching every Go import that references it. The Phase 1 hard bail language must be accepted by the team and written into the slice's acceptance criteria — it is not sufficient for the tech lead to know it; the entire implementation team must understand that Phase 1 stops if any proof criterion fails. No Hive SQL enters `server/migrations/` must be affirmed as a zero-tolerance rule because the consequences of a single leaked migration file (prefix collision, sqlc schema contamination) are hard to reverse once the file has been merged and run against production. The same-Postgres separate schema decision must be confirmed before Phase 1 begins, because the alternative (a separate database or sidecar) requires a fundamentally different HiveStore construction approach. Postgres schema creation permissions must be verified in the target deployment environment before Phase 1 runs, not discovered during Phase 1 execution. The migration execution model (automatic at startup vs. readiness verification after manual command) must be resolved because it determines what Phase 1's proof-of-failure test looks like.

**Before Phase 2.** The canonical EpicTree route must be confirmed because Phase 2 adds the second Hive route, and the sidebar structure must accommodate both. If `/hive` is the canonical EpicTree route and Phase 2 adds `/hive/review-gates`, the sidebar might show a parent "Hive" entry with children. If `/hive/epics` is canonical, the sidebar structure is different. Getting this wrong means rework during Phase 2 of the Phase 1 nav additions. The ReviewGate update permission requirement is a security-design question: if only workspace owners may pass or fail gates, the `WorkspaceAuthorizer` interface may need a role parameter, which affects the interface design in Phase 1.

**Before Phase 3.** PersonalQueue visibility scope directly affects the Phase 3 schema design. If admin-delegated items are in scope, the `hive.personal_queue_items` table needs an `assigned_by` column and the list query needs a delegation lookup. If admin visibility is in scope, the list endpoint needs a way for admins to specify a target user. These requirements cannot be retrofitted without a schema migration and an API change. The current-user-only default is what Phase 3 implements; any broader scope must be confirmed first.

**Before Phase 4.** The HermesChat refresh strategy (polling vs. WebSocket) determines the backend implementation approach for Phase 4. If polling is chosen, the backend needs only the standard REST endpoints — no WebSocket endpoint. If WebSocket integration with the existing `/ws` path is chosen, Phase 4 requires coordination with the Multica WebSocket handling layer (reusing `packages/core/api/ws-client.ts`) and additional backend infrastructure to push new-message events. The Phase 4 scope and time estimate are different for each choice.

**Before Phase 5.** The provenance fields question is a data model decision that cannot be changed after the first materialized skill exists in a production workspace. The minimum viable fields are `catalogKey`, `catalogVersion`, and `state`. Whether additional fields (e.g., `materializedBy`, `originalName`, `lastCheckedAt`) are needed depends on what operations product wants to support in the future. The name collision behavior question determines whether the conflict resolution path has a 409-and-stop semantics or a richer "allow overwrite if you choose" semantics — both are defensible but they produce different API shapes. The agent assignment decision affects whether Phase 5 requires permissions for both skill creation and agent-skill assignment in a single call.

**Before Phase 6.** The conditional nature of Phase 6 must be formally accepted by the team, not assumed. Without explicit agreement, there is risk that Phase 6 executes as an unconditional refactor regardless of fork churn evidence. The preferred documentation path question prevents Phase 6 from stalling while the team debates where seam documentation belongs.

Open data gaps:
- [data not provided: product-specific names, labels, and exact copy for the four Hive views]
- [data not provided: final role matrix for ReviewGate update and skill materialization]
- [data not provided: expected production volume for EpicTree nodes, queue items, and chat messages]

---

## Part 7: Elicitation — Stress-Testing the Plan

### 7.1 Why Won't This Work?

**Failure: Router seam tighter than evidence suggests.**
Trigger: `server/cmd/server/router.go` requires handler dependencies or middleware context that Hive cannot access from a clean build-linked package — private struct fields, unexported handler state, or middleware that assumes handler package internals.
Impact: what was designed as a thin `r.Mount` becomes a broad backend fork requiring Hive to import large handler packages or duplicate internal behavior. The "one mount" constraint cannot be satisfied without restructuring the existing handler package.
Signal: writing `server/internal/hive/router.go` requires importing `server/internal/handler` or accessing non-exported types from that package. The `router_test.go` auth test cannot be written cleanly without handler package internals.
Our answer: define `WorkspaceAuthorizer` as a minimal interface in `server/internal/hive/authz.go` that accepts only what Hive genuinely needs — likely a context and a workspace UUID. If constructing that interface requires more than a thin wrapper around a single exported function or interface from the existing codebase, Phase 1 stops and the team returns to architecture review. The hard bail language is the mechanism that forces an honest assessment rather than an accommodating workaround.

**Failure: WorkspaceAuthorizer cannot be extracted without coupling.**
Trigger: workspace authorization logic lives inside `handler.Handler` or similar structs with no exported interface. Extracting it requires either importing the entire handler package (creating a large coupling) or duplicating permission logic (creating a security divergence over time).
Impact: every Hive handler becomes either too tightly coupled to core handler internals, or implements its own authorization path that drifts from the core policy.
Signal: the first draft of `authz.go` requires a direct import of `server/internal/handler` or copies multiple functions from that package.
Our answer: if a clean interface extraction is possible with a small targeted refactor (one file, no new exported types beyond the interface itself), Phase 1 may include it. If the refactor is larger than that, Phase 1 stops. An authorization path that requires a large refactor is a signal that the `WorkspaceAuthorizer` assumption (see Section 7.2) was wrong.

**Failure: Startup migration behavior conflicts with Multica's operational model.**
Trigger: Multica runs core migrations through a separate explicit command, and the server binary does not currently have health/readiness endpoint semantics. Phase 1 requires that Hive migration failure be observable at startup or readiness, but neither mechanism exists.
Impact: the team must choose between adding new operational infrastructure in Phase 1 (a readiness endpoint) or accepting a weaker failure signal (log lines only) that may be missed in automated deployment workflows.
Signal: reviewing `server/cmd/server/main.go:142-160` shows no health check, no readiness gate, and no post-startup failure reporting beyond process exit.
Our answer: if the server has a health or readiness endpoint, Hive migration failure marks it unhealthy or makes the endpoint return a non-200 response. If no such endpoint exists, the implementer chooses between fail-fast startup — where Hive migration failure causes the server process to exit with a clear error message — or adding a minimal readiness signal. Either is acceptable; what is not acceptable is an empty EpicTree view as the observable failure mode, because an empty view is indistinguishable from successful migration with no data.

**Failure: TypeScript or Next.js transpilation friction from the new package.**
Trigger: `@multica/hive` uses exports or dependencies that require additional `next.config.ts` configuration beyond `transpilePackages`, such as CSS modules, image optimization, or package exports that Next.js does not transpile automatically.
Impact: Phase 1 typecheck or build fails with import resolution or transpilation errors that require investigation and config work unrelated to the route/store proof.
Signal: `pnpm --filter @multica/web typecheck` or `pnpm build` fails with errors referencing `@multica/hive` imports.
Our answer: the VERIFIED evidence at `apps/web/next.config.ts:27` and `apps/web/package.json:21-23` establishes that the pattern works for existing packages. Phase 1 must keep the initial `@multica/hive` package surface minimal: no CSS modules, no image imports, no unusual exports, no peer dependency conflicts. If transpilation issues appear anyway, they should be resolved before any Phase 2 work begins, because they represent a gap between the ASSUMED and VERIFIED evidence.

**Failure: Route and nav anchors sprawl across more files than anticipated.**
Trigger: four views plus catalog require sidebar entries, path builders, page route files, locale keys, nav tests, and potentially search registration or command palette entries in Multica, each with its own change and test. The per-view overhead compounds across phases.
Impact: implementation time for Phases 2-5 is significantly underestimated; the sidebar and path files accumulate many Hive-specific additions; Phase 6 seam extraction becomes a larger refactor than planned.
Signal: Phase 2 nav work (sidebar entry, path builder, locale key, nav test) takes longer than Phase 2 backend work.
Our answer: the sidebar strategy sign-off decision (decision 7) must be made before Phase 2 begins. A single Hive parent entry with in-page or sub-route child navigation is likely lower-maintenance than five independent sidebar entries. If the decision is deferred, Phase 2 should implement the minimal option — one entry — and adjust in Phase 3 if product requires separate entries for each view.

**Failure: Same Postgres separate schema carries operational coupling that is not documented.**
Trigger: operators performing backup configuration, Postgres upgrade preparation, or RDS snapshot review do not know `hive.*` exists as a separate schema within the same database. Backup policies configured at the database or table level may not include the new schema.
Impact: after a backup/restore cycle, `hive.*` tables are absent; the server starts but EpicTree, ReviewGates, PersonalQueue, HermesChat, and materialized skill catalog state all return empty results or errors.
Signal: a post-restore smoke check fails for Hive routes while core Multica features work correctly.
Our answer: the documentation impact section requires updating operations documentation to explicitly state that `hive.*` is part of the same Postgres backup target. The blocking questions in the dependency map include a pre-Phase-1 check of schema creation permissions in target environments.

**Failure: Cross-store materialization proves more complex than view slices.**
Trigger: the state machine for skill materialization — create if absent, reject if collision, update if explicitly requested, mark customized if user has edited — requires more conditional branches and edge case handling than a typical Hive data write, plus the transaction boundary across two schema owners.
Impact: Phase 5 takes significantly longer than planned; conflict behavior is implemented inconsistently; user skill data is corrupted in an edge case.
Signal: `skill_materializer_test.go` grows beyond twenty test cases before all scenarios are covered.
Our answer: Phase 5 implementation must draft the state machine document before writing any `skill_materializer.go` code. The state machine has at most four states per catalog entry per workspace: `absent` (never materialized), `materialized` (created from catalog, unmodified), `customized` (user has modified the materialized skill), `superseded` (catalog has a newer version than what was materialized). Each materialization action produces a deterministic state transition. If the state machine document reveals gaps — uncovered edge cases that require additional sign-off — Phase 5 stops at catalog browse (endpoint + minimal UI) and the materialization work is deferred until the state machine is fully specified.

**Failure: Skill catalog update semantics are underspecified at implementation time.**
Trigger: "enable", "customize", and "import" from the user-facing vocabulary imply different behaviors — whether the skill is overwritten, forked, or just added — and the source document does not fully specify which operations exist and what each does.
Impact: the Phase 5 implementer makes assumptions about behavior that differ from product intent, leading to a skill inventory that does not match user expectations on upgrade.
Signal: during Phase 5 implementation review, reviewers cannot agree on what should happen when a workspace tries to re-materialize a skill it already has.
Our answer: the minimum behavior is deliberately narrow: materialize creates if absent, returns 409 if the workspace already has a skill with that name without explicit semantics. Any richer behavior (re-materialize to a newer catalog version, fork a customized skill to a new name, bulk-import catalog) is follow-up work requiring its own sign-off. This minimum is explicitly stated in sign-off decision 12 and must be confirmed before Phase 5 begins.

**Failure: Runtime-local skill handling logic is mistakenly reused.**
Trigger: `server/internal/handler/runtime_local_skills.go` is nearby and handles something that looks like skill catalog operations, creating temptation to import or replicate its patterns.
Impact: the catalog browse endpoint depends on active runtime daemon callbacks as shown in lines 46-62 and 478-495, making it unavailable when no runtime is connected — exactly the failure mode the plan is designed to avoid.
Signal: `GET /api/plugins/hive/skills/catalog` returns an empty list or an error when no Claude Code runtime is connected.
Our answer: catalog browse reads from `packages/hive/src/skills/catalog.ts` — a static packaged data structure built at compile time, not discovered at request time. Any Phase 5 code that reaches toward runtime state for catalog data is a defect. The runtime-local code is referenced only as existence proof for the downstream materialization write path (lines 46-62 showing import flow, lines 478-495 showing the resulting DB-backed skill).

**Failure: Chat expectations exceed the chosen refresh behavior.**
Trigger: the product owner or early users find that polling latency makes HermesChat feel broken as a communication tool.
Impact: Phase 4 is functionally complete per the plan but fails user acceptance; real-time integration with `/ws` becomes an unplanned Phase 4 follow-up that delays subsequent slices.
Signal: user testing feedback explicitly cites polling latency as an acceptability blocker.
Our answer: the HermesChat refresh/realtime decision must be made at sign-off (decision 10) before Phase 4 begins, not after. If the product owner requires realtime from the first delivery, Phase 4 must plan for `/ws` integration using the existing rewrite configuration at `apps/web/next.config.ts:35-69` and the existing `packages/core/api/ws-client.ts`. Adding a second WebSocket client is never acceptable regardless of chat requirements.

**Failure: Phase 1 EpicTree establishes an unbounded list API contract.**
Trigger: the proof implementation returns all `hive.epic_nodes` for a workspace without any limit or cursor, which becomes the observed API contract that frontend code is written against.
Impact: retrofitting cursor-based pagination after real callers exist requires a breaking API change — different response shape, new required cursor parameter — plus frontend refactoring.
Signal: `GET /api/plugins/hive/epic-tree` response body has no `nextCursor` or `total` field and is documented as returning everything.
Our answer: Phase 1 should include a server-enforced upper bound on the returned node count even without full cursor-based pagination. A response header or a response body field indicating there may be more data costs one additional line of code in Phase 1 and prevents establishing an unbounded-list contract that callers depend on.

**Failure: Phase 6 adds abstraction without reducing fork maintenance.**
Trigger: the concrete Hive anchors from Phases 1-5 are small enough that a rebase or upstream sync takes modest time, and the generic seam helper adds indirection without measurably reducing that time.
Impact: Phase 6 produces an abstraction layer that future developers must understand without receiving a maintenance benefit in return.
Signal: the fork diff before Phase 6 is reviewable in under one hour; the Phase 6 changes require their own documentation and tests without a corresponding reduction in upstream-sync complexity.
Our answer: Phase 6 is explicitly conditional on measured fork churn evidence (sign-off decision 16). The documentation of the proven seam is unconditional. The code extraction is only justified if the measurement shows that the extraction reduces rebase effort. If the measurement shows the anchors are already small, Phase 6 produces only the seam documentation and closes.

**Failure: Invented path labels cause reviewer confusion between existing and new files.**
Trigger: the file change manifest references both existing files (with real filesystem paths that can be verified) and intended new files (paths that do not yet exist but follow the established directory structure). A reviewer cannot tell them apart without context.
Impact: a pull request accidentally modifies a file from the wrong category, or code review misses a new file landing in the wrong directory.
Signal: a pull request includes a CREATE for a file that the reviewer expects to already exist, or vice versa.
Our answer: the manifest uses explicit CREATE/MODIFY/UNCHANGED/UNCHANGED-BUT-AFFECTED labels for every entry. Every CREATE path is an intended addition inside an existing directory whose path is verifiable now. Every MODIFY path already exists. Code reviewers should verify that CREATE files land in their specified directories and MODIFY files do not introduce new files alongside changes.

---

### 7.2 Assumptions

**VERIFIED: `apps/web/next.config.ts` has `transpilePackages` for workspace packages** (line 27). This is the build-time package registration mechanism that Hive will use.

**VERIFIED: `apps/web/package.json` depends on `@multica/core`, `@multica/ui`, and `@multica/views` as workspace dependencies** (lines 21-23). The pattern for adding `@multica/hive` is established.

**VERIFIED: `apps/web/next.config.ts` rewrites `/api`, `/ws`, `/auth`, and `/uploads` to the backend** (lines 35-69). Auth inheritance and potential WebSocket reuse are structurally supported.

**VERIFIED: workspace routes are under `apps/web/app/[workspaceSlug]/...`.** Hive page adapters follow this directory structure.

**VERIFIED: `apps/web/app/[workspaceSlug]/layout.tsx` gates workspace routes on auth and workspace lookup** (lines 26-90). Hive pages inside the dashboard group inherit this gating automatically.

**VERIFIED: dashboard pages are thin adapters that import view packages** — `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12` shows the canonical example. Hive pages follow the same five-line pattern.

**VERIFIED: `packages/core/paths/paths.ts` centralizes workspace-scoped path builders** (lines 17-41). Hive path builders are added here.

**VERIFIED: `packages/views/layout/app-sidebar.tsx` uses static nav arrays** (lines 102-150) with render slots (lines 608-722). Hive nav entries follow the same mechanism.

**VERIFIED: backend protected API routes use `middleware.Auth`** in `server/cmd/server/router.go` at lines 301-304. The Hive mount belongs inside this group.

**VERIFIED: existing APIs are mounted with explicit chi route group registrations** at `server/cmd/server/router.go:535-590`. The Hive mount follows this style.

**VERIFIED: Multica creates a pgx pool from `DATABASE_URL`** in `server/cmd/server/main.go:142-160`. HiveStore receives this pool.

**VERIFIED: core migrations are loaded from `server/migrations/`** as shown in `server/internal/migrations/migrations.go:13-16` and `50-69`. Hive migrations must not enter this directory.

**VERIFIED: core sqlc schema input is `server/migrations/`** per `server/sqlc.yaml:1-10`. Hive SQL must not appear in sqlc input.

**VERIFIED: `skill`, `skill_file`, and `agent_skill` exist in core migrations** per `server/migrations/008_structured_skills.up.sql:4-31`. These are the materialization target tables.

**VERIFIED: existing skill CRUD is DB-backed** per `server/internal/handler/skill.go:212-307`. Materialized skills become native skill records via this path.

**VERIFIED: runtime-local skill listing depends on runtime/daemon request state** as shown in `server/internal/handler/runtime_local_skills.go:46-62` and `478-495`. Hive catalog must not replicate this dependency.

**ASSUMED: `@multica/hive` is an acceptable package name.** Follows existing `@multica/` namespace convention; no evidence of a conflict exists.

**ASSUMED: `packages/hive` is the preferred frontend package location.** Covered by the existing `packages/*` glob; alternatives require workspace config changes.

**ASSUMED: `server/internal/hive` is the preferred backend package location.** Follows the `server/internal/{domain}` convention used by existing feature packages.

**ASSUMED: Hive can extract or wrap enough authorization behavior without large handler refactors.** This is the central seam assumption. If it is wrong, Phase 1 stops.

**ASSUMED: startup fail-fast or readiness marking for Hive migration failure is operationally acceptable.** May need adjustment based on Multica's actual deployment model.

**ASSUMED: each Hive view can be delivered as a route page inside the existing dashboard shell.** The thin-adapter pattern evidence supports this.

**ASSUMED: React Query is the standard frontend data fetching pattern for Hive views.** Consistent with existing views package conventions.

**ASSUMED: a single `HiveStore` interface can grow across six slices without becoming unmanageable.** If the interface reaches ten or more domain methods across phases, per-domain stores should be evaluated.

**ASSUMED: each Hive table can reference core workspace/user/agent/skill records via plain UUIDs without hard foreign key constraints.** This avoids cross-schema constraint issues. The coupling design is deferred to sign-off.

**ASSUMED: product accepts minimal UI for proof and catalog browse.** Minimal means functional and navigable, not polished or fully featured.

**ASSUMED: Phase 2-4 can be reordered after Phase 1 if product priorities change.** No technical dependency exists between ReviewGates, PersonalQueue, and HermesChat.

**RISKY: ReviewGate state transition rules may be more complex than the plan captures.** If transitions have machine-validated constraints (no backward state change without an explicit override, required evidence before `passed`), Phase 2 needs a state machine implementation, not a simple field update, and the state rules must be specified before Phase 2 begins.

**RISKY: PersonalQueue may need richer permission semantics than current-user filtering.** Admin delegation, team-visible queues, priority override workflows, and read-only visibility for managers are not specified. If required, they affect Phase 3 schema and query design.

**RISKY: HermesChat may require realtime behavior before polling is confirmed acceptable.** If the product owner sees polling latency during Phase 4 review and deems it unacceptable, WebSocket integration becomes an unplanned addition that delays Phase 5.

**RISKY: Skill materialization may require a full upgrade/diff workflow.** If users expect their materialized skills to receive updates when the Hive catalog releases a new version, Phase 5 needs version-diffing and selective-update logic, making it significantly more complex than the minimum provenance and conflict handling specified.

**RISKY: Upstream seam extraction may not reduce enough fork churn to justify Phase 6 code changes.** If the concrete anchors from Phases 1-5 are already small, Phase 6 reduces to documentation only.

**RISKY: Large EpicTree and chat datasets may require pagination earlier than planned.** Early customers with many epics or active HermesChat threads could expose the Phase 1 and Phase 4 query bounds before optimization is ready.

**RISKY: Same-database separate schema may be perceived as "core DB coupling" by upstream Multica maintainers.** If upstream policy requires a truly separate data store for any plugin, the storage architecture must be revisited — a sidecar or separate database would require significant re-scoping.

**RISKY: Hive schema creation permissions may be unavailable in hosted deployments.** If `CREATE SCHEMA hive` fails in the target environment because the application database user lacks schema-creation privileges, Phase 1 migration fails regardless of code correctness. This is a pre-flight infrastructure check.

**RISKY: Catalog skill content may require a security review before any materialization endpoint ships.** If packaged catalog files can produce agent skill entries that bypass permission checks or produce unexpected agent behaviors, Phase 5 needs security sign-off before it ships, not after.

---

### 7.3 Simplest Version

The simplest acceptable version of this epic is Phase 1 only. The Phase 1 proof checklist defines "done" for the minimum viable epic:

- `@multica/hive` package exists and `pnpm --filter @multica/hive typecheck` passes
- `apps/web/package.json` lists `@multica/hive` as a workspace dependency
- `apps/web/next.config.ts` includes `@multica/hive` in `transpilePackages`
- One page adapter at `hive/page.tsx` renders `EpicTreeView`
- One sidebar entry navigates to the Hive route
- One `r.Mount("/api/plugins/hive", ...)` inside the protected route group
- `WorkspaceAuthorizer.RequireWorkspace` is called on every Hive handler
- `hive.schema_migrations` and `hive.epic_nodes` are created by Phase 1 migration
- One write and one read through `hive.epic_nodes` work end-to-end
- Unauthenticated requests to `/api/plugins/hive/epic-tree` return 401
- Unauthorized workspace requests return 403
- No file in `server/migrations/` contains Hive SQL
- `server/sqlc.yaml` is unchanged
- A broken Hive migration produces an observable failure (not a silent empty UI)

If any item on this list cannot be checked, the epic stops with a documented reason. Partial Phase 1 is not a deliverable.

For subsequent phases, the minimum acceptable ReviewGates is list by epic/workspace plus one state update — not a gate workflow engine with complex validated transitions. The minimum acceptable PersonalQueue is current-user active items with typed cross-system links — not delegation analytics, admin override visibility, or priority-weighted scheduling. The minimum acceptable HermesChat is persisted threads and messages with polling or manual refresh — not WebSocket integration unless the sign-off decision requires it. The minimum acceptable Skills phase is browse the packaged catalog and materialize one selected skill — not automatic version upgrade management, not bulk import, not skill removal. The minimum acceptable Phase 6 is documentation of the proven seam anchors plus a route/nav mount helper only if the fork diff evidence shows it reduces rebase effort.

Anything beyond these minima is follow-up work unless specifically required by sign-off decisions.

---

### 7.4 Regrets — What Will We Wish We'd Thought Of?

We may regret not defining `WorkspaceAuthorizer` as a clean reusable interface before implementing the first handler, because any subsequent handler that skips it or implements a local equivalent creates a security divergence that accretes silently. The second and third Hive handlers are the moments when shortcuts feel most tempting — the proof is working, there is schedule pressure, and the authorization call looks like boilerplate. The only defense is a convention that makes `WorkspaceAuthorizer.RequireWorkspace` the first line in every handler body, verified by a linter or code review checklist rather than developer memory.

We may regret making `HiveStore` a single broad interface if test doubles become unwieldy across all five domain areas. Per-domain stores (EpicNodeStore, ReviewGateStore, QueueStore, ChatStore, CatalogStore) produce smaller, more focused test doubles even if they complicate the injection graph slightly. The sign that this regret has arrived is when a test file requires a stubbed `HiveStore` that needs fifteen method implementations to satisfy the interface for a handler that only uses two of them. At that point, splitting the interface is a refactor rather than a design choice, and refactoring a widely used interface mid-epic is painful.

We may regret not adding cursor-based pagination to EpicTree in Phase 1 if early customers have large epic trees. The API contract established in the proof slice becomes load-bearing; retrofitting pagination is a breaking change that requires coordinated frontend and backend updates. A minimal defense is a server-side upper limit on returned nodes (e.g., hard cap at 500 with a response flag indicating more exist) that signals the contract is not unbounded, even if full cursor pagination is not implemented in Phase 1. This small addition buys time to add real pagination in a follow-up without requiring immediate breaking-change work.

We may regret not deciding sidebar structure before Phase 2-5 nav work begins. Each phase adds sidebar entries; changing the structure after Phase 3 means retroactively reworking Phase 2 and 3 nav additions. If Phases 2 and 3 each added a top-level sidebar entry and the product owner decides in Phase 4 that a single parent "Hive" entry with children is preferred, Phase 4 must remove two Phase 2-3 entries and add the parent — touching already-merged nav work and potentially producing a confusing user-visible change mid-epic.

We may regret choosing route names (`/hive`, `/hive/review-gates`, `/hive/queue`, `/hive/chat`, `/hive/skills`) that conflict with future product vocabulary or require redirect chains as the product evolves. Route names are part of the external API surface — they appear in links, bookmarks, and email notifications. A rename after the product ships requires redirects for backward compatibility. The names should be reviewed against the product vocabulary at sign-off rather than treated as implementation details.

We may regret not establishing a migration command and readiness convention clearly in Phase 1. Each subsequent phase adds a migration; operators need a consistent answer to "how do I apply Hive migrations?" from the first deployment. If Phase 1 picks "automatic at startup" and Phase 5 requires a manual step for a destructive migration, the convention breaks mid-epic. The right behavior is decided once at sign-off and implemented consistently. Inconsistent migration execution semantics across phases are operationally confusing even when each individual phase is technically correct.

We may regret not adding structured audit logging for ReviewGate state changes. Gate outcomes are significant product events with potential compliance implications — they represent a human decision that a work artifact has passed or failed quality review — and retroactively adding audit logging requires schema changes and backfilling. Adding an audit event on first write costs one table, one handler extension, and a migration. Adding it after the table has been live for months costs all of those plus a backfill query, data reconciliation, and a user-visible history gap.

We may regret not making `QueueTarget.href` type-safe enough to detect stale links. When a linked core issue or project is deleted, the href becomes a dead link that the frontend can only detect with an additional API call. The mitigation is not to prevent the link from going stale — that requires background reconciliation work not in scope — but to model the target as a typed discriminated union so that a future link resolver can pattern-match by type, construct a liveness check, and handle stale links gracefully rather than silently rendering a broken URL.

We may regret implementing chat polling if user expectations solidify around realtime delivery, and equally we may regret implementing WebSocket integration if the polling behavior was acceptable and the realtime work delayed Phase 5. This is a genuine two-sided risk with no safe default — polling delays Phase 5 if realtime becomes required; WebSocket adds complexity that may be wasted if polling was fine. The sign-off decision resolves it explicitly, and it must be made before Phase 4 begins. If the product owner cannot decide without seeing polling in action, the correct approach is to implement polling in Phase 4, ship, and schedule the WebSocket upgrade as Phase 4b after user feedback is available.

We may regret not modeling the skill catalog state machine fully before Phase 5 begins. Once materialized skills are in user workspaces, correcting a flawed state model requires a data migration. The four states — absent, materialized, customized, superseded — seem simple but the transitions are not: what happens when a user renames a materialized skill and then the catalog releases a new version? What happens when a workspace is deleted? What happens when an agent is deleted but the skill is still materialized? None of these are in scope for Phase 5, but having a documented state machine before implementation starts means these edge cases can be marked explicitly out of scope rather than discovered mid-implementation.

We may regret storing too little provenance to distinguish materialized, customized, and superseded skills. Once a skill is in a user's inventory and they have modified it, retroactively adding provenance fields requires a migration and potentially an audit of which skills are "really" Hive-originated. The specific field at risk is `materializedAt` — without it, there is no way to sort or filter materialized skills by when they were added to the workspace. Similarly, without `catalogVersion`, there is no way to tell whether a materialized skill is current or behind the latest catalog release.

We may regret using skill name as the primary collision surface rather than catalog key. If catalog keys are the stable identity and names are display properties, a user-renamed skill should not block re-materialization or updates. If a user renames `research-brief` to `my-research-brief`, a future materialize call should recognize this as the same catalog-key skill in customized state, not as an absent skill that can be re-created. The Phase 5 design should document whether collision detection uses `(workspace_id, catalog_key)` or `(workspace_id, name)` as the uniqueness test, and justify the choice.

We may regret failing to document backup/restore implications of the `hive` schema. If the operations team configures Postgres backup at the table or schema level and does not include `hive.*`, a backup/restore cycle produces a working Multica instance with no Hive data — no EpicTree nodes, no review gates, no queue items, no chat threads, no catalog state. The failure mode is silent: the application starts, requests succeed, and data appears empty rather than throwing errors. Operations documentation must explicitly state that `hive.*` schema tables are part of the same Postgres database and must be included in all backup and restore procedures.

We may regret treating Phase 6 as unconditional if the concrete anchors remain small and the abstraction adds more complexity than it removes. The risk is not that Phase 6 produces bad code — it is that the team spends time and review effort on an abstraction layer that nobody needed. The conditional language ("only if measured fork churn justifies it") protects against this, but it requires the team to actually measure and report the fork diff before Phase 6 begins, rather than treating measurement as a formality that happens after the decision to extract has already been made informally.

We may regret not producing a small operational checklist for `hive.*` tables in deployment documentation — schema creation permissions, migration command, readiness check, backup coverage. Each point on this checklist corresponds to a Phase 7 question being answered: Can the database user create a schema? Are Hive migrations applied before traffic is served? Are Hive tables included in backup scope? The checklist has nothing to implement — it captures what Phase 1 already verified and documents it for operations teams who were not part of the proof process.

We may regret not testing cross-workspace cache behavior explicitly in Phase 1 frontend tests. React Query key scoping is easy to get right once and easy to silently break during a refactor. The specific test scenario: render an EpicTree for workspace A, navigate to workspace B, verify that the cache does not serve workspace A's data. If this test does not exist, a later refactor that accidentally drops the workspace ID from the cache key will serve stale cross-workspace data and may not be caught in review.

We may regret not deciding whether Hive tables reference core records with foreign keys or plain UUIDs. Foreign keys provide referential integrity — an epic node's `workspace_id` cannot reference a deleted workspace — but they create cross-schema constraint complexity and make schema isolation harder. Plain UUIDs are simpler but allow orphaned references when core records are deleted. The decision must be made before Phase 1 schema design is finalized, and whatever choice is made must be applied consistently across all five Hive schema migrations.

We may regret not defining retention and deletion behavior for HermesChat messages. If chat becomes heavily used, unbounded message retention creates storage pressure and operational complexity. A table with no archiving policy grows forever; a table with an undocumented policy creates user confusion when messages disappear. Phase 4 should at minimum document the intended retention policy (even if the answer is "no automatic deletion in Phase 4") so that future implementers have a documented baseline to build from.

We may regret not defining rate limits for chat send and skill materialization before those endpoints are in production. Both are write-heavy endpoints that can be abused without per-user rate limiting. A user who sends a thousand chat messages per minute or a script that materializes the entire catalog in a tight loop should encounter a limit. Phase 4 and Phase 5 do not need to implement sophisticated rate limiting, but they should include a placeholder middleware hook point and document the expected per-user limits so that adding rate limiting later does not require a handler refactor.

We may regret not getting security review involved before Phase 5 materialization is coded. The risk that catalog files influence agent execution in unexpected ways is significant enough that a pre-implementation review is warranted, not a post-implementation audit. Catalog files become agent skill files. Agent skill files influence agent behavior. The path from "packaged catalog content" to "agent execution policy" is short, and a catalog file that produces unexpected skill content could constitute a privilege escalation. A security review before Phase 5 code is written is cheaper than a post-ship remediation.

---

### 7.5 Where Are We Over-Engineering?

Phase 6 may be over-engineering if the generic seam is extracted before measuring actual fork churn. If the five phases produce Hive-specific anchors that fit in a manageable diff, a generic `MountAuthenticatedPluginRoutes` helper adds indirection without reducing maintenance. Documentation of the proven seam is always justified; code extraction requires evidence.

A single broad `HiveStore` interface may be over-engineering across five phases if the resulting test doubles become large and fragile. A per-domain store design (one store per Hive feature area) produces focused, testable interfaces even if it requires more injection wiring. The right time to evaluate this is during Phase 2 or 3 when the interface size becomes visible.

The skills catalog UI is likely over-engineering if the browse endpoint and the existing Multica Skills page together satisfy the user workflow. A dedicated skills catalog route adds a view, a page adapter, a path builder, sidebar configuration, and test overhead. The minimum is a browse endpoint and materialization endpoint that the existing UI can consume.

Down migrations are potentially over-engineering if the production deployment policy never executes them. Down migrations are genuinely valuable for local development and test database teardown; their production value depends on an operational decision that has not been made. They should exist but should not be treated as a hard correctness gate.

Nav abstraction in Phase 6 may be over-engineering if a small number of explicit Hive entries in `app-sidebar.tsx` is more readable than a `PluginNavItem[]` array. Abstraction reduces repetition but introduces a layer that developers must understand. The right choice depends on whether the nav additions create a recurring maintenance cost.

The initial EpicTree data shape may be over-engineering if Phase 1 adds schema fields that are not needed to prove the route/store seam. The proof table should be minimal: `id`, `workspace_id`, `parent_id`, `title`, `status`, `updated_at`. Richer tree attributes such as ordering weights, depth caching, or extended metadata can be added in a follow-up Phase 1 amendment or in Phase 2 if product requires them.

Realtime chat may be over-engineering if a user-triggered refresh satisfies the Phase 4 acceptance criteria. Auto-polling with a fixed interval creates continuous server load proportional to the number of active chat sessions; a manual refresh or refetch-on-focus approach is simpler and may be sufficient.

Materialization assignment in the same API call may be over-engineering if the existing agent-skill assignment flow can handle post-creation assignment. Combining two distinct operations (materialize skill, assign to agent) in one endpoint complicates the API contract, the permission model, and the test surface. The simpler path is materialize-only, with assignment through the existing flow.

A plugin path helper for `paths.workspace(slug).hiveX()` functions may be over-engineering if those functions stay few, well-named, and typed. Replacing explicit path functions with `createWorkspacePluginPath(slug, "hive")` adds a layer of indirection without improving type safety.

Startup migration automation may be over-engineering if Multica's deployment model strongly prefers explicit migration commands. A minimal readiness check that verifies `hive.schema_migrations` completeness — without running migrations automatically — may be the better operational fit and requires less startup logic.

The plan must never over-engineer a runtime plugin loader (the locked architecture is build-time bundled, not runtime-discovered), a sidecar service (the locked storage is same Postgres with separate schema), automatic workspace skill seeding (the locked design rejects it), or generalized runtime catalog discovery from runtime-local skill handlers (the Hive catalog is packaged and versioned, not dynamically discovered).

---

## Part 8: Decision Points for Sign-Off

This section splits decisions into **already locked** (affirm as a group — settled at the design gate or standing policy) and **open** (each carries a recommended default; accept the defaults or override individually). Only the ★ items genuinely warrant a fresh judgment call.

### 8a. Decisions already locked (affirm as a group)

Not re-litigated here — approved at the design gate or standing policy. Listed for traceability.

- **Storage architecture** — same Postgres DB, separate `hive` schema, `hive.schema_migrations` ledger. *(Design-gate fork 2.)*
- **Fork-first, conditional Phase 6** — upstream seam extraction happens only if measured fork churn warrants it, not as an unconditional refactor. *(Design-gate fork 3.)*
- **Core-migration isolation** — no Hive SQL in `server/migrations`, ever; CI grep enforces it. *(Standing policy.)*
- **Phase 1 hard bail** — stop if route mount needs deep router surgery, the durable write/read can't be shown, or Hive needs core-migration files. *(Encoded as mpu-1 acceptance criteria.)*
- **Security plan-audit before execution** + **performance audit before production scale.** *(Standing process.)*
- **Missing-data policy** — implementers mark gaps `[data not provided: …]` rather than inventing behavior. *(Standing policy.)*
- **Risk Registry + Elicitation preserved downstream** — not collapsed into bullets in stories or reviews. *(Standing policy.)*

### 8b. Open decisions (recommended default — affirm or override)

Each defaults to the recommendation unless you override. **★ = worth a real look.**

1. **Frontend package name/location** — Default: `@multica/hive` in `packages/hive` (matches the `@multica/*` convention). Override for `@firefly-events/hive` or `apps/hive`. *Lock before Phase 1 — rename is codebase-wide.*
2. **Backend package location** — Default: `server/internal/hive` (Go internal convention). Override for a top-level `hive` package.
3. ★ **Sidebar strategy** — Default: one parent "Hive" entry with sub-nav for the four views + skills (keeps the sidebar from growing by five). Override for separate top-level entries per view.
4. ★ **HermesChat refresh** — Default: polling/manual refresh for v1 (simple, sufficient). Override for `/ws` realtime (adds backend event-publish + frontend connection management).
5. ★ **Hive migration execution** — Default: auto-run at server startup, failure surfaced at readiness. Override to verify-only (separate `hive migrate` command) if prod policy requires explicit, audited migrations.
6. ★ **ReviewGate update permissions** — Default: workspace-membership only for v1; build `WorkspaceAuthorizer` so role-gating can be added later without rework. Override to require a `reviewer` role / `can_update_gates` now.
7. **PersonalQueue visibility** — Default: current-user-only (simplest, safest). Override for admin/delegated visibility (needs extra schema + authz; can't retrofit without a migration).
8. **EpicTree canonical route** — Default: `/hive/epics` canonical, `/hive` redirects. Override to collapse to one.
9. **Skill materialization collision** — Default: 409 Conflict, caller chooses an explicit action. Override to support silent overwrite/customize flags.
10. **Assign-skill-in-materialize call** — Default: keep materialize and agent-assignment as separate flows. Override to combine (two permissions + two write domains in one transaction).
11. **Provenance fields** — Default: `catalogKey`, `catalogVersion`, `state`, plus `materializedBy`. Override to add `lastCheckedAt` / `originalName`.
12. **Catalog UI route** — Default: reuse the existing Multica Skills page for v1; defer a dedicated `/hive/skills` view. Override to build the dedicated catalog UI in Phase 5.

**Net:** affirm 8a as a group, accept the 8b defaults, and weigh in only on the four ★ items (sidebar, chat refresh, migration execution, gate permissions) if you'd choose differently.
