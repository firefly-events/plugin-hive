# Design Discussion - multica-plugin-ui

## 0. Prelude

The architecture is locked as build-time-bundled, not runtime drop-in. Hive is a workspace/npm package added to Multica's existing `transpilePackages` composition pattern, imported through one route group and one nav slot; the backend adds one `cmd/server/router.go` anchor mounting `/api/plugins/hive/` inside the existing authenticated route group; auth and WebSocket behavior are inherited through the current frontend rewrites and backend auth group; fork maintenance stays low only if Hive keeps most logic out-of-tree and owns its own datastore. Evidence: `.pHive/epics/multica-plugin-ui/docs/design-discussion-brief.md:34-39`, `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:35-52`, `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:54-60`, `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:84-89`, `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:108-128`.

## 1. Forks

### Fork 1 - Datastore: own-store vs Multica-DB

**Option A: Add Hive tables to Multica DB migrations.**

- Trade-offs: simplest conceptual integration with the core server database, but it puts Hive tables into Multica's numbered migration stream and generated DB surface.
- Evidence: the migration runner scans the shared migrations directory (`server/internal/migrations/migrations.go:13-16`, `server/internal/migrations/migrations.go:58-69`), records migration basenames in core `schema_migrations` (`server/cmd/migrate/main.go:46-56`, `server/cmd/migrate/main.go:105-109`), and sqlc reads that migrations directory as schema input (`server/sqlc.yaml:3-10`).
- Concern: any Hive table added here becomes part of core migration review and core generated DB shape.

**Option B: Reuse Multica `schema_migrations` with a Hive naming convention.**

- Trade-offs: avoids direct numeric filename collision only by convention, but still modifies the core migrations directory and generator input.
- Evidence: the runner sorts filenames lexicographically (`server/internal/migrations/migrations.go:64-68`), while existing duplicate-number migrations show humans and automation can interleave same-number files: `server/migrations/084_squad.up.sql`, `server/migrations/084_task_usage_dashboard_rollup.up.sql`, multiple `091_*.up.sql` files, and paired duplicate `095`/`096` files.
- Concern: this keeps merge/review friction in `server/migrations` instead of removing it.

**Option C: Hive owns its datastore.**

- Trade-offs: requires a plugin-local migration ledger and explicit references to Multica UUIDs instead of implicit ownership by core tables, but removes Hive from Multica's numbered migration stream.
- Evidence: the locked investigation already calls migrations the main fork-maintenance trap and recommends the plugin own its own datastore to avoid `server/migrations/NNN_*.sql` collisions (`.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:91-97`, `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:108-112`).

**Recommendation: choose Option C, Hive-owned datastore.**

This is the narrowest way to keep the backend fork surface to one route anchor plus build-linked handlers while avoiding recurring migration conflicts. It also makes the Slice-1 proof gate concrete: no files added to Multica's `server/migrations`, and one Hive endpoint writes/reads through Hive-owned storage.

### Fork 2 - Own-store shape: PG schema vs SQLite vs sidecar

**Option A: Same Postgres instance/database, separate `hive` schema.**

- Trade-offs: best operational fit because Multica already runs Postgres/pgx; backup remains inside the existing database volume; Hive can keep a plugin-local `hive.schema_migrations`; same-database transactions remain possible when explicitly sharing a `pgx.Tx`.
- Evidence: Multica constructs one Postgres pool from `DATABASE_URL` in `server/cmd/server/main.go:142-160`, wires it into router construction in `server/cmd/server/router.go:111-142`, and uses pgx in the server (`server/go.mod:16`). Current Docker/self-host deployments already include Postgres (`docker-compose.yml:3-13`, `docker-compose.selfhost.yml:21-32`).
- Concern: schema permissions and repository boundaries must prevent accidental writes to core tables.

**Option B: SQLite file store.**

- Trade-offs: best standalone local-development story, but weakest production fit: separate backups, file placement concerns, different observability, no practical transaction boundary across Multica Postgres and SQLite, and possible concurrent-write ceilings.
- Evidence: Multica is already Postgres-first through pgx and sqlc (`server/go.mod:16`, `server/sqlc.yaml:3-10`), and no SQLite dependency is present in the scoped `server/go.mod` evidence.

