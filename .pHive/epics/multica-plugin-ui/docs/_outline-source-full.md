# Architect Outline Content - multica-plugin-ui

Source scope:
- Branch: `feat/multica-plugin-ui` checked out as the agent work branch.
- Required contract: `skills/hive/skills/structured-outline/SKILL.md`.
- Planning inputs: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md`, `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md`, `.pHive/epics/multica-plugin-ui/docs/design-discussion.md`.
- Code evidence base: `~/Code/spikes/multica`.
- This document provides source substance for the writer. It is not `structured-outline.md`, not story YAML, and not a gate advancement.

## 1. **Executive Summary**

- The epic delivers Hive as a build-time-bundled plugin surface inside Multica, not as a runtime-loaded drop-in.
- The locked architecture uses a workspace/npm package added to Multica's existing package graph.
- Frontend behavior is anchored through thin workspace-scoped Next.js routes and sidebar navigation entries.
- Backend behavior is anchored through one authenticated chi route mount at `/api/plugins/hive/*`.
- The backend mount calls build-linked Hive handlers, not Go runtime plugins.
- Auth, session, and WebSocket behavior are inherited from the current Multica shell.
- Hive data is owned by Hive in a separate Postgres schema named `hive`.
- Hive must not add tables or SQL files to Multica's numbered `server/migrations` stream.
- Hive maintains its own migration ledger, expected as `hive.schema_migrations`.
- Slice 1 is the proof gate because the route/store seam is the decisive unknown.
- If Slice 1 requires deep router surgery, the epic stops.
- If Slice 1 cannot perform one durable write/read through `hive.*`, the epic stops.
- If Slice 1 requires Hive tables in core migrations or sqlc schema input, the epic stops.
- The four user-facing views are EpicTree, ReviewGates, PersonalQueue, and HermesChat.
- EpicTree is the minimal proof view because it can validate route, nav, API, store, and schema together.
- ReviewGates, PersonalQueue, and HermesChat are intentionally separate slices after the proof gate.
- The skills catalog is also separate because it exercises a distinct catalog-to-core materialization path.
- Upstream seam extraction is last because it should be based on observed fork evidence.
- The horizontal plan identifies nine layers: frontend package, route/nav anchors, auth/session/WebSocket inheritance, backend mount, HiveStore, Hive schema, skills catalog, four views, and fork/upstream seams.
- The vertical plan converts those layers into six commit-worthy slices.
- Design feedback changed the approach by rejecting speculative generic loader work before proof.
- Design feedback also rejected automatic workspace skill seeding because it creates version and ownership ambiguity.
- The locked datastore decision is Hive-owned storage.
- The locked own-store shape is same Postgres database, separate `hive` schema.
- The locked sequencing decision is fork-first, then upstream a proven minimal seam.
- The locked skills decision is a hybrid packaged catalog plus optional DB materialization.
- Evidence for build-time frontend composition is `~/Code/spikes/multica/apps/web/next.config.ts:27` and `~/Code/spikes/multica/apps/web/package.json:21-23`.
- Evidence for API/WS inheritance is `~/Code/spikes/multica/apps/web/next.config.ts:35-69`.
- Evidence for workspace route context is `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/layout.tsx:26-90`.
- Evidence for the dashboard shell is `~/Code/spikes/multica/packages/views/layout/dashboard-layout.tsx:21-45`.
- Evidence for thin page adapters is `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12`.
- Evidence for route builders is `~/Code/spikes/multica/packages/core/paths/paths.ts:17-41`.
- Evidence for sidebar nav arrays is `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx:102-150`.
- Evidence for sidebar render slots is `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx:608-722`.
- Evidence for protected API grouping is `~/Code/spikes/multica/server/cmd/server/router.go:301-304`.
- Evidence for existing route mount style is `~/Code/spikes/multica/server/cmd/server/router.go:535-590`.
- Evidence for DB pool creation is `~/Code/spikes/multica/server/cmd/server/main.go:142-160`.
- Evidence that core migrations are centralized is `~/Code/spikes/multica/server/internal/migrations/migrations.go:13-16` and `~/Code/spikes/multica/server/internal/migrations/migrations.go:50-69`.
- Evidence that core sqlc consumes core migrations is `~/Code/spikes/multica/server/sqlc.yaml:1-10`.
- Evidence for the existing skills DB model is `~/Code/spikes/multica/server/migrations/008_structured_skills.up.sql:4-31`.
- Evidence for DB-backed skill CRUD is `~/Code/spikes/multica/server/internal/handler/skill.go:212-307`.
- Evidence for runtime-local discovery limitations is `~/Code/spikes/multica/server/internal/handler/runtime_local_skills.go:46-62` and `~/Code/spikes/multica/server/internal/handler/runtime_local_skills.go:478-495`.
- The strategy is to prove the route/store seam first, then add views without changing the seam, then add skill catalog materialization, then extract only the generic seam demonstrated by the concrete implementation.
- The strategy keeps implementation feasible today by using existing Next.js package composition, existing chi route grouping, existing Postgres infrastructure, and existing skill tables.
- The strategy preserves future optionality because the final slice isolates a seam that can be proposed upstream after it has working evidence.
- The most important execution constraint is that each slice should leave a working, testable vertical path.
- The second most important constraint is that Hive-owned schema discipline must be visible in code review and tests, not merely documented.
- The third most important constraint is that auth inheritance is necessary but insufficient; workspace/member authorization must still be enforced by Hive handlers.
- Security planning is required because the epic adds a new authenticated API surface and cross-system skill materialization.
- Performance review is required because tree, queue, and chat surfaces can become large data reads.
- The writer should preserve the hard bail language prominently in the synthesized outline.
- The writer should preserve the Risk Registry and Elicitation sections as reasoning-heavy content, not compress them into checklists.

## 2. **Detailed Approach**

### Phase 1: Proof gate - backend route-mount + HiveStore + minimal EpicTree

- Source vertical slice: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` Step 1.
- Source horizontal layers: frontend plugin package, frontend route/nav anchors, auth/session/WebSocket inheritance, backend route mount, HiveStore, Hive Postgres schema, four Hive views.
- Outcome: authenticated browser route renders a minimal EpicTree view inside the dashboard shell.
- Outcome: `/api/plugins/hive/*` reaches build-linked Hive handlers.
- Outcome: one durable write/read succeeds through `hive.epic_nodes`.
- Outcome: Hive migration failure is visible at startup or readiness.
- Hard stop: no work after this slice if the route/store seam fails.

#### Phase 1 changes

- MODIFY `~/Code/spikes/multica/pnpm-workspace.yaml`.
- Add the Hive frontend package directory to the workspace package glob only if the chosen package location is outside the existing `packages/*` glob.
- If the package is created at `packages/hive`, the current `packages/*` glob already covers it.
- MODIFY `~/Code/spikes/multica/apps/web/package.json`.
- Add `@multica/hive` as a workspace dependency beside `@multica/core`, `@multica/ui`, and `@multica/views`.
- MODIFY `~/Code/spikes/multica/apps/web/next.config.ts`.
- Add `@multica/hive` to `transpilePackages`, matching the existing build-time package pattern at line 27.
- CREATE `~/Code/spikes/multica/packages/hive/package.json`.
- Define package exports for EpicTree and shared Hive client modules.
- CREATE `~/Code/spikes/multica/packages/hive/tsconfig.json`.
- Extend the local TypeScript convention used by existing packages.
- CREATE `~/Code/spikes/multica/packages/hive/src/index.ts`.
- Export the minimal `EpicTreeView` and proof-gate client surfaces.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/epic-tree-view.tsx`.
- Render a minimal but real dashboard-compatible EpicTree screen.
- CREATE `~/Code/spikes/multica/packages/hive/src/api/client.ts`.
- Own frontend calls to `/api/plugins/hive/*`.
- CREATE `~/Code/spikes/multica/packages/hive/src/api/types.ts`.
- Define frontend DTO types shared by the EpicTree view and client.
- CREATE `~/Code/spikes/multica/packages/hive/src/api/queries.ts`.
- Define React Query options for the proof EpicTree read path.
- CREATE `~/Code/spikes/multica/packages/hive/src/api/mutations.ts`.
- Define the proof write/update mutation for `hive.epic_nodes`.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/epic-tree-view.test.tsx`.
- Cover rendering, empty state, error state, and successful data display.
- CREATE `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/page.tsx`.
- Thin page adapter that imports `EpicTreeView` from `@multica/hive`.
- CREATE `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/epics/page.tsx`.
- Optional canonical route if product chooses `/hive/epics` over `/hive`.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.ts`.
- Add parameterless workspace path builders for `hive` and `hiveEpicTree`.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.test.ts`.
- Assert Hive route builders preserve URL encoding and workspace prefixing.
- MODIFY `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx`.
- Add a Hive nav key, label key, and sidebar entry using existing nav array pattern.
- MODIFY `~/Code/spikes/multica/packages/views/layout/app-sidebar.test.tsx` if present.
- If no sidebar test exists, add focused coverage where this project already tests layout navigation.
- MODIFY `~/Code/spikes/multica/packages/views/locales/en/layout.json` or existing layout locale file.
- Add Hive nav label text.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/layout.tsx`.
- The workspace layout continues to provide auth and workspace slug context.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/packages/views/layout/dashboard-layout.tsx`.
- The dashboard shell remains the host for the new route.
- MODIFY `~/Code/spikes/multica/server/cmd/server/main.go`.
- Construct HiveStore after the pgx pool is connected and before router readiness depends on Hive schema.
- Fail startup or mark readiness unhealthy if the proof migration fails, per vertical-plan Step 1.
- MODIFY `~/Code/spikes/multica/server/cmd/server/router.go`.
- Add a single mount inside the protected API route group after auth middleware.
- Keep the router change to one import, one store/handler construction seam, and one `r.Mount("/api/plugins/hive", ...)`.
- CREATE `~/Code/spikes/multica/server/internal/hive/router.go`.
- Define the Hive chi router and proof EpicTree routes.
- CREATE `~/Code/spikes/multica/server/internal/hive/store.go`.
- Define the `HiveStore` interface and pgx-backed implementation constructor.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations.go`.
- Own migration execution and `hive.schema_migrations`.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/001_epic_nodes.up.sql`.
- Create schema, migration ledger, and `hive.epic_nodes`.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/001_epic_nodes.down.sql`.
- Provide reversible cleanup for local/test rollback.
- CREATE `~/Code/spikes/multica/server/internal/hive/epic_nodes.go`.
- Implement proof read/write handlers and DTO mapping.
- CREATE `~/Code/spikes/multica/server/internal/hive/authz.go`.
- Isolate workspace authorization helpers used by Hive handlers.
- CREATE `~/Code/spikes/multica/server/internal/hive/router_test.go`.
- Prove the route returns 401/403 without valid auth context and works with test auth context.
- CREATE `~/Code/spikes/multica/server/internal/hive/store_test.go`.
- Prove migration and one write/read against a test Postgres or existing integration harness.
- UNCHANGED `~/Code/spikes/multica/server/migrations`.
- No Hive SQL file belongs in this directory.
- UNCHANGED `~/Code/spikes/multica/server/sqlc.yaml`.
- Hive SQL must not be added to core sqlc schema input for the proof slice.

#### Phase 1 interfaces

- `hive.NewRouter(store HiveStore, authz WorkspaceAuthorizer) chi.Router`
- `type HiveStore interface { Migrate(ctx context.Context) error; ListEpicTree(ctx context.Context, workspaceID uuid.UUID) ([]EpicNode, error); UpsertEpicNode(ctx context.Context, workspaceID uuid.UUID, input EpicNodeInput) (EpicNode, error) }`
- `type WorkspaceAuthorizer interface { RequireWorkspace(ctx context.Context, r *http.Request, workspaceID uuid.UUID) error }`
- `GET /api/plugins/hive/epic-tree?workspace_id={uuid}`
- `PUT /api/plugins/hive/epic-tree/nodes/{nodeId}`
- `type EpicNodeInput = { title: string; parentId?: string | null; status?: string }`
- `type EpicNode = { id: string; workspaceId: string; parentId: string | null; title: string; status: string; updatedAt: string }`
- `paths.workspace(slug).hive(): string`
- `paths.workspace(slug).hiveEpicTree(): string`
- `function EpicTreeView(): JSX.Element`
- `function listEpicTree(workspaceId: string): Promise<EpicNode[]>`
- `function upsertEpicNode(workspaceId: string, input: EpicNodeInput): Promise<EpicNode>`
- Errors: `401 Unauthorized` when inherited auth is absent.
- Errors: `403 Forbidden` when workspace membership or role check fails.
- Errors: `400 Bad Request` when workspace/node identifiers are malformed.
- Errors: `409 Conflict` when node ordering or parent constraints conflict.
- Errors: `500 Internal Server Error` for store/migration failures.

#### Phase 1 validation

- Run frontend package typecheck for `@multica/hive`.
- Run existing web typecheck after adding package dependency and route imports.
- Run path tests for `packages/core/paths/paths.ts`.
- Run EpicTree view tests.
- Run Hive router/store tests.
- Run a startup/readiness test or local boot check with intentionally broken Hive migration to prove failure is visible.
- Manual check: log in to Multica, open `/{workspaceSlug}/hive` or `/{workspaceSlug}/hive/epics`, confirm the dashboard shell renders.
- Manual check: use the UI or a test action to create/update one EpicTree node.
- Manual check: refresh the page and confirm persisted node data returns from `hive.epic_nodes`.
- Manual check: inspect network traffic and confirm calls hit `/api/plugins/hive/*`.
- File review: confirm `~/Code/spikes/multica/server/migrations` has no Hive files.
- File review: confirm `~/Code/spikes/multica/server/sqlc.yaml` is unchanged.
- Bail if any proof criterion fails.

### Phase 2: ReviewGates view

- Source vertical slice: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` Step 2.
- Outcome: user lists review gates, inspects evidence, and updates gate state.
- Constraint: no change to auth, router, or store architecture proven in Phase 1.
- Constraint: ReviewGates adds one capability through the same `/api/plugins/hive/*` boundary.

#### Phase 2 changes

- MODIFY `~/Code/spikes/multica/packages/hive/src/index.ts`.
- Export `ReviewGatesView` and related client helpers.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/review-gates-view.tsx`.
- Implement list/detail/update UI using existing Multica UI primitives.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/review-gates-view.test.tsx`.
- Cover loading, empty, detail selection, evidence display, and update error states.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/types.ts`.
- Add `ReviewGate`, `ReviewGateEvidence`, and update input DTOs.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/client.ts`.
- Add review-gate list/detail/update calls.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/queries.ts`.
- Add query keys scoped by workspace and epic/gate identifiers.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/mutations.ts`.
- Add gate state update mutation with query invalidation.
- CREATE `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/review-gates/page.tsx`.
- Thin page adapter that imports `ReviewGatesView`.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.ts`.
- Add `hiveReviewGates` route builder.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.test.ts`.
- Add coverage for the review-gate route path.
- MODIFY `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx`.
- Add or expand Hive sidebar entries only if the UX chooses separate entries rather than a single Hive parent entry.
- MODIFY existing layout locale files.
- Add labels for ReviewGates if visible in sidebar or page chrome.
- MODIFY `~/Code/spikes/multica/server/internal/hive/router.go`.
- Register review-gate routes under the existing Hive router.
- MODIFY `~/Code/spikes/multica/server/internal/hive/store.go`.
- Extend `HiveStore` with review-gate methods.
- CREATE `~/Code/spikes/multica/server/internal/hive/review_gates.go`.
- Implement list/detail/update handlers.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/002_review_gates.up.sql`.
- Create `hive.review_gates`.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/002_review_gates.down.sql`.
- Reverse the review-gate table.
- CREATE `~/Code/spikes/multica/server/internal/hive/review_gates_test.go`.
- Cover list/detail/update including workspace scoping.
- UNCHANGED `~/Code/spikes/multica/server/cmd/server/router.go`.
- The global mount should not need additional edits after Phase 1.
- UNCHANGED `~/Code/spikes/multica/server/migrations`.
- Keep Hive schema out of core migrations.

#### Phase 2 interfaces

- `GET /api/plugins/hive/review-gates?workspace_id={uuid}&epic_id={uuid}`
- `GET /api/plugins/hive/review-gates/{gateId}?workspace_id={uuid}`
- `PATCH /api/plugins/hive/review-gates/{gateId}`
- `type ReviewGate = { id: string; workspaceId: string; epicId: string; name: string; state: "pending" | "passed" | "failed"; evidence: ReviewGateEvidence[]; updatedAt: string }`
- `type ReviewGateEvidence = { kind: string; summary: string; url?: string; createdAt: string }`
- `type UpdateReviewGateInput = { state: "pending" | "passed" | "failed"; note?: string }`
- `HiveStore.ListReviewGates(ctx, workspaceID, epicID uuid.UUID) ([]ReviewGate, error)`
- `HiveStore.GetReviewGate(ctx, workspaceID, gateID uuid.UUID) (ReviewGate, error)`
- `HiveStore.UpdateReviewGate(ctx, workspaceID, gateID uuid.UUID, input UpdateReviewGateInput) (ReviewGate, error)`
- Errors: `404 Not Found` when the gate is absent or outside the workspace.
- Errors: `409 Conflict` when state transition rules reject an update.
- Errors: `422 Unprocessable Entity` when evidence payload shape is invalid.

#### Phase 2 validation

- Integration test: list gates through authenticated Hive API.
- Integration test: detail lookup refuses cross-workspace gate IDs.
- Integration test: update persists and returns refreshed state.
- Frontend test: update mutation invalidates list and detail query keys.
- Manual check: navigate from sidebar or Hive landing to ReviewGates.
- Manual check: change a gate state, refresh, and confirm persistence.
- Manual check: API returns authorization failures consistently with Phase 1.
- File review: no new auth model, no new router mount outside `/api/plugins/hive/*`, no core migration changes.

### Phase 3: PersonalQueue view

- Source vertical slice: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` Step 3.
- Outcome: current user sees authorized Hive work items linked to epic and gate context.
- Constraint: queue results must be user-scoped and workspace-scoped.
- Constraint: queue links can point to Hive views or existing Multica records.

#### Phase 3 changes

- MODIFY `~/Code/spikes/multica/packages/hive/src/index.ts`.
- Export `PersonalQueueView`.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/personal-queue-view.tsx`.
- Render current user's queue items with status, priority, source, and target link.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/personal-queue-view.test.tsx`.
- Cover empty queue, filtered items, link rendering, and update failure.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/types.ts`.
- Add `PersonalQueueItem` and queue update DTOs.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/client.ts`.
- Add list/update queue calls.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/queries.ts`.
- Add queue query keys scoped by workspace and current user.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/mutations.ts`.
- Add queue item update mutation.
- CREATE `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/queue/page.tsx`.
- Thin page adapter that imports `PersonalQueueView`.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.ts`.
- Add `hiveQueue` route builder.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.test.ts`.
- Assert route output.
- MODIFY sidebar and locale files only if queue has a visible nav entry.
- MODIFY `~/Code/spikes/multica/server/internal/hive/router.go`.
- Register queue routes.
- MODIFY `~/Code/spikes/multica/server/internal/hive/store.go`.
- Extend `HiveStore` with queue methods.
- CREATE `~/Code/spikes/multica/server/internal/hive/personal_queue.go`.
- Implement list and update handlers with current-user scoping.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/003_personal_queue_items.up.sql`.
- Create `hive.personal_queue_items`.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/003_personal_queue_items.down.sql`.
- Reverse queue table creation.
- CREATE `~/Code/spikes/multica/server/internal/hive/personal_queue_test.go`.
- Prove workspace and user filters are both enforced.
- UNCHANGED `~/Code/spikes/multica/server/internal/handler/skill.go`.
- Queue should not rely on skill materialization.

#### Phase 3 interfaces

- `GET /api/plugins/hive/personal-queue?workspace_id={uuid}`
- `PATCH /api/plugins/hive/personal-queue/{itemId}`
- `type PersonalQueueItem = { id: string; workspaceId: string; assigneeUserId: string; kind: string; title: string; status: string; priority?: string; target: QueueTarget; updatedAt: string }`
- `type QueueTarget = { type: "hive_epic" | "hive_gate" | "multica_issue" | "multica_project"; id: string; href: string }`
- `type UpdateQueueItemInput = { status?: string; snoozedUntil?: string | null }`
- `HiveStore.ListPersonalQueue(ctx, workspaceID, userID uuid.UUID) ([]PersonalQueueItem, error)`
- `HiveStore.UpdateQueueItem(ctx, workspaceID, userID, itemID uuid.UUID, input UpdateQueueItemInput) (PersonalQueueItem, error)`
- Errors: `403 Forbidden` when user attempts to update another user's item.
- Errors: `404 Not Found` for absent or cross-workspace queue items.

#### Phase 3 validation

- Integration test: queue list returns only current user's items.
- Integration test: queue list excludes another workspace's items.
- Integration test: update refuses another user's queue item.
- Manual check: queue links resolve to the expected Hive or Multica route.
- Manual check: refreshing after update shows persisted state.
- Performance check: queue list query has workspace/user indexes and a bounded default page size.

### Phase 4: HermesChat view

- Source vertical slice: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` Step 4.
- Outcome: user can create/select a thread, send messages, and read persisted messages.
- Constraint: no second auth or WebSocket stack.
- Constraint: realtime behavior should reuse existing `/ws` only if needed and justified.
- Constraint: a simple refresh/polling behavior is acceptable if it meets the slice goal.

#### Phase 4 changes

- MODIFY `~/Code/spikes/multica/packages/hive/src/index.ts`.
- Export `HermesChatView`.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/hermes-chat-view.tsx`.
- Implement thread list, selected thread, composer, and message timeline.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/hermes-chat-view.test.tsx`.
- Cover thread creation, send success, send failure, and message display.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/types.ts`.
- Add thread and message DTOs.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/client.ts`.
- Add thread create/list and message send/read calls.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/queries.ts`.
- Add thread and message query keys.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/mutations.ts`.
- Add send-message and create-thread mutations.
- CREATE `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/chat/page.tsx`.
- Thin page adapter for `HermesChatView`.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.ts`.
- Add `hiveChat` route builder.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.test.ts`.
- Assert route output.
- MODIFY sidebar and locale files only if chat has a visible nav entry.
- MODIFY `~/Code/spikes/multica/server/internal/hive/router.go`.
- Register chat thread and message routes.
- MODIFY `~/Code/spikes/multica/server/internal/hive/store.go`.
- Extend `HiveStore` with chat methods.
- CREATE `~/Code/spikes/multica/server/internal/hive/hermes_chat.go`.
- Implement thread create/list and message send/read handlers.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/004_hermes_chat.up.sql`.
- Create `hive.hermes_threads` and `hive.hermes_messages`.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/004_hermes_chat.down.sql`.
- Reverse chat tables.
- CREATE `~/Code/spikes/multica/server/internal/hive/hermes_chat_test.go`.
- Cover workspace scoping, thread ownership/visibility, message persistence, and ordering.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/apps/web/next.config.ts`.
- Existing `/ws` rewrite continues to support inherited realtime if used.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/packages/core/api/ws-client.ts`.
- Do not fork a second WebSocket client unless later evidence requires it.

#### Phase 4 interfaces

- `GET /api/plugins/hive/hermes/threads?workspace_id={uuid}`
- `POST /api/plugins/hive/hermes/threads`
- `GET /api/plugins/hive/hermes/threads/{threadId}/messages?workspace_id={uuid}&cursor={cursor}`
- `POST /api/plugins/hive/hermes/threads/{threadId}/messages`
- `type HermesThread = { id: string; workspaceId: string; title: string; createdBy: string; updatedAt: string; lastMessageAt?: string }`
- `type HermesMessage = { id: string; threadId: string; workspaceId: string; senderUserId: string; body: string; createdAt: string }`
- `type CreateHermesThreadInput = { workspaceId: string; title?: string }`
- `type SendHermesMessageInput = { workspaceId: string; body: string }`
- `HiveStore.ListHermesThreads(ctx, workspaceID, userID uuid.UUID) ([]HermesThread, error)`
- `HiveStore.CreateHermesThread(ctx, workspaceID, userID uuid.UUID, input CreateHermesThreadInput) (HermesThread, error)`
- `HiveStore.ListHermesMessages(ctx, workspaceID, threadID uuid.UUID, cursor PageCursor) (Page[HermesMessage], error)`
- `HiveStore.SendHermesMessage(ctx, workspaceID, threadID, userID uuid.UUID, input SendHermesMessageInput) (HermesMessage, error)`
- Errors: `413 Payload Too Large` if message body exceeds configured limit.
- Errors: `429 Too Many Requests` if chat send rate limiting is added.
- Errors: `404 Not Found` for absent or unauthorized thread.

#### Phase 4 validation

- Integration test: create thread and send/read message through authenticated Hive API.
- Integration test: messages preserve chronological ordering and pagination cursor behavior.
- Integration test: cross-workspace thread access is denied.
- Manual check: create/select a thread, send a message, refresh, and confirm persistence.
- Manual check: verify chosen refresh or realtime behavior works without introducing a second auth/WS path.
- Performance check: message list endpoint is paginated and indexed by thread/time.

### Phase 5: Skills catalog

- Source vertical slice: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` Step 5.
- Outcome: Hive ships a versioned catalog browseable before materialization.
- Outcome: enable/customize/import materializes selected skills into Multica DB-backed skill tables.
- Constraint: no automatic seeding of every workspace at install time.
- Constraint: runtime-local discovery alone is not enough for active skill availability.
- Constraint: provenance/version behavior must be explicit before writes to `skill` and `skill_file`.

#### Phase 5 changes

- MODIFY `~/Code/spikes/multica/packages/hive/src/index.ts`.
- Export catalog UI surfaces if a catalog view is included.
- CREATE `~/Code/spikes/multica/packages/hive/src/skills/catalog.ts`.
- Provide packaged catalog metadata and versioned skill entries.
- CREATE `~/Code/spikes/multica/packages/hive/src/skills/catalog.test.ts`.
- Validate catalog keys, versions, file paths, and required metadata.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/skills-catalog-view.tsx`.
- Optional UI for browse/materialize if product wants catalog inside Hive routes.
- CREATE `~/Code/spikes/multica/packages/hive/src/views/skills-catalog-view.test.tsx`.
- Cover browse state, already-materialized state, and materialization errors.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/types.ts`.
- Add catalog entry, materialization, and materialization request DTOs.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/client.ts`.
- Add catalog and materialization client calls.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/queries.ts`.
- Add catalog and materialization query keys.
- MODIFY `~/Code/spikes/multica/packages/hive/src/api/mutations.ts`.
- Add materialization mutation.
- CREATE `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/skills/page.tsx`.
- Optional route adapter for catalog UI.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.ts`.
- Add `hiveSkillsCatalog` route builder if UI route is created.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.test.ts`.
- Assert route output.
- MODIFY `~/Code/spikes/multica/server/internal/hive/router.go`.
- Register catalog and materialization endpoints.
- MODIFY `~/Code/spikes/multica/server/internal/hive/store.go`.
- Extend `HiveStore` with catalog state and materialization tracking methods.
- CREATE `~/Code/spikes/multica/server/internal/hive/skills_catalog.go`.
- Implement catalog browse and materialization handlers.
- CREATE `~/Code/spikes/multica/server/internal/hive/skills_catalog_test.go`.
- Cover catalog browse without online runtime and materialization conflict behavior.
- CREATE `~/Code/spikes/multica/server/internal/hive/skill_materializer.go`.
- Encapsulate writes to existing `skill`, `skill_file`, and `agent_skill` tables.
- CREATE `~/Code/spikes/multica/server/internal/hive/skill_materializer_test.go`.
- Prove selected catalog skills become DB-backed Multica skills with provenance.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/005_plugin_skill_catalog_state.up.sql`.
- Create `hive.plugin_skill_catalog_state`.
- CREATE `~/Code/spikes/multica/server/internal/hive/migrations/005_plugin_skill_catalog_state.down.sql`.
- Reverse catalog state table.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/server/internal/handler/skill.go`.
- Existing skill CRUD remains the native representation after materialization.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/server/migrations/008_structured_skills.up.sql`.
- Existing tables define the materialization target.
- UNCHANGED-BUT-AFFECTED `~/Code/spikes/multica/server/internal/handler/runtime_local_skills.go`.
- Its import flow proves external/local bundles can become DB-backed skills, but Hive catalog should not require an online runtime.

#### Phase 5 interfaces

- `GET /api/plugins/hive/skills/catalog?workspace_id={uuid}`
- `GET /api/plugins/hive/skills/materializations?workspace_id={uuid}`
- `POST /api/plugins/hive/skills/{catalogKey}/materialize`
- `type HiveSkillCatalogEntry = { key: string; version: string; name: string; description: string; files: CatalogSkillFile[]; defaultConfig?: object }`
- `type CatalogSkillFile = { path: string; content: string; checksum: string }`
- `type SkillMaterialization = { catalogKey: string; catalogVersion: string; skillId: string; workspaceId: string; state: "materialized" | "customized" | "superseded"; materializedAt: string }`
- `type MaterializeSkillInput = { workspaceId: string; name?: string; customize?: boolean; assignToAgentId?: string }`
- `HiveStore.ListSkillCatalogState(ctx, workspaceID uuid.UUID) ([]SkillMaterialization, error)`
- `HiveStore.RecordSkillMaterialization(ctx, input SkillMaterializationInput) error`
- `Materializer.Materialize(ctx, workspaceID, actorID uuid.UUID, entry HiveSkillCatalogEntry, input MaterializeSkillInput) (SkillMaterialization, error)`
- Errors: `409 Conflict` when a workspace skill name already exists and overwrite/customize behavior is not specified.
- Errors: `422 Unprocessable Entity` when catalog files fail path validation.
- Errors: `403 Forbidden` when actor lacks permission to create skills or assign agent skills.

#### Phase 5 validation

- Catalog browse check works without online runtime.
- Unit test validates packaged catalog structure.
- Integration test materializes selected skill into `skill` and `skill_file`.
- Integration test optionally attaches `agent_skill` when assignment is requested.
- Integration test preserves user customization by marking state instead of blind overwrite.
- Manual check: browse catalog before materialization.
- Manual check: materialize a skill, open existing Multica Skills page, confirm it appears.
- Manual check: assign materialized skill to an agent using existing agent-skill logic.
- File review: no install-time auto-seeding of every workspace.
- Security review: confirm materialization validates file paths and rejects privilege escalation.

### Phase 6: Upstream seam extraction

- Source vertical slice: `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` Step 6.
- Outcome: concrete Hive anchors still work, and generic seam is isolated enough to propose upstream.
- Constraint: no new Hive capability in this slice.
- Constraint: no speculative runtime loader, dynamic registry, or broad plugin framework unless the prior slices prove that exact need.

#### Phase 6 changes

- MODIFY `~/Code/spikes/multica/apps/web/next.config.ts`.
- Extract package registration into a small generic list or documented append point only if it reduces fork churn.
- MODIFY `~/Code/spikes/multica/apps/web/package.json`.
- Keep dependency declaration explicit; do not hide package dependencies in runtime discovery.
- MODIFY `~/Code/spikes/multica/packages/core/paths/paths.ts`.
- Factor Hive path additions behind a minimal plugin path helper only if it remains type-safe and testable.
- MODIFY `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx`.
- Extract a nav slot or append helper if the repeated Hive nav additions create a stable seam.
- MODIFY relevant locale files.
- Preserve explicit labels; do not introduce runtime locale loading unless required.
- MODIFY `~/Code/spikes/multica/server/cmd/server/router.go`.
- Replace Hive-specific mount code with a generic mount hook only after all Hive routes already pass.
- MODIFY `~/Code/spikes/multica/server/internal/hive/router.go`.
- Adapt Hive router construction to the extracted seam.
- CREATE `~/Code/spikes/multica/docs/plugin-seams.md` or update existing architecture docs if project convention prefers another docs path.
- Document the proven frontend package, route/nav, backend mount, and store boundaries.
- CREATE or MODIFY tests that verify the extracted seam still mounts Hive routes and preserves auth.
- UNCHANGED `~/Code/spikes/multica/server/internal/hive/migrations`.
- No new schema is required.
- UNCHANGED `~/Code/spikes/multica/packages/hive/src/views/*`.
- No new view capability belongs in seam extraction.

#### Phase 6 interfaces

- `type PluginRouteMount = { basePath: string; router: chi.Router }`
- `func MountAuthenticatedPluginRoutes(r chi.Router, mounts ...PluginRouteMount)`
- `type PluginNavItem = { key: string; href: (paths: WorkspacePaths) => string; labelKey: string; icon: ComponentType }`
- `function createWorkspacePluginPath(slug: string, segment: string): string`
- `hive.NewRouter(store HiveStore, authz WorkspaceAuthorizer) chi.Router` remains the concrete Hive router.
- Errors: seam helper should reject duplicate base paths during tests or startup.
- Errors: seam helper should not allow unauthenticated mounts by accident.

#### Phase 6 validation

- Rebase-oriented review: compare fork diff before and after extraction.
- Functional check: EpicTree, ReviewGates, PersonalQueue, HermesChat, and Skills catalog still work.
- Test check: authenticated route mount coverage still asserts middleware placement.
- Test check: path/nav helper coverage catches duplicate or missing routes.
- Manual check: all Hive sidebar entries and route links still resolve.
- Documentation check: the seam description is proof-backed and avoids claiming a general plugin loader exists.
- Reject the slice if extraction increases complexity without reducing fork churn.

## 3. **Verification Plan**

- Verification follows the vertical slices, not just horizontal layers.
- Phase 1 verification is the hard gate for the epic.
- Later phases should not reopen the route/store/auth architecture unless Phase 1 evidence was wrong.
- Every phase includes automated API/store tests, frontend component or route tests, and at least one manual browser check.
- Every schema-adding phase includes a migration check using Hive-owned migration ledger.
- Every API phase includes auth and workspace scoping checks.
- Every frontend phase includes route and sidebar link checks when it adds visible navigation.

### Phase 1 automated verification

- Run `pnpm --filter @multica/hive typecheck`.
- Run `pnpm --filter @multica/web typecheck`.
- Run path tests covering new Hive route builders.
- Run EpicTree component tests.
- Run Hive migration tests.
- Run HiveStore write/read tests for `hive.epic_nodes`.
- Run Hive router tests proving `/api/plugins/hive/*` is mounted under auth.
- Run a regression check confirming no files in `~/Code/spikes/multica/server/migrations` start with Hive-specific table names.
- Run a regression check confirming `~/Code/spikes/multica/server/sqlc.yaml` does not include Hive migrations.

### Phase 1 manual verification

- Start Multica locally with Postgres.
- Log in through existing Multica auth.
- Navigate to the workspace Hive route.
- Confirm the dashboard shell, sidebar, and EpicTree render together.
- Create or update one EpicTree node.
- Refresh the page.
- Confirm the node persists.
- Break or withhold a Hive migration in a controlled local check.
- Confirm startup/readiness reports the migration failure.
- Inspect network traffic and confirm frontend uses `/api/plugins/hive/*`.

### Phase 2 automated verification

- Run review-gate API integration tests for list, detail, and update.
- Run review-gate store tests for workspace scoping.
- Run frontend component tests for loading, empty, detail, and update states.
- Run route path tests for the ReviewGates route builder.
- Run migration test for `hive.review_gates`.

### Phase 2 manual verification

- Open the ReviewGates route inside the dashboard.
- Select a gate and inspect evidence.
- Update gate state.
- Refresh and confirm the updated state persists.
- Attempt to load a gate outside the current workspace using a test fixture.
- Confirm access is denied or not found.

### Phase 3 automated verification

- Run queue API tests proving user and workspace filters.
- Run queue update tests proving another user's item cannot be updated.
- Run frontend queue tests for empty state, item rendering, and link rendering.
- Run route path tests for the queue route builder.
- Run migration test for `hive.personal_queue_items`.

### Phase 3 manual verification

- Log in as a user with queue items.
- Open PersonalQueue.
- Confirm only that user's items appear.
- Click links to Hive epic/gate or Multica issue/project targets.
- Update queue item state and refresh.
- Confirm persistence and authorization behavior.

### Phase 4 automated verification

- Run HermesChat API tests for thread create, message send, message read, and pagination.
- Run store tests for message ordering and thread workspace scoping.
- Run frontend tests for send success/failure and timeline display.
- Run migration test for `hive.hermes_threads` and `hive.hermes_messages`.
- Run a bounded query test or explain-plan review for message pagination indexes.

### Phase 4 manual verification

- Open HermesChat.
- Create a thread.
- Send a message.
- Switch away and back or refresh.
- Confirm thread and message persist.
- Confirm the chosen refresh or realtime behavior works.
- Confirm no separate login/session prompt appears.

### Phase 5 automated verification

- Run catalog unit tests validating packaged catalog metadata.
- Run catalog endpoint tests proving browse works without online runtime.
- Run materialization tests proving selected skills create `skill` and `skill_file` rows.
- Run assignment tests proving `agent_skill` can be created when requested.
- Run provenance tests proving catalog version and source metadata are stored.
- Run conflict tests for name collision and customized skill behavior.
- Run file path validation tests for materialized `skill_file` rows.
- Run migration test for `hive.plugin_skill_catalog_state`.

### Phase 5 manual verification

- Open Skills catalog route or browse endpoint.
- Confirm entries are visible before materialization.
- Materialize a selected skill.
- Open the existing Multica Skills page.
- Confirm the materialized skill appears with expected files.
- Assign the materialized skill to an agent.
- Confirm existing assignment UI or API recognizes it.
- Confirm no workspace was seeded automatically before explicit action.

### Phase 6 automated verification

- Run all Hive API tests after seam extraction.
- Run all Hive frontend route tests after seam extraction.
- Run route mount tests proving auth middleware still wraps plugin routes.
- Run path/nav tests proving Hive links are still stable.
- Run a diff review script or manual diff checklist comparing fork anchor size before/after extraction.

### Phase 6 manual verification

- Re-run the browser smoke path for every Hive route.
- Confirm sidebar entries still work.
- Confirm API calls still use `/api/plugins/hive/*`.
- Confirm upstream seam docs match actual code.
- Confirm no new Hive feature was added during extraction.

### Coverage matrix

| Area | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
| --- | --- | --- | --- | --- | --- | --- |
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

### Not verified and why

- Not verified: production-scale tree sizes in Phase 1.
- Why: Phase 1 is a route/store proof gate; large-tree optimization belongs after the seam is proven.
- Not verified: full realtime chat in Phase 4 if the chosen behavior is polling.
- Why: the vertical plan allows chosen refresh or realtime behavior; a second WebSocket stack is explicitly out of scope.
- Not verified: upstream acceptance of the extracted seam.
- Why: Phase 6 only prepares a proof-backed proposal; upstream review is outside this epic's control.
- Not verified: automatic workspace skill seeding.
- Why: the locked design rejects automatic seeding.
- Not verified: SQLite or sidecar storage behavior.
- Why: the locked storage decision is same Postgres database with separate Hive schema.
- Not verified: generic runtime plugin loading.
- Why: the locked architecture is build-time bundled.
- Not verified: every possible skill catalog update policy.
- Why: Phase 5 must define minimum provenance/conflict rules; richer upgrade workflows can be follow-up.

## 3b. **Cross-Cutting Concerns**

### Error handling

- Hive API responses should use the same error shape conventions as existing Multica handlers where possible.
- Auth failures should be `401` when no valid session/token exists.
- Workspace/member failures should be `403` when the user is known but lacks access.
- Cross-workspace object lookups may return `404` to avoid leaking object existence.
- Validation failures should be `400` for malformed IDs or invalid JSON.
- Semantic failures should be `409` for conflicts and `422` for well-formed but invalid domain payloads.
- Store failures should log internal details and return stable `500` messages.
- Migration failures must be surfaced at startup/readiness and must not be converted into empty UI states.
- Frontend views should distinguish empty states from load errors.
- Mutation errors should preserve enough message detail for operators without exposing sensitive internals.

### Migration

- Hive migrations live under `~/Code/spikes/multica/server/internal/hive/migrations`.
- Hive migrations write to the `hive` schema and `hive.schema_migrations`.
- Hive migrations do not enter `~/Code/spikes/multica/server/migrations`.
- Hive migrations do not enter `~/Code/spikes/multica/server/sqlc.yaml`.
- Each schema-adding phase should add paired up/down migrations.
- Startup should apply or verify Hive migrations before serving Hive routes.
- If the project prefers manual migration commands, readiness must still detect unapplied Hive migrations.
- Migration version names should be plugin-local and not share core numeric migration semantics.
- Tables should include `workspace_id` and indexes that match endpoint filters.
- Chat messages should be indexed by thread and created time.
- Queue items should be indexed by workspace, assignee, and status.
- Catalog state should be indexed by workspace and catalog key.

### Rollback

- Phase 1 rollback removes the frontend dependency, route/nav anchors, backend mount, and Hive schema migration code.
- Database rollback should run Hive down migrations for local/test environments.
- Production rollback should prefer disabling route/nav exposure before destructive data removal.
- Later view rollback should remove that view's route and API handlers while leaving earlier HiveStore tables intact unless explicitly rolling back schema.
- Skill materialization rollback is not a simple table drop because it writes to core `skill` and `skill_file`.
- Materialized skills need provenance so they can be identified, but user-customized skills should not be deleted blindly.
- Seam extraction rollback should revert to the concrete Hive anchors proven in prior slices.

### Performance

- Phase 1 EpicTree should include baseline limits and indexes but not over-optimize before data shape is proven.
- Tree reads need workspace filtering and predictable ordering.
- Large trees may later require pagination, lazy child loading, or subtree queries.
- ReviewGates list should be bounded by epic/workspace.
- PersonalQueue list should default to current user and active statuses.
- HermesChat messages must be paginated from the first implementation.
- Catalog browse can be static or in-memory if catalog size is small, but materialization state joins must be workspace-indexed.
- Avoid client-side rendering of unbounded datasets.
- React Query keys must be scoped by workspace to avoid cross-workspace cache bleed.
- The performance audit trigger is justified by tree, queue, and chat query patterns.

### Documentation impact

- Update developer docs with the Hive schema ownership rule.
- Document that Hive tables do not belong in core migrations.
- Document the build-time package registration steps.
- Document the `/api/plugins/hive/*` route boundary.
- Document the minimum manual smoke path for each slice.
- Document materialized skill provenance rules.
- In Phase 6, document only the seam proven by the implementation, not a general plugin platform.

### Security

- New authenticated API surface requires `security:plan-audit`.
- Skill materialization requires special security review because it writes executable agent skill content into DB-backed skill tables.
- File paths for skill files must use existing validation rules or stronger equivalents.
- Hive routes must inherit login auth and enforce workspace membership.
- Queue endpoints must enforce current-user scoping.
- Chat endpoints must enforce thread/workspace visibility.
- ReviewGate update endpoints must enforce role or permission requirements.
- Catalog materialization must enforce permission to create skills and assign agent skills.
- Audit logs or events should be considered for gate updates and skill materialization.
- Do not accept catalog content from arbitrary remote sources in this epic.

## 4. **File Change Manifest**

| Action | Path | Phase | Notes |
| --- | --- | --- | --- |
| MODIFY | `~/Code/spikes/multica/pnpm-workspace.yaml` | 1 | Only if Hive package path is outside existing `packages/*` glob. |
| MODIFY | `~/Code/spikes/multica/apps/web/package.json` | 1 | Add `@multica/hive` workspace dependency. |
| MODIFY | `~/Code/spikes/multica/apps/web/next.config.ts` | 1, 6 | Add transpile package; possibly extract package seam later. |
| CREATE | `~/Code/spikes/multica/packages/hive/package.json` | 1 | Hive frontend package metadata and exports. |
| CREATE | `~/Code/spikes/multica/packages/hive/tsconfig.json` | 1 | TypeScript package config. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/index.ts` | 1 | Export Hive views and client surfaces. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/client.ts` | 1 | Hive API client calls. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/types.ts` | 1 | Shared frontend DTOs. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/queries.ts` | 1 | React Query definitions. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/api/mutations.ts` | 1 | Mutation definitions. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/epic-tree-view.tsx` | 1 | Proof view. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/epic-tree-view.test.tsx` | 1 | Proof view tests. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/review-gates-view.tsx` | 2 | ReviewGates UI. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/review-gates-view.test.tsx` | 2 | ReviewGates UI tests. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/personal-queue-view.tsx` | 3 | Queue UI. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/personal-queue-view.test.tsx` | 3 | Queue UI tests. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/hermes-chat-view.tsx` | 4 | Chat UI. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/hermes-chat-view.test.tsx` | 4 | Chat UI tests. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/skills-catalog-view.tsx` | 5 | Optional catalog UI. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/views/skills-catalog-view.test.tsx` | 5 | Optional catalog UI tests. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/skills/catalog.ts` | 5 | Packaged skill catalog. |
| CREATE | `~/Code/spikes/multica/packages/hive/src/skills/catalog.test.ts` | 5 | Catalog validation tests. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/page.tsx` | 1 | Thin EpicTree/Hive entry route. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/epics/page.tsx` | 1 | Optional canonical EpicTree route. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/review-gates/page.tsx` | 2 | Thin ReviewGates route. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/queue/page.tsx` | 3 | Thin queue route. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/chat/page.tsx` | 4 | Thin chat route. |
| CREATE | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/hive/skills/page.tsx` | 5 | Optional skills catalog route. |
| MODIFY | `~/Code/spikes/multica/packages/core/paths/paths.ts` | 1-6 | Add Hive path builders; possibly extract seam in Phase 6. |
| MODIFY | `~/Code/spikes/multica/packages/core/paths/paths.test.ts` | 1-6 | Route builder coverage. |
| MODIFY | `~/Code/spikes/multica/packages/views/layout/app-sidebar.tsx` | 1-6 | Add Hive nav entries; possibly extract seam in Phase 6. |
| MODIFY | `~/Code/spikes/multica/packages/views/layout/app-sidebar.test.tsx` | 1-6 | Add/adjust nav tests if present or conventional. |
| MODIFY | `~/Code/spikes/multica/packages/views/locales/en/layout.json` | 1-5 | Add Hive nav labels; exact locale path should follow repo convention. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/layout.tsx` | 1-6 | Continues to provide workspace/auth context. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx` | 1-6 | Dashboard route group hosts Hive pages. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/packages/views/layout/dashboard-layout.tsx` | 1-6 | Existing dashboard shell hosts Hive pages. |
| MODIFY | `~/Code/spikes/multica/server/cmd/server/main.go` | 1 | Construct/migrate HiveStore with pgx pool. |
| MODIFY | `~/Code/spikes/multica/server/cmd/server/router.go` | 1, 6 | Add authenticated Hive mount; later extract generic seam only if proven. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/router.go` | 1 | Hive chi router. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/store.go` | 1-5 | Store interface and pgx implementation. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations.go` | 1 | Plugin-local migration runner. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/authz.go` | 1 | Workspace/member authz helpers. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/epic_nodes.go` | 1 | EpicTree handlers/store mapping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/review_gates.go` | 2 | ReviewGates handlers/store mapping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/personal_queue.go` | 3 | Queue handlers/store mapping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/hermes_chat.go` | 4 | Chat handlers/store mapping. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skills_catalog.go` | 5 | Catalog browse/materialization handlers. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skill_materializer.go` | 5 | Writes selected catalog skills to core skill tables. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/router_test.go` | 1 | Route/auth tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/store_test.go` | 1 | Migration and write/read tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/review_gates_test.go` | 2 | Gate tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/personal_queue_test.go` | 3 | Queue tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/hermes_chat_test.go` | 4 | Chat tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skills_catalog_test.go` | 5 | Catalog endpoint tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/skill_materializer_test.go` | 5 | Materialization tests. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/001_epic_nodes.up.sql` | 1 | `hive.schema_migrations`, `hive.epic_nodes`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/001_epic_nodes.down.sql` | 1 | Local/test rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/002_review_gates.up.sql` | 2 | `hive.review_gates`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/002_review_gates.down.sql` | 2 | Local/test rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/003_personal_queue_items.up.sql` | 3 | `hive.personal_queue_items`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/003_personal_queue_items.down.sql` | 3 | Local/test rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/004_hermes_chat.up.sql` | 4 | `hive.hermes_threads`, `hive.hermes_messages`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/004_hermes_chat.down.sql` | 4 | Local/test rollback. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/005_plugin_skill_catalog_state.up.sql` | 5 | `hive.plugin_skill_catalog_state`. |
| CREATE | `~/Code/spikes/multica/server/internal/hive/migrations/005_plugin_skill_catalog_state.down.sql` | 5 | Local/test rollback. |
| UNCHANGED | `~/Code/spikes/multica/server/migrations` | 1-6 | Must not receive Hive tables. |
| UNCHANGED | `~/Code/spikes/multica/server/sqlc.yaml` | 1-6 | Must not include Hive migrations. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/server/migrations/008_structured_skills.up.sql` | 5 | Defines skill/materialization target tables. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/server/internal/handler/skill.go` | 5 | Existing skill CRUD remains native after materialization. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/server/internal/handler/runtime_local_skills.go` | 5 | Runtime-local flow informs materialization but is not the catalog mechanism. |
| UNCHANGED-BUT-AFFECTED | `~/Code/spikes/multica/packages/core/api/ws-client.ts` | 4 | Reuse existing realtime if needed; no second WS stack. |
| CREATE or MODIFY | `~/Code/spikes/multica/docs/plugin-seams.md` | 6 | Proof-backed seam documentation if docs path is accepted. |
| MODIFY | `.pHive/epics/multica-plugin-ui/docs/structured-outline.md` | writer only | Writer synthesizes from this content; architect does not write it here. |

## 5. **Risk Registry**

| risk | severity | likelihood | mitigation | owner |
| --- | --- | --- | --- | --- |
| Slice 1 route mount requires deep `server/cmd/server/router.go` surgery instead of one authenticated mount. | high | medium | Keep Phase 1 to a single build-linked `r.Mount("/api/plugins/hive", ...)` inside the protected group; stop the epic if the router must be reorganized. | backend implementer |
| Hive tables leak into `~/Code/spikes/multica/server/migrations` or `server/sqlc.yaml`. | high | medium | Add file review and test checks proving Hive SQL lives only under `server/internal/hive/migrations` and uses `hive.schema_migrations`. | backend implementer |
| Auth inheritance is mistaken for complete authorization. | high | high | Require workspace/member checks in every Hive handler, with tests for cross-workspace object access and current-user queue access. | backend implementer |
| Skill materialization overwrites user-customized skills. | high | medium | Store provenance/version in `hive.plugin_skill_catalog_state`; reject collisions unless customize/import behavior is explicit; never auto-seed all workspaces. | skills implementer |
| Materialized skill files introduce unsafe paths or executable content confusion. | high | medium | Reuse or strengthen existing skill file path validation from `skill.go`; restrict catalog source to packaged content; add security review. | skills implementer |
| Startup succeeds with stale or missing Hive schema. | high | medium | Make Hive migration failure visible at startup or readiness; Phase 1 validation must intentionally break a migration and observe failure. | backend implementer |
| Cross-store writes appear atomic but are not. | high | low | Document that Hive and Multica writes are only atomic when using an explicit shared pgx transaction; materialization should own transaction boundaries. | backend implementer |
| Chat messages become an unbounded client-side render. | medium | high | Paginate message reads from first implementation and index by thread/time. | frontend/backend implementers |
| EpicTree grows beyond a single read response. | medium | medium | Start with baseline indexes and a bounded proof; add lazy subtree loading only after measured need. | frontend/backend implementers |
| Queue endpoint exposes another user's work items. | high | medium | Query by workspace and current user; deny updates unless item assignee matches current user or role policy permits. | backend implementer |
| ReviewGate state transitions are under-specified. | medium | medium | Define minimum allowed states and conflict behavior in Phase 2; mark advanced workflow rules as follow-up if not provided. | product + implementer |
| Sidebar becomes cluttered with too many Hive entries. | medium | medium | Decide whether Hive uses a single parent entry or separate view entries before Phase 2-5 nav work. | product + frontend implementer |
| Phase 6 over-generalizes into an unproven plugin platform. | medium | medium | Limit extraction to anchors used by working Hive slices; reject dynamic loader abstractions. | architect + implementer |
| Existing runtime-local skill flow is confused with Hive packaged catalog. | medium | medium | Keep catalog browse independent of online runtime; use runtime-local evidence only as import/materialization precedent. | skills implementer |
| Same database separate schema is missed by backup/restore docs. | medium | low | Update operations docs to state `hive.*` is part of the same Postgres backup target. | docs owner |
| Frontend cache leaks across workspaces. | medium | medium | Include workspace ID/slug in every React Query key. | frontend implementer |
| API error shapes drift from existing Multica conventions. | low | medium | Use existing handler response helpers or mirror their shape. | backend implementer |
| Package export paths become unstable during view additions. | low | medium | Keep `@multica/hive` exports explicit and covered by typecheck. | frontend implementer |
| Optional catalog UI delays materialization work. | medium | low | Treat browse endpoint and materialization as mandatory; catalog UI can stay minimal. | product + implementer |
| Upstream seam docs claim more than the code proves. | medium | medium | Require docs to cite concrete paths and tests from Phases 1-5. | architect + writer |

### Detailed mitigation for high-severity risks

- Route mount risk mitigation:
- The backend router currently creates a protected group at `~/Code/spikes/multica/server/cmd/server/router.go:301-304`.
- The proof mount must live inside that group.
- The acceptable change is one build-linked Hive router construction and one mount.
- The unacceptable change is a broad router reorganization, a second server, or unauthenticated mount path.
- Phase 1 should include a test that unauthenticated requests fail before reaching Hive handlers.
- Phase 1 should also include a manual browser check proving authenticated dashboard traffic reaches Hive.
- If this cannot be done with the thin mount, the epic should stop and return to architecture review.

- Core migration leakage mitigation:
- The existing migration resolver scans `migrations` and `server/migrations` and sorts files lexically.
- Existing duplicate numeric migration prefixes demonstrate why adding Hive migrations there is a fork-maintenance trap.
- Hive migration files must live under a plugin-owned directory such as `server/internal/hive/migrations`.
- The Hive runner must record versions in `hive.schema_migrations`, not core `schema_migrations`.
- Code review should reject any Hive table in `server/migrations`.
- Tests or CI checks should grep for `CREATE TABLE hive.` under `server/migrations` and fail.
- `server/sqlc.yaml` must remain pointed at core migrations only.

- Authorization drift mitigation:
- Mounting under auth only proves the user is authenticated.
- It does not prove the user belongs to the workspace named by `workspace_id`.
- Every Hive endpoint must call a workspace authorizer before reading or writing.
- Object IDs must be constrained by workspace in SQL queries.
- PersonalQueue must also constrain by current user.
- Chat thread/message access must constrain by workspace and visibility.
- ReviewGate update may require role checks beyond membership.
- Tests must include same-ID wrong-workspace fixtures where feasible.

- Skill overwrite mitigation:
- Existing `skill` rows are unique by `(workspace_id, name)` in `~/Code/spikes/multica/server/migrations/008_structured_skills.up.sql:4-15`.
- A packaged Hive catalog update can collide with a user-created or customized skill name.
- Materialization should never blindly upsert by name.
- On collision, return `409 Conflict` unless the request explicitly chooses customize/import semantics.
- Store catalog key, version, target skill ID, and state in `hive.plugin_skill_catalog_state`.
- If a materialized skill is edited by the user, mark it `customized` or equivalent and do not overwrite it automatically.
- Assignment to `agent_skill` should only happen when requested and authorized.

- Skill file safety mitigation:
- The existing skill creation path validates file paths before writing `skill_file`.
- The Hive materializer must reuse that validation or a shared helper.
- Catalog content should come from packaged files, not arbitrary remote URLs.
- Materialization should store provenance in skill config so reviewers can trace source and version.
- Security review should inspect whether catalog files can influence agent execution unexpectedly.
- Failed path validation should return `422` or `400` and leave no partial skill rows.

- Stale schema mitigation:
- Hive owns a separate migration ledger, so core migration success does not imply Hive schema readiness.
- Startup should run or verify Hive migrations before serving routes.
- If operational policy forbids automatic migrations, readiness should fail until a separate Hive migrate command succeeds.
- Phase 1 should include a deliberately broken migration check to verify the failure is observable.
- Empty UI on missing table is unacceptable because it hides operational failure.
- Logs should include migration version and failing statement/file context without leaking secrets.

- Cross-store transaction mitigation:
- Hive and Multica tables share a Postgres database but are not automatically transactionally coupled.
- Any operation writing both `hive.*` and core tables must decide transaction boundaries explicitly.
- Skill materialization is the primary cross-store operation.
- The materializer should use one pgx transaction for creating `skill`, `skill_file`, optional `agent_skill`, and `hive.plugin_skill_catalog_state`.
- If any write fails, rollback all related writes.
- Document this boundary so later implementers do not split materialization across independent transactions.

- Queue exposure mitigation:
- Queue data is sensitive because it reveals a user's assigned work and linked records.
- SQL must filter by `workspace_id` and `assignee_user_id` for normal users.
- Update operations must include both item ID and current user/workspace constraints.
- Tests should seed two users and prove each sees only their own rows.
- Admin override behavior should be explicit; if not specified, do not implement it.

## 6. **Dependency Map**

- Frontend package depends on `apps/web/package.json` and `apps/web/next.config.ts` build-time package registration.
- Frontend package depends on `@multica/core` for API client conventions, paths, workspace context, and query patterns.
- Frontend package depends on `@multica/ui` and existing view layout primitives for dashboard-compatible UI.
- Workspace routes depend on `packages/core/paths/paths.ts` and Next.js app route files under `apps/web/app/[workspaceSlug]/(dashboard)`.
- Sidebar entries depend on `packages/views/layout/app-sidebar.tsx` nav key and label key arrays.
- Auth inheritance depends on `apps/web/next.config.ts` rewrites and `apps/web/app/[workspaceSlug]/layout.tsx` workspace auth gating.
- Backend Hive router depends on `server/cmd/server/router.go` protected route group.
- HiveStore depends on the existing pgx pool created in `server/cmd/server/main.go`.
- Hive migrations depend on Postgres schema permissions for creating `hive`.
- Hive tables depend on workspace/user UUIDs from core tables but should avoid hard coupling to sqlc-generated core types.
- EpicTree depends on `hive.epic_nodes`.
- ReviewGates depends on `hive.review_gates` and epic identifiers.
- PersonalQueue depends on `hive.personal_queue_items`, current user identity, and link targets.
- HermesChat depends on `hive.hermes_threads` and `hive.hermes_messages`.
- Skills catalog browse depends on packaged catalog metadata.
- Skill materialization depends on existing `skill`, `skill_file`, and optionally `agent_skill` tables.
- Skill materialization depends on existing validation rules for skill file paths.
- Phase 6 seam extraction depends on evidence from Phases 1-5.

### Blocking questions

- Decision needed: should the visible Hive entry be one sidebar parent route or separate sidebar entries for EpicTree, ReviewGates, Queue, Chat, and Skills?
- Decision needed: is `/hive` the canonical EpicTree route, or should `/hive/epics` be canonical with `/hive` redirecting?
- Decision needed: what minimum role may update ReviewGates?
- Decision needed: can PersonalQueue include admin-visible delegated items, or only current-user items?
- Decision needed: should HermesChat use polling in Phase 4 or integrate with existing `/ws` immediately?
- Decision needed: what exact provenance fields are required for materialized skills?
- Decision needed: should materialized skills be assigned to agents in the same API call or a separate existing flow?
- Decision needed: should Hive migrations run automatically at server startup or be verified by readiness after a manual migrate step?
- Decision needed: where should Phase 6 seam documentation live if `docs/plugin-seams.md` is not the preferred docs path?
- [data not provided: product-specific names, labels, and exact copy for the four Hive views]
- [data not provided: final role matrix for ReviewGate update and skill materialization]
- [data not provided: expected production volume for EpicTree nodes, queue items, and chat messages]

## 7. **Elicitation — Stress-Testing the Plan**

### 7.1 Why won't this work?

- It may fail because the router seam is less isolated than the evidence suggests.
- `server/cmd/server/router.go` may require handler dependencies or middleware context that Hive cannot access from a clean build-linked package.
- If Hive handlers need deep access to private handler internals, the thin route mount may become a broad backend fork.
- It may fail because workspace authorization is not available as a reusable interface.
- The plan assumes a `WorkspaceAuthorizer` can be extracted or wrapped without duplicating permission logic.
- If permission logic is tightly embedded in `handler.Handler`, Hive either imports too much handler state or duplicates authorization.
- It may fail because startup migration behavior conflicts with Multica's current operational model.
- Core migrations appear to run through a separate command, but the plan asks Hive migration failure to be visible at startup or readiness.
- If the server does not currently have readiness semantics, the implementer must choose startup fail-fast or add a small readiness signal.
- It may fail because the package boundary creates TypeScript or Next.js transpilation friction.
- The existing `transpilePackages` pattern is encouraging, but `@multica/hive` may add dependencies or exports that need additional config.
- It may fail because route/nav anchors are more numerous than expected.
- Four views plus catalog can sprawl in sidebar, paths, route files, locale files, tests, and search/navigation code.
- It may fail because the same Postgres separate schema still carries operational coupling.
- Operators may not notice `hive.*` during backup/restore, debugging, or schema permissions setup.
- It may fail because cross-store materialization is more complex than the view slices.
- Skill materialization touches plugin catalog state and core skill tables, and it must preserve user customization.
- It may fail because version/update semantics for packaged skills are underspecified.
- "Enable", "customize", and "import" can each imply different overwrite and assignment rules.
- It may fail because runtime-local skill logic is tempting to reuse but mismatched.
- Runtime-local listing depends on online runtimes and daemon callbacks; Hive catalog needs browse without online runtime.
- It may fail because chat expectations exceed the chosen refresh behavior.
- Users may expect realtime chat, but the vertical plan only requires chosen refresh or realtime behavior.
- If realtime is required, the plan must reuse existing `/ws` carefully and not add a second stack.
- It may fail because EpicTree can become large quickly.
- A proof-gate implementation may accidentally establish an unbounded list API that later becomes hard to change.
- It may fail because Phase 6 has weak payoff if the concrete anchors are already small.
- A generic seam could add indirection without reducing rebase pain.
- It may fail because the "no invented paths" rule clashes with new file creation.
- The outline uses existing paths for modified/affected files and clearly labels proposed create paths under existing directories.
- The writer should preserve that distinction so reviewers know which paths exist now and which are intended additions.

### 7.2 Assumptions (label each VERIFIED / ASSUMED / RISKY)

- VERIFIED: `apps/web/next.config.ts` has `transpilePackages` for workspace packages.
- VERIFIED: `apps/web/package.json` depends on workspace packages such as `@multica/core`, `@multica/ui`, and `@multica/views`.
- VERIFIED: `apps/web/next.config.ts` rewrites `/api`, `/ws`, `/auth`, and `/uploads` to the backend.
- VERIFIED: workspace routes are under `apps/web/app/[workspaceSlug]/...`.
- VERIFIED: `apps/web/app/[workspaceSlug]/layout.tsx` gates workspace routes on auth and workspace lookup.
- VERIFIED: dashboard pages are thin adapters that import view packages.
- VERIFIED: `packages/core/paths/paths.ts` centralizes workspace-scoped path builders.
- VERIFIED: `packages/views/layout/app-sidebar.tsx` uses static nav arrays and resolves paths at render time.
- VERIFIED: backend protected API routes use `middleware.Auth` in `server/cmd/server/router.go`.
- VERIFIED: existing APIs are mounted explicitly with chi route groups.
- VERIFIED: Multica creates a pgx pool from `DATABASE_URL`.
- VERIFIED: core migrations are loaded from `migrations` or `server/migrations`.
- VERIFIED: core sqlc schema input is `server/migrations`.
- VERIFIED: `skill`, `skill_file`, and `agent_skill` exist in core migrations.
- VERIFIED: existing skill CRUD is DB-backed.
- VERIFIED: runtime-local skill listing depends on runtime/daemon request state.
- ASSUMED: a package named `@multica/hive` is acceptable.
- ASSUMED: `packages/hive` is the preferred frontend package location.
- ASSUMED: `server/internal/hive` is the preferred backend package location.
- ASSUMED: Hive can import or wrap enough authz behavior without large handler refactors.
- ASSUMED: startup fail-fast for Hive migration failure is operationally acceptable if readiness is not already available.
- ASSUMED: each Hive view can be delivered as a route page inside the existing dashboard shell.
- ASSUMED: React Query is the expected frontend data fetching pattern for Hive views.
- ASSUMED: a single `HiveStore` interface can grow across the slices without becoming unmanageable.
- ASSUMED: each Hive table can store UUID references to core workspace/user/agent/skill records without foreign keys or with carefully chosen foreign keys.
- ASSUMED: product accepts minimal UI for proof and catalog browse.
- ASSUMED: Phase 2-4 can be reordered after Phase 1 if product priority changes.
- RISKY: ReviewGate state transition rules may be more complex than the plan captures.
- RISKY: PersonalQueue may need richer permission semantics than current-user filtering.
- RISKY: HermesChat may need realtime behavior earlier than planned.
- RISKY: Skill materialization may need a full upgrade/diff workflow, not just provenance and conflict handling.
- RISKY: Upstream seam extraction may not reduce enough fork churn to justify abstraction.
- RISKY: Large EpicTree and chat datasets may require pagination/lazy loading sooner than expected.
- RISKY: Same-database separate schema may still be perceived as "core DB coupling" by maintainers.
- RISKY: If Hive schema permissions are unavailable in hosted deployments, migration will fail despite correct code.
- RISKY: Catalog skill content may need security review before any materialization endpoint ships.

### 7.3 Simplest version

- The simplest acceptable version is Phase 1 only.
- It adds `@multica/hive` as a build-time frontend package.
- It adds one dashboard route for EpicTree.
- It adds one sidebar entry or one path to reach that route.
- It adds one backend mount under `/api/plugins/hive/*`.
- It adds one HiveStore with `Migrate`, `ListEpicTree`, and `UpsertEpicNode`.
- It adds `hive.schema_migrations` and `hive.epic_nodes`.
- It performs one write/read through that table.
- It proves authenticated requests reach Hive handlers.
- It proves missing Hive schema is visible.
- It proves no Hive SQL is in core migrations.
- It stops there if the seam is not viable.
- The simplest ReviewGates version is list plus one state update, not a full gate workflow engine.
- The simplest PersonalQueue version is current-user active items with links, not delegation analytics.
- The simplest HermesChat version is persisted thread/messages with refresh/polling, not a new realtime subsystem.
- The simplest Skills version is browse packaged catalog plus materialize one selected skill, not automatic update management.
- The simplest Phase 6 version is documentation plus a tiny route/nav mount helper only if the diff proves value.
- Anything beyond these minimums should be follow-up unless required to satisfy acceptance.

### 7.4 What will we wish we'd thought of? (Regrets)

- We may regret not defining workspace authorization as a clean reusable interface before implementing multiple handlers.
- We may regret making HiveStore a single broad interface if test doubles become large and brittle.
- We may regret not adding pagination to EpicTree from the start if early customers have large epics.
- We may regret not deciding sidebar structure before adding many individual view routes.
- We may regret choosing route names that later conflict with product vocabulary.
- We may regret not establishing a migration command or readiness convention clearly in Phase 1.
- We may regret not adding structured event/audit logging for ReviewGate updates.
- We may regret not making queue target links typed enough to avoid broken cross-links.
- We may regret implementing chat polling if user expectation quickly becomes realtime.
- We may regret implementing chat realtime if it delays the slice and duplicates existing WebSocket behavior.
- We may regret not modeling skill catalog upgrades before first materialization.
- We may regret storing too little provenance to distinguish packaged, materialized, customized, and superseded skills.
- We may regret using skill name as the primary human conflict surface if catalog keys are the stable identity.
- We may regret failing to document backup/restore implications of the `hive` schema.
- We may regret treating Phase 6 as mandatory extraction if the fork anchors remain smaller than the abstraction.
- We may regret not including a small operational checklist for `hive.*` tables.
- We may regret not testing cross-workspace cache behavior in the frontend.
- We may regret not deciding whether Hive references core records with foreign keys or plain UUIDs.
- We may regret not defining what happens when a linked core issue/project is deleted.
- We may regret not defining retention behavior for HermesChat messages.
- We may regret not defining rate limits for chat or skill materialization.
- We may regret not involving security review before catalog materialization is coded.

### 7.5 Where are we over-engineering?

- We may be over-engineering Phase 6 if a generic seam is extracted before fork churn is measured.
- We may be over-engineering a single broad `HiveStore` if smaller per-domain stores are easier to test.
- We may be over-engineering the skills catalog UI if endpoint browse plus existing Skills page is enough initially.
- We may be over-engineering down migrations if production rollback policy never drops plugin tables automatically.
- We may be over-engineering nav abstraction if a few explicit Hive entries are more maintainable.
- We may be over-engineering EpicTree data shape before proof of route/store viability.
- We may be over-engineering realtime chat if polling satisfies the first usable workflow.
- We may be over-engineering materialization assignment if existing skill assignment UI can handle assignment after creation.
- We may be over-engineering a plugin path helper if `paths.workspace(slug).hiveX()` functions stay clear and typed.
- We may be over-engineering startup migration automation if Multica's deployment model strongly prefers explicit migration commands.
- We should not over-engineer a runtime plugin loader; the locked architecture is build-time bundled.
- We should not over-engineer a sidecar service; the locked storage shape is same Postgres database with a separate schema.
- We should not over-engineer automatic skill seeding; the locked design rejects it.
- We should not over-engineer generalized catalog discovery from runtime-local skills; Hive catalog is packaged and versioned.
- We should not over-engineer product workflow rules that upstream inputs did not provide; mark missing rules as `[data not provided]` where necessary.

## 8. **Decision Points for Sign-Off**

1. Confirm `@multica/hive` and `~/Code/spikes/multica/packages/hive` as the frontend package name/location.
2. Confirm `~/Code/spikes/multica/server/internal/hive` as the backend package location.
3. Confirm Phase 1 hard bail: stop if route mount, auth inheritance, Hive schema, or durable write/read fails.
4. Confirm no Hive SQL files may be added to `~/Code/spikes/multica/server/migrations`.
5. Confirm Hive schema uses same Postgres database with separate `hive` schema and `hive.schema_migrations`.
6. Confirm the canonical EpicTree route: `/hive`, `/hive/epics`, or both with one redirect.
7. Confirm sidebar strategy: one Hive entry versus separate entries for each Hive view.
8. Confirm ReviewGate update permission requirements.
9. Confirm PersonalQueue visibility: current user only or admin/delegated visibility too.
10. Confirm HermesChat first implementation: polling/refresh or existing WebSocket integration.
11. Confirm whether Hive migrations run automatically at startup or readiness only verifies manual migration status.
12. Confirm skill catalog materialization behavior on name collision.
13. Confirm whether materialization can assign an agent skill in the same call.
14. Confirm minimum provenance fields for catalog materialization.
15. Confirm whether catalog UI is required or endpoint plus existing Skills page is sufficient.
16. Confirm Phase 6 is conditional on measured fork churn, not an unconditional generic framework build.
17. Confirm `security:plan-audit` is raised before execution because the plan adds authenticated APIs, schema, and skill materialization.
18. Confirm `performance:audit` is raised after execution because tree, queue, and chat can involve large query paths.
19. Confirm missing product details may be represented as `[data not provided: ...]` in the final structured outline rather than inventing behavior.
20. Confirm the writer preserves Part 5 Risk Registry and Part 7 Elicitation as full sections, not summaries.

Completeness checklist for writer:
- Part 1 Executive Summary: present.
- Part 2 Detailed Approach: present with six phases matching vertical slices.
- Part 3 Verification Plan: present with per-phase automated/manual checks, matrix, and not-verified list.
- Part 3b Cross-Cutting Concerns: present.
- Part 4 File Change Manifest: present.
- Part 5 Risk Registry: present with table and high-risk mitigation paragraphs.
- Part 6 Dependency Map: present.
- Part 7 Elicitation: present with all five required subsections.
- Part 8 Decision Points for Sign-Off: present.
