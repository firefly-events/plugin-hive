# Writer task — structured outline for planning-queue (cluster B)

You are the **technical-writer**. Produce `.pHive/epics/planning-queue/docs/structured-outline.md` (~1000 lines) per `hive/references/document-templates/structured-outline.md`. Commit to `feat/planning-queue`.

## Read first (all on-branch)
- `.pHive/epics/planning-queue/docs/design-gate-decisions.md` — locked G1–G4 + fork defaults. **Bind.**
- `.pHive/epics/planning-queue/docs/vertical-plan.md` — the **6 slices** (Steps 1–6). Each outline phase maps to one slice.
- `.pHive/epics/planning-queue/docs/horizontal-plan.md` — the 8 layers + dependencies.
- `.pHive/epics/planning-queue/docs/design-discussion.md` + `research-brief.md` + `architect-notes.md` — approach + file-path-grounded surfaces.

## Structure (each outline phase = one vertical slice)

For EACH of the 6 slices, produce a detailed phase section with:
1. **Goal + working-state assertion** (from the vertical plan).
2. **Detailed approach** — concrete steps, citing real file paths from research/architect notes (e.g. `hive/lib/config.py`, `gateway/platforms/slack.py`, Hermes `plugins.py register_tool`, `hooks/common.sh` state-dir).
3. **File manifest** — exact files created/modified, with one-line purpose each. Mark net-new vs extends-existing.
4. **Risk registry** — per-slice risks (pull from vertical-plan §5) + mitigations.
5. **Interfaces/contracts** — function signatures, the `planning-queue.yaml` schema, the Python Multica client surface, the hermes-multica tool schemas, the `GATE ANSWER:` correlation record shape.

Then a global:
6. **File manifest summary** — all files across the epic.
7. **Elicitation (Part 7)** — the team's own stress-test: 6–10 hard questions about the plan with YOUR answers (e.g. "what if a label-create race double-creates `idea-queue`?", "what happens if a GATE answer arrives after the leader task was GC'd?", "how does the feeder avoid promoting the same idea twice under concurrent ticks?"). Answer each — these let the maintainer judge if the thinking is sound.
8. **Decision points (Part 8)** — numbered affirm/change items for the maintainer (anything still genuinely open after the gate decisions; if none, say so explicitly rather than manufacturing).

## Bound by (do NOT reopen)
- Relay = gateway feature + plugin tools (G1). Visual = label-only v1 (G2). Scale Large. Version minor.
- Python-primary queue code; small Python Multica client (not the ESM dispatch).
- Watermark = live `issue list` depth capped scan; gate = `blocked-for-human` label + `@orchestrator GATE:` comment (both); relay re-dispatches leader; workspace-scoped PAT.
- Path = `<resolved_state_dir>/planning-queue.yaml`, default `.pHive/planning-queue.yaml`.

Commit `structured-outline.md` to `feat/planning-queue`. Report path + SHA. Do NOT advance any gate.
