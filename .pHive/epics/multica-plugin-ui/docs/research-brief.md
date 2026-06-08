# Research brief - multica-plugin-ui feasibility

## Executive summary

The plugin-loader plan is feasible only if the architecture changes from runtime drop-in loading to build-time bundled plugin registration. Frontend research refutes the proposed `~/.multica/plugins/manifest.json` plus `next/dynamic` runtime import path because Next.js requires explicit, build-known dynamic imports. Backend research likewise refutes runtime scanning of Go plugin API handlers and plugin-owned migrations as a small portable patch. The viable path is GO-WITH-CAVEATS: build-time registered frontend and backend extension seams exist, but route/nav injection, migrations, and WebSocket scopes require core Multica changes.

## VERDICT: GO-WITH-CAVEATS

Single riskiest assumption: runtime-vs-build-time loading. PLU-295 reports that "RUNTIME DROP-IN IS REFUTED" for the stated manifest plus `next/dynamic` idea because the import target must be known to the Next build and emitted into the bundle/chunk graph. PLU-296 reports the matching backend constraint: runtime-loaded Go handlers from a plugin directory are not realistic for this server as written, there is no server plugin loader, and Go `plugin` has portability and matching-build constraints.

Build-time-bundled plugins are viable with caveats. The frontend can consume existing auth/API/WS seams if plugin code is compiled into the app graph, and the backend can mount build-time registered handlers inside existing chi middleware groups. The runtime drop-in version of the maintainer hypothesis should be treated as refuted.

## The 6 feasibility questions answered

1. **How does Multica register routes and sidebar nav today? Is dynamic plugin route injection feasible without deep surgery?**

   Answer: routes are filesystem App Router files, and sidebar navigation is hard-coded, so dynamic route/nav injection is not available as a small runtime registry change. PLU-295 cites concrete route files at `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12`, `settings/page.tsx:1`, and `agents/[id]/page.tsx:1-12`, with dashboard wrapping in `apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx:3-23`. It also cites hard-coded workspace route builders in `packages/core/paths/paths.ts:17-41` and only global/workspace builder exports at `packages/core/paths/paths.ts:44-55`. Sidebar source is closed over local unions and arrays at `packages/views/layout/app-sidebar.tsx:102-150`, with rendering directly mapping those arrays at `app-sidebar.tsx:607-633`, `app-sidebar.tsx:672-692`, and `app-sidebar.tsx:696-720`. `DashboardLayout` mounts a fixed `AppSidebar` at `packages/views/layout/dashboard-layout.tsx:35-38`, whose props are only `children`, `extra`, `searchSlot`, and `loadingIndicator` at `dashboard-layout.tsx:11-19`.

2. **How does the Go backend mount routes and middleware? Can a plugin dir be scanned and mounted under `/api/plugins/<name>/` cleanly?**

   Answer: route mounting is centralized in chi and has clear build-time seams, but no runtime plugin loader exists. PLU-296 cites `NewRouterWithOptions` constructing `chi.NewRouter()` at `cmd/server/router.go:111` and `cmd/server/router.go:180`, applying global middleware at `cmd/server/router.go:182-202`, registering `/ws` before auth at `cmd/server/router.go:220-232`, daemon routes under `/api/daemon` with `middleware.DaemonAuth` at `cmd/server/router.go:266-299`, protected user routes at `cmd/server/router.go:301-305`, and workspace-member routes at `cmd/server/router.go:373-375`. The same findings state that a plugin loader could hook inside `NewRouterWithOptions`, likely under the protected workspace-member group, but the seam is not currently abstracted and no backend plugin/manifest/registration package was found.

3. **Auth + WebSocket: how would a plugin view inherit Multica's session + WS? Real seams or hand-wave?**

   Answer: real seams exist for code compiled into the Multica package graph; external runtime bundles would need a separate host contract. On the frontend, PLU-295 cites `apps/web/components/web-providers.tsx:64-81` mounting `CoreProvider`, `packages/core/platform/core-provider.tsx:36-44` creating/registering the `ApiClient`, `core-provider.tsx:56-60` registering auth and chat stores, `packages/core/auth/index.ts:9-40` exposing `useAuthStore`, and `packages/core/api/index.ts:16-40` exposing the `api` singleton. For WebSocket, PLU-295 cites `/ws` setup at `apps/web/components/web-providers.tsx:30-38`, `CoreProvider` wiring at `web-providers.tsx:64-67`, `WSProvider` at `packages/core/platform/core-provider.tsx:95-103`, workspace-scoped `WSClient` creation at `packages/core/realtime/provider.tsx:79-101`, and hooks at `packages/core/realtime/hooks.ts:13-32`. On the backend, PLU-296 cites `middleware.Auth` taking JWT/PAT/cookie auth and setting user headers at `internal/middleware/auth.go:19-30`, `:47-89`, `:93-124`, and `:129-144`, with CSRF on cookie state-changing methods at `internal/middleware/auth.go:40-45`. Workspace membership is resolved and injected at `internal/middleware/workspace.go:47-84`, `:133-138`, and `:170-225`.

