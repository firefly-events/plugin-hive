# Research Brief — Hermes as Persistent SDLC Orchestrator

> Status: **research brief** (input for `/plan`, not a finished plan). Produced
> 2026-06-18 from a Studio Multica session that proved `/execute`-on-Multica and then
> deep-dived the hermes-agent framework. Feed this to `/plan` to decompose the
> core-loop MVP into an epic.

## Requirement

Stand up a **persistent orchestrator** for the Hive SDLC running on the Multica
substrate, with **Hermes as the orchestrator process**. The orchestrator does not do the
work — it **monitors, rescues, routes, and gates**. Agents own their per-story work and a
complete self-finalize wrap-up (insights + commit/push). The phase machine:

```
planning → [USER GATE] → implementation → review ⮌(back to impl, orchestrator discretion)
        → simulated-manual testing ⮌(back to impl, orchestrator discretion) → [USER GATE] → ship
```

Orchestrator responsibilities: (1) **watchdog** — detect stuck Multica tasks, rescue;
(2) **phase routing** — advance work group→group, loop back on review/SimMan findings at
its discretion; (3) **gatekeeper** — surface the two user gates; (4) **epic finalize** —
open the PR after the **final story** of an epic completes (orchestrator-owned per
`story-yaml-schema` §6.3/§8.2).

## What already exists (reuse, don't rebuild)

- **Phase skills:** `/plan`, `/execute`, `/review`, `/test` (+ shipped `test-mode-actual`
  = SimMan tier), `/ship`. Cycle-state schema (`.pHive/cycle-state/<epic>.yaml`:
  decisions/escalations/phase_records/handoff_log). Loop-back routing (review
  `needs_revision`→`in_progress`→re-dispatch; test dev-standby fix loop). Respawn protocol
  (interactive teammates). Multica autopilots (cron-dispatch). Agent self-finalize
  (insights + commit). Version-bump + PR defined as orchestrator-owned.
- **Multica monitoring:** `pollTaskUntilTerminal` in `hive/lib/multica-story-dispatch/
  episode-sync.mjs` (terminal = completed/failed/cancelled; 30-min wall-clock; transport
  backoff; `onStateTransition`). Episode markers via `writeMulticaRunEpisode`.

## What is missing (the build)

- A top-level **persistent phase-engine** chaining the full pipeline (today `/standup`
  only ties plan+execute; `/ship` is manual). The **autonomous-cycle-loop** runner
  (cycle-state block defined, writer deferred).
- A **Multica-side watchdog** (respawn protocol targets interactive teammates, not daemon
  tasks; the 30-min poll cap is coarse).
- A **pre-ship user gate** (today only infra checks).
- **Hermes gate-relay** (designed in `.pHive/proposals/cluster-b-planning-queue-brief.md`
  + `hermes-integration-mvp`, not built).

## Hermes feasibility — deep-dive findings (`/Users/don/Code/hermes-agent`)

Hermes supplies the orchestrator substrate; augmentation is **tooling + config, not core
changes**:

- **The loop = the cron ticker.** `gateway/run.py:_start_cron_ticker` → `cron/scheduler.py
  :tick()` every 60s; jobs in `~/.hermes/cron/jobs.json` with `next_run_at`, saved output,
  **`context_from`** (read prior tick) and **`script`** pre-check (poll external state, or
  `{"wakeAgent": false}` to skip). The agent loop itself is **turn-based / not autonomous**
  (`agent/conversation_loop.py`) — the cron tick is what makes it a loop.
- **Hermes can drive, not just read.** Cron jobs run the full AIAgent with tools; the
  "reader invariant" is a *plugin-hive convention*, NOT enforced in Hermes. Writes gated
  only by `approvals.cron_mode`.
- **Tools:** `PluginContext.register_tool(...)` (`hermes_cli/plugins.py`); template
  `plugins/spotify/`. No core changes.
- **Gate relay:** gateway platform adapters `send()` + inbound reply routing
  (`gateway/platforms/base.py`, `cron/scheduler.py:_deliver_result`).
- **HTTP:** `httpx`, per-plugin client. **ACP:** server-only — not used; talk to Multica
  via REST.
- Hermes-agent **is installed + running on the Studio** (`/Users/hive/Code/hermes-agent`,
  `~/.hermes/cron/jobs.json`, dashboard :9119).

## Proposed architecture

**A Hermes cron job ticks an idempotent phase-reconciler; cycle-state is the cross-tick
memory; a thin `hermes-multica` plugin exposes Multica actions by shelling to the proven
`multica-story-dispatch` JS lib.** Each tick: read cycle-state + episode markers + Multica
task status → advance ONE step (dispatch next story / write episode marker on terminal /
loop a story back on `needs_revision` / cancel+re-dispatch a stuck task / open the epic PR
after the last story) → write cycle-state → end. Idempotent → robust to crashes; sidesteps
the headless-exit problem (persistence = the ticker, not a long-lived session).

This honors "Hermes as orchestrator" (Hermes runs the reconcile turns, holds the tools,
relays gates) and gets idempotent-tick robustness (the cron ticker is the autonomous-loop
substrate the turn-based agent lacks).

## Core-loop MVP (scope for the first epic)

Build the reconciler engine + watchdog on the proven slice: **implementation → review →
(loop back on findings) → epic-finalize PR**. Components:
- `hive/lib/multica-story-dispatch/cli.mjs` — thin node CLI exposing dispatch/poll/episode/
  status from the existing lib (reuse, don't re-port).
- `plugins/hermes-multica/` (hermes-agent) — `register_tool` wrappers shelling to that CLI
  + reading `.pHive` state: `multica_dispatch_story`, `multica_poll_task`,
  `multica_list_tasks`, `multica_epic_status`, `multica_post_comment`.
- `hive/references/cycle-reconciler.md` — the deterministic phase state-machine runbook the
  cron job executes; state container = the autonomous-cycle cycle-state block.
- Watchdog: in-tick stuck detection (`started_at` vs `stuck_after_seconds`) → cancel +
  re-dispatch.
- Register the Hermes cron job on the Studio (Aqua/Keychain session).

## Deferred follow-ons

Planning phase + its user gate; SimMan phase wired into the loop; pre-ship user gate; full
gate-relay (HiveChat/Slack + `blocked-for-human`); the `planning-queue` feeder
(PLU-287–292). Build after the core loop is proven.

## Open questions for `/plan`

1. Gate-relay surface for MVP: gate-less on a pre-approved epic, or wire HiveChat first?
2. Reconciler state: extend the existing autonomous-cycle cycle-state block, or a new
   reconciler state file?
3. Where the reconciler logic lives: a hive skill the cron prompt invokes, vs a reference
   runbook the cron prompt inlines.
