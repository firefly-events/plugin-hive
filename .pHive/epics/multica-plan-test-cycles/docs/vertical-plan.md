# Vertical Planning — Slice Plan — multica-plan-test-cycles

The execution plan overlaid on [horizontal-plan.md](./horizontal-plan.md). Six
ordered thin slices that route `/plan` and `/test --simulated-manual` through
Multica, each leaving the workstream in a working, demoable, commit-worthy state.

**Source:** `_hv-findings.md` §B/§C/§D. Gate decisions in `design-discussion.md`
§9 (Option A full mirror; spike squad-as-cell first; framing = plan→execute→test
with `/test` as the verification checkpoint).

---

## 1. Slicing Strategy

```
STRATEGY:
  Total horizontal items: ~13 (5 layers)
  Planned slices: 6
  First slice goal: spike whether a Multica squad fans a task across member-agents
                    or runs leader-only — this FORK POINT picks the dispatch carrier.
  Final slice goal: prove the full plan → execute → test cycle end-to-end through
                    Multica on one demo workstream, on the single shared epic branch.

  Slicing rationale:
    - Slice 1 forks the plan. The squad-as-cell spike verdict decides squad-as-unit
      vs per-persona fan-out; EVERY dispatch design in Slices 4–6 inherits it, along
      with the Codex/Claude backend split (grill C1/C2). It runs first and blocks 4–6.
    - Slices 2+3 are the locked hard gate. Scenario-schema drift (HIGH) and the
      done-signal gap (HIGH) make any test dispatch un-pollable. Slice 5 (test
      dispatch) CANNOT start until both land.
    - Plan-half (Slice 4) before test-half (Slice 5) mirrors the plan→execute→test
      cycle, and lets the new routing path be exercised first on read-only docs
      (lower branch contention) before test introduces verdict writes.
    - Slice 6 is last: end-to-end proof needs both halves plus a real /execute between.
    - Constraint binding all slices: single shared branch feat/<epic-id>,
      serial-against-trunk, fresh-checkout/rebase-push.
```

---

## 2. Vertical Slice Plan

### Step 1: Squad-as-cell spike — FORK POINT

WHAT WORKS AFTER THIS STEP:
  A documented spike verdict that picks the dispatch carrier (squad-as-unit vs
  per-persona fan-out) for Slices 4–6, and confirms whether the per-agent
  Codex/Claude backend split survives.

LAYERS TOUCHED:
  Substrate:
    - Assign a throwaway task to `planning-team-squad`; observe agent assignment
      and which provider each member runs on.
    - Confirm squad member roles exist in `agents.yaml`.
  (No production wiring — observation only.)

NOT YET:
  - Any `*-mode-multica` atom
  - Any spawn-path or skill wiring
  - Any marker or schema change

