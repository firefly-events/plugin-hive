# Research task — planning-queue epic (cluster B)

> **These files ARE on your checked-out branch `feat/planning-queue`.** Read them FIRST with the Read/cat tool: this file AND `.pHive/proposals/cluster-b-planning-queue-brief.md`. Do not work from the roadmap line alone.
>
> **The 4 design decisions in the brief are LOCKED — do NOT flag them as risks.** Specifically: the rough-idea queue is a **NEW `planning-queue.yaml`**, separate from triage `queue.yaml` — so "autonomous refill conflicts with triage's operator-driven design" is NOT a risk (different queue, different semantics). The visual surface is a **label + saved board-view convention**, not a Multica core UI change — so "no Multica UI tab exists" is expected, not a risk. Your job is to find reuse seams + real conflicts, not to re-open settled choices.

You are the **researcher** for the `planning-queue` epic. Deliver **raw findings** (concrete file paths, schemas, function signatures, gaps) — NOT a formatted brief. The technical writer formats later.

**First read the design brief:** `.pHive/proposals/cluster-b-planning-queue-brief.md` — it carries 4 maintainer-locked decisions. Do NOT re-litigate them. Your job is to find the code surfaces the build will touch.

## What the epic builds (locked)

1. New `planning-queue.yaml` rough-idea store (separate from triage `queue.yaml`).
2. **Kanban-low watermark** feeder: when ready/in-progress count `< N`, promote top idea → kanban.
3. Gate-elevation: a leader posts `@orchestrator GATE: <q>` + sets issue `blocked` + `blocked-for-human` label.
4. `hermes-multica` plugin (templated off Hermes `plugins/kanban/`) + a routine that polls `multica issue list` for blocked/GATE issues → relays to Slack → answer posts back → resume.

## Audit these surfaces — report exact paths + signatures + schemas

1. **Triage queue** — `.pHive/triage/queue.yaml` schema + its reader/writer lib (find the single-writer module). Contrast: what's reusable vs what must be net-new for an idea-feed queue.
2. **Multica dispatch infra** — `hive/lib/multica-story-dispatch/` (index.mjs, episode-sync.mjs). Document `dispatchStoryToPersonas`, `pollTaskUntilTerminal`, `writeMulticaRunEpisode` signatures — this is the reuse seam for the feeder + relay.
3. **Multica CLI surfaces** the build needs: `issue list` (filter by status/label — for kanban-depth count + blocked poll), `issue edit`/label, `issue comment`, `assignee`, board/view, `squad` ops. Note JSON output shapes.
4. **Hermes plugin template** — locate `~/Code/hermes-agent/plugins/kanban/` (or wherever Hermes plugins live). Document plugin structure: manifest, tool definitions, routine/poll registration. This is the `hermes-multica` template.
5. **Hermes Slack relay** — how Hermes posts to Slack (which module/tool); auth surface. Confirm Slack is wired.
6. **state-dir-resolver contract** — how `.pHive/` paths resolve (the resolver lib); where `planning-queue.yaml` path should plug in. Note: resolver is planned-not-shipped — find current `.pHive/` path convention to use until then.
7. **hive.config.yaml tunables** — pattern for adding config knobs (watermark `N`, consumption cap, label names). Show an existing example block.
8. **Label/board conventions** — existing `hive:*` label namespace usage in Multica; whether saved board views exist or are a convention.

## Deliverables

- Raw findings keyed to the 8 surfaces above, with `file_path:line` references.
- **`inconsistency_risk_signals`**: list any places where the locked design collides with existing conventions (e.g. queue-storage duplication, label-namespace clashes, dispatch-infra assumptions). Grill consumes this.
- **context7 validation**: if any external lib/SDK appears (Slack SDK, YAML libs), validate + note confidence. If none, say so.

Work on branch `feat/planning-queue`. Commit findings under `.pHive/epics/planning-queue/docs/` if you write any; otherwise return findings in your final message.
