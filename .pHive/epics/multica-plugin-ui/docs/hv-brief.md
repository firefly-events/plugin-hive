# Squad-leader brief — multica-plugin-ui H/V planning (Phase C)

**You are `tpm`, leader of `planning-team-squad`.** Members: `architect` (codex, gpt-5.5),
`researcher` (codex), `technical-writer` (codex). You run on Claude. **You ORCHESTRATE —
delegate, do not do the work solo.**

### How to delegate (gap-corrected)
For each sub-task **create a FRESH issue assigned to the member at creation**
(`multica issue create --assignee <member> --status todo ...`). A status-flip does NOT
spawn the agent. Capture child ids; poll `multica issue get <id>` to `in_review`/`done`;
read via `multica issue comment list <id>`. Members commit to work_dirs (human reconciles).

## Context — design is LOCKED (read first, on origin `feat/multica-plugin-ui`)
- `.pHive/epics/multica-plugin-ui/docs/requirement-brief.md` — scope: loader + ALL 4 views
  (EpicTree, ReviewGates, PersonalQueue, HermesChat), ONE epic, hard proof gate after Slice 1.
- `.pHive/epics/multica-plugin-ui/docs/mf-investigation.md` — grounded architecture.
- `.pHive/epics/multica-plugin-ui/docs/design-discussion.md` — **4 forks RESOLVED (locked):**
  1. **Hive owns its own datastore** (out of Multica's numbered migration stream).
  2. **Same Postgres instance, separate `hive` schema** + plugin-local `hive.schema_migrations`.
  3. **Fork-first, then upstream a proven minimal seam.**
  4. **Hybrid skills: versioned plugin catalog, materialize to Multica DB on enable.**

Do NOT re-litigate the architecture or the 4 forks. Build the plan ON them.

## The job — produce the horizontal + vertical plans

Delegate (create one fresh assigned issue each):

1. **Horizontal + vertical plan → `architect`.** Two deliverables:
   - **Horizontal layer/component map**: the layers this epic touches —
     (a) frontend plugin package (workspace pkg + `transpilePackages` anchor + route group + nav slot),
     (b) backend route-mount anchor (`/api/plugins/hive/` inside auth group) + build-linked handlers + `HiveStore` boundary,
     (c) Hive-owned datastore (`hive` PG schema + `hive.schema_migrations` ledger),
     (d) skills catalog (versioned in plugin, materialize-on-enable),
     (e) the 4 views (EpicTree, ReviewGates, PersonalQueue, HermesChat),
     (f) fork anchor-patch set + later upstream-seam extraction.
     For each layer: responsibility, key files/seams (cite real paths from `~/Code/spikes/multica`), dependencies.
   - **Vertical slices**: ordered, each independently shippable. **Slice 1 = the proof gate**:
     backend route-mount + `hive` schema/own-store + ONE minimal EpicTree view end-to-end in
     running Multica, hitting the design-discussion §2 pass/fail criteria. Then a slice per
     remaining view (ReviewGates, PersonalQueue, HermesChat), a skills-catalog slice, and an
     upstream-seam-extraction slice (last, per fork 3). Mark the **hard BAIL gate after Slice 1**.
     Each slice: goal, layers touched, acceptance signal, dependencies.

2. **Synthesize → `technical-writer`.** Write two files (commit to branch):
   `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md` and `…/vertical-plan.md`.
   Faithfully render the architect's map + slices; preserve all file:line evidence; do not drop slices.

## Boundaries
- Produce horizontal-plan.md + vertical-plan.md only. Do NOT advance any user gate, do NOT
  write story YAMLs. The human runs the H/V review gate + sign-off locally.
- When children are terminal and both docs committed, post a final summary comment on THIS
  issue: child id + member + status + the slice list (Slice 1 … N with one-line goals).
