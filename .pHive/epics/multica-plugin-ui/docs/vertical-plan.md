# Vertical Planning - Slice Plan

This plan cuts the horizontal map into commit-worthy slices. Slice 1 is the proof gate and the hard stop point if the backend route-mount plus Hive-owned storage does not hold inside running Multica.

**Source inputs**
- `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md`
- `.pHive/epics/multica-plugin-ui/docs/design-discussion.md`
- PLU-303 architect comment on issue `33a51d93-5809-4f53-a953-b2d2ea143283`

## 1. Slicing Strategy

STRATEGY:
- Total horizontal items: 9 layer entries with 4 distinct views and one catalog path
- Planned slices: 6
- First slice goal: prove `/api/plugins/hive/*` reaches build-linked handlers, writes and reads through Hive-owned storage, and renders minimal EpicTree end-to-end in running Multica
- Final slice goal: prove the full Hive surface set, including skills catalog and the upstream seam extraction, after the proof gate has already passed

SLICING RATIONALE:
- The horizontal map says the decisive unknown is not the frontend shell or auth inheritance; it is whether the backend route mount and Hive-owned datastore can work without deep core surgery.
- Slice 1 therefore bundles the backend route anchor, HiveStore, Hive schema, and one minimal EpicTree flow so the team can fail fast before investing in the remaining views.
- The remaining slices are grouped by user-facing surface so each one adds one working capability without reopening prior work.
- The skills catalog is intentionally a separate slice because it exercises a different materialization path into the existing Multica skill tables.
- The upstream seam extraction is last because it should be based on observed evidence, not speculation.
- Slice 1 is the proof gate and the hard BAIL point.

## 2. Vertical Slice Plan

## Step 1: Proof gate - backend route-mount + HiveStore + minimal EpicTree

WHAT WORKS AFTER THIS STEP:
- An authenticated browser route inside Multica renders a minimal EpicTree view.
- Requests flow through `/api/plugins/hive/*` into build-linked Hive handlers.
- One durable write/read succeeds through `hive.*` tables.
- Hive migration failure is visible at startup or readiness instead of silently running against stale schema.

LAYERS TOUCHED:
- Frontend plugin package: minimal EpicTree client code
- Frontend route and nav anchors: one EpicTree route and one sidebar entry
- Auth/session/WebSocket inheritance: reused, not reimplemented
- Backend route mount: `/api/plugins/hive/*` mounted inside the authenticated chi group
- HiveStore persistence boundary: minimal typed read/write API
- Hive Postgres schema: `hive.schema_migrations` and `hive.epic_nodes`

NOT YET:
- ReviewGates view
- PersonalQueue view
- HermesChat view
- Skills catalog
- Upstream seam extraction
- Broad polish or extra generic loader abstraction

VERIFIED BY:
- Manual authenticated browser check that the EpicTree route renders inside the dashboard shell
- Integration check that one `hive.epic_nodes` write/read succeeds
- Startup/readiness check that schema failure is surfaced
- File review that no Hive tables were added to Multica `server/migrations`

COMMIT REPRESENTS:
- Backend route mount + Hive-owned store + minimal EpicTree proof gate

HARD BAIL:
- Stop the epic if this slice requires deep router surgery, adds Hive tables to core migrations, fails to inherit auth, or cannot complete a durable write/read through Hive-owned storage.

---

## Step 2: ReviewGates view

BUILDS ON:
- Step 1

WHAT WORKS AFTER THIS STEP:
- A user can list review gates for an epic, inspect evidence, and update gate state through the same authenticated Hive API boundary.

LAYERS TOUCHED:
- Frontend plugin package: ReviewGates view
- Frontend route and nav anchors: review-gate route entry and sidebar label
- Backend route mount: review-gate handlers
- HiveStore persistence boundary: review-gate read/write methods
- Hive Postgres schema: `hive.review_gates`

NOT YET:
- PersonalQueue view
- HermesChat view
- Skills catalog
- Upstream seam extraction
- Any assumption that the review-gate UI has different auth or store plumbing than EpicTree

VERIFIED BY:
- Integration test for list/detail/update through authenticated Hive API
- Manual check that refreshed state persists after update

COMMIT REPRESENTS:
- ReviewGates end-to-end working against Hive-owned storage

---

## Step 3: PersonalQueue view

BUILDS ON:
- Step 1

WHAT WORKS AFTER THIS STEP:
- The current user sees an authorized queue of Hive work items with links back to epic and gate context.

LAYERS TOUCHED:
- Frontend plugin package: PersonalQueue view
- Frontend route and nav anchors: queue route entry and sidebar label
- Backend route mount: queue handlers
- HiveStore persistence boundary: queue read/update methods
- Hive Postgres schema: `hive.personal_queue_items`

NOT YET:
- HermesChat view
- Skills catalog
- Upstream seam extraction
- Any change to the proof-gate assumptions from Step 1

VERIFIED BY:
- Integration test that queue items are filtered by current user and workspace authorization
- Manual check that links resolve to related Hive or Multica records

COMMIT REPRESENTS:
- PersonalQueue surface with Hive-owned data and user-scoped visibility

---

## Step 4: HermesChat view

BUILDS ON:
- Step 1

WHAT WORKS AFTER THIS STEP:
- A user can create or select a thread, send and read persisted messages, and use the chosen refresh or realtime behavior for Hive chat.

LAYERS TOUCHED:
- Frontend plugin package: HermesChat view
- Frontend route and nav anchors: chat route entry and sidebar label
- Backend route mount: chat handlers
- HiveStore persistence boundary: thread/message methods
- Hive Postgres schema: `hive.hermes_threads` and `hive.hermes_messages`

NOT YET:
- Skills catalog
- Upstream seam extraction
- Any claim that chat requires a new auth model or a second WebSocket stack

