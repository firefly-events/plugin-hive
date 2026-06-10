# Horizontal Planning Scan — multica-plan-test-cycles

Breadth-first layer map for routing `/plan` and `/test --simulated-manual`
through Multica, mirroring the existing `/execute → execute-dispatch →
execute-mode-multica` shape. This is the map, not the execution plan —
[vertical-plan.md](./vertical-plan.md) slices it into ordered increments.

**Source:** `_hv-findings.md` §A. Gate decisions locked in
`design-discussion.md` §9 (Option A — full mirror; spike squad-as-cell first).

---

## 1. Layer Inventory

This work spans skill orchestration, the Multica dispatch library, the scenario
schema/loader, and the squads substrate. There is no UI or backend-API surface.

- **Dispatch library** — `hive/lib/multica-story-dispatch/`: the reusable
  dispatch→poll→marker plumbing both new seams consume. Today carries story SHAs;
  must learn a non-SHA terminal for doc/verdict tasks.
- **Plan-mode skill atoms** — new `plan-mode-multica` skill paralleling
  `execute-mode-multica`; consumed by the `/plan` spawn seam.
- **Test-mode skill atoms** — new `test-mode-multica` skill, symmetric sibling.
- **Planning-routing spawn path** — `planning-routing/SKILL.md` Step 0.3 gains a
  third spawn mode (multica) alongside direct `TeamCreate` and Codex.
- **Skill wiring** — `/plan` Phase 0 and `/test` execution section invoke the
  new dispatch atoms.
- **Scenario schema + loader** — `test-scenario-schema.md` ↔ `scenarios/load.mjs`:
  two incompatible shapes that must reconcile to one before test dispatch is wired.
- **Verdict + marker contract** — canonical verdict home, unified agent name, and
  the doc/verdict done-signal marker (no code-push SHA).
- **Squads substrate** — `.pHive/multica/squads.yaml` + `agents.yaml`: confirm
  `planning-team-squad` and `verify-team-squad` member roles are seeded.
- **Bootstrap** — `multica-init` + `multica-bootstrap` (prerequisite; no change
  expected, must be live before any dispatch runs).

---

## 2. Per-Layer Requirements

### Layer: Dispatch library (`hive/lib/multica-story-dispatch/`)

CODE CHANGES:
  - `index.mjs` — add a `dispatchStoryToSquad` sibling, OR confirm existing
    `dispatchStoryToAgent` covers per-persona fan-out (resolved by the Slice 1 spike).
  - `episode-sync.mjs` — extend the marker terminal to recognize doc/verdict tasks
    that carry NO SHA; reuse `pollTaskUntilTerminal` + `writeMulticaRunEpisode`
    unchanged for the poll/episode loop.

REUSED AS-IS:
  - `pollTaskUntilTerminal` (poll loop)
  - `writeMulticaRunEpisode` (episode-marker writer, under
    `${HIVE_STATE_DIR}/episodes/...`)

### Layer: Plan-mode skill atom (new)

NEW FILE:
  - `skills/hive/skills/plan-mode-multica/SKILL.md` — owns the plan-side
    dispatch→poll→marker lifecycle, symmetric with `execute-mode-multica/SKILL.md`.

MODE-RESOLVE:
  - Thin mode-resolve reading env `HIVE_*_MODE` / config `execution.mode`
    (the `execute-dispatch` `mode_decision` pattern reused, NOT the full enum —
    plan tasks have no story/parallel-gate semantics).

### Layer: Test-mode skill atom (new)

NEW FILE:
  - `skills/hive/skills/test-mode-multica/SKILL.md` — owns the test-side
    dispatch→poll→marker lifecycle; hands the scenario to a Multica `tester`.

MODE-RESOLVE:
  - Its own thin mode-resolve (env `HIVE_*_MODE` / config `execution.mode`),
    parallel to plan-mode.

### Layer: Planning-routing spawn path

SKILL CHANGES:
  - `skills/hive/skills/planning-routing/SKILL.md` Step 0.3 — add `multica` as a
    third spawn mode beside direct `TeamCreate` and Codex `agent-spawn → codex-invoke`.
  - Fallback chain: `multica → codex → direct` on daemon-down.
  - INFO-log vocabulary extension for the new path.

### Layer: Skill wiring

SKILL CHANGES:
  - `skills/plan/SKILL.md` Phase 0 — invoke planning-routing with the multica path.
  - `skills/test/SKILL.md` execution section + `hive/workflows/steps/test/simulated-manual.md`
    (the executor contract) — invoke `test-mode-multica`.

### Layer: Scenario schema + loader

RECONCILIATION (blocking):
  - `hive/references/test-scenario-schema.md` declares
    `invocation` / `pre_conditions` / `expectations` / `sandcastle_mode_override`.
  - `hive/lib/scenarios/load.mjs` (`loadScenario`) expects
    `mode` / `steps[{action,expected}]` / `preconditions` / `postconditions`.
  - Pick ONE canonical shape; make `loadScenario` validate it; migrate existing
    scenarios in place; add loader tests.

