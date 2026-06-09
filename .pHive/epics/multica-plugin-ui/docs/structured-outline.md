# Structured Outline - multica-plugin-ui

The epic delivers Hive as a build-time-bundled plugin surface inside Multica, not as a runtime-loaded drop-in. This structured outline operationalizes the approved design discussion and vertical/horizontal plans into a detailed implementation blueprint sufficient that story decomposition becomes mechanical rather than creative.

## 1. **Executive Summary**

Hive integrates into Multica as a workspace-scoped npm package, anchored through thin Next.js routes and sidebar navigation entries on the frontend, and a single authenticated chi route mount at `/api/plugins/hive/*` on the backend. The backend mount dispatches to build-linked Hive handlers, not to Go runtime plugins; auth and WebSocket behavior inherit directly from Multica's current shell infrastructure. Hive owns its own datastore, stored in a separate Postgres schema named `hive` within the same database Multica uses, eliminating the fork maintenance burden of adding numbered migration files to `server/migrations` and ensuring Hive tracks its own schema version in `hive.schema_migrations`.

The proof-of-concept gate is Phase 1, which validates the route/store seam. Phase 1 stops the epic if the router seam requires deep surgery, if a single durable write/read through `hive.*` cannot complete, or if any Hive tables end up in core migrations. The four user-facing views—EpicTree, ReviewGates, PersonalQueue, and HermesChat—land in separate phases after proof, each building on the proven seam without architectural changes. The skills catalog materialization path is separate because it exercises a distinct integration with Multica's existing skill/agent assignment model. Upstream seam extraction is last, grounded in concrete evidence from working implementation rather than speculative abstraction.

The locked architectural decisions are: Hive-owned storage using the same Postgres instance with a separate schema; fork-first implementation followed by upstreaming a proven minimal seam; and a hybrid skills approach—packaged/versioned catalog for discovery, optional DB materialization for activation. Design feedback rejected speculative generic loader work before proof and automatic workspace skill seeding due to version and ownership ambiguity. The strategy keeps implementation feasible by reusing existing Next.js package composition, existing chi route grouping, existing Postgres infrastructure, and existing skill tables. Execution discipline requires that each slice leave a working, testable vertical path; that Hive-owned schema discipline be visible in code review and tests; and that auth inheritance be supplemented by explicit workspace/member authorization checks in every Hive handler. Security review is required for the new authenticated API surface and cross-system skill materialization. Performance review is required because tree, queue, and chat surfaces can involve large data reads.

## 2. **Detailed Approach**

### Phase 1: Proof gate — backend route-mount + HiveStore + minimal EpicTree

Phase 1 is the decisive slice. It proves the route/store seam by delivering an authenticated browser route that renders a minimal EpicTree view inside the existing dashboard shell, reaching build-linked Hive handlers through `/api/plugins/hive/*`, and performing a single durable write/read through `hive.epic_nodes`. The phase validates that Hive migration failure surfaces at startup or readiness, and that no Hive tables enter the core migration stream. If the router seam requires deep surgery, if the write/read loop breaks, or if schema/migration boundaries are violated, the epic stops before proceeding to later phases.

The proof logic cascades: build-time package composition feeds the frontend dependency tree; workspace route layout provides auth context; frontend routes dispatch through the dashboard shell; sidebar navigation anchors user discovery; backend routes mount under existing auth middleware; the HiveStore interface provides a clean seam between router handlers and the Postgres-backed store; and the migration runner ensures schema readiness before requests reach handlers. Each anchor point is intentionally small and specific.

#### Phase 1 file changes and structure

The frontend package setup begins with registering `@multica/hive` in the build-time package graph. Modify `pnpm-workspace.yaml` only if the chosen package location falls outside the existing `packages/*` glob; if `packages/hive` is selected, the current glob already covers it. Update `apps/web/package.json` to list `@multica/hive` as a workspace dependency alongside `@multica/core`, `@multica/ui`, and `@multica/views`. Update `apps/web/next.config.ts` to add `@multica/hive` to the `transpilePackages` list, following the pattern already established at line 27.

Create the `@multica/hive` package structure under `packages/hive`. Add `package.json` to export EpicTree and proof-gate client surfaces; `tsconfig.json` extending the local TypeScript convention; and `src/index.ts` exporting the minimal `EpicTreeView` and proof client APIs. Build the view layer in `src/views/epic-tree-view.tsx` as a minimal but real dashboard-compatible screen, tested in `src/views/epic-tree-view.test.tsx` for rendering, empty state, error state, and successful data display. Create the API client layer in `src/api/client.ts` to own frontend calls to `/api/plugins/hive/*`; `src/api/types.ts` for shared DTO definitions; `src/api/queries.ts` for React Query options driving EpicTree reads; and `src/api/mutations.ts` for proof-gate write/update operations.

Frontend routes register through thin page adapters. Create `apps/web/app/[workspaceSlug]/(dashboard)/hive/page.tsx` as a thin adapter importing `EpicTreeView` from `@multica/hive`; optionally add `apps/web/app/[workspaceSlug]/(dashboard)/hive/epics/page.tsx` if product chooses `/hive/epics` as canonical. Update `packages/core/paths/paths.ts` to add parameterless workspace path builders for `hive` and `hiveEpicTree`, with corresponding test coverage in `paths.test.ts` asserting URL encoding and workspace prefixing preservation. Update `packages/views/layout/app-sidebar.tsx` to add a Hive nav key, label key, and sidebar entry using the existing nav array pattern; update `app-sidebar.test.tsx` if present, or add focused coverage where the project already tests layout navigation. Update locale files (typically `packages/views/locales/en/layout.json`) to add Hive nav label text, following the repo's locale conventions.

The backend architecture mirrors this simplicity. Modify `server/cmd/server/main.go` to construct HiveStore after the pgx pool connects and before router readiness can depend on Hive schema. Build startup to fail fast or mark readiness unhealthy if the proof migration fails—this is non-negotiable per Phase 1 acceptance. Modify `server/cmd/server/router.go` to add one single mount inside the protected API route group after auth middleware, keeping the change limited to one import, one store/handler construction seam, and one `r.Mount("/api/plugins/hive", ...)` call.

Backend implementation files establish the store/handler boundary. Create `server/internal/hive/router.go` to define the Hive chi router and proof EpicTree routes. Create `server/internal/hive/store.go` to define the `HiveStore` interface and pgx-backed implementation constructor—keep the interface focused on proof operations: `Migrate(ctx)`, `ListEpicTree(ctx, workspaceID)`, and `UpsertEpicNode(ctx, workspaceID, input)`. Create `server/internal/hive/migrations.go` to own migration execution and manage `hive.schema_migrations` separately from core migrations. Create the paired migration files `server/internal/hive/migrations/001_epic_nodes.up.sql` and `.down.sql`, with the up migration creating the schema, migration ledger, and `hive.epic_nodes` table, and the down migration providing reversible cleanup for local/test rollback. Create `server/internal/hive/epic_nodes.go` to implement proof read/write handlers and DTO mapping. Create `server/internal/hive/authz.go` to isolate workspace authorization helpers used by all Hive handlers—this captures the pattern for reuse in later phases.

Testing is minimal but concrete. Create `server/internal/hive/router_test.go` to prove the route returns 401/403 without valid auth context and works with test auth context. Create `server/internal/hive/store_test.go` to prove migration execution and one write/read against a test Postgres instance or existing integration harness.

Files unchanged but affected during Phase 1: `apps/web/app/[workspaceSlug]/layout.tsx` continues to provide auth and workspace slug context; `packages/views/layout/dashboard-layout.tsx` remains the host for the new route; `server/migrations` and `server/sqlc.yaml` must remain untouched—no Hive SQL files belong in either.

#### Phase 1 interfaces

The backend router is constructed with a HiveStore and a WorkspaceAuthorizer, returning a chi.Router: `hive.NewRouter(store HiveStore, authz WorkspaceAuthorizer) chi.Router`. The HiveStore interface exposes three proof operations: `Migrate(ctx context.Context) error` to initialize the schema; `ListEpicTree(ctx context.Context, workspaceID uuid.UUID) ([]EpicNode, error)` to fetch the current tree; and `UpsertEpicNode(ctx context.Context, workspaceID uuid.UUID, input EpicNodeInput) (EpicNode, error)` to create or update a node. The WorkspaceAuthorizer interface provides `RequireWorkspace(ctx context.Context, r *http.Request, workspaceID uuid.UUID) error` to check workspace membership; implementations check both authentication and authorization before proceeding.

