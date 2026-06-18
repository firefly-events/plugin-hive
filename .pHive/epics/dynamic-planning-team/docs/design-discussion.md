# Design Discussion — Dynamic Planning-Team Composition

**Epic:** dynamic-planning-team
**Scale:** Medium
**Methodology:** classic

## Goal

At `/plan` step 1, the orchestrator analyzes the incoming requirement, classifies it
into one or more **work-type tags** (perf, security, ui, data, infra, a11y, …), and
assembles the planning team from a **fixed spine + classification-resolved specialist
slots**. Today the team is a fixed spine plus exactly two hardcoded prose conditionals
(architect, ui-designer). This epic generalizes those two conditionals into an N-way,
config-driven, project-gated, provenance-recorded classification.

The planning team itself becomes a function of *what is being planned* — a security
enhancement, a perf enhancement, and a UI enhancement each draw a different specialist
set into planning, not just into execution.

## Current state (what already exists — do not rebuild)

1. **Spine + conditional slots** already live in `skills/hive/skills/planning-routing/SKILL.md`
   **Step 0.1 (Build Team Composition)**:
   - Spine (always): `researcher`, `technical-writer`, `tpm`.
   - Conditional (prose heuristics): `architect`, `ui-designer`.
   - `planning-routing` already accepts a pre-assembled `assembled_personas` list from the
     caller — *"The caller may pass a completed `assembled_personas` list."*
   - Hard constraint already stated there: **"Backend routing must not change team composition."**

2. **A specialist catalog already exists** — `hive/references/specialist-triggers.md`:
   maps trigger-id → specialist/team + `placement` (`pre-exec | post-exec | append`) +
   `raised_by` + `responds_with`. Entries: `security:plan-audit`, `security:impl-audit`,
   `performance:audit`, `observability:audit`, `ui:major`, `ui:brand-redo`, `ui:animations`,
   `ux:major`. **But this is an *escalation* lifecycle** — specialists raised *at review
   gates* (plan step 4b / 9b) by architect/tpm/ui-designer, added at pre-exec/post-exec/append.
   It is NOT the plan-step-1 *composition* lifecycle.
   - Forward-compat constraint already documented: *"execute branches ONLY on `placement`
     and `responds_with.type` — never on specific trigger IDs."*

3. **Project gate has a home** — `.pHive/project-profile.yaml` (plugin-hive's own profile
   declares `tech_stack: [node, bash, python, sqlite, yaml, markdown]` — no UI surface).

4. **Roster is rich** — `hive/agents/` includes `security-reviewer`, `performance-reviewer`,
   `accessibility-specialist`, `animations-specialist`, `idiomatic-reviewer`,
   `backend-developer`, `frontend-developer`, `architect`, `ui-designer`, plus `test-*`.

## Proposed approach (decisions locked with operator)

### D1 — Extend `specialist-triggers.md` with a composition section (NOT a separate file)

Add a new top-level **`planning_composition:`** section to `hive/references/specialist-triggers.md`,
distinct from the existing escalation `Catalog` list. It maps **work-type tag → planning
specialist persona(s)**. Keeping it in the same file (operator's call) gives one catalog
surface; keeping it in a *separate clearly-labelled section* avoids overloading the
escalation semantics (the existing `placement` values stay escalation-only; composition
entries do not reuse `placement`).

```yaml
# new section in hive/references/specialist-triggers.md
planning_composition:
  schema_version: "1.0.0"
  spine: [researcher, technical-writer, tpm]   # always present
  work_types:
    - tag: architecture
      specialists: [architect]
      project_gate: ~                # no gate — applies everywhere
    - tag: ui
      specialists: [ui-designer]
      project_gate: requires_ui      # suppressed where project has no UI
    - tag: security
      specialists: [security-reviewer]
      project_gate: ~
    - tag: performance
      specialists: [performance-reviewer]
      project_gate: ~
    - tag: accessibility
      specialists: [accessibility-specialist]
      project_gate: requires_ui
    - tag: data
      specialists: [architect]       # data-model work routes to architect in planning
      project_gate: ~
    # extensible — add a row to add a work-type
```

The existing two conditionals (architect, ui-designer) become the `architecture` and `ui`
rows — generalization, not replacement. The escalation `Catalog` list is untouched; a
short cross-reference note links the two sections.

### D2 — New atomic skill `planning-classification`

`skills/hive/skills/planning-classification/SKILL.md`. Invoked by `/plan` at step 1
(atomic external call, matching the grill / design / planning-routing pattern). Contract:

- **Input:** `requirement_summary`, project-profile path.
- **Process:** orchestrator analyzes the requirement → emits 1+ work-type tags →
  reads `planning_composition` map → resolves roster = `spine ∪ (project-gated specialist
  slots for matched tags)`.
- **Invariants:**
  - **Roster-only:** specialists are chosen ONLY from the catalog's declared personas,
    which must resolve to existing `hive/agents/*.md`. Never invent a persona
    (known failure mode: improvised persona → self-implements, bypasses backend routing).
  - **Spine is self-sufficient:** low-confidence / no-match classification →
    spine-only roster. Never block planning on a bad tag. Specialists *augment*.
  - **Project gate:** a work-type whose `project_gate: requires_ui` resolves empty when
    the project profile says no UI (see D3).
- **Output:** `assembled_personas` (list) + `classification` (tags + per-tag reasoning +
  confidence) — handed to `planning-routing` unchanged, and to the provenance writer (D4).

### D3 — Explicit `project_type` gate in `project-profile.yaml`

Add a field (e.g. `project_type: framework | consumer-app | service` and/or a derived
`has_ui: bool`) to `.pHive/project-profile.yaml` and document it in the kickoff/profile
schema. The classification skill reads it to evaluate `project_gate`. plugin-hive's own
profile sets the no-UI value, so `ui` / `accessibility` slots stay empty for hive
self-planning — generalizing today's *"do not add ui-designer for backend work"* prose
into tracked, operator-overridable state.

### D4 — Provenance: `planning_team:` block in `epic.yaml`

`/plan` writes the classification result (matched tags, resolved roster, per-tag reasoning,
confidence, gate decisions) into `epic.yaml` as a `planning_team:` block. This buys back the
visibility that going inline (vs `/triage`) costs: the decision is tracked, auditable, and
operator-overridable. Document the block in `hive/references/story-yaml-schema.md` §6.

### D5 — Wire into `/plan` Phase 0

Replace the prose *"conditional architect/ui-designer selected from the requirement"* in
`/plan` step 1 with the atomic `planning-classification` call; pass its `assembled_personas`
to `planning-routing` (which already accepts a pre-assembled list). `planning-routing`
Step 0.1's prose conditionals are updated to defer to the caller-supplied list (its
default-assembly path can keep the two-conditional fallback for direct callers).