### Layer: Verdict + marker contract

DECISIONS:
  - Canonical verdict home — `.pHive/cycle-state/<id>.yaml` vs story `manual_verdict`
    block; pick one.
  - Unify the agent name to `tester` (today: `test-worker` in `test/SKILL.md`,
    `tester` from Phase C seeding, `tester` in the roster — three names for one role).
  - Done-signal/marker — defined in `episode-sync.mjs` as
    **artifacts-committed + episode-terminal** (NOT a pushed-code SHA).

### Layer: Squads substrate

CONFIRMATION (no code change):
  - `.pHive/multica/squads.yaml` — `planning-team-squad` (leader tpm),
    `verify-team-squad` (leader peer-validator) already defined.
  - `agents.yaml` — confirm member roles are seeded
    (`verify-team-squad` references `test-architect` / `test-scout` /
    `security-reviewer`; `planning-team-squad` members likewise).

### Layer: Bootstrap (prerequisite, unchanged)

  - `skills/multica-init/SKILL.md` + `hive/lib/multica-bootstrap/index.mjs` —
    server / CLI / auth / workspace / daemon / agents must be live. No change expected.

---

## 3. Cross-Layer Dependencies

```
DEPENDENCIES:

plan-mode-multica          → multica-story-dispatch  (needs dispatch+poll helpers)
test-mode-multica          → multica-story-dispatch  (needs dispatch+poll helpers)
multica-story-dispatch     → marker contract         (needs non-SHA terminal shape)
plan-mode-multica          → squad carrier verdict   (squad-as-unit vs per-persona fan-out)
test-mode-multica          → scenario schema/loader  (one canonical shape to replay)
test-mode-multica          → verdict home + agent name (where to write; who is assignee)
planning-routing Step 0.3  → plan-mode-multica       (third spawn path invokes the atom)
/plan Phase 0              → planning-routing         (wiring)
/test + simulated-manual   → test-mode-multica       (wiring)
all dispatch               → squads substrate         (member roles must exist in agents.yaml)
all dispatch               → multica-init bootstrap    (daemon/agents live)
```

The two HIGH-risk dependencies — the squad-carrier verdict and the
schema/loader+marker contract — gate every dispatch layer. They are the slice
boundaries the vertical plan cuts on.

---

## 4. Layer Map Diagram

```
HORIZONTAL LAYER MAP
──────────────────────────────────────────────────────────────────────────────

Skill wiring   │ /plan Phase 0    │ planning-routing │ /test exec +     │
               │ (invoke routing) │ Step 0.3 (+multica│ simulated-manual │
               │                  │  +fallback)       │ (invoke atom)    │
───────────────┼──────────────────┼───────────────────┼──────────────────┤
Mode atoms     │ plan-mode-multica│                   │ test-mode-multica│
               │ (new, +resolve)  │                   │ (new, +resolve)  │
───────────────┼──────────────────┼───────────────────┼──────────────────┤
Dispatch lib   │ index.mjs        │ episode-sync.mjs  │ pollTaskUntil/   │
               │ (squad dispatch  │ (non-SHA marker   │ writeEpisode     │
               │  or fan-out)     │  terminal)        │ (reused)         │
───────────────┼──────────────────┼───────────────────┼──────────────────┤
Schema/verdict │ scenario schema  │ load.mjs loader   │ verdict home +   │
               │ ↔ loader reconcile│ (validate, tests)│ agent name unify │
───────────────┼──────────────────┼───────────────────┼──────────────────┤
Substrate      │ squads.yaml      │ agents.yaml       │ multica-init     │
               │ (confirm squads) │ (confirm roles)   │ bootstrap (live) │
──────────────────────────────────────────────────────────────────────────────
```

This diagram is the canvas the vertical slice plan overlays.

---

## 5. Scope Summary

```
HORIZONTAL SCOPE:
  Layers affected: 5 (skill wiring, mode atoms, dispatch lib, schema/verdict,
                      substrate) — bootstrap is an unchanged prerequisite
  Total items: ~13 (per _hv-findings.md §A enumeration)
  New vs modified: 2 new (plan-mode-multica, test-mode-multica)
                   ~9 modified (planning-routing, /plan, /test, simulated-manual,
                                index.mjs, episode-sync.mjs, schema, load.mjs,
                                verdict/agent unification)
                   2 confirmation-only (squads.yaml, agents.yaml)
  Estimated total effort: large (per §9 gate decision 3)

  LARGEST LAYER: Mode atoms + dispatch lib — two new symmetric skills plus the
    library extension that carries both halves of the plan→execute→test cycle.
  RISKIEST LAYER: Schema/verdict — two HIGH risks live here (scenario-schema
    drift; done-signal gap), each a hard gate before test dispatch can poll.
```