The HTTP contract exposes two endpoints. `GET /api/plugins/hive/epic-tree?workspace_id={uuid}` lists the current EpicTree nodes for a workspace. `PUT /api/plugins/hive/epic-tree/nodes/{nodeId}` updates a single node, accepting an EpicNodeInput containing title, optional parentId, and optional status. Responses are EpicNode objects carrying id, workspaceId, parentId, title, status, and updatedAt. Errors return 401 Unauthorized when inherited auth is absent; 403 Forbidden when workspace membership or role checks fail; 400 Bad Request when workspace or node identifiers are malformed; 409 Conflict when node ordering or parent constraints are violated; and 500 Internal Server Error for store or migration failures.

Frontend paths are built through workspace-scoped builders: `paths.workspace(slug).hive(): string` yields the Hive entry point; `paths.workspace(slug).hiveEpicTree(): string` yields the EpicTree specific route. The frontend client exposes `function EpicTreeView(): JSX.Element` for rendering; `function listEpicTree(workspaceId: string): Promise<EpicNode[]>` for fetching; and `function upsertEpicNode(workspaceId: string, input: EpicNodeInput): Promise<EpicNode>` for mutations.

#### Phase 1 validation

Automated verification begins with typecheck passes: run `pnpm --filter @multica/hive typecheck` and re-run the existing web typecheck to catch integration errors. Run path tests on `packages/core/paths/paths.ts` to verify route builders are stable. Run EpicTree view component tests covering rendering, empty state, error state, and successful data display. Run Hive router tests proving `/api/plugins/hive/*` is mounted under auth and returns appropriate errors for unauthenticated requests. Run HiveStore write/read tests against a test Postgres or integration harness, proving migration execution succeeds and a single node persists and reads back correctly. Run a deliberate startup/readiness test with an intentionally broken Hive migration to confirm failure is visible and prevents readiness—this is critical to catch operational bugs before production.

Manual verification in a local Multica instance: log in through existing Multica auth, navigate to `/{workspaceSlug}/hive` (or `/hive/epics` if that route is canonical), and confirm the dashboard shell, sidebar, and minimal EpicTree render together. Use the UI or a test mutation to create or update one EpicTree node. Refresh the browser and confirm the node persists and returns from `hive.epic_nodes`. Inspect network traffic and confirm all API calls target `/api/plugins/hive/*` rather than any other endpoint. Perform a file review confirming `~/Code/spikes/multica/server/migrations` contains no Hive-related files and `~/Code/spikes/multica/server/sqlc.yaml` remains unchanged. If any criterion fails, stop the epic and return to architecture review.

### Phase 2: ReviewGates view

Phase 2 builds the first additional view on the proven route/store seam. Users list review gates scoped to an epic, inspect gate state and supporting evidence, and update gate status. The phase makes no architectural changes to auth, router, or store—ReviewGates add one capability through the same `/api/plugins/hive/*` boundary by extending HiveStore with gate-specific methods and adding a new schema table for gate state.

Frontend changes are localized. Export `ReviewGatesView` and related client helpers from `packages/hive/src/index.ts`. Create the view in `src/views/review-gates-view.tsx` using existing Multica UI primitives for list/detail/update, tested in `review-gates-view.test.tsx` covering loading, empty, detail selection, evidence display, and update error states. Update `src/api/types.ts` to define ReviewGate, ReviewGateEvidence, and update input DTOs. Extend `src/api/client.ts` with review-gate list/detail/update calls and `src/api/queries.ts` with query keys scoped by workspace and epic/gate identifiers. Update `src/api/mutations.ts` with a gate state update mutation that invalidates dependent query keys. Create a thin page adapter at `apps/web/app/[workspaceSlug]/(dashboard)/hive/review-gates/page.tsx`. Update `packages/core/paths/paths.ts` to add a `hiveReviewGates` route builder with test coverage. Update `app-sidebar.tsx` to add or expand Hive sidebar entries only if product chooses separate view entries rather than a single Hive parent; update locale files if ReviewGates is visible in navigation.

Backend changes mirror Phase 1's pattern. Extend `server/internal/hive/router.go` to register review-gate routes under the existing Hive router. Modify `server/internal/hive/store.go` to add review-gate methods to HiveStore: `ListReviewGates`, `GetReviewGate`, `UpdateReviewGate`. Create `server/internal/hive/review_gates.go` with list/detail/update handlers. Create paired migrations `002_review_gates.up.sql` and `.down.sql`, with the up migration creating `hive.review_gates` and the down migration providing reversible cleanup. Create `server/internal/hive/review_gates_test.go` covering list/detail/update operations and workspace scoping.

The HTTP contract adds three gates-specific endpoints. `GET /api/plugins/hive/review-gates?workspace_id={uuid}&epic_id={uuid}` lists gates for an epic. `GET /api/plugins/hive/review-gates/{gateId}?workspace_id={uuid}` fetches a single gate and its evidence. `PATCH /api/plugins/hive/review-gates/{gateId}` updates gate state with an optional note. ReviewGate objects carry id, workspaceId, epicId, name, state (one of "pending", "passed", "failed"), evidence array, and updatedAt. Evidence entries have kind, summary, optional URL, and createdAt. Errors include 404 Not Found when the gate is absent or outside the workspace; 409 Conflict when state transition rules reject an update; and 422 Unprocessable Entity when evidence payload shape is invalid.

Validation includes integration tests proving list gates returns only gates for the specified epic, detail lookup refuses cross-workspace gate IDs, and updates persist and return refreshed state. Frontend tests verify the update mutation invalidates both list and detail query keys. Manual verification navigates from sidebar to ReviewGates, updates a gate state, refreshes to confirm persistence, and checks that authorization failures match Phase 1 behavior. File review confirms no new auth model, no new router mounts outside `/api/plugins/hive/*`, and no core migration changes.

### Phase 3: PersonalQueue view

Phase 3 adds a queue surface showing work items assigned to the current user and linked to Hive or Multica contexts. The queue is strictly user-scoped and workspace-scoped, enforced both in the API and in the frontend query keys. Links in the queue can point to Hive epics/gates or existing Multica issues/projects, preserving a unified work experience.

Frontend code follows the proven pattern. Export `PersonalQueueView` from `packages/hive/src/index.ts`. Create the view in `src/views/personal-queue-view.tsx` rendering items with status, priority, source, and clickable target links; test in `personal-queue-view.test.tsx` covering empty queue, filtered items, link rendering, and update error states. Update `src/api/types.ts` to add PersonalQueueItem and queue update DTOs. Extend `src/api/client.ts` with list/update queue calls and `src/api/queries.ts` with query keys scoped by workspace and current user. Update `src/api/mutations.ts` with a queue item update mutation. Create the page adapter at `apps/web/app/[workspaceSlug]/(dashboard)/hive/queue/page.tsx`. Update `packages/core/paths/paths.ts` to add `hiveQueue` route builder with test coverage. Update sidebar and locale files only if the queue has a visible nav entry.

Backend implementation enforces multi-level scoping. Modify `server/internal/hive/router.go` to register queue routes. Extend `server/internal/hive/store.go` with queue methods: `ListPersonalQueue(ctx, workspaceID, userID)` and `UpdateQueueItem(ctx, workspaceID, userID, itemID)`. Create `server/internal/hive/personal_queue.go` with list and update handlers, both filtering by workspace and current user—this is non-negotiable for security. Create paired migrations `003_personal_queue_items.up.sql` and `.down.sql`, with the up migration creating `hive.personal_queue_items` indexed by workspace and assignee. Create `server/internal/hive/personal_queue_test.go` proving both workspace and user filters are enforced, including a fixture where one user cannot see or update another user's items.

The HTTP contract exposes two queue endpoints. `GET /api/plugins/hive/personal-queue?workspace_id={uuid}` lists queue items for the current user in the specified workspace. `PATCH /api/plugins/hive/personal-queue/{itemId}` updates a single item's status or snooze state. PersonalQueueItem objects carry id, workspaceId, assigneeUserId, kind, title, status, optional priority, target, and updatedAt. QueueTarget objects specify type (one of "hive_epic", "hive_gate", "multica_issue", "multica_project"), id, and href. UpdateQueueItemInput accepts optional status and optional snoozedUntil. Errors include 403 Forbidden when a user attempts to update another user's item and 404 Not Found for absent or cross-workspace items.

Validation includes integration tests proving the queue list returns only the current user's items and excludes other workspaces' items, and update operations refuse another user's items. Manual verification confirms queue links resolve correctly and persisted updates appear after refresh. Performance validation checks that the queue list query has workspace/user indexes and implements a bounded default page size.

### Phase 4: HermesChat view

Phase 4 adds a chat surface for threaded conversations scoped to the workspace. Users create or select threads, send messages, and read a chronologically ordered message timeline. The implementation reuses Multica's existing auth and session—no second authentication stack. Realtime behavior defaults to polling/refresh, and only integrates with the existing `/ws` WebSocket endpoint if later evidence justifies the additional complexity.

