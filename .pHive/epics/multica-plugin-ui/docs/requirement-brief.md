# Requirement brief — multica-plugin-ui (Hive UI inside Multica)

**Date:** 2026-06-08. **Planning home:** plugin-hive `.pHive/epics/multica-plugin-ui/` (artifacts only). **Impl targets:** a fork of Multica (`~/Code/spikes/multica`) + a new `hive-multica-plugin` repo. **Carrier:** planning-team-squad (cell-as-squad). Local gates stay with the human orchestrator.

## Goal

A unified Hive UI that runs **inside** Multica (one tab, shared auth, shared WebSocket, native look) instead of a separate app. Achieved via a small, generic **plugin loader** added to Multica + a **Hive plugin** that registers views.

## Architecture (maintainer hypothesis — research must VALIDATE against real source)

Multica = Next.js frontend (`~/Code/spikes/multica/apps/web`: app/, components/, features/, platform/, next.config.ts) + Go backend (`~/Code/spikes/multica/server/`). Next.js supports dynamic imports — no formal extension API required; the frontend just needs to know where to look.

**Plugin loader (small change added to Multica, claimed ~200-300 LOC):**
1. **Manifest dir** — Multica scans a configured dir (e.g. `~/.multica/plugins/`) for `manifest.json`.
2. **Dynamic component loading** — frontend reads manifests, `next/dynamic`-imports each plugin's JS bundle; plugin registers routes + UI components.
3. **Backend route mounting** — Go backend scans the same dir for plugin API handlers, mounts under `/api/plugins/<name>/`.
4. **Sidebar "Plugins" section** — each plugin gets a nav item rendering its component.

**Hive plugin repo (`hive-multica-plugin/`):**
```
manifest.json            # metadata, routes, nav items
frontend/  EpicTree.tsx ReviewGates.tsx PersonalQueue.tsx HermesChat.tsx index.tsx
backend/   api.go  migrations/   # Hive tables (epics, gates, ...)
skills/    deploy-to-staging/ review-pr/ ...
```
Sidebar gains: Epics → EpicTree · Review Gates → ReviewGates · My Queue → PersonalQueue · Hermes → HermesChat. Native because they run inside Multica's React app/auth/WebSocket/UI library.

## Locked decisions (maintainer)

- **Scope: loader + ALL 4 views** (EpicTree, ReviewGates, PersonalQueue, HermesChat) in **ONE epic. No V2, no separate plugin epic.**
- **Build piecemeal with a hard PROOF GATE after the first view.** Slice 1 = **loader + EpicTree end-to-end**, running inside Multica. That slice IS the proof the loader ideology works. **Gate after Slice 1:** if the loader doesn't actually work (runtime drop-in fails, route/nav injection needs deep surgery, auth/WS won't inherit), **BAIL** — do not build views 2-4. If it works, proceed through the remaining 3 views in the same epic.
- The research feasibility verdict (below) is the FIRST proof checkpoint; the Slice-1 implementation gate is the SECOND, decisive one.
- **Repo strategy:** plugin loader = standalone **PR to Multica upstream**, framed as *generic plugin infrastructure* (no Hive mention). Hive plugin = **separate repo**. If loader PR merges → plugin just works; if not → maintain loader as a small rebase-friendly **fork patch set**.
- **Dogfood** on the self-hosted Multica instance; working dogfood = the upstream argument.

## THE feasibility question (research's #1 job)

The entire plan rests on "the loader is ~200-300 LOC and generic enough to upstream." **Research must validate this against the real Multica source**, not assume it. Specifically:
1. How does Multica's Next.js app register routes + sidebar nav today? (find the nav/router source in `apps/web`). Is dynamic plugin route injection actually feasible without deep surgery?
2. How does the Go backend (`server/`) mount routes / middleware? Can a plugin dir be scanned + mounted under `/api/plugins/<name>/` cleanly?
3. Auth + WebSocket: how would a plugin view inherit Multica's session + WS? Real seams or hand-wave?
4. DB migrations: can a plugin add tables, or does Multica's schema/migration system forbid it?
5. Build-time vs runtime loading: `next/dynamic` needs the bundle in the build graph — can plugins truly be dropped in at runtime, or must they be built into Multica? (This is the riskiest claim — verify.)
6. Realistic LOC estimate for the loader, with file-path evidence. Confirm or refute the 200-300 figure.

Output a **feasibility verdict**: GO / GO-WITH-CAVEATS / NO-GO, with the riskiest assumption named.

## Open forks for the design gate
- Runtime-drop-in vs build-time-bundled plugins (research may force build-time).
- Plugin DB tables in Multica's DB vs Hive plugin owning its own store.
- Loader-PR-first vs fork-first sequencing (depends on how invasive the loader really is).
- Skills dir in the plugin — how Multica agents discover plugin-provided skills.