4. **DB migrations: can a plugin add tables, or does Multica's schema/migration system forbid it?**

   Answer: plugin-owned tables are possible only if migration discovery changes or plugin migrations are copied into the canonical migration directory before running the migrator. PLU-296 cites a custom raw SQL runner that discovers only `migrations` or `server/migrations` under bounded roots at `internal/migrations/migrations.go:13-39`, globs `*.up.sql` and `*.down.sql` in that one directory at `internal/migrations/migrations.go:50-69`, executes each file directly at `cmd/migrate/main.go:58-115`, and tracks versions at `cmd/migrate/main.go:46-56` and `cmd/migrate/main.go:105-109`. sqlc schema input is hard-coded to `migrations/` at `sqlc.yaml:3-10`, so runtime plugin migrations would not participate in generated query types. PLU-296 notes raw SQL remains possible because `Handler` exposes `DB` and `TxStarter` at `internal/handler/handler.go:92-117`.

5. **Build-time vs runtime loading: can plugins be dropped in at runtime, or must they be built into Multica?**

   Answer: the proposed runtime drop-in mechanism is refuted; plugins must be build-time bundled unless a different remote-module architecture is chosen. PLU-295 cites `apps/web/next.config.ts:25-28`, which only conditionally enables standalone output and transpiles `@multica/core`, `@multica/ui`, and `@multica/views`; no external plugin directory, webpack externals, module federation, asset prefix, or runtime loader config exists. It also cites rewrites only for backend/docs/ws/auth/uploads at `apps/web/next.config.ts:35-69` and no plugin dependency or loader dependency in `apps/web/package.json:21-23`. PLU-295 also cites official Next.js behavior: App Router routes are made public by `page` files, and `next/dynamic` import paths must be explicitly written, not variables or template strings, and top-level so Next can match bundle/module IDs. PLU-296 reaches the same backend conclusion: runtime-loaded Go handlers from a plugin directory are not realistic as written; there is no loader, and Go `plugin` is operationally unsuitable for portable runtime drop-in handlers.

6. **Realistic LOC estimate for the loader. Confirm or refute 200-300 LOC.**

   Answer: the 200-300 total estimate is refuted for the stated loader. PLU-295 says the "~150 LOC frontend half is not credible" for runtime drop-in because the core mechanism is invalid in production, and estimates build-time-bundled frontend support at roughly 350-700 LOC before tests for typed manifests, explicit imports or generated import maps, route handling, path builder integration, sidebar refactor, labels/icons/active state, and tests. PLU-296 says a minimal build-time backend handler mount plus manifest scan could be roughly 150-250 backend LOC before tests, out-of-tree migration registration and safe execution is more like 300-500 backend LOC, and subprocess/RPC or HTTP proxy plugin hosting with lifecycle, auth forwarding, and observability is likely 600-1,000+ backend LOC.

## Frontend findings summary

- Routes are App Router filesystem pages, not a runtime route registry. Evidence: `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:1-12`, `settings/page.tsx:1`, `agents/[id]/page.tsx:1-12`, and dashboard layout wrapping at `apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx:3-23` (PLU-295).
- Sidebar nav is hard-coded through closed keys and arrays. Evidence: `packages/views/layout/app-sidebar.tsx:102-150` defines `NavKey`, labels, and `personalNav`, `workspaceNav`, and `configureNav`; render sites are `app-sidebar.tsx:607-633`, `app-sidebar.tsx:672-692`, and `app-sidebar.tsx:696-720` (PLU-295).
- Feature wiring is static imports from route files and layout shell. Evidence: `apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx:3-10`, `settings/page.tsx:1`, `agents/[id]/page.tsx:3-12`, and shell imports/slots in `apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx:3-22` (PLU-295).
- `next.config.ts` and package dependencies do not contain plugin loader support. Evidence: `apps/web/next.config.ts:25-28`, `apps/web/next.config.ts:35-69`, and `apps/web/package.json:21-23` (PLU-295).
- Auth/API/WS seams exist for compiled-in code through `CoreProvider`, `api`, `useAuthStore`, `useWS`, and realtime hooks. Evidence: `apps/web/components/web-providers.tsx:30-38`, `:64-81`; `packages/core/platform/core-provider.tsx:36-44`, `:56-60`, `:95-103`; `packages/core/auth/index.ts:9-40`; `packages/core/api/index.ts:16-40`; `packages/core/realtime/provider.tsx:79-149`; `packages/core/realtime/hooks.ts:13-32` (PLU-295).
- LOC reality: build-time frontend plugin support is roughly 350-700 LOC before tests; runtime manifest-path `next/dynamic` is not a small-patch path (PLU-295).

## Backend findings summary