VERIFIED BY:
- Integration test for thread create/send/read through authenticated Hive API
- Manual verification of the chosen refresh or realtime behavior

COMMIT REPRESENTS:
- HermesChat persisted messaging inside Multica

---

## Step 5: Skills catalog

BUILDS ON:
- Step 1
- The existing Multica skill tables and handlers

WHAT WORKS AFTER THIS STEP:
- Hive ships a versioned catalog that is browseable before materialization.
- Enable, customize, or import materializes selected skills into Multica DB-backed skill tables with provenance.

LAYERS TOUCHED:
- Skills catalog packaging in the Hive plugin
- Backend route mount: catalog and materialization endpoints
- HiveStore persistence boundary: catalog state and materialization tracking
- Hive Postgres schema: `hive.plugin_skill_catalog_state`
- Existing Multica skill tables and handlers: `skill`, `skill_file`, and `agent_skill`

NOT YET:
- Upstream seam extraction
- Any assumption that every workspace should be auto-seeded at install time
- Any assumption that runtime-local discovery alone is enough for active skills

VERIFIED BY:
- Catalog browse check without requiring an online runtime
- Materialization check that selected skills create Multica `skill` and `skill_file` rows
- Assignment check that existing agent-skill logic works after materialization

COMMIT REPRESENTS:
- Hybrid skills catalog with explicit materialization into Multica DB

---

## Step 6: Upstream seam extraction

BUILDS ON:
- Steps 1-5

WHAT WORKS AFTER THIS STEP:
- The concrete Hive-specific anchors still work, but the generic seam is isolated enough to propose upstream without carrying speculative loader work.

LAYERS TOUCHED:
- Frontend route and nav anchors: generic path/nav seam
- Backend route mount: generic plugin mount seam
- Documentation and tests: proof-backed seam description

NOT YET:
- Any new Hive capability
- Any promise that the generic seam is worth upstreaming unless the evidence from prior slices supports it

VERIFIED BY:
- Rebase-oriented review that the fork diff is smaller or more stable
- Functional check that Hive still works after the seam extraction

COMMIT REPRESENTS:
- Proven generic seam extracted from the Hive-specific implementation

## 3. Overlay Diagram

```text
VERTICAL SLICE OVERLAY
────────────────────────────────────────────────────────────────────────────────────────────────────────

Layer / Slice                  │ Step 1 │ Step 2 │ Step 3 │ Step 4 │ Step 5 │ Step 6
───────────────────────────────┼────────┼────────┼────────┼────────┼────────┼────────
Frontend plugin package        │ EpicTree│ ReviewGates │ PersonalQueue │ HermesChat │ Catalog UI/hooks │ Generic seam
Frontend route and nav anchors │ route+nav│ review nav │ queue nav │ chat nav │ catalog nav │ seam extraction
Auth/session/WS inheritance    │ inherited│ inherited │ inherited │ inherited │ inherited │ inherited
Backend route mount            │ /api/plugins/hive/* + handlers │ review routes │ queue routes │ chat routes │ catalog routes │ generic mount seam
HiveStore                      │ minimal read/write │ gate methods │ queue methods │ chat methods │ catalog methods │ seam helper
Hive Postgres schema           │ hive.schema_migrations + hive.epic_nodes │ hive.review_gates │ hive.personal_queue_items │ hive.hermes_threads/messages │ hive.plugin_skill_catalog_state │ no new tables
Skills catalog                 │ not yet │ not yet │ not yet │ not yet │ browse + materialize │ no new catalog
Four Hive views                │ minimal EpicTree │ ReviewGates │ PersonalQueue │ HermesChat │ view-independent catalog UI │ no new view
Fork anchors                   │ proof anchor │ stable anchor │ stable anchor │ stable anchor │ stable anchor │ upstream seam
────────────────────────────────────────────────────────────────────────────────────────────────────────

Step 1 is the proof gate and the hard stop if the backend mount plus Hive-owned storage does not hold.
```

## 4. Deferred Items

DEFERRED (not in the current slice plan):
- Any extra generic plugin loader abstraction before Step 1 proves the route/store seam
- Any automatic workspace seeding of skills at install time
- Any second auth or WebSocket model for Hive
- Any speculative upstream PR before the concrete seam exists

RATIONALE:
- These items either depend on proof from earlier slices or would pull the team into speculative infrastructure before the decisive backend gate is known.

## 5. Risk by Slice

RISK PER SLICE:
- Step 1: High - first contact with the backend route-mount and storage seam; the proof gate can fail fast if deep surgery or core migration changes are required
- Step 2: Medium - first gate workflow beyond EpicTree; the main risk is response-shape drift or UI/data mismatch
- Step 3: Medium - user-scoped queue logic can expose authorization or filtering mistakes
- Step 4: Medium - chat history and refresh behavior can reveal persistence or latency issues
- Step 5: Medium - materialization can create version or provenance conflicts with existing Multica skills
- Step 6: Low to medium - seam extraction is mostly architectural cleanup, but it can expose hidden coupling if earlier slices were not kept thin

## 6. Moldability Notes

- Steps 2, 3, and 4 can be reordered after Step 1 if the product owner changes priority, because they all build on the same proven route/store seam.
- Step 5 can stay last if the team wants to keep the plugin surface focused on core views first.
- Step 6 should remain last unless the upstream seam becomes an explicit blocker.
- If Step 1 fails, the plan should stop rather than being stretched into a heavier platform project.
- If a later slice reveals that chat needs a different realtime policy, Step 4 can split into persistence and delivery sub-slices without invalidating the rest of the plan.
- If the skills catalog proves more complex than expected, Step 5 can split into browse and materialize sub-slices while still depending on the same proof-gated backend seam.
