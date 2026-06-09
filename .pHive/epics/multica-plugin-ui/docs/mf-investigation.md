# Module Federation investigation — multica-plugin-ui

**Date:** 2026-06-09. **Question:** Does Module Federation (MF) rescue a runtime-ish
plugin-load in Multica's Next.js app, reducing fork surface vs build-time bundling?
**Verdict: NO — MF is dead here.** But the investigation surfaced the *right* build-time
seam, which strengthens the fork-maintainability case.

## Evidence (real source: `~/Code/spikes/multica/apps/web`)

| Fact | Value | Source |
|---|---|---|
| Next.js | `^16.2.5` | `apps/web/package.json` |
| Router | App Router (`app/` with `(auth)`,`(landing)`,`[workspaceSlug]`,`layout.tsx`; no `pages/`) | `apps/web/app/` |
| Bundler | Turbopack-default (Next 16); no `webpack()` hook in config | `apps/web/next.config.ts` |
| Build system | Turborepo + pnpm workspaces | root `package.json`, `transpilePackages` |
| Workspace pkgs | `@multica/core`, `@multica/ui`, `@multica/views` | `transpilePackages` |
| Existing MF | none | grep clean |

## Why MF fails — 3 independent blockers, each near-fatal alone

1. **App Router / RSC incompatibility.** MF is a client-side webpack-runtime construct.
   It never properly supported the App Router — React Server Components can't be
   federated (the federated remote is a client runtime; RSC boundaries fight it).
   This blocker alone refutes MF for this codebase.
2. **Turbopack.** Next 16 defaults to Turbopack for dev + build; MF requires webpack,
   which Next 16 is deprecating. `@module-federation/nextjs-mf` does not support App
   Router or Turbopack.
3. **Bleeding-edge Next 16.** Any community MF recipe targets Next 13/14 **Pages**
   Router. Nothing targets Next 16 App Router.

Net: MF does not enable runtime drop-in. It is refuted harder than `next/dynamic`
(which the squad research already refuted). Do **not** spend a squad spike on MF —
this file is the spike.

## The seam the investigation DID find (the good news)

Multica's web app is **already assembled from workspace packages** via
`transpilePackages: ["@multica/core","@multica/ui","@multica/views"]` (Turborepo +
pnpm `workspace:*`). The plugin model that fits Multica's **actual idiom**:

> **Hive plugin = a workspace/npm package** the fork adds to `transpilePackages` and
> imports. Build-time-bundled (as the research verdict concluded), but riding an
> **existing composition pattern**, not a bolted-on dynamic loader.

Fork diff for the frontend collapses to:
- add the plugin package to the workspace (or as a versioned dep), and to `transpilePackages`;
- **anchor edits only:** one route group + one nav slot importing from the plugin package.

That is the **thin-anchor + fat-new-files** shape — fat logic lives in the out-of-tree
plugin package; the fork touches a handful of anchor lines. This is the auto-mergeable
fork profile (low upstream-collision surface; `transpilePackages` and the route-group
structure are not violently churned upstream).

## Bonus finding — auth + WebSocket inheritance is FREE

`apps/web/next.config.ts` `rewrites()` already proxies `/api/:path*`, `/ws`,
`/auth/:path*`, `/uploads/:path*` → the Go backend (`REMOTE_API_URL`). A plugin view
rendered inside the Next app inherits session + WebSocket **by construction**
(same origin, same cookies, same `/ws`). Feasibility-question 3 (auth/WS inheritance)
= **real seam, not hand-wave.**

## Implications for the feasibility gate

- **Frontend loader is NOT runtime drop-in** (MF + `next/dynamic` both refuted) — it is
  **build-time workspace-package composition.** Lock this as the architecture.
- **Frontend fork surface is small + additive-leaning** (package + `transpilePackages` +
  2 anchor edits) → fork stays auto-mergeable; upstream auto-pull is low-risk for the
  frontend half. Strengthens "fork isn't a big deal."