Frontend code maintains the pattern. Export `HermesChatView` from `packages/hive/src/index.ts`. Create the view in `src/views/hermes-chat-view.tsx` with thread list, selected thread display, message composer, and message timeline; test in `hermes-chat-view.test.tsx` covering thread creation, message send success/failure, and message display. Update `src/api/types.ts` to add thread and message DTOs. Extend `src/api/client.ts` with thread create/list and message send/read calls. Update `src/api/queries.ts` with thread and message query keys scoped by workspace. Update `src/api/mutations.ts` with send-message and create-thread mutations. Create the page adapter at `apps/web/app/[workspaceSlug]/(dashboard)/hive/chat/page.tsx`. Update `packages/core/paths/paths.ts` to add `hiveChat` route builder with test coverage. Update sidebar and locale files only if chat has a visible nav entry.

Backend implementation follows established patterns with a focus on scalability. Modify `server/internal/hive/router.go` to register chat thread and message routes. Extend `server/internal/hive/store.go` with chat methods: `ListHermesThreads`, `CreateHermesThread`, `ListHermesMessages`, and `SendHermesMessage`. Create `server/internal/hive/hermes_chat.go` implementing these handlers with workspace and visibility checks. Create paired migrations `004_hermes_chat.up.sql` and `.down.sql`, with the up migration creating `hive.hermes_threads` and `hive.hermes_messages` tables, both indexed by workspace and additionally by thread and creation time for message reads. Create `server/internal/hive/hermes_chat_test.go` proving workspace scoping, thread ownership/visibility rules, message persistence, and chronological ordering.

The HTTP contract exposes four chat endpoints. `GET /api/plugins/hive/hermes/threads?workspace_id={uuid}` lists threads visible to the current user. `POST /api/plugins/hive/hermes/threads` creates a new thread with optional title. `GET /api/plugins/hive/hermes/threads/{threadId}/messages?workspace_id={uuid}&cursor={cursor}` fetches paginated messages, ordered chronologically. `POST /api/plugins/hive/hermes/threads/{threadId}/messages` sends a message to a thread. HermesThread objects carry id, workspaceId, title, createdBy, updatedAt, and optional lastMessageAt. HermesMessage objects carry id, threadId, workspaceId, senderUserId, body, and createdAt. Errors include 413 Payload Too Large if message body exceeds configured limits; 429 Too Many Requests if rate limiting is implemented; and 404 Not Found for absent or unauthorized threads.

Validation includes integration tests proving thread creation and message send/read operations complete, messages preserve chronological order, pagination cursor behavior is stable, and cross-workspace thread access is denied. Manual verification creates a thread, sends a message, refreshes to confirm persistence, and verifies the chosen refresh or polling behavior works smoothly without introducing a second auth or WebSocket stack. Performance validation confirms the message list endpoint is paginated from the first implementation and indexed by thread and creation time.

### Phase 5: Skills catalog

Phase 5 delivers a packaged, versioned skill catalog alongside materialization support. The catalog is browseable without requiring an online runtime or daemon. When a workspace enables a skill from the catalog, the materializer writes versioned `skill` and `skill_file` rows to Multica's existing skill tables and optionally attaches the skill to agents. Explicit provenance and state tracking prevent accidental overwrites of user-customized skills, and the phase rejects automatic workspace seeding—all materialization is opt-in.

Frontend catalog surfaces are built on the proven seam. Export catalog UI surfaces from `packages/hive/src/index.ts`. Create `src/skills/catalog.ts` to provide packaged catalog metadata and versioned skill entries; validate in `catalog.test.ts` that catalog keys, versions, file paths, and required metadata are present and well-formed. Create an optional UI in `src/views/skills-catalog-view.tsx` for browsing and initiating materialization; test in `skills-catalog-view.test.tsx` covering browse state, already-materialized indicators, and materialization error handling. Update `src/api/types.ts` to define HiveSkillCatalogEntry, CatalogSkillFile, SkillMaterialization, and MaterializeSkillInput DTOs. Extend `src/api/client.ts` with catalog and materialization client calls. Update `src/api/queries.ts` with catalog and materialization query keys scoped by workspace. Update `src/api/mutations.ts` with a materialization mutation. Create an optional page adapter at `apps/web/app/[workspaceSlug]/(dashboard)/hive/skills/page.tsx`. Update `packages/core/paths/paths.ts` to add `hiveSkillsCatalog` route builder if the UI route is created, with test coverage.

Backend implementation bridges the plugin catalog and Multica's existing skill model. Modify `server/internal/hive/router.go` to register catalog browse and materialization endpoints. Extend `server/internal/hive/store.go` with `ListSkillCatalogState` to track which catalog skills are materialized and `RecordSkillMaterialization` to record the materialization decision. Create `server/internal/hive/skills_catalog.go` to implement catalog browse and materialization handlers, proving that catalog browse works without an online runtime. Create `server/internal/hive/skill_materializer.go` to encapsulate cross-store writes: when materializing a skill, open a single pgx transaction, write the catalog entry's files to Multica's `skill` and `skill_file` tables, optionally attach through `agent_skill`, and record the operation in `hive.plugin_skill_catalog_state`. Create tests `skills_catalog_test.go` covering catalog browse without online runtime and materialization conflict behavior, and `skill_materializer_test.go` proving selected catalog skills become DB-backed Multica skills with provenance recorded. Create paired migrations `005_plugin_skill_catalog_state.up.sql` and `.down.sql`, creating a `hive.plugin_skill_catalog_state` table to track catalog key, catalog version, materialized skill ID, workspace, and state (one of "materialized", "customized", or "superseded").

The HTTP contract exposes three catalog endpoints. `GET /api/plugins/hive/skills/catalog?workspace_id={uuid}` returns the full versioned catalog without requiring an online runtime. `GET /api/plugins/hive/skills/materializations?workspace_id={uuid}` lists previously materialized catalog skills and their current state. `POST /api/plugins/hive/skills/{catalogKey}/materialize` accepts a MaterializeSkillInput and writes the skill to the DB, respecting existing workspace name uniqueness constraints. HiveSkillCatalogEntry objects carry key, version, name, description, files array, and optional defaultConfig. CatalogSkillFile objects carry path, content, and checksum. SkillMaterialization objects carry catalogKey, catalogVersion, skillId, workspaceId, state, and materializedAt. Errors include 409 Conflict when a workspace skill name already exists and customize/overwrite behavior is not specified; 422 Unprocessable Entity when catalog files fail path validation; and 403 Forbidden when the actor lacks permission to create skills or assign agent skills.

Validation confirms catalog browse works without an online runtime and packaged catalog structure is valid. Integration tests materialize a skill into `skill` and `skill_file`, optionally attach `agent_skill` when requested, and prove that marking a skill "customized" prevents blind overwrites. Manual verification browses the catalog before materialization, materializes a skill, opens the existing Multica Skills page to confirm the skill appears, and assigns the materialized skill to an agent using existing assignment logic. File review confirms no install-time auto-seeding of every workspace, and security review validates that materialization respects file path constraints and rejects privilege escalation attempts.

### Phase 6: Upstream seam extraction

Phase 6 is conditional on measured fork churn from Phases 1–5. It does not add any new Hive capability—it instead extracts only the generic seams proven by working implementation, documents them, and proposes them upstream. No speculative runtime loader, dynamic registry, or broad plugin framework is introduced. If the concrete Hive anchors remain smaller than the abstraction, the slice is rejected and Phases 1–5 stand as a fork.

Backend router extraction is the primary candidate. After all Hive routes pass Phase 1–5 tests, measure the size of Hive-specific edits in `server/cmd/server/router.go`. If the mount is truly minimal (one import, one store construction seam, one `r.Mount(...)` call), extract it behind a generic mount helper only if upstream review will accept it. The helper signature remains simple: `type PluginRouteMount = { basePath: string; router: chi.Router }` and `func MountAuthenticatedPluginRoutes(r chi.Router, mounts ...PluginRouteMount)`. Adapt `server/internal/hive/router.go` to use this seam, but keep the concrete Hive router constructor unchanged.

Frontend path and nav extraction follows the same principle. Update `packages/core/paths/paths.ts` to factor Hive path additions behind a minimal plugin path helper only if it remains type-safe and testable—prefer explicit path functions over dynamic discovery. Extract a nav slot or append helper in `packages/views/layout/app-sidebar.tsx` only if repeated Hive nav additions create a stable pattern worth generalizing. Preserve explicit labels in locale files; do not introduce runtime locale loading unless required. Update `apps/web/next.config.ts` and `apps/web/package.json` only if evidence shows that package registration creates measurable fork churn. In most cases, explicit declarations are more maintainable than dynamic discovery.