**Option C: Sidecar service.**

- Trade-offs: strongest isolation and independent scaling, but highest deployment cost: another image, network hop, healthcheck, auth boundary, backup target, observability target, release artifact, and new latency/failure modes.
- Evidence: self-host deployment is already backend/frontend/Postgres with a single backend `DATABASE_URL` (`docker-compose.selfhost.yml:39-92`).

**Recommendation: choose Option A, same Postgres database with a separate `hive` schema.**

This satisfies the goal without adding a new service or storage engine: no core numbered migration file, no SQLite production drift, no sidecar deployment footprint, and a plugin-local migration ledger under `hive.*`.

### Fork 3 - Sequencing: loader-PR-first vs fork-first

**Option A: Loader-PR-first.**

- Trade-offs: lowest long-term fork surface if upstream accepts a generic loader seam, but highest review latency and coordination cost; it asks upstream to accept an abstraction before Hive proves the exact route/package/nav/skills shape.
- Evidence: the current frontend package anchor is one additive config list in `apps/web/next.config.ts:27`; backend route integration lives under the authenticated group at `server/cmd/server/router.go:303-304`, with explicit route mounts nearby at `server/cmd/server/router.go:541-587`.

**Option B: Fork-first.**

- Trade-offs: fastest iteration and best for proving Hive-specific assumptions; carries a small anchor patch set during rebases.
- Evidence: existing build-time composition is additive (`apps/web/next.config.ts:27`), and backend auth inheritance comes from placing routes under the protected group (`server/cmd/server/router.go:303-304`).

**Option C: Fork-first, then upstream a proven minimal loader seam.**

- Trade-offs: preserves Slice-1 iteration speed, collects concrete evidence for an upstream PR, and still leaves one later extraction/review cycle.
- Evidence: no generic plugin registry or dynamic route scan is visible in the scoped router evidence; APIs are mounted explicitly (`server/cmd/server/router.go:541-587`).

**Recommendation: choose Option C.**

Start fork-first for Slice 1, keep anchors intentionally generic-looking, then upstream only after the Hive route/package/nav/skills shape is proven. This balances iteration speed against merge risk and avoids blocking on abstract loader review before the real anchor surface is validated.

### Fork 4 - Skills discovery: DB-registered vs runtime-local vs hybrid

**Option A: DB-registered plugin skills.**

- Mechanism: plugin install/seed/import creates workspace `skill` and `skill_file` rows and optionally attaches them through `agent_skill`.
- Trade-offs: best native discoverability and assignment because current handlers already speak this model; however plugin install writes into Multica workspace data and creates version/update ambiguity.
- Evidence: `skill` is workspace-scoped and unique by `(workspace_id, name)` with content/config stored in DB (`server/migrations/008_structured_skills.up.sql:4-15`); `skill_file` and `agent_skill` tables exist (`server/migrations/008_structured_skills.up.sql:17-31`); list/create/import/agent assignment handlers are DB-backed (`server/internal/handler/skill.go:212-229`, `server/internal/handler/skill.go:256-307`, `server/internal/handler/skill.go:1582-1660`, `server/internal/handler/skill.go:1750-1838`).

**Option B: Runtime-local only.**

- Mechanism: Hive skills remain in plugin/runtime filesystem; agents discover them through runtime-local list endpoints, and users import selected skills when needed.
- Trade-offs: avoids install-time DB seeding and keeps plugin skills isolated with the plugin, but discovery depends on an online runtime/daemon flow and assignment becomes DB-backed only after import.
- Evidence: runtime-local listing is an async request-store contract and comments require durable shared storage for multi-node deploys (`server/internal/handler/runtime_local_skills.go:46-62`); list initiation requires an online runtime (`server/internal/handler/runtime_local_skills.go:478-495`); daemon reports results back to server (`server/internal/handler/runtime_local_skills.go:580-637`); import materializes DB-backed skills (`server/internal/handler/runtime_local_skills.go:639-764`).

**Option C: Hybrid catalog plus optional DB materialization.**

