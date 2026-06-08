# Writer task — design-discussion.md for planning-queue (cluster B)

You are the **technical-writer**. Produce `.pHive/epics/planning-queue/docs/design-discussion.md` (~200 lines) per the template at `hive/references/document-templates/design-discussion.md`. Commit it to branch `feat/planning-queue`.

## Read first (all on your checked-out branch)
- `.pHive/proposals/cluster-b-planning-queue-brief.md` — **4 LOCKED decisions. Honor them. Do NOT re-open or list them as risks/open-questions.**
- `.pHive/epics/planning-queue/docs/research-brief.md` — research findings (8 surfaces, file-path grounded).
- `.pHive/epics/planning-queue/docs/architect-notes.md` — component seams, schema sketch, open forks, risks from the architect.

## The design discussion must cover
- **Goal** — autonomous planning queue + human-gate elevation (per the locked brief's north star).
- **Proposed approach** — synthesize research + architect notes into a coherent build: `planning-queue.yaml` store, kanban-low watermark feeder (reuse `multica-story-dispatch` seams), gate-elevation contract (`@orchestrator GATE:` + `blocked-for-human` label), `hermes-multica` plugin (templated off Hermes `plugins/kanban/`, per the `plugins.py` registration API the research found), Slack relay (gateway-owned, since research found NO generic plugin `register_routine` API — call this out as a real constraint shaping the design).
- **Risks** — pull from research + architect (e.g. gateway-owned routines mean the relay can't be a pure directory plugin; `idea-queue` vs `hive` label-prefix tension; state-dir-resolver not yet shipped).
- **Dependencies** — C (done), state-dir-resolver (planned), Hermes glue (net-new).
- **Open forks** — ONLY these four (from the brief): (1) `hermes-multica` PAT scope; (2) gate re-trigger mechanism (auto-wake vs relay re-dispatch); (3) watermark read source (poll `issue list` count vs cached signal); (4) `blocked-for-human` label vs `GATE:` comment — both or label-only. Plus any NEW genuine fork the research/architect surfaced (e.g. relay-as-gateway-feature vs plugin). Do NOT manufacture forks from the locked decisions.
- **Scale assessment** — recommend Small/Medium/Large with rationale (this is multi-component, cross-surface, net-new plugin → likely Medium or Large).

Keep it ~200 lines. This is a draft — grill + the human design gate run after you, locally. Do NOT advance any gate. Commit `design-discussion.md` to `feat/planning-queue` and report the path + SHA in your final message.