Documentation is mandatory. Create or update architecture docs (e.g., `docs/plugin-seams.md` or the project's preferred location) to document the proven frontend package, route/nav, backend mount, and store boundaries. Every claim in the seam documentation must cite a concrete path and test from Phases 1–5. The documentation describes what the implementation proves—not a general plugin loader, but the specific anchors Hive uses.

Testing ensures the extracted seam still works. Create or update tests verifying the extracted seam still mounts Hive routes correctly and preserves auth middleware placement. Add path and nav helper tests catching duplicate or missing routes. Perform a diff review comparing fork changes before extraction against after extraction; if extraction increases complexity without reducing churn, reject the slice.

Manual validation confirms all previous functionality still works. Re-run browser smoke tests for EpicTree, ReviewGates, PersonalQueue, HermesChat, and Skills catalog. Confirm all sidebar entries and route links still resolve. Inspect network traffic and verify API calls still target `/api/plugins/hive/*`. Confirm the extracted seam docs match actual code and avoid claiming a general plugin platform exists. If extraction passes all checks and reduces measured fork churn, propose it upstream with confidence that it is proof-backed. If extraction fails to reduce churn or introduces complexity, keep the fork as-is at the end of Phase 5.

## 3. **Verification Plan**

Verification follows vertical slices rather than horizontal layers, ensuring each phase delivers a working end-to-end path. Phase 1 verification is the hard gate for the entire epic; later phases do not reopen the route/store/auth architecture unless Phase 1 evidence proves the design wrong. Every phase combines automated API/store tests, frontend component or route tests, and at least one manual browser validation. Schema-adding phases include migration tests using the Hive-owned migration ledger. API phases include auth and workspace scoping tests. Frontend phases with visible navigation include route and sidebar link tests.

**Phase 1 verification** proves the foundation. Automated tests run `pnpm --filter @multica/hive typecheck` and re-run the existing web typecheck after adding the package dependency and route imports, catching integration errors early. Path tests on `packages/core/paths/paths.ts` verify route builders are stable. EpicTree component tests cover rendering, empty state, error state, and successful data display. HiveStore write/read tests prove migration execution succeeds and a single node persists and reads back. Hive router tests prove `/api/plugins/hive/*` is mounted under auth and returns appropriate errors for unauthenticated requests. A regression check confirms no files in `server/migrations` contain Hive-specific table names, and another confirms `server/sqlc.yaml` is unchanged.

Manual Phase 1 validation starts a local Multica instance, logs in through existing auth, navigates to the workspace Hive route, and confirms the dashboard shell, sidebar, and minimal EpicTree render together. Creating or updating one EpicTree node, refreshing, and confirming persistence validates the write/read loop. A controlled test breaking a Hive migration confirms startup/readiness reports the failure visibly. Network traffic inspection confirms all API calls target `/api/plugins/hive/*`. If any criterion fails, the epic stops.

**Phase 2–5 verification** follows established patterns. Each phase includes API integration tests for list/detail/update operations; store tests for workspace and user scoping; frontend component tests for UI states; route path tests for new route builders; and migration tests for schema changes. Manual checks open each new route inside the dashboard, interact with the UI (creating, updating, reading data), refresh to confirm persistence, and check that authorization failures match Phase 1's behavior.

**Phase 2 (ReviewGates)** integration tests list gates scoped to an epic, confirm detail lookup refuses cross-workspace IDs, and prove updates persist. Frontend tests validate that the update mutation invalidates dependent query keys. Manual checks navigate to ReviewGates, update a gate state, and refresh to confirm persistence.

**Phase 3 (PersonalQueue)** integration tests prove the queue list returns only the current user's items and excludes other workspaces' items. Update tests confirm another user's item cannot be modified. Manual checks seed items for a user, open the queue, and verify only that user's items are visible. Links are clicked to confirm they resolve correctly.

**Phase 4 (HermesChat)** integration tests create a thread, send a message, read it back, and verify chronological ordering and pagination behavior. Store tests prove thread workspace scoping and message ordering. Manual checks create a thread, send a message, navigate away and back or refresh, and confirm persistence. The chosen refresh or polling behavior is validated to work without introducing a second auth or WebSocket stack.

**Phase 5 (Skills catalog)** unit tests validate packaged catalog structure. Catalog endpoint tests prove browse works without an online runtime. Materialization tests create `skill` and `skill_file` rows, optionally attach `agent_skill`, and prove provenance is recorded. Conflict tests verify name collisions are handled, and customized skills are not overwritten blindly. Manual checks browse the catalog, materialize a skill, open the existing Multica Skills page to confirm the skill appears, assign the skill to an agent, and verify no workspace was auto-seeded.

**Phase 6 (Upstream seam extraction)** runs all Hive API and frontend tests after extraction to ensure nothing broke. Route mount tests verify auth middleware still wraps plugin routes. Path and nav helper tests catch duplicate or missing routes. A diff review compares fork anchor size before and after extraction. Manual smoke tests cover every Hive route, confirm sidebar entries work, verify API calls still target `/api/plugins/hive/*`, and confirm upstream seam documentation matches actual code and avoids claiming a general plugin platform exists.

### Coverage matrix

The coverage matrix tracks which areas are tested in each phase, ensuring progressive validation without regression.

| Area | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
| --- | --- | --- | --- | --- | --- | --- |
| Build-time package composition | automated + manual | regression | regression | regression | regression | extraction review |
| Workspace routes | EpicTree | ReviewGates | Queue | Chat | Catalog (optional) | seam tests |
| Sidebar navigation | EpicTree entry | optional sub-entries | optional sub-entries | optional sub-entries | optional sub-entries | seam tests |
| Auth inheritance | proof gate | regression | regression | regression | regression | mount tests |
| Workspace authorization | proof gate | gate scoping | user/workspace scoping | thread/message scoping | materialization permissions | regression |
| HiveStore interface | epic nodes | review gates | queue items | chat threads/messages | catalog state | unchanged |
| Hive migrations | `epic_nodes` | `review_gates` | `personal_queue_items` | `hermes_threads`, `hermes_messages` | `plugin_skill_catalog_state` | no new tables |
| Core migration isolation | file review | file review | file review | file review | file review | file review |
| Existing skill tables | not used | not used | not used | not used | materialization | regression |
| Performance-sensitive reads | tree baseline | gate list baseline | queue filters | message pagination | catalog size | diff review |

### Not verified and rationale

Production-scale tree sizes are not verified in Phase 1 because Phase 1 is strictly a route/store proof gate; large-tree optimization belongs after the seam is proven. Full realtime chat is not verified in Phase 4 if the chosen behavior is polling, because the vertical plan allows either refresh or realtime behavior, and a second WebSocket stack is explicitly out of scope for this epic. Upstream acceptance of the extracted seam is not verified in Phase 6 because that phase only prepares a proof-backed proposal; upstream review is outside this epic's control and can proceed independently. Automatic workspace skill seeding is not verified because the locked design rejects it. SQLite or sidecar storage behavior is not verified because the locked storage decision uses the same Postgres database with a separate schema. Generic runtime plugin loading is not verified because the locked architecture is build-time bundled, not runtime-loaded. Every possible skill catalog update policy is not verified because Phase 5 defines minimum provenance and conflict handling rules; richer upgrade workflows can be follow-up work.

## 3b. **Cross-Cutting Concerns**

**Error handling** follows Multica conventions. Auth failures return 401 Unauthorized when no valid session/token exists. Workspace membership failures return 403 Forbidden when the user is known but lacks access; cross-workspace object lookups may return 404 Not Found to avoid leaking object existence. Validation failures return 400 Bad Request for malformed IDs or invalid JSON. Semantic failures return 409 Conflict for constraint violations and 422 Unprocessable Entity for well-formed but domain-invalid payloads. Store failures log internal details and return stable 500 Internal Server Error messages without exposing sensitive information. Migration failures must surface at startup or readiness and must not be silent or converted into empty UI states—this is critical for operational visibility. Frontend views distinguish empty states (genuine zero results) from load errors (transient failures); mutation errors preserve enough message detail for operators without exposing backend internals.

**Migration discipline** is foundational to the fork strategy. Hive migrations live exclusively under `server/internal/hive/migrations`, write to the `hive` schema and `hive.schema_migrations`, and never enter `server/migrations` or `server/sqlc.yaml`. Each schema-adding phase contributes paired up/down migrations: the up migration creates tables and indexes; the down migration provides reversible cleanup for local/test rollback. Startup must apply or verify Hive migrations before serving Hive routes. If the project prefers manual migration commands over automated startup migration, readiness must at minimum detect unapplied Hive migrations and fail until manual migration completes. Migration version names are plugin-local and do not share core numeric migration semantics. Every Hive table includes `workspace_id` as a filter column and is indexed to match endpoint query patterns: chat messages are indexed by thread and creation time; queue items by workspace and assignee; catalog state by workspace and catalog key.

**Rollback strategy** depends on the phase. Phase 1 rollback removes the frontend package dependency, route/nav anchors, backend mount code, and Hive migration files. Database rollback runs Hive down migrations for local/test environments. Production rollback prefers disabling route/nav exposure before destructive data removal, allowing gradual customer migration off Hive. Later view rollback (Phases 2–4) removes that view's route and API handlers while leaving earlier HiveStore tables and their data intact unless explicitly rolling back schema. Skill materialization rollback is more delicate because it writes to core `skill` and `skill_file` tables; materialized skills must record provenance so operators can identify them, but user-customized skills should not be deleted blindly. Seam extraction rollback reverts to the concrete Hive anchors proven in Phases 1–5, undoing any abstraction.

**Performance** starts conservatively and grows with evidence. Phase 1 EpicTree includes baseline limits and indexes but does not over-optimize before data shape is proven in production. Tree reads filter by workspace and maintain predictable ordering; large trees may later require pagination, lazy child loading, or subtree queries. ReviewGates list is bounded by epic and workspace. PersonalQueue list defaults to the current user and active statuses, with pagination for safety. HermesChat messages are paginated from the first implementation, never rendering unbounded datasets on the client. Catalog browse is static or in-memory if size is small; materialization state joins are workspace-indexed. React Query keys are scoped by workspace to prevent cross-workspace cache bleed. A performance audit is triggered after execution because tree, queue, and chat can involve large query paths that need validation.

**Documentation** updates reflect the new architecture. Developer docs must state the Hive schema ownership rule and that Hive tables do not belong in core migrations. Document the build-time package registration steps, the `/api/plugins/hive/*` route boundary, and the minimum manual smoke path for each slice. Document materialized skill provenance rules and how customized skills are preserved. In Phase 6, document only the seam proven by implementation, not a hypothetical general plugin platform.

**Security** is elevated beyond routine code review. The new authenticated API surface requires a `security:plan-audit` review covering the route mount, auth inheritance, workspace authorization, and session handling. Skill materialization requires special security review because it writes executable agent skill content into DB-backed skill tables, creating a control flow from a plugin package to runtime agent execution. File paths for skill files must use existing validation rules or stronger equivalents. Hive routes must inherit login auth and enforce workspace membership through explicit checks in every handler. Queue endpoints enforce current-user scoping so one user cannot read or modify another's items. Chat endpoints enforce thread and workspace visibility rules. ReviewGate update endpoints enforce role or permission requirements if defined. Catalog materialization enforces permission to create skills and assign agent skills, using existing permission checks where possible. Audit logs or events should be considered for ReviewGate updates and skill materializations, especially if they affect shared product state. Catalog content is restricted to packaged Hive files in this epic; accepting arbitrary remote sources is explicitly deferred.

## 4. **File Change Manifest**

The complete file manifest is organized by phase, distinguishing creates, modifies, and files that remain unchanged but are affected.

| Action | Path | Phase | Notes |
| --- | --- | --- | --- |
| MODIFY | `apps/web/package.json` | 1 | Add `@multica/hive` workspace dependency. |
| MODIFY | `apps/web/next.config.ts` | 1, 6 | Add transpile package; extract seam only if Phase 6 justifies it. |
| CREATE | `packages/hive/package.json` | 1 | Package metadata and exports. |
| CREATE | `packages/hive/tsconfig.json` | 1 | TypeScript config. |
| CREATE | `packages/hive/src/index.ts` | 1-5 | Export views and client surfaces, expanding per phase. |
| CREATE | `packages/hive/src/api/client.ts` | 1-5 | Frontend API client, growing with phases. |
| CREATE | `packages/hive/src/api/types.ts` | 1-5 | Shared DTO definitions. |
| CREATE | `packages/hive/src/api/queries.ts` | 1-5 | React Query definitions. |
| CREATE | `packages/hive/src/api/mutations.ts` | 1-5 | Mutation definitions. |
| CREATE | `packages/hive/src/views/epic-tree-view.tsx` | 1 | EpicTree view component. |
| CREATE | `packages/hive/src/views/epic-tree-view.test.tsx` | 1 | EpicTree tests. |
| CREATE | `packages/hive/src/views/review-gates-view.tsx` | 2 | ReviewGates view. |
| CREATE | `packages/hive/src/views/review-gates-view.test.tsx` | 2 | ReviewGates tests. |
| CREATE | `packages/hive/src/views/personal-queue-view.tsx` | 3 | PersonalQueue view. |
| CREATE | `packages/hive/src/views/personal-queue-view.test.tsx` | 3 | PersonalQueue tests. |
| CREATE | `packages/hive/src/views/hermes-chat-view.tsx` | 4 | HermesChat view. |
| CREATE | `packages/hive/src/views/hermes-chat-view.test.tsx` | 4 | HermesChat tests. |
| CREATE | `packages/hive/src/views/skills-catalog-view.tsx` | 5 | Optional catalog UI. |
| CREATE | `packages/hive/src/views/skills-catalog-view.test.tsx` | 5 | Optional catalog UI tests. |
| CREATE | `packages/hive/src/skills/catalog.ts` | 5 | Packaged catalog metadata. |
| CREATE | `packages/hive/src/skills/catalog.test.ts` | 5 | Catalog validation. |
| CREATE | `apps/web/app/[workspaceSlug]/(dashboard)/hive/page.tsx` | 1 | Hive entry route. |
| CREATE | `apps/web/app/[workspaceSlug]/(dashboard)/hive/review-gates/page.tsx` | 2 | ReviewGates route. |
| CREATE | `apps/web/app/[workspaceSlug]/(dashboard)/hive/queue/page.tsx` | 3 | Queue route. |
| CREATE | `apps/web/app/[workspaceSlug]/(dashboard)/hive/chat/page.tsx` | 4 | Chat route. |
| CREATE | `apps/web/app/[workspaceSlug]/(dashboard)/hive/skills/page.tsx` | 5 | Optional catalog route. |
| MODIFY | `packages/core/paths/paths.ts` | 1-6 | Add Hive route builders per phase. |
| MODIFY | `packages/core/paths/paths.test.ts` | 1-6 | Route builder coverage. |
| MODIFY | `packages/views/layout/app-sidebar.tsx` | 1-6 | Add Hive nav entries per phase. |
| MODIFY | `packages/views/locales/en/layout.json` | 1-5 | Add Hive nav labels. |
| MODIFY | `server/cmd/server/main.go` | 1 | Construct HiveStore with migration. |
| MODIFY | `server/cmd/server/router.go` | 1, 6 | Add authenticated mount; extract seam if Phase 6 proceeds. |
| CREATE | `server/internal/hive/router.go` | 1-6 | Hive chi router. |
| CREATE | `server/internal/hive/store.go` | 1-5 | Store interface and pgx implementation. |
| CREATE | `server/internal/hive/migrations.go` | 1 | Migration runner. |
| CREATE | `server/internal/hive/authz.go` | 1 | Authorization helpers. |
| CREATE | `server/internal/hive/epic_nodes.go` | 1 | EpicTree handlers. |
| CREATE | `server/internal/hive/review_gates.go` | 2 | ReviewGates handlers. |
| CREATE | `server/internal/hive/personal_queue.go` | 3 | Queue handlers. |
| CREATE | `server/internal/hive/hermes_chat.go` | 4 | Chat handlers. |
| CREATE | `server/internal/hive/skills_catalog.go` | 5 | Catalog handlers. |
| CREATE | `server/internal/hive/skill_materializer.go` | 5 | Skill materialization. |
| CREATE | `server/internal/hive/router_test.go` | 1 | Route/auth tests. |
| CREATE | `server/internal/hive/store_test.go` | 1 | Store tests. |
| CREATE | `server/internal/hive/review_gates_test.go` | 2 | ReviewGates tests. |
| CREATE | `server/internal/hive/personal_queue_test.go` | 3 | Queue tests. |
| CREATE | `server/internal/hive/hermes_chat_test.go` | 4 | Chat tests. |
| CREATE | `server/internal/hive/skills_catalog_test.go` | 5 | Catalog tests. |
| CREATE | `server/internal/hive/skill_materializer_test.go` | 5 | Materialization tests. |
| CREATE | `server/internal/hive/migrations/001_epic_nodes.up.sql` | 1 | Schema and `hive.epic_nodes`. |
| CREATE | `server/internal/hive/migrations/001_epic_nodes.down.sql` | 1 | Rollback. |
| CREATE | `server/internal/hive/migrations/002_review_gates.up.sql` | 2 | `hive.review_gates`. |
| CREATE | `server/internal/hive/migrations/002_review_gates.down.sql` | 2 | Rollback. |
| CREATE | `server/internal/hive/migrations/003_personal_queue_items.up.sql` | 3 | `hive.personal_queue_items`. |
| CREATE | `server/internal/hive/migrations/003_personal_queue_items.down.sql` | 3 | Rollback. |
| CREATE | `server/internal/hive/migrations/004_hermes_chat.up.sql` | 4 | Chat tables. |
| CREATE | `server/internal/hive/migrations/004_hermes_chat.down.sql` | 4 | Rollback. |
| CREATE | `server/internal/hive/migrations/005_plugin_skill_catalog_state.up.sql` | 5 | Catalog state. |
| CREATE | `server/internal/hive/migrations/005_plugin_skill_catalog_state.down.sql` | 5 | Rollback. |
| UNCHANGED | `server/migrations` | 1-6 | No Hive tables. |
| UNCHANGED | `server/sqlc.yaml` | 1-6 | No Hive migrations. |

## 5. **Risk Registry**

High-severity risks are those where failure blocks the epic or compromises security. They receive detailed mitigation plans and must be validated in Phase 1 or Phase 5 before proceeding.

| Risk | Severity | Likelihood | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| Phase 1 route mount requires deep router refactoring instead of one authenticated mount. | high | medium | Keep Phase 1 to a single `r.Mount("/api/plugins/hive", ...)` inside the protected group; stop if the router needs reorganization. | backend implementer |
| Hive tables leak into core migrations or sqlc input. | high | medium | Maintain separate `server/internal/hive/migrations` directory; test/review must prevent Hive SQL in `server/migrations` or `server/sqlc.yaml`. | backend implementer |
| Auth inheritance is mistaken for complete authorization. | high | high | Require workspace/member checks in every Hive handler; include tests for cross-workspace object access and current-user queue enforcement. | backend implementer |
| Skill materialization blindly overwrites user-customized skills. | high | medium | Record provenance and state in `hive.plugin_skill_catalog_state`; reject name collisions unless customize behavior is explicit; never auto-seed. | skills implementer |
| Materialized skill files introduce unsafe paths or execution confusion. | high | medium | Reuse existing `skill.go` path validation or strengthen it; restrict catalog source to packaged content; require security review. | skills implementer |
| Startup succeeds with stale or missing Hive schema. | high | medium | Make migration failure visible at startup or readiness; Phase 1 validation must intentionally break a migration and observe failure. | backend implementer |
| Cross-store writes appear atomic but silently fail partway through. | high | low | Document that only explicit pgx transactions couple Hive and Multica writes; skill materialization owns transaction boundaries. | backend implementer |
| Chat messages render unbounded client-side. | medium | high | Paginate message reads from first implementation; index by thread and creation time. | frontend/backend |
| EpicTree grows beyond one response before pagination is added. | medium | medium | Include baseline indexes and bounded proof in Phase 1; add lazy loading only after measured need. | frontend/backend |
| Queue endpoint exposes another user's work items. | high | medium | Filter by workspace and current user; deny updates unless item assignee or role permits; test with two users. | backend implementer |
| ReviewGate state transitions are under-specified. | medium | medium | Define minimum states and conflict behavior in Phase 2; defer advanced workflow rules to follow-up. | product + implementer |
| Sidebar navigation becomes cluttered. | medium | medium | Decide before Phases 2–5: single Hive parent or separate view entries. | product + frontend |
| Phase 6 over-generalizes into an unproven plugin platform. | medium | medium | Extract only proven concrete anchors; reject speculative dynamic loaders. | architect + implementer |
| Runtime-local skill discovery is confused with Hive packaged catalog. | medium | medium | Keep catalog browse independent of online runtime; use runtime-local only as import precedent. | skills implementer |
| Same-database separate-schema architecture is missed by ops docs. | medium | low | Update operations docs: `hive.*` is part of the same Postgres backup target. | docs owner |
| Frontend cache leaks across workspaces. | medium | medium | Include workspace ID/slug in every React Query key. | frontend implementer |
| API error shapes drift from Multica conventions. | low | medium | Use existing handler response helpers or mirror their error shape. | backend implementer |
| Package export paths destabilize during additions. | low | medium | Keep `@multica/hive` exports explicit and covered by typecheck. | frontend implementer |
| Optional catalog UI delays mandatory materialization work. | medium | low | Treat browse endpoint and materialization as mandatory; UI can be minimal. | product + implementer |
| Upstream seam docs claim more than code proves. | medium | medium | Require docs to cite concrete paths and tests from Phases 1–5. | architect + writer |

### Detailed mitigation for high-severity risks

**Route mount isolation.** The backend router creates a protected group at `server/cmd/server/router.go:301-304`. The Phase 1 proof mount must live inside that group and consist of exactly: one build-linked Hive router construction and one `r.Mount("/api/plugins/hive", ...)` call. A broad router reorganization, a second server, or an unauthenticated mount path is unacceptable. Phase 1 must include a test that unauthenticated requests return 401/403 before reaching Hive handlers, and a manual browser check proving authenticated dashboard traffic reaches Hive. If the seam cannot achieve this with a thin mount, the epic stops.

**Core migration discipline.** The existing migration resolver scans `migrations` and `server/migrations` lexically; duplicate numeric prefixes already exist and show why adding Hive migrations there is a fork-maintenance trap. Hive migration files must live exclusively under `server/internal/hive/migrations`. The Hive runner records versions in `hive.schema_migrations`, never in core `schema_migrations`. Code review rejects any Hive table in `server/migrations`. CI checks grep for `CREATE TABLE hive.` under `server/migrations` and fail the build. `server/sqlc.yaml` remains pointed at core migrations only.

**Authorization enforcement.** Mounting under auth proves the user is authenticated; it does not prove workspace membership. Every Hive endpoint must call a workspace authorizer before reading or writing. Object IDs are constrained by workspace in SQL queries. PersonalQueue constrains by both workspace and current user. Chat thread and message access constrain by workspace and visibility rules. ReviewGate updates may require additional role checks. Tests include same-ID wrong-workspace fixtures to catch authorization leaks.

**Skill overwrite prevention.** Existing `skill` rows are unique by `(workspace_id, name)` (see `server/migrations/008_structured_skills.up.sql:4-15`). A packaged Hive catalog can collide with a user-created or customized skill. Materialization never blindly upserts by name; on collision, return 409 Conflict unless the request explicitly chooses customize/import semantics. Store catalog key, version, target skill ID, and state in `hive.plugin_skill_catalog_state`. If a user edits a materialized skill, mark it `customized` and do not blindly overwrite. Agent skill assignment happens only when explicitly requested and authorized.

**Skill file safety.** The existing skill creation path validates file paths before writing `skill_file` (see `server/internal/handler/skill.go:256-307`). The Hive materializer reuses that validation or a stronger equivalent. Catalog content comes from packaged files, not arbitrary remote URLs. Materialization stores provenance in skill config so reviewers can trace source and version. Security review inspects whether catalog files can influence agent execution unexpectedly. Failed path validation returns 422 or 400 and leaves no partial skill rows.

**Schema readiness visibility.** Hive owns a separate migration ledger; core migration success does not imply Hive schema readiness. Startup runs or verifies Hive migrations before serving Hive routes. If operational policy forbids automatic migrations, readiness fails until a separate Hive migrate command succeeds. Phase 1 validation includes a deliberately broken migration to observe failure is visible. Empty UI on missing table is unacceptable because it hides operational failure. Logs include migration version and failing statement context without leaking secrets.

**Cross-store transaction integrity.** Hive and Multica tables share a Postgres database but are not automatically transactionally coupled. Operations writing both `hive.*` and core tables must decide transaction boundaries explicitly. Skill materialization is the primary cross-store operation. The materializer uses one pgx transaction for creating `skill`, `skill_file`, optional `agent_skill`, and `hive.plugin_skill_catalog_state`. If any write fails, all related writes roll back. This boundary is documented so later implementers do not split materialization across independent transactions.

**Queue visibility isolation.** Queue data reveals a user's assigned work and linked records. SQL filters by `workspace_id` and `assignee_user_id` for normal users. Update operations include both item ID and current user/workspace constraints. Tests seed two users and prove each sees only their own rows. Admin override behavior is explicit; if not specified, it is not implemented.

## 6. **Dependency Map**

The frontend package composition builds on existing Multica infrastructure. The `@multica/hive` package depends on `apps/web/package.json` and `apps/web/next.config.ts` for build-time registration. It imports from `@multica/core` for API client conventions, path builders, workspace context, and React Query patterns. It uses `@multica/ui` and existing layout primitives from the dashboard shell for consistent UI. Workspace routes depend on `packages/core/paths/paths.ts` to build stable route URIs and on Next.js route files under `apps/web/app/[workspaceSlug]/(dashboard)` for rendering. Sidebar navigation entries depend on `packages/views/layout/app-sidebar.tsx` to register nav keys and label keys. Auth inheritance depends on `apps/web/next.config.ts` URL rewrites that proxy API and WebSocket traffic to the backend, and on `apps/web/app/[workspaceSlug]/layout.tsx` to gate workspace routes based on auth and workspace lookup.

Backend architecture anchors on the existing pgx pool and router structure. The Hive router depends on `server/cmd/server/router.go` to provide the protected route group where Hive mounts. HiveStore depends on the pgx pool created in `server/cmd/server/main.go` and requires successful Hive migration execution before routes are accessible. Hive migrations depend on Postgres schema permissions to create the `hive` schema and tables. Hive tables reference workspace/user UUIDs from core tables but avoid hard coupling to sqlc-generated types—Hive uses plain uuid.UUID values for foreign references.

View-specific dependencies follow from the schema design. EpicTree depends on the `hive.epic_nodes` table. ReviewGates depends on `hive.review_gates` and epic identifiers passed via request parameters. PersonalQueue depends on `hive.personal_queue_items`, the current user identity from auth context, and cross-link targets pointing to Hive or Multica records. HermesChat depends on `hive.hermes_threads` and `hive.hermes_messages`. Skills catalog browse depends on packaged catalog metadata defined in the `@multica/hive` package. Skill materialization depends on existing `skill` and `skill_file` tables and optionally `agent_skill` tables, and reuses existing path validation rules. Phase 6 seam extraction depends on evidence from Phases 1–5 proving which anchors are stable enough to propose upstream.

### Blocking questions

Nine decisions must be made before execution can proceed. These are not deferred or marked incomplete; they directly affect design and implementation scope.

1. **Sidebar navigation strategy:** Should the visible Hive entry be one parent route with sub-entries, or separate sidebar entries for EpicTree, ReviewGates, Queue, Chat, and Skills?

2. **EpicTree route canonical form:** Is `/hive` the canonical EpicTree route, or should `/hive/epics` be canonical with `/hive` redirecting?

3. **ReviewGate update permission:** What minimum role (member, manager, workspace-owner) may update ReviewGates?

4. **PersonalQueue visibility scope:** Should PersonalQueue show only the current user's items, or include admin-visible delegated work?

5. **HermesChat realtime strategy:** Should Phase 4 implement polling/refresh or immediately integrate with existing `/ws` WebSocket?

6. **Skill materialization provenance fields:** What exact fields are required in materialization records (e.g., catalog key, version, checksum, user who materialized)?

7. **Skill assignment workflow:** Should materialization assign an agent skill in a single API call, or use existing agent-skill assignment separately?

8. **Hive migration execution:** Should Hive migrations run automatically at server startup, or should readiness only verify manual migration status?

9. **Phase 6 documentation path:** Where should seam documentation live if `docs/plugin-seams.md` is not the preferred location?

Additionally, three areas lack data from upstream planning:

- **Product-specific copy:** Product-specific names, labels, and exact copy for EpicTree, ReviewGates, PersonalQueue, and HermesChat views.

- **Authorization matrix:** Final role matrix for ReviewGate update and skill materialization permissions across workspace member roles.

- **Volume expectations:** Expected production volume (row counts, growth rates) for EpicTree nodes, queue items, and chat messages to inform indexing and pagination decisions.

## 7. **Elicitation — Stress-Testing the Plan**

This section is the team's adversarial self-review. It asks hard questions about the plan's viability, documents assumptions, identifies the simplest acceptable version, acknowledges regrets that may emerge, and pinpoints areas where the design may be over-engineered.

### 7.1 Why won't this work?

The router seam may be less isolated than evidence suggests. `server/cmd/server/router.go` may require handler dependencies or middleware context that Hive cannot access from a clean build-linked package. If Hive handlers need deep access to private handler internals, the thin route mount becomes a broad backend fork. Mitigation: Phase 1 makes this concrete; if the router mount requires more than one line of code, stop.

Workspace authorization may not be extractable as a reusable interface. The plan assumes a `WorkspaceAuthorizer` can be wrapped without duplicating permission logic, but if authorization is tightly embedded in `handler.Handler`, Hive either imports too much handler state or duplicates the logic. Mitigation: architect the authorizer as a minimal interface early in Phase 1; if extraction proves impossible, the epic adjusts accordingly.

Startup migration semantics may conflict with Multica's current operational model. Core migrations run through a separate command, but the plan asks Hive migration failure to surface at startup or readiness. If the server lacks readiness semantics, the implementer must choose between startup fail-fast or adding a small readiness signal. Mitigation: confirm migration execution strategy before Phase 1 implementation.

Package transpilation may create friction. The existing `transpilePackages` pattern is encouraging, but `@multica/hive` may add dependencies or exports that require additional Next.js config. Mitigation: proof the transpilation in Phase 1 before shipping views.

Route/nav anchors may sprawl beyond expectations. Four views plus catalog create anchors in sidebar arrays, path builders, route files, locale files, tests, and navigation code. Mitigation: Phase 2 decides sidebar strategy to contain sprawl.

Same-database separate-schema architecture still carries operational coupling. Operators may overlook `hive.*` during backup/restore, debugging, or schema permissions setup. Mitigation: update operations docs clearly and enforce schema discipline in code review.

Cross-store materialization may be more complex than view slices. Skill materialization touches plugin catalog state and core skill tables and must preserve user customization. Version and update semantics for packaged skills are underspecified; "enable", "customize", and "import" imply different overwrite and assignment rules. Mitigation: Phase 5 defines minimum provenance and conflict handling; richer upgrade workflows defer to follow-up.

Runtime-local skill logic is tempting to reuse but mismatched. Runtime-local listing depends on online runtimes and daemon callbacks; Hive catalog must browse without online runtime. Mitigation: keep catalog independent of the runtime-local flow; use runtime-local only as import precedent.

Chat user expectations may exceed the chosen refresh behavior. Users may expect realtime chat, but the vertical plan allows either refresh or realtime. If realtime is required, reusing existing `/ws` must be done carefully without a second auth or WebSocket stack. Mitigation: Phase 4 decides refresh vs. realtime early.

EpicTree can grow large quickly, and a proof-gate implementation may accidentally establish an unbounded list API that later becomes hard to change. Mitigation: Phase 1 includes pagination or bounded defaults from the start.

Phase 6 seam extraction may have weak payoff if concrete anchors are already small. A generic abstraction could add indirection without reducing rebase pain. Mitigation: Phase 6 is conditional on measured fork churn; if churn is small, skip extraction.

### 7.2 Assumptions (labeled VERIFIED / ASSUMED / RISKY)

**VERIFIED assumptions** are grounded in code evidence from the spike. Build-time package composition exists: `apps/web/next.config.ts` has `transpilePackages` and `apps/web/package.json` depends on workspace packages like `@multica/core`, `@multica/ui`, and `@multica/views`. Frontend infrastructure is proven: `apps/web/next.config.ts` rewrites `/api`, `/ws`, `/auth`, and `/uploads` to the backend; workspace routes live under `apps/web/app/[workspaceSlug]/...`; `apps/web/app/[workspaceSlug]/layout.tsx` gates routes on auth and workspace lookup; dashboard pages are thin adapters importing view packages; `packages/core/paths/paths.ts` centralizes path builders; `packages/views/layout/app-sidebar.tsx` uses static nav arrays resolving paths at render time. Backend infrastructure is proven: protected API routes use `middleware.Auth` in `server/cmd/server/router.go`; existing APIs mount explicitly with chi route groups; Multica creates a pgx pool from `DATABASE_URL`; core migrations load from `migrations` or `server/migrations`; sqlc schema input is `server/migrations`; `skill`, `skill_file`, and `agent_skill` tables exist; existing skill CRUD is DB-backed; runtime-local skill listing depends on runtime/daemon state.

**ASSUMED assumptions** are reasonable extrapolations not yet proven. A package named `@multica/hive` is acceptable; `packages/hive` is the preferred frontend location; `server/internal/hive` is the preferred backend location. Hive can import or wrap authorization behavior without large handler refactors. Startup fail-fast for Hive migration failure is operationally acceptable if readiness semantics are not yet in place. Each Hive view is deliverable as a route page inside the existing dashboard shell. React Query is the expected frontend data fetching pattern. A single `HiveStore` interface can grow across phases without becoming unmanageable. Hive tables can store UUID references to core records without foreign keys, or with carefully chosen foreign keys. Product accepts minimal UI for proof and catalog browse. Phases 2–4 can be reordered after Phase 1 if product priority shifts.

**RISKY assumptions** are areas where the plan may deviate from reality. ReviewGate state transition rules may be more complex than captured. PersonalQueue may need richer permissions than current-user filtering (e.g., delegated work). HermesChat may need realtime behavior earlier than Phase 4. Skill materialization may need a full upgrade/diff workflow, not just provenance and conflict handling. Upstream seam extraction may not reduce fork churn enough to justify the abstraction. Large EpicTree and chat datasets may require pagination/lazy loading sooner than Phase 1 baseline suggests. Same-database separate schema may still feel like "core DB coupling" to maintainers despite documentation. Hive schema permissions may be unavailable in hosted deployments, breaking migration despite correct code. Catalog skill content may require security review before materialization ships.

### 7.3 Simplest acceptable version

The simplest acceptable version is Phase 1 only, delivering the proof gate. Phase 1 adds `@multica/hive` as a build-time frontend package, one dashboard route for EpicTree, one sidebar entry or path to reach that route, one backend mount under `/api/plugins/hive/*`, and one HiveStore interface with `Migrate`, `ListEpicTree`, and `UpsertEpicNode`. It creates `hive.schema_migrations` and `hive.epic_nodes`, performs one write/read through that table, proves authenticated requests reach Hive handlers, proves missing Hive schema is visible, and proves no Hive SQL enters core migrations. If the seam is not viable, the epic stops.

Each later phase has a simplest acceptable version. Phase 2 (ReviewGates) is list plus one state update operation, not a full gate workflow engine. Phase 3 (PersonalQueue) is current-user active items with links, not delegation analytics or admin visibility. Phase 4 (HermesChat) is persisted thread and messages with refresh/polling, not a new realtime subsystem. Phase 5 (Skills) is browse packaged catalog plus materialize one selected skill, not automatic update management or upgrade workflows. Phase 6 (Upstream seam) is documentation plus a tiny route/nav mount helper only if the diff proves it reduces fork churn.

Anything beyond these minimums should be follow-up work unless required by product acceptance criteria.

### 7.4 Regrets we may have

Design decisions made now that may require rework later include authorization abstraction. Not defining workspace authorization as a clean reusable interface before implementing multiple handlers may cause code duplication across Phase 2–5 handlers. HiveStore interface may grow too broad; a single interface across all phases may become unwieldy if test doubles become large and brittle—consider early splitting if complexity appears.

Pagination and naming are long-term friction points. Not adding pagination to EpicTree from the start means if early customers have large epics, the API contract and frontend behavior must be retrofitted. Choosing route names without consulting product vocabulary risks naming conflicts; `/hive/epics` and `/hive/review-gates` may clash with existing or planned product terms. Sidebar structure is a cascading decision—not deciding before Phases 2–5 means adding entries individually and later discovering structural problems.

Migration and logging operational debt. Not establishing a migration execution command or readiness convention clearly in Phase 1 leaves Phase 2–5 lacking precedent. Not adding structured event/audit logging for ReviewGate updates and skill materializations means later compliance or debugging requirements force retrofitting.

Skills catalog and upgrade debt. Not making queue target links typed enough to avoid broken cross-links means deleted Hive/Multica records leave stale references. Not modeling skill catalog upgrades before first materialization creates a messy retrofitting path if upgrades are later needed. Storing too little provenance to distinguish packaged, materialized, customized, and superseded skills complicates future upgrade and rollback semantics. Using skill name as the primary human conflict surface when catalog keys are the stable identity causes confusion.

Realtime chat timing. Implementing chat polling if user expectation quickly becomes realtime requires rework. Conversely, implementing realtime too early if it delays Phase 4 and duplicates existing WebSocket behavior wastes effort.

Operations and data retention. Failing to document backup/restore implications of the `hive` schema means operators miss it during migrations. Not including a small operational checklist for `hive.*` tables leaves documentation debt. Not defining retention behavior for HermesChat messages creates uncertainty about long-term data volume. Not defining rate limits for chat or skill materialization leaves the system vulnerable to abuse.

Architecture extraction. Treating Phase 6 as mandatory extraction if the fork anchors remain smaller than the abstraction adds needless indirection. Not involving security review before catalog materialization is coded forces a rewrite if security findings require changes.

Frontend caching and data consistency. Not testing cross-workspace cache behavior in the frontend creates the risk of user A seeing user B's data in React Query cache. Not deciding whether Hive references core records with foreign keys or plain UUIDs complicates deletions—if a linked core issue is deleted, queue items and gates that reference it become orphaned.

### 7.5 Where are we over-engineering?

Conditional over-engineering points: Phase 6 seam extraction may be premature if fork churn is small—measure before abstracting. A single broad `HiveStore` may be over-engineered if splitting into smaller per-domain stores produces cleaner tests. Skills catalog UI may be over-engineered if endpoint browse plus existing Multica Skills page is sufficient initially—the UI is optional. Down migrations may be over-engineered if production rollback policy never drops plugin tables automatically, making up migrations sufficient for local/test. Navigation abstraction may be over-engineered if a few explicit Hive entries in `app-sidebar.tsx` are more maintainable than a generic helper. EpicTree data shape may be over-engineered before proof that the route/store seam works—keep the proof minimal. Realtime chat may be over-engineered if polling satisfies the first usable workflow. Materialization assignment may be over-engineered if existing skill assignment UI can handle assignment after creation. Plugin path helpers may be over-engineered if explicit `paths.workspace(slug).hiveX()` functions remain clear and typed. Startup migration automation may be over-engineered if Multica's deployment model strongly prefers explicit migration commands.

Areas that should NOT be over-engineered under any circumstance: a runtime plugin loader, because the locked architecture is build-time bundled; a sidecar service, because locked storage is same Postgres with separate schema; automatic skill seeding, because locked design rejects it; generalized catalog discovery from runtime-local skills, because Hive catalog is packaged and versioned; product workflow rules that upstream inputs did not provide—instead mark missing rules as `[data not provided]` so reviewers see the gap explicitly rather than discovering it in implementation.

## 8. **Decision Points for Sign-Off**

Twenty decisions must be affirmed before implementation begins. These are non-negotiable because they set scope, architecture, and authorization boundaries.

1. **Frontend package name and location:** Confirm `@multica/hive` as the package name and `packages/hive` as the location.

2. **Backend package location:** Confirm `server/internal/hive` as the backend package location.

3. **Phase 1 hard bail:** Confirm that the epic stops if Phase 1 proof fails on route mount, auth inheritance, Hive schema creation, or durable write/read through `hive.epic_nodes`.

4. **Core migration isolation:** Confirm that no Hive SQL files may be added to `server/migrations` and that this is enforced by code review and CI checks.

5. **Storage architecture:** Confirm that Hive schema uses the same Postgres database with a separate `hive` schema and `hive.schema_migrations` ledger.

6. **EpicTree canonical route:** Confirm whether `/hive` is the canonical EpicTree route, `/hive/epics` is canonical with `/hive` redirecting, or both are acceptable.

7. **Sidebar navigation strategy:** Confirm whether Hive uses one parent sidebar entry with sub-items or separate entries for each Hive view.

8. **ReviewGate update permissions:** Confirm the minimum role (member, manager, workspace-owner) that may update ReviewGate state.

9. **PersonalQueue visibility scope:** Confirm whether PersonalQueue shows only current-user items or includes admin-visible delegated work.

10. **HermesChat realtime approach:** Confirm whether Phase 4 implements polling/refresh or integrates with existing `/ws` WebSocket.

11. **Hive migration execution:** Confirm whether Hive migrations run automatically at server startup or readiness only verifies manual migration status.

12. **Skill name collision handling:** Confirm behavior when materialization encounters a workspace skill name that already exists (reject, override, customize, etc.).

13. **Materialization and agent assignment:** Confirm whether materialization can assign an agent skill in the same API call or requires a separate existing flow.

14. **Skill provenance requirements:** Confirm the minimum provenance fields required in materialization records (e.g., catalog key, version, checksum, who materialized).

15. **Catalog UI scope:** Confirm whether catalog UI is required or whether endpoint browse plus existing Multica Skills page is sufficient.

16. **Phase 6 extraction condition:** Confirm that Phase 6 is conditional on measured fork churn, not an unconditional mandate to build a generic plugin framework.

17. **Security review trigger:** Confirm that `security:plan-audit` is raised before execution because the plan adds authenticated APIs, schema, and skill materialization.

18. **Performance review trigger:** Confirm that `performance:audit` is raised after execution because tree, queue, and chat can involve large query paths.

19. **Data gaps handling:** Confirm that missing product details (names, labels, copy, role matrices, volume expectations) may be represented as `[data not provided: ...]` rather than inventing behavior.

20. **Completeness preservation:** Confirm that Risk Registry (Part 5) and Elicitation (Part 7) are written as full analytical sections in prose, not compressed into bullet checklists.

These decisions lock the scope and reduce rework during implementation. Answering them before Phase 1 begins is non-negotiable for execution discipline.
