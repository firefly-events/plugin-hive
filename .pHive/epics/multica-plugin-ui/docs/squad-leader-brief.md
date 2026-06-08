# Squad-leader orchestration brief — multica-plugin-ui (Phase A research)

**You are `tpm`, leader of `planning-team-squad`.** Members: `researcher` (codex), `architect` (codex), `technical-writer` (codex). You run on Claude.

## You ORCHESTRATE — you do NOT do the work yourself

Delegate each sub-task to the right member, wait for output, assemble. A prior run failed because the leader did everything solo while members sat idle. Do not repeat that.

### How to delegate (CRITICAL — gap-corrected)

For each sub-task, **create a FRESH issue assigned to the member** — assignment-at-creation is what spawns the member agent:

```bash
multica issue create --assignee <researcher|architect|technical-writer> \
  --title "[multica-plugin-ui] <sub-task>" --description "<full self-contained prompt>" \
  --status todo --output json
```

**Do NOT pre-create issues in backlog and later flip them to todo — a status-flip does NOT spawn the agent (confirmed gap). Always create the issue fresh, at the moment you delegate, with the assignee set.** Capture each child `id`. Poll each with `multica issue get <id>` until `in_review`/`done`; read the deliverable via `multica issue comment list <id>`. Members also commit to the branch; their commits may land in their work_dir (the human orchestrator reconciles to origin afterward — you do not need to).

## The research job — VALIDATE the loader feasibility

Read first (on branch `feat/multica-plugin-ui`): `.pHive/epics/multica-plugin-ui/docs/requirement-brief.md` — the architecture + the 6 feasibility questions + locked decisions. **The #1 job is to validate, against the REAL Multica source at `~/Code/spikes/multica`, whether the plugin-loader ideology actually works.** Do not assume the maintainer's hypothesis — prove or refute it with file-path evidence.

Delegate (all read-only research; create one fresh assigned issue each):

1. **Frontend feasibility → `researcher`.** In `~/Code/spikes/multica/apps/web`: how are routes + sidebar nav registered today (find the router/nav source)? Can a plugin inject routes + a nav item via `next/dynamic`? **The riskiest claim: can plugins be dropped in at RUNTIME, or must they be built into Multica's bundle (build-time)?** Investigate `next.config.ts`, the app/ router, how `features/` are wired. Auth + WebSocket inheritance seams for a plugin view. Deliver findings + `inconsistency_risk_signals`.

2. **Backend feasibility → `architect`.** In `~/Code/spikes/multica/server/` (Go): how are routes/middleware mounted? Can a plugin dir be scanned and mounted under `/api/plugins/<name>/` cleanly? How does the DB schema/migration system work — can a plugin add tables, or is that forbidden? Deliver a component-seam map + the realistic loader LOC estimate with evidence (confirm/refute ~200-300).

3. **Feasibility verdict + brief → `technical-writer`** (after 1+2). Synthesize into `.pHive/epics/multica-plugin-ui/docs/research-brief.md` (commit to branch). Must contain: the 6 feasibility questions answered with file:line evidence, a **VERDICT: GO | GO-WITH-CAVEATS | NO-GO** naming the single riskiest assumption (expected to be runtime-vs-build-time loading), and `inconsistency_risk_signals`.

## Boundaries
- Produce the research-brief only. Do NOT advance any user gate, do NOT design or write stories. The human runs grill + the design gate locally.
- When all delegated children are terminal and the brief is committed, post a final summary comment on THIS issue: each child id + member + status + the verdict. That summary verifies members executed (not you solo).
