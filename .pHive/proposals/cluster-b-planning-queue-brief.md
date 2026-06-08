# Cluster B — Autonomous Planning Queue + Human-Gate Elevation (planning brief)

**Status:** design input for `/plan` (Multica-driven). Seeds the epic. Substitutes the deferred squad-orchestration + Hermes-marriage proposal.
**Branch:** `feat/planning-queue` off `develop`. **Triage:** t-004.
**Date:** 2026-06-08.

## North star

A rough-idea queue that auto-feeds the kanban when it runs low, plus a human-gate elevation path so an in-flight planning/execution squad can ask the maintainer a question asynchronously (via Hermes → Slack) and resume on the answer — without a human babysitting the board.

## Maintainer-locked design decisions (2026-06-08)

1. **Two-layer build (orchestrator dep).** Queue mechanics + gate-elevation are designed to run on **today's ephemeral orchestrator**. An always-on Hermes orchestrator-agent is a **separate later slice**, not a blocker. B must function before it exists.
2. **New dedicated queue store.** Rough ideas live in a **new `planning-queue.yaml`**, NOT the triage `queue.yaml`. Triage = bug/feature intake with its own 5-state lifecycle; the idea-feed queue has different (consumption-fed) semantics. Keep separate.
3. **Visual tab = convention, not core.** Surface the queue via an **`idea-queue` label + a saved Multica board view**. **Zero Multica core change.** A real dedicated tab is deferred unless the convention proves insufficient.
4. **Kanban-low watermark trigger.** Consumption is **event-driven**: when ready/in-progress count `< N`, pull the next idea from the queue into the kanban. Tunable via watermark `N` (empty-always = high N; very-slow = low N). NOT cron-cadence.

## Scope (in)

- **Queue store** `planning-queue.yaml`: schema for a rough idea (id, title, sketch, priority, source, added-at, status). Append + reorder + promote operations.
- **Watermark feeder**: reads kanban depth (Multica `issue list`), compares to `N`, promotes top idea → kanban planning intake when below watermark. Idempotent; one pull per tick.
- **Gate-elevation glue** (two-layer layer 1, ephemeral): a planning/execution leader recognizes an open question it can't resolve → posts `@orchestrator GATE: <question>` comment + sets the Multica issue `blocked` + applies `blocked-for-human` label.
- **Hermes relay seam** (`hermes-multica` plugin): template = Hermes `plugins/kanban/`. Gives Hermes tools to drive Multica (comment / assign / squad ops) + a routine that polls `multica issue list` for `blocked` / `GATE` issues and **relays to Slack** (Slack is live via Hermes). Maintainer answers async → answer posts back as a Multica comment → re-triggers the leader → work resumes.
- **Tunables**: watermark `N`, queue consumption cap per tick, label names — surfaced in `hive.config.yaml`.

## Scope (out / deferred)

- Always-on persistent Hermes orchestrator-agent (separate later slice).
- Multica core UI tab (convention-first; revisit only if labels+board-view insufficient).
- Auto-generation of ideas (queue is human-seeded for v1; consumption tunable, production not).
- Dynamic ephemeral per-epic squad creation as a hard requirement (viable per squad-dispatch-spike correction, but not gated on for v1).

## Dependencies

- **C (language ADR): DONE** — Option B Python-first + bridges. New B code follows the Python-primary direction.
- **state-dir-resolver: planned, not shipped.** B's `planning-queue.yaml` path should resolve via the state-dir-resolver contract once shipped; until then use the current `.pHive/` convention. Do NOT hard-block B planning on it.
- **Hermes/Multica glue:** the `hermes-multica` plugin is net-new in this epic.

## Open forks for the design gate (squad to surface)

- `hermes-multica` plugin auth: which PAT scope drives comment/assign/squad ops? (owner/admin PAT per runtime squad ops.)
- Re-trigger mechanism: does a maintainer answer-comment auto-wake the leader, or does the relay routine re-dispatch the leader task? (two-layer: ephemeral re-dispatch likely.)
- Watermark read source: poll `multica issue list` count vs a cached depth signal — cost/latency tradeoff.
- `blocked-for-human` vs `GATE:` comment — are both needed, or is the label sufficient signal for the relay poll?

## Suggested slices

1. Queue store + schema + CLI ops (`planning-queue.yaml`).
2. Watermark feeder (kanban-low → promote).
3. Gate-elevation contract (leader-side: comment + label + blocked).
4. `hermes-multica` plugin (Multica-drive tools, templated off kanban plugin).
5. Hermes relay routine (poll blocked/GATE → Slack → answer-back → resume).
6. Config tunables + docs (README Quick Start + operations-guide Commands Reference).
