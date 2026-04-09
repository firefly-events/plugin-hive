# Vertical Planning — Slice Plan

Take the horizontal layer map and cut it into vertical slices — minimum cross-stack increments that each produce a working, demo-able, commit-worthy state. This is the execution plan overlaid on the breadth map.

**Input:** Horizontal planning scan (layer map + per-layer requirements + cross-layer dependencies) + design discussion + user feedback.

## Core Principle

Every vertical slice must leave the product in a working state. Not "the whole product works" — but "the specific thing this slice built works and can be verified." If a bug appears, it was introduced in THIS slice, not some unknown prior one. This is the #1 value of vertical planning: **issues are caught when they arrive, not after five unknowns pile up.**

Horizontal planning tells you WHAT exists across each layer. Vertical planning tells you WHEN to build each piece and in what combination across layers.

## Document Structure

### 1. Slicing Strategy (~30 lines)

Explain the slicing approach for this specific work:
- What's the thinnest possible first slice that proves the concept?
- What's the logical progression from MVP to complete?
- Where are the natural slice boundaries (informed by cross-layer dependencies)?

```
STRATEGY:
  Total horizontal items: {N}
  Planned slices: {N}
  First slice goal: {what it demonstrates}
  Final slice goal: {complete feature as specified}
  
  Slicing rationale: {why these boundaries, what dependencies drove them}
```

### 2. Vertical Slice Plan (~200-400 lines)

For each slice, define what gets built across which layers:

```
## Step 1: {Goal — what this demonstrates when complete}

WHAT WORKS AFTER THIS STEP:
  {One-line description of the working state. Example: "User can type in the 
  search box and see dummy results rendered in the list view."}

LAYERS TOUCHED:
  Frontend:
    - DiscoverScreen — basic layout with search input
    - SearchResultCard — renders dummy data
  Data:
    - Dummy search results (hardcoded or fixture)

NOT YET:
  - Backend API (using dummy data)
  - Real database
  - Filtering, pagination

VERIFIED BY:
  - Component test: SearchResultCard renders dummy data correctly
  - Manual: search UI visible and interactive on target device

COMMIT REPRESENTS: Basic search UI with dummy data — proof of concept

---

## Step 2: {Goal}

BUILDS ON: Step 1
WHAT WORKS AFTER THIS STEP:
  {Working state description. Example: "Search input hits real backend, 
  returns real user results from the database."}

LAYERS TOUCHED:
  Backend API:
    - GET /api/search?q={term}&type=users — real endpoint
  Services:
    - SearchService — user search only
  Data:
    - search_index — user entries
  Frontend:
    - DiscoverScreen — wire to real API (replace dummy data)

NOT YET:
  - Event search, venue search
  - Filtering bar
  - Rate limiting, caching

VERIFIED BY:
  - Integration test: API returns real user results (pytest)
  - E2E test: type query → see real results on device (Maestro)

COMMIT REPRESENTS: End-to-end search working for one data type (users)

---

## Step 3: {Goal}
...
```

### 3. Overlay Diagram (~30 lines)

Take the horizontal layer map from the previous step and overlay the vertical slice boundaries:

```
VERTICAL SLICE OVERLAY
─────────────────────────────────────────────────────────

              │  Step 1   │  Step 2    │  Step 3    │  Step 4    │
              │  (MVP)    │  (Users)   │  (Events)  │  (Polish)  │
──────────────┼───────────┼────────────┼────────────┼────────────┤
Frontend      │ Search UI │ Wire API   │ Event cards│ FilterBar  │
              │ dummy data│            │            │ pull-refresh│
──────────────┼───────────┼────────────┼────────────┼────────────┤
API           │           │ GET /search│ +events    │ rate-limit │
              │           │ (users)    │ type param │ cache      │
──────────────┼───────────┼────────────┼────────────┼────────────┤
Services      │           │ Search     │ +EventSvc  │            │
              │           │ (users)    │ fan-out    │            │
──────────────┼───────────┼────────────┼────────────┼────────────┤
Data          │ fixtures  │ user index │ event index│            │
              │           │            │            │            │
─────────────────────────────────────────────────────────

Each column is a commit-worthy, working state.
```

### 4. Deferred Items (~30 lines)

Items from the horizontal scan that are NOT in any slice — intentionally deferred:

```
DEFERRED (not in current slice plan):
  - Venue search (future vertical slice, not part of this epic)
  - Advanced search operators (nice-to-have, descoped)
  - Search analytics events (can be added after core works)

RATIONALE: {why these are safe to defer}
```

### 5. Risk by Slice (~30 lines)

For each slice, what's the most likely thing to go wrong?

```
RISK PER SLICE:
  Step 1: Low — dummy data, no integration points
  Step 2: Medium — first API integration, response shape mismatch possible
  Step 3: Medium — fan-out logic, search index performance with multiple types
  Step 4: Low — polish, no new integrations
```

### 6. Moldability Notes (~20 lines)

What can change without invalidating the plan?

- Which slices can be reordered?
- Which slices can be dropped if scope shrinks?
- What new slices might be needed if we discover something unexpected?

The vertical plan is moldable — unlike a rigid horizontal rollout, individual slices can adapt as we learn from earlier ones. Each slice's learnings inform the next.

## Output Guidelines

- Write the finished document to `state/epics/{epic-id}/docs/vertical-plan.md`
- Every slice MUST have a "WHAT WORKS AFTER THIS STEP" statement — this is the invariant
- Every slice MUST have a "VERIFIED BY" statement — how we confirm this slice works (tools, test types, platforms)
- Every slice MUST have a "COMMIT REPRESENTS" statement — what the commit message would describe
- The overlay diagram is mandatory — it's the visual that ties horizontal and vertical together
- First slice should be the thinnest possible proof of concept (dummy data is fine)
- Later slices build on earlier ones — never require rework of a completed slice
- "NOT YET" sections are important — they set expectations and prevent scope creep per slice
- Target 300-500 lines depending on number of slices
- Slice count should typically be 3-6 for a medium feature, 5-10 for a large one
