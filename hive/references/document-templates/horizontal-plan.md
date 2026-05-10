# Horizontal Planning Scan

Produce a horizontal layer map from a design discussion and research findings. This is the breadth-first view — what does each layer of the architecture need OVERALL to fulfill the requirement? The output is a map, not an execution plan. Vertical planning (next step) will slice this map into executable increments.

**Input:** Design discussion document + research brief + user feedback on the design discussion.

## Purpose

Horizontal planning answers: "If we zoom into each layer independently, what's the full picture of what that layer needs?" This gives the team a complete understanding of scope across all affected systems BEFORE deciding execution order.

The value is the map — not the execution. Horizontal plans executed directly produce monolithic, non-working intermediate states. But WITHOUT horizontal planning, vertical slices miss dependencies and underestimate scope.

## Document Structure

### 1. Layer Inventory (~30 lines)

Identify every architectural layer this work touches. Common layers:
- Frontend (UI components, screens, navigation)
- Backend API (endpoints, middleware, routing)
- Business logic / services
- Data layer (database schema, migrations, queries)
- Infrastructure (deployment, config, CI)
- External integrations (third-party APIs, webhooks)

For each layer, one line: what it does in the current system and how it's affected.

### 2. Per-Layer Requirements (~100-200 lines)

For EACH layer identified above, enumerate everything that layer needs to fully satisfy the requirement. Be exhaustive — this is the breadth pass.

```
## Layer: Backend API

ENDPOINTS NEEDED:
  - GET /api/search?q={term}&type={users|events|venues} — unified search
  - GET /api/venues — list venues (new)
  - GET /api/venues/:id — venue detail (new)

MIDDLEWARE CHANGES:
  - Search rate limiter (new)
  - Response cache for search results

SERVICE LOGIC:
  - SearchService.unified() — fan-out to user, event, venue indexes
  - VenueService — full CRUD

DATA CHANGES:
  - venues table (new)
  - search_index — add venue entries

---

## Layer: Frontend

SCREENS:
  - DiscoverScreen — text search with multi-type results
  - VenueDetailScreen — venue information display

COMPONENTS:
  - SearchResultCard — polymorphic (user/event/venue)
  - SearchFilterBar — type toggles

STATE:
  - useSearch hook — debounced query, type filtering, pagination

NAVIGATION:
  - Add venue detail to stack navigator
```

List everything even if some items might be deferred. The vertical planning step will decide what's in each increment.

### 3. Cross-Layer Dependencies (~50 lines)

Where do layers connect? What in one layer requires something in another?

```
DEPENDENCIES:

Frontend SearchResultCard → Backend GET /api/search (needs response shape)
Frontend VenueDetailScreen → Backend GET /api/venues/:id (needs venue model)
Backend SearchService.unified() → Data search_index (needs venue entries indexed)
Backend VenueService → Data venues table (needs schema)
```

These dependencies are what vertical planning uses to determine slice boundaries — you can't build the frontend search card without knowing the API response shape.

### 4. Layer Map Diagram (~30 lines)

ASCII visual showing layers (y-axis) and the areas within each layer that are affected:

```
HORIZONTAL LAYER MAP
─────────────────────────────────────────────────────────

Frontend    │ DiscoverScreen  │ SearchCard  │ VenueDetail │ FilterBar  │
            │ (search UI)     │ (results)   │ (new screen)│ (toggles)  │
────────────┼─────────────────┼─────────────┼─────────────┼────────────┤
API         │ GET /search     │ GET /venues │ rate-limit  │ cache      │
            │ (unified)       │ (new CRUD)  │ (middleware) │ (middleware)│
────────────┼─────────────────┼─────────────┼─────────────┼────────────┤
Services    │ SearchService   │ VenueService│             │            │
            │ (fan-out)       │ (new)       │             │            │
────────────┼─────────────────┼─────────────┼─────────────┼────────────┤
Data        │ search_index    │ venues      │             │            │
            │ (add venues)    │ (new table) │             │            │
─────────────────────────────────────────────────────────
```

This diagram becomes the canvas that vertical planning overlays with slice boundaries.

### 5. Scope Summary (~20 lines)

```
HORIZONTAL SCOPE:
  Layers affected: {N}
  Total items: {N} (endpoints + components + services + data changes)
  New vs modified: {N} new, {M} modified
  Estimated total effort: small | medium | large | xlarge

  LARGEST LAYER: {which layer has the most work}
  RISKIEST LAYER: {which layer has the most unknowns}
```

## Output Guidelines

- Write the finished document to `.pHive/epics/{epic-id}/docs/horizontal-plan.md`
- Be exhaustive in per-layer requirements — this is the breadth pass, not the execution plan
- Every item should be concrete (name the endpoint, name the component, name the table)
- The layer map diagram is mandatory — it's the visual anchor for vertical planning
- Cross-layer dependencies are mandatory — they determine where vertical slices can cut
- Do NOT suggest execution order — that's vertical planning's job
- Target 200-400 lines depending on scope
