# Structured Outline - multica-plugin-ui

## Intro
The epic goal is to deliver Hive as a build-time-bundled workspace package inside Multica: thin frontend route and nav anchors, inherited auth/session/WebSocket behavior, a backend mount under `/api/plugins/hive/*`, Hive-owned storage in a separate `hive` schema, four user-facing Hive views, a packaged skills catalog with explicit materialization, and a later evidence-backed upstream seam extraction.

HARD BAIL: Stop the epic if this slice requires deep router surgery, adds Hive tables to core migrations, fails to inherit auth, or cannot complete a durable write/read through Hive-owned storage.

## Step 1

### mpu-1
handle: mpu-1
title: Proof `/api/plugins/hive/*` route mount, HiveStore, and Hive schema gate
acceptance_criteria:
- An authenticated request to `/api/plugins/hive/*` reaches build-linked Hive handlers mounted inside the existing authenticated chi group, using the backend route-mount seam in `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md:96-112` and auth inheritance seams in `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md:76-94`.
- Integration check proves one `hive.epic_nodes` durable write/read succeeds through a typed HiveStore boundary, tied to the Step 1 `VERIFIED BY` item in `vertical-plan.md:52-55` and HiveStore/schema seams in `horizontal-plan.md:118-167`.
- Startup/readiness check surfaces Hive migration failure instead of silently running against stale schema, tied to `vertical-plan.md:54-55` and startup/store seams in `horizontal-plan.md:130-137`.
- File review proves no Hive tables or Hive migration files were added to Multica `server/migrations`, tied to `vertical-plan.md:56-57` and the separate-schema discipline in `horizontal-plan.md:139-167`.
- HARD BAIL: If `/api/plugins/hive/*` requires deep router surgery, cannot mount inside the authenticated chi group, fails to inherit auth, adds Hive tables to core migrations/sqlc input, or the proof write/read fails, STOP the epic before Steps 2-6.
dependencies:
  blocks: [mpu-2, mpu-3, mpu-4, mpu-5, mpu-6, mpu-7, mpu-8]
  blocked_by: []
layers: [Auth/session/WebSocket inheritance, Backend route mount, HiveStore persistence boundary, Hive Postgres schema]
cross_cutting: auth inheritance; Hive-owned schema migration discipline; hard bail proof gate

### mpu-2
handle: mpu-2
title: Minimal EpicTree route, nav entry, and dashboard render
acceptance_criteria:
- Manual authenticated browser check proves the EpicTree route renders inside the Multica dashboard shell, tied to the Step 1 `VERIFIED BY` item in `vertical-plan.md:52-53` and frontend package/route seams in `horizontal-plan.md:24-49` and `horizontal-plan.md:50-75`.
- EpicTree route is workspace-scoped under `/{workspaceSlug}/hive/...` with a thin additive sidebar entry, using route/nav anchor seams in `horizontal-plan.md:63-69`.
- EpicTree client calls use `/api/plugins/hive/*` through the same authenticated API boundary proven by mpu-1, with no separate Hive auth/session/WebSocket implementation.
dependencies:
  blocks: [mpu-3, mpu-4, mpu-5, mpu-6, mpu-7, mpu-8]
  blocked_by: [mpu-1]
layers: [Frontend plugin package, Frontend route and nav anchors, Auth/session/WebSocket inheritance, Four Hive views]
cross_cutting: fork-anchor stability; auth/WS inherited, not reimplemented

## Step 2

### mpu-3
handle: mpu-3
title: ReviewGates list/detail/update workflow
acceptance_criteria:
- Integration test covers review-gate list, detail, and update through authenticated Hive API, tied to the Step 2 `VERIFIED BY` item in `vertical-plan.md:88-90` and the shared backend route mount seam in `horizontal-plan.md:96-117`.
- Manual check confirms refreshed review-gate state persists after update, tied to `vertical-plan.md:89-91` and HiveStore future gate methods in `horizontal-plan.md:124-129`.
- ReviewGates route and sidebar entry are additive workspace-scoped anchors using the route/nav seams in `horizontal-plan.md:50-75`, without changing Step 1 auth/store assumptions.
dependencies:
  blocks: [mpu-8]
  blocked_by: [mpu-1, mpu-2]
layers: [Frontend plugin package, Frontend route and nav anchors, Backend route mount, HiveStore persistence boundary, Hive Postgres schema, Four Hive views]
cross_cutting: parallel after proof gate; reuses authenticated Hive API boundary

## Step 3

### mpu-4
handle: mpu-4
title: PersonalQueue user-scoped work-item surface
acceptance_criteria:
- Integration test proves queue items are filtered by current user and workspace authorization, tied to the Step 3 `VERIFIED BY` item in `vertical-plan.md:118-120` and auth/workspace seams in `horizontal-plan.md:76-94`.
- Manual check proves queue links resolve to related Hive or Multica epic/gate records, tied to `vertical-plan.md:119-121`.
- Queue handlers use HiveStore queue read/update methods and `hive.personal_queue_items`, matching Step 3 layers in `vertical-plan.md:105-110` and the shared API/store dependency in `horizontal-plan.md:255-258`.
dependencies:
  blocks: [mpu-8]
  blocked_by: [mpu-1, mpu-2]