- Router seams are centralized in chi. Evidence: `cmd/server/router.go:111`, `:180`, `:182-202`, `:220-232`, `:266-299`, `:301-305`, and `:373-375` (PLU-296).
- Auth and workspace middleware inheritance is feasible if plugin routes mount inside existing protected groups. Evidence: `internal/middleware/auth.go:19-30`, `:40-45`, `:47-89`, `:93-124`, `:129-144`; `internal/middleware/workspace.go:47-84`, `:133-138`, `:170-225`; protected groups at `cmd/server/router.go:301-305` and `cmd/server/router.go:373-375` (PLU-296).
- Migration runner is custom and scans one built-in migration location, not plugin directories. Evidence: `internal/migrations/migrations.go:13-69`, `cmd/migrate/main.go:46-115`, and `sqlc.yaml:3-10` (PLU-296).
- WebSocket hub supports existing workspace/user fanout but plugin-specific scopes are not open-ended. Evidence: browser WS auth at `internal/realtime/hub.go:638-726`, auto-subscription at `internal/realtime/hub.go:222-238`, broadcaster at `internal/realtime/broadcaster.go:16-42`, hard-coded scopes at `internal/realtime/hub.go:797-853`, authorizer wiring at `cmd/server/main.go:250-251`, and authorizer implementation at `cmd/server/scope_authorizer.go:21-95` (PLU-296).
- Go `plugin` portability concerns make runtime-loaded Go handlers unsuitable for a generic upstreamable runtime drop-in system; PLU-296 cites the official Go `plugin` docs as limited to Linux/FreeBSD/macOS with matching toolchain/build flags/dependencies and notes IPC/RPC is often better.
- LOC reality: backend build-time handler mounting can be small only at the handler-mount layer; migrations, WS scope extension, or subprocess/RPC hosting increase the estimate substantially (PLU-296).

## Honest LOC estimate

The claimed 200-300 total LOC is contradicted by both research outputs.

- Build-time-bundled frontend plugin support: roughly 350-700 LOC before tests, covering typed manifest/registry, explicit import map or generated imports, route handling, path builder integration, sidebar injection/refactor, labels/icons/active-state handling, and tests (PLU-295).
- Build-time backend handler mount plus manifest scan: roughly 150-250 backend LOC before tests if scoped narrowly to route registration (PLU-296).
- Backend with plugin-owned migrations: roughly 300-500 backend LOC for out-of-tree migration registration and safe execution (PLU-296).
- Backend with subprocess/RPC or HTTP proxy plugin hosting: roughly 600-1,000+ backend LOC for hosting, lifecycle, auth forwarding, and observability (PLU-296).

Realistic build-time bundled approach: roughly 350-700 frontend LOC plus 150-500 backend LOC, depending on whether backend scope stops at handler mounting or includes plugin-owned migrations and WS scope extension. Subprocess/RPC plugin hosting trends 600-1,000+ backend LOC.

## `inconsistency_risk_signals`

```text
PLU-295:
- Signal: hidden assumption | Where: requirement brief / maintainer hypothesis | Detail: claims plugins can drop in at runtime via `next/dynamic`, but Next requires statically analyzable top-level imports in the build graph.
- Signal: convention violation | Where: `apps/web/app/**` route files | Detail: current app uses App Router filesystem pages, not a runtime route registry.
- Signal: vocabulary mismatch | Where: "feature wiring" claim vs `packages/views/layout/app-sidebar.tsx` | Detail: "features register into app shell" does not match hard-coded imports/nav arrays.
- Signal: LOC optimism | Where: "~150 LOC frontend half" claim | Detail: even build-time plugin support requires route, path, sidebar, manifest/import-map, and tests across existing shell boundaries.

PLU-296:
- `backend-runtime-drop-in-go-handlers`: contradicted. The code has no server-side plugin loader, and Go `plugin` is operationally unsuitable for portable/runtime drop-in handlers.
- `plugin-owned-migrations-runtime`: contradicted as stated. Migrations are loaded from one built-in directory, and sqlc is build-time.
- `shared-WS-with-plugin-scopes`: overstated. Existing WS can carry workspace/user events, but new plugin scopes require core changes.
- `backend-half-within-200-300-total`: likely understated if it includes robust runtime discovery, migration execution, tests, and WS extension. A minimal build-time handler mount + manifest scan could be roughly 150-250 backend LOC before tests. Adding out-of-tree migration registration and safe execution is more like 300-500 backend LOC. Adding subprocess/RPC or HTTP proxy plugin hosting, lifecycle, auth forwarding, and observability is likely 600-1,000+ backend LOC.
```

## Unanswered questions / scope decisions for the maintainer

- Whether a build-time plugin registry or catch-all plugin route is acceptable as a changed architecture.
- Whether frontend plugin code should be delivered as a package dependency, generated import map, federated remote, iframe/web component, external bundle, or another architecture.
- Whether plugin-owned migrations are in scope or explicitly forbidden.
- Whether plugin-specific WebSocket scopes are required, or whether workspace/user fanout is sufficient.
- Whether the first implementation proof gate should validate only loader plus EpicTree under build-time bundling, or preserve the original runtime drop-in requirement despite the research verdict.
