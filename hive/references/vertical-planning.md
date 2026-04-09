# Horizontal + Vertical Planning Methodology

H/V planning is Hive's two-phase approach to decomposing requirements into executable stories. It runs during the planning phase (`/hive:plan`) for medium and large epics. The output is a set of stories that each produce a working, demo-able state.

---

## Why H/V Planning

Horizontal planning tells you WHAT exists across each layer. Vertical planning tells you WHEN to build each piece and in what combination. Together they prevent the two most common planning failure modes:

1. **Missing scope** — "We forgot the search index needed to be updated." Horizontal planning is exhaustive; nothing is missed.
2. **Non-working intermediate states** — "Step 3 of 7 is done but nothing is demo-able." Vertical slices ensure every commit is a working state.

The vertical plan's core invariant: **every slice leaves the product in a working state.** Not "the whole product works" — but "the specific thing this slice built works and can be verified." If a bug appears, it was introduced in THIS slice, not some unknown prior one.

---

## When H/V Planning Runs

Planning scales with the complexity of the request:

| Scope | What Runs |
|-------|-----------|
| **Small** | research → design discussion → stories |
| **Medium** | research → design discussion → **horizontal scan → vertical slice plan** → stories |
| **Large** | research → design discussion → **horizontal scan → vertical slice plan** → structured outline → stories |

H/V planning triggers for medium and large epics. The orchestrator or analyst determines scope from the requirement's breadth (number of layers affected) and depth (lines of code across those layers).

---

## Phase 1: Horizontal Planning Scan

**Skill:** `skills/hive/skills/horizontal-plan/SKILL.md`
**Agent:** TPM (with researcher and analyst input)
**Output:** ~200–400 lines

The horizontal scan maps breadth — what does each architectural layer need overall to fulfill the requirement?

### Document Structure

1. **Layer Inventory** — which layers are affected (frontend, backend API, services, data, infra, external integrations)
2. **Per-Layer Requirements** — exhaustive list of everything each layer needs (name the endpoints, components, tables, services)
3. **Cross-Layer Dependencies** — where layers connect; which items in one layer require something in another
4. **Layer Map Diagram** — ASCII grid of layers (y-axis) × areas (x-axis)
5. **Scope Summary** — total items, new vs modified, effort estimate, riskiest layer

### Key Rules

- Be exhaustive in per-layer requirements — this is the breadth pass
- Name specific things (endpoint path, component name, table name) — not abstractions
- Do NOT suggest execution order — that's vertical planning's job
- The layer map diagram is mandatory; it becomes the canvas for vertical planning

---

## Phase 2: Vertical Slice Plan

**Skill:** `skills/hive/skills/vertical-plan/SKILL.md`
**Agent:** TPM
**Input:** horizontal layer map + design discussion + user feedback
**Output:** ~300–500 lines

The vertical slice plan overlays the horizontal map with execution slices — minimum cross-stack increments that each produce a working, commit-worthy state.

### Document Structure

1. **Slicing Strategy** — the thinnest first slice, logical progression, slice boundaries driven by cross-layer dependencies
2. **Vertical Slice Plan** — one block per slice, each with:
   - WHAT WORKS AFTER THIS STEP — the working state invariant
   - LAYERS TOUCHED — specific items per layer
   - NOT YET — explicitly deferred items (prevents scope creep per slice)
   - VERIFIED BY — how to confirm this slice works (tools, test types, platforms)
   - COMMIT REPRESENTS — one-line commit message
3. **Overlay Diagram** — the horizontal layer map with vertical slice column headers overlaid
4. **Deferred Items** — items from the horizontal scan not in any slice, with rationale
5. **Risk by Slice** — what's most likely to go wrong in each slice
6. **Moldability Notes** — which slices can be reordered or dropped

### Key Rules

- Every slice MUST have WHAT WORKS and VERIFIED BY — these are non-negotiable
- First slice should use dummy/fixture data to prove the concept with minimal integration risk
- Later slices build on earlier ones — never require rework of a completed slice
- Slice count: 3–6 for medium features, 5–10 for large ones

---

## From Vertical Slices to Stories

Each vertical slice becomes one or more Hive stories. The slice's WHAT WORKS statement becomes the story's acceptance criteria. The slice's LAYERS TOUCHED list maps to the story's `key_files` and `files_to_modify`.

**Slice-to-story mapping:**
- One simple slice → one story
- One complex slice → split by domain (frontend story + backend story)
- A slice with a risky integration → add a research story first

The TPM is responsible for this mapping — ensuring the final story set preserves the working-state invariant from the vertical plan.

---

## Integration with the Daily Ceremony

H/V planning runs during the planning phase of the daily ceremony (step after design discussion). The orchestrator triggers it when scope is medium or large:

```
1. /hive:plan — user provides requirement
2. Researcher gathers context
3. Technical writer produces design discussion
4. User reviews and provides feedback
5. TPM runs horizontal planning scan
6. TPM runs vertical slice plan (using horizontal output as input)
7. User reviews vertical plan, approves or steers
8. Agent-ready checklist validates stories from slices
9. User approves → execution begins
```

---

## Example: Horizontal and Vertical Together

**Requirement:** Add unified venue + user + event search to a mobile app

**Horizontal scan produces:**
- Frontend layer: DiscoverScreen, SearchResultCard, SearchFilterBar, VenueDetailScreen
- Backend layer: GET /api/search, GET /api/venues, rate-limiter, cache
- Services layer: SearchService (fan-out), VenueService (new)
- Data layer: search_index (add venues), venues table (new)
- Cross-layer deps: SearchResultCard needs API response shape; SearchService needs data index

**Vertical plan produces:**
- Slice 1 (Step 1): Search UI with dummy data — proves the concept, no backend needed
- Slice 2 (Step 2): GET /api/search for users only — real API, one data type, verifiable end-to-end
- Slice 3 (Step 3): Add events to search — fan-out logic, same frontend wire
- Slice 4 (Step 4): Venue CRUD + venue search — new entity, new screen
- Slice 5 (Step 5): FilterBar, rate limiting, caching — polish

Each step leaves the product in a state where search WORKS for what's been built so far.

---

## Reference Files

| File | Purpose |
|------|---------|
| `skills/hive/skills/horizontal-plan/SKILL.md` | Horizontal planning scan procedure |
| `skills/hive/skills/vertical-plan/SKILL.md` | Vertical slice plan procedure |
| `skills/hive/skills/design-discussion/SKILL.md` | Design discussion (precedes H/V planning) |
| `skills/hive/skills/structured-outline/SKILL.md` | Structured outline (follows V planning for large epics) |
| `hive/references/agent-ready-checklist.md` | 9-point story validation applied to V-plan stories |