## Risks

| Severity | Risk | Mitigation |
|---|---|---|
| medium | Mis-classification draws wrong specialists → weaker plan | Spine is self-sufficient; specialists only augment. Provenance block makes the call visible + overridable at the confirmation gate. |
| medium | Overloading `specialist-triggers.md` blurs escalation vs composition | Separate top-level `planning_composition:` section; escalation `Catalog` untouched; `placement` not reused for composition. |
| low | Multi-tag requirement pulls a large team | Union-of-specialists, deduped. Operator sees roster at confirmation; can trim. |
| low | New `project_type` field breaks profiles lacking it | Treat absent field as "unknown" → conservative default (ungated tags apply; `requires_ui` slots resolve via tech_stack heuristic fallback or stay empty). |
| low | planning-routing default-assembly path drifts from the catalog | Catalog is the single source; routing's inline two-conditional fallback documented as legacy/direct-caller-only. |

## Dependencies

- `hive/references/specialist-triggers.md` (extend)
- `skills/hive/skills/planning-routing/SKILL.md` (Step 0.1 defers to caller list)
- `skills/plan/SKILL.md` (Phase 0 step 1 wiring + epic.yaml provenance)
- `.pHive/project-profile.yaml` + profile schema (new field)
- `hive/agents/*.md` (roster — referenced, not modified)
- `hive/references/story-yaml-schema.md` §6 (document `planning_team:` block)

## Open questions (for user review)

1. **Tag vocabulary v1** — start set: `architecture, ui, security, performance, accessibility,
   data, infra`. Add/remove any for the first cut?
2. **`project_type` shape** — enum (`framework|consumer-app|service`) + derived `has_ui`, or
   just a boolean `has_ui`? Enum is richer for future gates; boolean is minimal.
3. **Classifier confidence** — is a simple "matched / low-confidence" binary enough for v1
   (drives spine-only fallback), or do you want a per-tag confidence score recorded?
4. **planning-routing legacy fallback** — keep the inline two-conditional default-assembly
   path in planning-routing for non-/plan callers, or make the catalog the *only* path and
   have planning-routing require a caller-supplied `assembled_personas`?

## Forward scope (explicitly OUT of scope for this epic)

`planning-classification` is a **planning-time** skill consumed by the local `/plan`
orchestrator. Today that is correct: planning runs on the laptop, only `/execute` runs
through Multica, and `multica-init` exports **agents only** (no skill records). So this
skill needs no Multica-side presence now — it reaches any Multica agent via the
`CLAUDE_PLUGIN_PATH` plugin-mount if ever invoked there.

**But this boundary is temporary.** Operator direction (2026-05-28): (a) Multica bootstrap
should eventually export **skills** too, not just agents; (b) eventually **all** workflows —
planning included — run through Multica. When that lands, `planning-classification` becomes
a skill that must exist Multica-side. Do not bake "planning is always local" assumptions
into the skill's design — keep it a pure function of (requirement, catalog, profile) so it
ports cleanly into a Multica runtime later. Skill-export wiring and planning-in-Multica are
their own future epics; not built here.

## Scale assessment

**Medium.** Multi-file (catalog, new skill, /plan wiring, profile schema, provenance, tests),
multiple layers (config → classification logic → composition wiring → provenance artifact),
single system (the planning skill cluster), no migration. H/V planning would help slice but
the slices are already clear from the locked decisions — recommend proceeding to stories
(`--fast`-equivalent) unless you want explicit H/V.