- Mechanism: Hive ships a versioned skill catalog in the plugin package; Multica exposes those as plugin-provided skills; workspace enable/customize/import materializes DB `skill` and `skill_file` rows only when needed.
- Trade-offs: best install ergonomics and plugin isolation, avoids mandatory DB seeding for every workspace, and still uses existing skill/agent assignment once a skill is active; it requires a small catalog/read-through surface because current APIs are DB CRUD/import or runtime-local, not plugin-catalog discovery.
- Evidence: the DB model can hold active materialized skills (`server/migrations/008_structured_skills.up.sql:4-31`), runtime-local import proves external/local bundles can become DB-backed skills (`server/internal/handler/runtime_local_skills.go:717-731`), and router evidence shows current public APIs are explicit DB/runtime-local routes rather than a plugin catalog (`server/cmd/server/router.go:541-587`).

**Recommendation: choose Option C.**

Treat Hive skills as packaged/versioned catalog entries for discovery, then materialize them into Multica DB when enabled or customized. This preserves plugin version isolation while still converging on the native DB-backed skill and agent-assignment model for active skills.

## 2. Slice-1 proof-gate definition

Slice 1 should prove the decisive remaining backend seam: a build-linked Hive route mount plus Hive-owned storage working end-to-end inside running Multica. The frontend composition and auth/WS inheritance are already grounded by the locked investigation (`.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:35-60`); the backend route-mount plus own-store path is the remaining gate (`.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:70-72`, `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md:125-130`).

**Pass criteria:**

- A single backend anchor mounts `/api/plugins/hive/*` inside the existing authenticated group near `server/cmd/server/router.go:301-305`.
- Hive handlers are build-linked and route through a `HiveStore` boundary.
- Hive creates and migrates a plugin-owned `hive` schema with a plugin-local migration ledger such as `hive.schema_migrations`.
- One authenticated Hive endpoint performs a write/read through `hive.*` tables in running Multica.
- No Hive migration files are added to Multica core `server/migrations`.
- Request auth is inherited from the existing Multica auth group; any workspace/member authorization beyond login is enforced in Hive handlers.
- Startup or readiness behavior reports Hive migration failure instead of silently running against stale schema.

**Fail criteria:**

- Slice 1 requires deep changes to `cmd/server/router.go` beyond the thin route anchor.
- Slice 1 requires adding Hive tables to core `server/migrations` or to Multica sqlc schema input.
- Slice 1 cannot make an authenticated request reach Hive handlers through `/api/plugins/hive/*`.
- Slice 1 cannot complete one durable write/read through Hive-owned storage.
- Slice 1 exposes plugin skills only by mutating every workspace's skill rows at install time, with no version/update semantics.

## 3. inconsistency_risk_signals

- **Vocabulary mismatch:** the researcher issue referred to `migrations/008_structured_skills.up.sql` and `internal/handler/runtime_local_skills.go`, while the actual spike paths are under `server/migrations/` and `server/internal/handler/`.
- **Hidden assumption:** "plugin-provided skills discoverable to agents" could mean browseable packaged catalog, automatic workspace install, runtime-local filesystem discovery, or immediate agent assignment. The recommended hybrid path assumes browseable catalog first and DB materialization only when enabled/customized.
- **Unresolved tension:** loader-PR-first reduces long-term fork surface only if upstream accepts a generic seam quickly; fork-first is more aligned with proving the locked build-time architecture before abstracting it.
- **Versioning risk:** DB-registered plugin skills become workspace-owned rows unique by `(workspace_id, name)` (`server/migrations/008_structured_skills.up.sql:4-15`), so package updates, user customization, overwrite behavior, and provenance need explicit rules.
- **Runtime availability risk:** runtime-local-only discovery depends on an online runtime and daemon result flow (`server/internal/handler/runtime_local_skills.go:478-495`, `server/internal/handler/runtime_local_skills.go:580-637`), which is weaker than an always-browseable plugin skill catalog.
- **Authorization drift risk:** Hive routes inherit login by mount location, but workspace/member constraints still need route-level enforcement (`server/cmd/server/router.go:301-305`).
- **Cross-store transaction risk:** separate schema keeps same-database transaction options open, but developers must not assume Hive and Multica writes are automatically atomic without an explicit shared transaction boundary.
- **Operations visibility risk:** operators need backup/restore and readiness visibility for `hive.*`; otherwise own-store may be missed even though it lives in the same Postgres instance.