layers: [Frontend plugin package, Frontend route and nav anchors, Auth/session/WebSocket inheritance, Backend route mount, HiveStore persistence boundary, Hive Postgres schema, Four Hive views]
cross_cutting: authorization filtering risk; parallel after proof gate

## Step 4

### mpu-5
handle: mpu-5
title: HermesChat persisted thread/message workflow
acceptance_criteria:
- Integration test covers thread create, message send, and message read through authenticated Hive API, tied to the Step 4 `VERIFIED BY` item in `vertical-plan.md:147-149` and route/store seams in `horizontal-plan.md:96-137`.
- Manual verification confirms the chosen refresh or realtime behavior works, tied to `vertical-plan.md:148-150` and inherited `/ws` behavior expectations in `horizontal-plan.md:76-94`.
- Chat persistence uses `hive.hermes_threads` and `hive.hermes_messages` through HiveStore methods, matching Step 4 schema/store layers in `vertical-plan.md:135-140`.
dependencies:
  blocks: [mpu-8]
  blocked_by: [mpu-1, mpu-2]
layers: [Frontend plugin package, Frontend route and nav anchors, Auth/session/WebSocket inheritance, Backend route mount, HiveStore persistence boundary, Hive Postgres schema, Four Hive views]
cross_cutting: no second auth or WebSocket stack; latency/performance-sensitive chat history

## Step 5

### mpu-6
handle: mpu-6
title: Browseable packaged Hive skills catalog
acceptance_criteria:
- Catalog browse check succeeds without requiring an online runtime, tied to the Step 5 `VERIFIED BY` item in `vertical-plan.md:178-180` and catalog route surfaces in `horizontal-plan.md:168-189`.
- `GET /api/plugins/hive/skills/catalog` exposes versioned packaged catalog entries before materialization, using the hybrid catalog responsibility in `horizontal-plan.md:170-180`.
- Catalog state/provenance uses `hive.plugin_skill_catalog_state` through HiveStore, preserving the separate Hive schema boundary in `horizontal-plan.md:139-167`.
dependencies:
  blocks: [mpu-7, mpu-8]
  blocked_by: [mpu-1, mpu-2]
layers: [Skills catalog, Backend route mount, HiveStore persistence boundary, Hive Postgres schema]
cross_cutting: depends on existing Multica skill tables conceptually, but browse remains plugin-packaged and runtime-independent

### mpu-7
handle: mpu-7
title: Skill materialization into existing Multica skill tables
acceptance_criteria:
- Materialization check proves selected catalog skills create Multica `skill` and `skill_file` rows, tied to the Step 5 `VERIFIED BY` item in `vertical-plan.md:179-181` and existing skill table seams in `horizontal-plan.md:181-189`.
- Assignment check proves existing agent-skill logic works after materialization, tied to `vertical-plan.md:180-182` and `agent_skill` dependency in `horizontal-plan.md:190-193`.
- Enable/customize/import materialization preserves explicit provenance/version rules and does not auto-seed every workspace at install time, matching the locked hybrid decision in `design-discussion.md:75-98`.
dependencies:
  blocks: [mpu-8]
  blocked_by: [mpu-1, mpu-2, mpu-6]
layers: [Skills catalog, Backend route mount, HiveStore persistence boundary, Hive Postgres schema, Existing Multica skill tables and handlers]
cross_cutting: cross-system skill materialization; provenance/version discipline; no automatic workspace seeding

## Step 6

### mpu-8
handle: mpu-8
title: Evidence-backed upstream seam extraction
acceptance_criteria:
- Rebase-oriented review shows the fork diff is smaller or more stable after extracting the proven generic seam, tied to the Step 6 `VERIFIED BY` item in `vertical-plan.md:205-207` and fork-anchor seams in `horizontal-plan.md:219-242`.
- Functional check proves the concrete Hive-specific anchors still work after extraction, tied to `vertical-plan.md:206-208`.
- Extraction is limited to proven route/nav/package/backend mount seams from Steps 1-5 and does not add new Hive capability or speculative generic loader work, matching `vertical-plan.md:193-204`.
dependencies:
  blocks: []
  blocked_by: [mpu-1, mpu-2, mpu-3, mpu-4, mpu-5, mpu-6, mpu-7]
layers: [Frontend route and nav anchors, Backend route mount, Documentation and tests, Fork anchors and upstream seam extraction]
cross_cutting: fork-anchor stability; upstream proposal only after evidence from Steps 1-5

## Dependency Summary

Sequential:
- `mpu-1` must land before `mpu-2`.
- `mpu-2` must land before `mpu-3`, `mpu-4`, `mpu-5`, `mpu-6`, `mpu-7`, and `mpu-8`.
- `mpu-6` must land before `mpu-7`.
- `mpu-8` depends on all stories from Steps 1-5.

Parallel:
- `mpu-3`, `mpu-4`, and `mpu-5` run in parallel after the Step 1 proof gate is complete.
- `mpu-6` and `mpu-7` are a Step 5 sequence after the Step 1 proof gate and the Step 2-4 view work are in place.
- Step 6 is last and waits for the full evidence set from Steps 1-5.