- **Auth/WS = free** via existing rewrite proxy. One less risk.
- **Still open:** the Go backend half (route mount under `/api/plugins/<name>/`, plugin
  DB migrations) — research flagged this as the heavier, CORE-Multica-change side. The
  backend, not the frontend, is now the dominant fork-surface + maintenance risk.

## Backend findings (real source: `~/Code/spikes/multica/server`, Go 1.26.1)

| Fact | Value | Source |
|---|---|---|
| Router | `go-chi/chi/v5` v5.2.5 | `go.mod`, `cmd/server/router.go` |
| Route registration | imperative, single `router.go` (~431+ lines, `r.Route` chains + middleware groups). No plugin registry, no dynamic scan. | `cmd/server/router.go` |
| Migrations | numbered sequential SQL (`migrations/001..088`, `.up/.down` pairs) run by `cmd/migrate` | `server/migrations/` |
| Auth/WS | `middleware.Auth(queries,patCache)` group + `internal/realtime` hub | `router.go:303`, `internal/realtime` |
| Go plugin loading | none (Go `plugin` pkg is Linux-only/toolchain-locked/unused) → handlers must be build-time-linked | — |

**Route mount = feasible, low-collision.** One anchor edit:
`r.Route("/api/plugins", hive.Router())` inside the existing
`r.Group(middleware.Auth...)` block + build-time-linked Go handlers. Plugin routes
inherit auth **free** by living inside the authed group. `router.go` is upstream-hot,
but a single append-point line rarely conflicts. Confirms build-time (not runtime);
research's ~150-500 backend LOC is plausible.

**Migrations = THE real fork-maintenance trap.** Numbered sequential files collide on
**every** upstream update (upstream adds `089_x.up.sql`, fork adds `089_hive.up.sql` →
number collision each merge). This is the single worst recurring fork hazard — and it
is **avoidable by design:** resolve the open fork (requirement-brief "plugin DB tables
in Multica's DB vs Hive plugin owning its own store") toward **Hive plugin owns its own
datastore.** Then the plugin never touches Multica's migration sequence → zero collision.

## Net feasibility picture (both halves now grounded)

| Dimension | Verdict |
|---|---|
| Runtime drop-in | **DEAD** — frontend (MF + `next/dynamic`) and backend (no Go runtime plugin) both refuted. Build-time confirmed both sides. |
| Frontend fork surface | **SMALL** — workspace package + `transpilePackages` + 2 anchor edits (route group, nav slot). Auto-mergeable. |
| Backend fork surface | **SMALL–MODERATE** — one `router.go` anchor + build-linked handlers. |
| Migrations | **MODERATE risk → de-risked by own-store choice** (the one design decision that removes the worst hazard). |
| Auth / WebSocket | **FREE** both sides (frontend rewrite proxy + backend authed route group). |

**"Fork isn't a big deal" — TRUE, conditional on two design choices:**
1. Plugin lives **out-of-tree** on both halves (fat-new-files in the plugin package /
   module; fork holds only thin anchors).
2. Plugin **owns its own datastore** (no entry in Multica's numbered migration stream).

Make those two choices → upstream auto-pull is genuinely low-maintenance; conflicts are
limited to ~2-3 anchor lines that upstream rarely churns.

## Recommendation — GO-WITH-CAVEATS (caveats now fully specified + de-risked)

Proceed **build-time**, architecture locked:
- Frontend: Hive plugin as a **workspace/npm package** added to `transpilePackages` +
  imported at one route group + one nav slot. (Not runtime drop-in — that's dead.)
- Backend: one `router.go` anchor mounting `/api/plugins/hive/` inside the auth group;
  Go handlers build-linked; **plugin owns its own datastore** (no Multica migration entry).
- Auth/WS: inherited free both sides — no new work.

**Re-aim Slice 1's proof gate at the backend route-mount + own-store pattern**, since the
frontend composition + auth/WS are now well-understood. Slice 1 (loader + EpicTree
end-to-end) proves the decisive remaining unknown: a plugin mounting its own routes +
own store inside Multica without invasive core surgery. If that holds → proceed views
2-4 in the same epic. If it requires deep `router.go`/migration surgery → bail per the
locked gate.
