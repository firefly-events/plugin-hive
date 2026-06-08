# Writer task — Horizontal + Vertical planning for planning-queue (cluster B)

You are the **technical-writer** producing TWO documents on branch `feat/planning-queue`. Commit both.

## Read first (all on-branch)
- `.pHive/epics/planning-queue/docs/design-gate-decisions.md` — **locked decisions G1–G4 + fork defaults. Bind to these.**
- `.pHive/epics/planning-queue/docs/design-discussion.md` — the approach (§3), subsystems, risks (§4).
- `.pHive/epics/planning-queue/docs/research-brief.md` + `architect-notes.md` — file-path-grounded surfaces.
- `hive/references/document-templates/horizontal-plan.md` + `vertical-plan.md` — the two templates.

## Bound by these locked decisions
- Relay = **Hermes gateway feature + plugin tools** (G1): `hermes-multica` tools via `register_tool`; poll loop in gateway.
- Visual = **label-only v1** (G2), board-view deferred.
- Watermark feeder = live `issue list` depth, capped scan. Gate = `blocked-for-human` label + `@orchestrator GATE:` comment (BOTH).
- Python-primary queue code; small Python Multica client (don't reuse the ESM dispatch directly).
- Path = `<resolved_state_dir>/planning-queue.yaml`, default `.pHive/planning-queue.yaml`.

## Doc 1 — `horizontal-plan.md` (layer map)
Map every architectural layer this epic touches and the cross-layer dependencies. At minimum these layers (from design-discussion):
1. **Queue store** — `planning-queue.yaml` schema + Python store ops (append/reorder/promote).
2. **Config** — typed `planning_queue` reader in `hive/lib/config.py` (watermark, caps, label names, ready_statuses).
3. **Multica client (Python)** — issue list/create/comment/label/assign with timeout+JSON+error posture mirroring the ESM seam.
4. **Watermark feeder** — read kanban depth → promote top idea when `< N`. Idempotent, one pull/tick.
5. **Gate-elevation contract** — leader posts `@orchestrator GATE:` + `blocked-for-human` label + sets blocked.
6. **hermes-multica plugin** — tool plugin (`plugin.yaml` + `register(ctx)`), tools: multica_post_comment / update_issue / resolve_or_create_label / add_label / list_blocked_gates.
7. **Gateway relay** — `gateway/multica_gate_relay.py` + `run.py` hook: poll blocked/GATE → Slack via `slack.py send()` → ingest thread reply → post `GATE ANSWER:` back → re-dispatch leader. Correlation store (issue/comment ↔ Slack channel/thread_ts).
8. **Docs** — README Quick Start + operations-guide reference for the queue + tunables.

For each layer note: what's net-new vs extends-existing (cite file paths), and which layers it depends on.

## Doc 2 — `vertical-plan.md` (slice cuts)
Cut minimum cross-stack vertical slices, each leaving a working state. Suggested progression (refine as you see fit):
- **Slice 1 — Queue store + config + CLI ops.** `planning-queue.yaml` + typed config + add/list/promote. Working state: a human can seed + inspect the queue.
- **Slice 2 — Watermark feeder.** Python Multica client (read path) + feeder promotes top idea when kanban `< N`. Working state: queue auto-feeds the board.
- **Slice 3 — Gate-elevation contract (leader side).** Leader posts GATE comment + label + blocked. Working state: a blocked planning issue is machine-detectable.
- **Slice 4 — hermes-multica plugin tools.** The Multica tool surface in Hermes. Working state: Hermes can drive Multica (comment/label/list-blocked).
- **Slice 5 — Gateway relay loop.** Poll → Slack → answer-back → re-dispatch. Working state: end-to-end async human-gate over Slack.
- **Slice 6 — Docs + tunables polish.**

For each slice: which layers it spans, its working-state assertion, what's deferred. First slice must be a thin real proof.

Commit both docs to `feat/planning-queue`. Report paths + SHA. Do NOT advance any gate.