VERIFIED BY:
  - Manual: Multica daemon round-trip (per #230 w4-5 pilot-roundtrip-validation) —
    inspect agent assignment + provider used.
  - Recorded carrier verdict (squad-as-unit vs per-persona fan-out).

COMMIT REPRESENTS: Spike verdict picking the dispatch carrier for the real stories.

DEPENDS_ON: — (bootstrap live).

---

### Step 2: Scenario-schema + loader reconciliation

WHAT WORKS AFTER THIS STEP:
  `loadScenario` accepts a single canonical scenario shape; `/test` parses
  scenarios without drift.

LAYERS TOUCHED:
  Schema/verdict:
    - Reconcile `test-scenario-schema.md` ↔ `scenarios/load.mjs` to one shape.
    - Migrate existing scenarios in place.
    - Add loader tests.

NOT YET:
  - Verdict-home decision (Slice 3)
  - Any test dispatch (Slice 5)

VERIFIED BY:
  - Automated: scenario-schema loader validation tests pass on migrated scenarios.

COMMIT REPRESENTS: One canonical scenario shape that the loader validates.

DEPENDS_ON: — (parallel to Slice 1).

---

### Step 3: Verdict-location + done-signal / marker shape

WHAT WORKS AFTER THIS STEP:
  A marker a poller can drive to terminal for non-SHA (doc/verdict) tasks, with a
  pinned verdict home and a single canonical agent name.

LAYERS TOUCHED:
  Schema/verdict:
    - Choose canonical verdict home: `.pHive/cycle-state/<id>.yaml` vs story-YAML
      `manual_verdict` block.
    - Unify the agent name to `tester` (resolving test-worker / tester / tester).
  Dispatch lib:
    - Define the done-signal marker (artifacts-committed + episode-terminal) in
      `episode-sync.mjs`.

NOT YET:
  - Any dispatch atom (Slices 4, 5)
  - Skill wiring

VERIFIED BY:
  - Automated: episode-marker terminal-status assertion for a non-SHA task.

COMMIT REPRESENTS: A trustable terminal marker + pinned verdict home for doc/verdict tasks.

DEPENDS_ON: Slice 2.

---

### Step 4: Plan-half dispatch (`plan-mode-multica` + routing path)

WHAT WORKS AFTER THIS STEP:
  `/plan` produces its design docs via Multica end-to-end.

LAYERS TOUCHED:
  Mode atoms:
    - Build `plan-mode-multica` atom (symmetric with `execute-mode-multica`).
  Planning-routing spawn path:
    - Add multica as the third spawn path in Step 0.3 + `multica→codex→direct` fallback.
  Skill wiring:
    - Wire `/plan` Phase 0 to invoke the multica path.
  Dispatch lib / substrate:
    - Apply the backend split per the Slice 1 spike carrier.

NOT YET:
  - Test-half dispatch (Slice 5)
  - Full-cycle integration (Slice 6)

VERIFIED BY:
  - Automated: dispatch→poll→marker round-trip for one planning cell.
  - Manual: spec-walk scenario confirming `/plan` emits docs via Multica.

COMMIT REPRESENTS: `/plan` dispatches its team via Multica, docs committed to the epic branch.

DEPENDS_ON: Slice 1 (carrier), Slice 3 (marker).

---

### Step 5: Test-half dispatch (`test-mode-multica`)

WHAT WORKS AFTER THIS STEP:
  A Multica `tester` replays a scenario and writes a verdict to the canonical home.

LAYERS TOUCHED:
  Mode atoms:
    - Build `test-mode-multica` atom reusing dispatch + poll.
  Skill wiring:
    - Wire `/test` execution section + `simulated-manual.md` executor contract.
  Schema/verdict:
    - Write the verdict to the canonical home (pinned in Slice 3).

NOT YET:
  - Full plan→execute→test loop (Slice 6)

VERIFIED BY:
  - Automated: dispatch→poll→marker round-trip for one test cell.
  - Manual: spec-walk scenario confirming `/test` produces a verdict via a Multica tester.

COMMIT REPRESENTS: `/test --simulated-manual` dispatches via Multica; tester writes a verdict.

DEPENDS_ON: Slices 2+3 (HARD GATE), Slice 1, Slice 4 (lib glue).

---

### Step 6: Full cycle integration (plan → execute → test)

WHAT WORKS AFTER THIS STEP:
  One demo workstream planned via Multica, built via `/execute`, and verified by
  `/test` that the build matched the plan — the cycle proven end-to-end.

LAYERS TOUCHED:
  All:
    - Run the loop on one demo workstream.
    - Enforce single-shared-branch / serial-against-trunk.
    - Capture episodes across the cycle.

NOT YET:
  - Multi-agent parallel dispatch (out of scope — one agent per role today).

VERIFIED BY:
  - Manual + automated: the plan→execute→test loop completes; episode markers
    terminal at each stage; verdict confirms execution matched the plan.

COMMIT REPRESENTS: End-to-end plan→execute→test cycle running through Multica.

DEPENDS_ON: Slices 4+5.

---

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY
──────────────────────────────────────────────────────────────────────────────

              │ Step 1   │ Step 2   │ Step 3   │ Step 4    │ Step 5    │ Step 6  │
              │ SPIKE    │ Schema   │ Verdict/ │ Plan-half │ Test-half │ Full    │
              │ (FORK)   │ +loader  │ marker   │ dispatch  │ dispatch  │ cycle   │
──────────────┼──────────┼──────────┼──────────┼───────────┼───────────┼─────────┤
Skill wiring  │          │          │          │ /plan P0 +│ /test +   │ run loop│
              │          │          │          │ routing   │ sim-manual│ on demo │
──────────────┼──────────┼──────────┼──────────┼───────────┼───────────┼─────────┤
Mode atoms    │          │          │          │ plan-mode-│ test-mode-│         │
              │          │          │          │ multica   │ multica   │         │
──────────────┼──────────┼──────────┼──────────┼───────────┼───────────┼─────────┤
Dispatch lib  │ carrier? │          │ non-SHA  │ backend   │ reuse     │ episodes│
              │ (verdict)│          │ marker   │ split     │ dispatch  │ captured│
──────────────┼──────────┼──────────┼──────────┼───────────┼───────────┼─────────┤
Schema/verdict│          │ reconcile│ home +   │           │ write     │         │
              │          │ + tests  │ agent    │           │ verdict   │         │
──────────────┼──────────┼──────────┼──────────┼───────────┼───────────┼─────────┤
Substrate     │ confirm  │          │          │ (uses     │ (uses     │ serial- │
              │ roles    │          │          │  carrier) │  carrier) │ trunk   │
──────────────────────────────────────────────────────────────────────────────

FORK POINT  : Step 1's carrier verdict feeds Steps 4–6 (dotted inheritance).
HARD GATE   : Steps 2+3 must both close before Step 5 can start.
Each column is a commit-worthy, working state.
```

---

## 4. Deferred Items

```
DEFERRED (not in current slice plan):
  - Multi-agent parallel dispatch — out of scope; one agent per role today,
    re-tightens later per the integration principle.
  - Load / performance of the Multica daemon.
  - The full 9-step swarm test pipeline — unchanged by this work.

RATIONALE: This workstream proves the dispatch seams on a single-agent-per-role
  roster. Parallelism and perf are deliberately out of scope until the seams exist
  and are proven end-to-end (Slice 6). The swarm pipeline is untouched.
```

---

## 5. Risk by Slice

```
RISK PER SLICE:
  Step 1: Medium — squad may run leader-only, silently dropping the backend split.
          CONTAINED: throwaway task, no production wiring; the verdict gates 4–6,
          so a leader-only result reshapes those slices rather than corrupting them.

  Step 2: Medium — scenario migration breaks existing scenarios.
          CONTAINED: loader tests + migrate-in-place before any dispatch consumes
          the schema; nothing downstream reads it yet.

  Step 3: Low/Medium — wrong canonical verdict home strands a downstream reader.
          CONTAINED: doc-only decision; nothing dispatches until the home is pinned.

  Step 4: Medium — third spawn path lacks a fallback on daemon-down.
          CONTAINED: multica→codex→direct fallback ships IN this slice; docs are
          read-only so trunk contention stays low.

  Step 5: Medium — tester / test-worker / test-architect name mismatch breaks
          resolveAgentUuidByName.
          CONTAINED: Slice 3 unifies the name to `tester`; Slice 1 confirmed the roster.

  Step 6: Medium — parallel plan + test cells contend on one branch.
          CONTAINED: enforce serial-against-trunk fresh-checkout/rebase-push;
          single agent per role keeps execution serial.
```

---

## 6. Moldability Notes

What can change without invalidating the plan:

- **Slices 1 and 2 can run in parallel** — Slice 2 has no dependency on the spike.
- **The fork point reshapes, not reorders.** If Slice 1 returns "leader-only," the
  *internals* of Slices 4–6 change (per-persona fan-out instead of squad-as-unit),
  but the slice boundaries and ordering hold.
- **Slices 2+3 are a hard gate that cannot be relaxed** — Slice 5 is un-pollable
  until both land. This boundary is not moldable.
- **Slices 4 and 5 cannot swap** — plan-half deliberately precedes test-half to
  exercise the routing path on read-only docs before verdict writes appear, and
  Slice 5 reuses Slice 4's library glue.
- **Slice 6 is always last** — end-to-end proof needs both halves plus a real
  `/execute`.
- If the squad-carrier or schema reconciliation surfaces something unexpected, the
  most likely new work is a `dispatchStoryToSquad` helper in `index.mjs` (Slice 1
  may make this explicit rather than confirming `dispatchStoryToAgent` suffices).
