# Design-gate decisions — planning-queue (cluster B)

Locked at the B design gate (2026-06-08), after design-discussion.md + inline grill.

## Gate-1 decisions (composition, locked earlier)
- D1 Orchestrator dep: **two-layer** — queue runs on ephemeral orchestrator; always-on Hermes = later slice.
- D2 Queue storage: **new `planning-queue.yaml`** (separate from triage).
- D3 Visual surface: **label + board-view convention** (no Multica core change).
- D4 Consumption: **kanban-low watermark** (event-driven).

## Gate-2 decisions (design, locked now)
- **G1 Relay architecture:** Hermes **gateway feature + plugin tools**. `hermes-multica` ships Multica tools via `register_tool` (spotify pattern); the long-running blocked/GATE poll lives in the gateway (`gateway/multica_gate_relay.py` + `run.py` hook), reusing the kanban watcher pattern. Rationale: no generic plugin routine API exists.
- **G2 Board-view:** **label-only for v1; board-view deferred.** Ship the `idea-queue` label (buildable). Saved board view = manual/UI nicety, deferred until a Multica API surfaces. Drops the unbuildable half from v1 — honors "no core change."
- **G3 Scale:** **Large** — full H/V planning + structured outline before stories (cross-system Hive+Hermes, net-new plugin).
- **G4 Version bump:** **minor.**

## Fork defaults (orchestrator-resolved, override on request)
- PAT scope: workspace-scoped — comment/assign/label/issue-update.
- Gate re-trigger: relay **explicitly re-dispatches** the leader (no auto-wake assumption).
- Watermark read source: live `multica issue list` depth, capped scan (no cached signal found).
- Label vs both: require **both** `blocked-for-human` label + `@orchestrator GATE:` comment (label = relay signal, comment = question payload).

## Carried risks (from design-discussion §4)
- Multica labels are ID-based → need `resolve_or_create_label(name)` + cache.
- No label filter in `issue list` → poll `status=blocked`, cap scan, client-side filter.
- Python-primary queue vs ESM Multica dispatch → small Python Multica client, bridge to JS only if needed.
- state-dir-resolver not shipped → target `<resolved_state_dir>/planning-queue.yaml`, default `.pHive/planning-queue.yaml`.
