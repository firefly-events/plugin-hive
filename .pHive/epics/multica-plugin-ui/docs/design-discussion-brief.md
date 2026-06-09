# Squad-leader brief — multica-plugin-ui design-discussion (Phase B)

**You are `tpm`, leader of `planning-team-squad`.** Members: `researcher` (codex),
`architect` (codex), `technical-writer` (codex). You run on Claude.

## You ORCHESTRATE — you do NOT do the work yourself

Delegate each sub-task to the right member, wait, assemble. A prior run failed because
the leader did everything solo while members idled. Do not repeat that.

### How to delegate (gap-corrected — CRITICAL)

For each sub-task, **create a FRESH issue assigned to the member at creation**:

```bash
multica issue create --assignee <researcher|architect|technical-writer> \
  --title "[multica-plugin-ui] <sub-task>" --description "<full self-contained prompt>" \
  --status todo --output json
```

**Do NOT pre-create in backlog then flip to todo — a status-flip does NOT spawn the
agent (confirmed gap). Always create fresh, assignee set, at delegation time.** Capture
each child `id`; poll `multica issue get <id>` until `in_review`/`done`; read deliverables
via `multica issue comment list <id>`. Members commit to the branch (their commits may
land in their work_dir; the human reconciles to origin — you do not need to).

## Context — feasibility is DONE, architecture is LOCKED

Read first on branch `feat/multica-plugin-ui` (already on origin):
- `.pHive/epics/multica-plugin-ui/docs/requirement-brief.md` — goal, locked decisions, the 4 open forks.
- `.pHive/epics/multica-plugin-ui/docs/research-brief.md` — feasibility verdict.
- `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md` — **the grounded architecture. READ THIS.**

**LOCKED (do NOT re-litigate):**
- Runtime drop-in is DEAD (MF + `next/dynamic` refuted; no Go runtime plugin). **Build-time-bundled.**
- **Frontend** = Hive plugin as a workspace/npm package added to Multica `transpilePackages` + imported at one route group + one nav slot. Rides the existing `@multica/core|ui|views` composition idiom.
- **Backend** = one `cmd/server/router.go` anchor mounting `/api/plugins/hive/` inside the existing `r.Group(middleware.Auth...)` block; Go handlers build-linked.
- **Auth + WebSocket = inherited free** (frontend rewrite proxy `/api,/ws,/auth` → Go; backend authed route group). No new work.
- Fork stays low-maintenance via two choices: plugin out-of-tree (fat-new-files) + own datastore.

## The job — develop the 4 REMAINING design forks into gate-ready options

Each fork → 2-3 options, trade-offs, a recommendation with file:line evidence from the
real source at `~/Code/spikes/multica`. These feed the human's design gate.

Delegate (create one fresh assigned issue each):

1. **Datastore forks → `architect`.** Fork (a): Hive plugin tables in Multica's DB vs
   plugin owns its own store. The mf-investigation recommends **own-store** to dodge the
   numbered-migration collision (`server/migrations/NNN_*.sql` — upstream adds `089`,
   fork adds `089` → conflict every merge). Confirm/refute with evidence. Fork (b):
   concrete own-store shape — separate Postgres schema in the same instance (Multica uses
   `pgx`), vs separate SQLite, vs separate sidecar service. Recommend one. Check
   `server/migrations/`, `cmd/migrate/main.go`, `server/pkg/db`, `go.mod` (pgx).

2. **Sequencing + skills forks → `researcher`.** Fork (c): loader-PR-first (upstream a
   generic plugin seam, no Hive mention) vs fork-first (carry the anchor patch set).
   Weigh against how invasive the real anchors are (router.go append-point + transpilePackages).
   Fork (d): skills-dir discovery — how do Multica agents discover plugin-provided skills?
   Check `server/internal/handler/skill.go`, `migrations/008_structured_skills.up.sql`,
   `internal/handler/runtime_local_skills.go`. Is there a skills registry a plugin can add to,
   or must skills be injected another way? Recommend a mechanism.

3. **Synthesize → `technical-writer`** (after 1+2). Write
   `.pHive/epics/multica-plugin-ui/docs/design-discussion.md` (commit to branch). Structure:
   §0 prelude (locked architecture recap, 1 para), §1 the 4 forks each with options +
   recommendation + evidence, §2 Slice-1 proof-gate definition (backend route-mount +
   own-store end-to-end in running Multica), §3 `inconsistency_risk_signals`.

## Boundaries
- Produce design-discussion.md only. Do NOT advance any user gate, do NOT write stories.
- The human runs grill + the design gate locally.
- When all children are terminal and the doc is committed, post a final summary comment
  on THIS issue: each child id + member + status + the per-fork recommendation. That
  verifies members executed (not you solo).
