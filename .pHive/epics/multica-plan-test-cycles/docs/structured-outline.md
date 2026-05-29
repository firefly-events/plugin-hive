# Structured Outline — multica-plan-test-cycles

The detailed blueprint for routing `/plan` and `/test --simulated-manual` through
Multica, completing the **plan → execute → test** cycle on the Multica substrate.
Consumes the [design discussion](./design-discussion.md) (esp. §9 LOCKED gate
decisions), the [grill record](./grill-record.md) (12 findings), the
[research brief](./research-brief.md), the [horizontal plan](./horizontal-plan.md)
(5 layers), and the [vertical plan](./vertical-plan.md) (6 slices). The six outline
phases map 1:1 to slices S1–S6; the vertical plan is the spine and is not re-ordered.

---

## Part 1: Executive Summary

**What we're building.** `/execute` already reaches Multica through a clean single
dispatch point (`execute-dispatch` → `execute-mode-multica`, reusing
`hive/lib/multica-story-dispatch/`). This workstream extends the **same pattern** to
the other two cycle phases: `/plan` (Phase 0 / `planning-routing` spawn step) gains a
third spawn path that dispatches the planning team to Multica, and
`/test --simulated-manual` gains a Multica dispatch that hands a scenario to a
`tester` agent. The result is a full plan → execute → test cycle that can run entirely
on the Multica substrate, on a single shared epic branch, serial-against-trunk.

**Why.** `/execute` proves Multica works as an execution substrate; the plan and test
halves are the two unmirrored phases. Completing the mirror gives a uniform dispatch
shape across all three cycle phases (one atomic `*-mode-multica` skill per phase,
selected by a dispatch atom, owning its own dispatch → poll → terminal-marker
lifecycle). `/test --simulated-manual` is framed as the **verification checkpoint**
that execution matched the plan — the manual-style pass that catches false
positives/negatives unit and integration tests miss. That framing is the WHY for
routing test through Multica as the cycle's final gate.

**How the gate changed/confirmed the original approach.** The design discussion framed
two seam shapes (A full mirror vs B lighter seam) and leaned B. The user gate (§9,
locked 2026-05-28) **overrode the lean and selected Option A (full mirror)** — two new
symmetric atomic skills (`plan-mode-multica`, `test-mode-multica`), each with its own
dispatch atom, for consistency with `/execute`. The gate also **converted the squad
question from a design choice into a spike** (S1 fork): rather than assume
squad-as-cell is dispatchable, S1 assigns a throwaway task to `planning-team-squad`
and observes whether Multica fans work across member-agents (preserving the
Codex/Claude split for free) or runs leader-only. The spike verdict — not the design —
picks the dispatch carrier.

**Key locked decisions (cite §9):**
- **Seam shape = Option A full mirror** (§9.1) — two new `*-mode-multica` atoms.
- **Squad model = spike-first** (§9.2) — S1 observes carrier behavior; resolves grill
  H1 (is squad-dispatch a real primitive?) + C1 (does squad-as-one-task break the
  backend split?).
- **Scale = Large** (§9.3) — H/V + this structured outline before story decomposition.
- **Framing = plan→execute→test, `/test` is the verification checkpoint** (§9.4).
- **Blocking foundational stories** (§9.5) — scenario-schema reconciliation +
  verdict-location divergence + done-signal/marker shape MUST land before any test
  dispatch can poll to terminal. This is the S2+S3 → S5 hard gate.

**Implementation strategy (3-5 sentences).** Six thin slices, each commit-worthy.
S1 is a fork point: it spikes the squad carrier and gates every dispatch design in
S4–S6. S2 and S3 are a locked hard gate (scenario-schema HIGH + done-signal HIGH) that
S5 cannot start without. S4 (plan-half) deliberately precedes S5 (test-half) so the new
routing path is first exercised on read-only docs (low branch contention) before
verdict writes appear, and so S5 can reuse S4's library glue. S6 proves the full cycle
end-to-end. All six commit to one shared branch `feat/multica-plan-test-cycles`,
serial-against-trunk, fresh-checkout/rebase-push.

```
PRODUCT GOALS:
  Success metrics:
    - /plan can dispatch its planning team through Multica (third spawn path) with a
      multica→codex→direct fallback on daemon-down.
    - /test --simulated-manual can dispatch a scenario to a Multica `tester` and
      drive an episode marker to terminal for a NON-SHA (doc/verdict) task.
    - One demo workstream runs plan → execute → test end-to-end through Multica on a
      single shared branch (S6).
  Non-goals (per vertical plan §4):
    - Multi-agent parallel dispatch (one agent per role today; re-tightens later).
    - Multica daemon load/performance work.
    - The full 9-step swarm test pipeline (unchanged by this work).
  Stakeholders: single maintainer (Don). Cross-skill coordination across /plan, /test,
    planning-routing, the dispatch lib, and the scenario schema/loader.
```

---

## Part 2: Detailed Approach

Six phases mapped to slices S1–S6. Files cite the [horizontal plan](./horizontal-plan.md)
layers: **Skill wiring**, **Mode atoms**, **Dispatch lib** (`hive/lib/multica-story-dispatch/`),
**Schema/verdict**, **Substrate**. Bootstrap (`multica-init`) is an unchanged
prerequisite that must be live.

### Phase S1: Squad-as-cell spike — FORK POINT

**Goal:** Produce a documented spike verdict that picks the dispatch carrier
(squad-as-unit vs per-persona fan-out) for S4–S6, and confirm whether the per-agent
Codex/Claude backend split survives squad dispatch.
**Depends on:** Bootstrap live (`multica-init`). Nothing else. Can run parallel to S2.

#### Changes (Substrate layer only — observation, no production wiring)

1. **`.pHive/multica/squads.yaml`** (confirm-only)
   - Confirm `planning-team-squad` (leader `tpm`; members researcher, architect,
     technical-writer, tpm) is seeded as observed.
   - No edit unless the spike reveals a missing/renamed member.

2. **`.pHive/multica/agents.yaml`** (confirm-only)
   - Confirm each squad member role exists and record its `provider`/`model`
     (creators expected `provider: codex`; verifiers expected `provider: claude`,
     `model: claude-opus-4-7`). The research brief flags an older snapshot showed
     `developer`/`tester` on `claude/claude-sonnet-4-6` — confirm against the 8.6KB
     worktree file, not the 880B repo-root file.

3. **Throwaway dispatch task** (no file; observation artifact)
   - Assign a throwaway task to `planning-team-squad` via the live daemon round-trip
     (per #230 w4-5 pilot-roundtrip-validation).
   - Observe: (a) does Multica fan the task across member-agents, or run the leader
     only? (b) does each member run on its own `agents.yaml` provider?

#### Interfaces

No interface changes. The spike reads the existing Multica assignment API behavior.
Open question it answers: does an "assign issue to squad" primitive exist, or is
`dispatchStoryToAgent` (single-agent) the only carrier? (grill H1)

#### Validation

- **Manual:** inspect agent assignment + provider used in the daemon round-trip.
- **Recorded:** a written carrier verdict — `squad-as-unit` (fans across members,
  backend split preserved) **or** `per-persona fan-out` (leader-only; must fan one
  Multica issue per persona to preserve the split).
- **Could silently break:** if Multica runs leader-only AND we don't notice, the
  Codex/Claude split silently collapses to one runtime (grill C1). The spike exists
  precisely to make this visible before any wiring.

**Commit represents:** the spike verdict picking the dispatch carrier for S4–S6.

---

### Phase S2: Scenario-schema + loader reconciliation

**Goal:** `loadScenario` accepts a single canonical scenario shape; `/test` parses
scenarios without drift.
**Depends on:** Nothing (parallel to S1). Part of the locked hard gate; blocks S5.

#### Changes (Schema/verdict layer)

1. **`hive/references/test-scenario-schema.md`** (modified)
   - Today documents `invocation` / `pre_conditions` / `expectations` /
     `sandcastle_mode_override`.
   - Reconcile to ONE shape with the loader. The loader's vocabulary
     (`mode` ∈ {`spec-walk`, `implementation-walk`}, `steps[{action, expected}]`,
     `preconditions`, `postconditions`) is the runtime reality; the schema doc must be
     brought to match whichever single shape is chosen (recommend: loader wins, since
     it is executable and `/test` already parses it).

2. **`hive/lib/scenarios/load.mjs`** (`loadScenario`) (modified)
   - Validate the one canonical shape. Add explicit validation errors for the
     deprecated/foreign keys so a stale scenario fails loudly rather than silently
     mis-parsing.

3. **Existing scenarios under `.pHive/test-scenarios/*.yaml`** (modified — migrate in place)
   - Migrate every existing scenario to the canonical shape. Nothing downstream reads
     the schema yet, so migration is safe to do now.

4. **Loader tests** (new — `hive/lib/scenarios/*.test.mjs` or sibling)
   - Add validation tests that pass on the migrated scenarios and reject the foreign
     shape.

#### Interfaces

`loadScenario(path) → Scenario` — define the canonical `Scenario` type explicitly:
fields, allowed `mode` enum values, the `steps[]` element shape, and the error thrown
on an unrecognized key. This is the contract S5's `test-mode-multica` replays.

#### Validation

- **Automated:** scenario-schema loader validation tests pass on migrated scenarios.
- **What could silently break:** a scenario that "loads" under both shapes but means
  different things. The loader tests must assert the foreign-key path now *errors*,
  not just that the canonical path passes.

**Commit represents:** one canonical scenario shape that the loader validates.

---

### Phase S3: Verdict-location + done-signal / marker shape

**Goal:** A marker a poller can drive to terminal for non-SHA (doc/verdict) tasks,
with a pinned verdict home and a single canonical agent name.
**Depends on:** S2. Part of the locked hard gate; blocks S5. Builds on S2 by adding the
verdict/marker contract on top of the now-canonical scenario shape.

#### Changes

1. **Canonical verdict home** (Schema/verdict layer — decision, then enforce)
   - Today divergent: `simulated-manual.md` writes the verdict to
     `.pHive/cycle-state/<epic-id>.yaml`; `test/SKILL.md §8` points at the story YAML
     `manual_verdict` block (grill U3). **Pick one** and update the other to match.
   - Recommendation carried for sign-off (Decision 1): story-YAML `manual_verdict`
     block is canonical (verdict is story-scoped and travels with the story record);
     `cycle-state` becomes a derived/index view. The maintainer decides at sign-off.

2. **Agent-name unification** (Schema/verdict layer)
   - Three names for one role today: `test-worker` (in `test/SKILL.md`
     `manual_verdict.agent`), `tester` (Phase C seeding), `tester` (roster). Unify to
     **`tester`** (the roster name — `resolveAgentUuidByName` must match it). Update
     `test/SKILL.md` to write `manual_verdict.agent: tester`. Resolves grill V3 /
     the verdict-agent vocab clash.

3. **`hive/lib/multica-story-dispatch/episode-sync.mjs`** (modified)
   - Define the done-signal marker for non-SHA tasks: **artifacts-committed +
     episode-terminal** (NOT a pushed-code SHA). Reuse the existing
     `multica-run.yaml` episode marker (do not invent a new marker dialect — resolves
     grill V2); add a terminal-derivation rule that recognizes a doc/verdict task as
     terminal when its artifacts are committed and the episode status is terminal.
   - Reuse `pollTaskUntilTerminal` and `writeMulticaRunEpisode` unchanged for the
     poll/episode loop.

#### Interfaces

Marker terminal predicate: `isTerminal(episode) → bool` extended so a task carrying
NO SHA is terminal when `artifacts_committed == true && episode.status ∈ terminal-set`.
Document this rule inline in `episode-sync.mjs` and in the marker contract section of
the new `*-mode-multica` skills.

#### Validation

- **Automated:** episode-marker terminal-status assertion for a non-SHA task.
- **What could silently break:** a verdict written to the *un*-chosen home strands a
  downstream reader (e.g., `/metrics-check` reading the story YAML while the tester
  wrote cycle-state). The single-home decision + updating both consumers is the
  mitigation.

**Commit represents:** a trustable terminal marker + pinned verdict home + single
canonical agent name for doc/verdict tasks.

---

### Phase S4: Plan-half dispatch (`plan-mode-multica` + routing path)

**Goal:** `/plan` can dispatch its planning team through Multica via a new third spawn
path, with a fallback chain. Exercised first on read-only docs (low branch contention).
**Depends on:** S1 (the carrier verdict shapes this slice's internals). Uses the
dispatch lib; does NOT depend on S2/S3 (plan produces read-only docs, not verdicts).

#### Changes

1. **`skills/hive/skills/plan-mode-multica/SKILL.md`** (NEW — Mode atoms layer)
   - New atomic skill paralleling `execute-mode-multica`. Owns the per-unit lifecycle:
     dispatch the assembled planning personas → poll → write terminal episode marker
     under `${HIVE_STATE_DIR}/episodes/...` → return a summary.
   - **S1 fork shapes this skill's internals:**
     - If S1 verdict = **squad-as-unit**: the atom assigns ONE task to
       `planning-team-squad` and relies on Multica to fan across members on their own
       providers (backend split preserved by the substrate).
     - If S1 verdict = **per-persona fan-out**: the atom fans ONE Multica issue per
       persona (researcher/architect/technical-writer on `codex`; tpm on `claude`),
       reading `agent_backends` to route each (resolves grill C2). This is the branch
       that may require a new `dispatchStoryToSquad` helper (see manifest).

2. **`skills/hive/skills/planning-routing/SKILL.md`** Step 0.3 (modified — Skill wiring/Planning-routing spawn path)
   - Add `multica` as a THIRD spawn mode beside direct `TeamCreate` and Codex
     (`agent-spawn → codex-invoke`). Today only two paths exist.
   - Fallback chain: **multica → codex → direct** on daemon-down (extends today's
     codex→direct chain).
   - Extend the INFO-log vocabulary for the new path.

3. **`skills/plan/SKILL.md`** Phase 0 (modified — Skill wiring)
   - Invoke `planning-routing` with the multica path available. The override source
     mirrors `/execute`'s: `env.HIVE_PLANNING_MODE == "multica"` OR root
     `hive.config.yaml` `planning.mode: multica` (exact key names are Decision 2).

4. **`hive/lib/multica-story-dispatch/index.mjs`** (modified — Dispatch lib)
   - Carries the backend split per the S1 verdict. CONDITIONAL: add a
     `dispatchStoryToSquad` sibling IF S1 returns squad-as-unit AND
     `dispatchStoryToAgent` does not cover it; otherwise reuse `dispatchStoryToAgent`
     for per-persona fan-out (this is the moldability hinge per vertical plan §6).

#### Interfaces

`plan-mode-multica` inputs (mirror `execute-mode-multica`): assembled personas /
planning-team handle, `epic_handle`, `hive_config`, the planning task brief. Outputs:
per-unit episode marker + summary to caller. The routing atom emits a spawn-mode
decision (`direct | codex | multica`) with `mode_reason` and `field_sources`.

#### Validation

- **Automated:** dispatch→poll→marker round-trip for one planning cell.
- **Manual:** spec-walk scenario confirming `/plan` emits docs via Multica.
- **What could silently break:** the third spawn path with no fallback on daemon-down.
  The multica→codex→direct fallback ships IN this slice. Docs are read-only so trunk
  contention stays low while the path is shaken out.

**Commit represents:** `/plan` dispatches its team via Multica with a fallback chain.

---

### Phase S5: Test-half dispatch (`test-mode-multica`)

**Goal:** A Multica `tester` replays a scenario and writes a verdict to the canonical
home.
**Depends on:** **S2 + S3 (HARD GATE — both must close first)**, S1 (carrier verdict),
S4 (reuses S4's dispatch-lib glue). Cannot start until S2 and S3 land — the scenario
shape and the done-signal/verdict-home must exist or the test cell is un-pollable.

#### Changes

1. **`skills/hive/skills/test-mode-multica/SKILL.md`** (NEW — Mode atoms layer)
   - Symmetric sibling to `plan-mode-multica`. Hands the canonical scenario (S2) to a
     Multica `tester` (name unified in S3), polls via the dispatch lib, and writes the
     verdict to the canonical home (pinned in S3). Reuses S4's `index.mjs` glue.

2. **`skills/test/SKILL.md`** execution section (modified — Skill wiring)
   - Invoke `test-mode-multica` from the execution section when the multica mode is
     selected. Update `manual_verdict.agent` to `tester` (the S3 unification).

3. **`hive/workflows/steps/test/simulated-manual.md`** (modified — Skill wiring; the executor contract)
   - Update the executor contract so the simulated-manual step routes through
     `test-mode-multica` and writes the verdict to the S3-canonical home.

4. **Verdict write** (Schema/verdict layer)
   - The tester writes the verdict to the canonical home pinned in S3 — one place,
     consistently.

#### Interfaces

`test-mode-multica` inputs: scenario path (canonical shape), `epic_handle`,
`hive_config`. Outputs: verdict at the canonical home + terminal episode marker
(artifacts-committed + episode-terminal per S3) + summary. Error condition: if
`resolveAgentUuidByName("tester")` fails, hard-error (S3 unified the name; the spike
S1 confirmed the roster).

#### Validation

- **Automated:** dispatch→poll→marker round-trip for one test cell.
- **Manual:** spec-walk scenario confirming `/test` produces a verdict via a Multica
  tester.
- **What could silently break:** an agent-name mismatch (`tester` / `test-worker`)
  breaks `resolveAgentUuidByName`. S3's unification + S1's roster confirmation are the
  mitigation.

**Commit represents:** `/test --simulated-manual` dispatches via Multica; tester writes
a verdict.

---

### Phase S6: Full cycle integration (plan → execute → test)

**Goal:** Prove the full plan → execute → test cycle end-to-end through Multica on one
demo workstream, on the single shared epic branch.
**Depends on:** S4 (plan-half) + S5 (test-half) + a real `/execute` between them.
Always last — end-to-end proof needs both halves.

#### Changes (no new production code; integration + episode capture)

1. **Demo workstream run** (Substrate + all layers exercised end-to-end)
   - Run `/plan` (Multica) → `/execute` (existing Multica) → `/test --simulated-manual`
     (Multica) on one demo workstream.
   - Enforce serial-against-trunk: single shared branch `feat/multica-plan-test-cycles`,
     fresh-checkout at start, rebase-then-push at end. Single agent per role keeps
     execution serial.

2. **Episode capture** (Dispatch lib — verify, not change)
   - Confirm episodes are captured for all three phases under
     `${HIVE_STATE_DIR}/episodes/...`.

#### Interfaces

No new interfaces. This slice exercises S1–S5's contracts together.

#### Validation

- **Manual:** the full cycle completes; each phase's episode marker reaches terminal;
  the verdict lands in the canonical home.
- **What could silently break:** parallel plan + test cells contending on one branch.
  Mitigation: serial-against-trunk fresh-checkout/rebase-push; single agent per role.

**Commit represents:** the full plan → execute → test cycle proven end-to-end via
Multica on one shared branch.

---

## Part 3: Verification Plan

Fittingly, the seams are verified via the very `--simulated-manual` cycle this
workstream touches, plus the existing Multica round-trip pattern (design discussion §7).

**Per-phase verification:**

```
S1 (spike) verification:
  Automated: — (observation only)
  Manual: Multica daemon round-trip (#230 w4-5 pattern); inspect agent assignment +
          provider per member; record carrier verdict.
  Tools: live Multica daemon (Podman)
  Platforms: local single-agent-per-role roster

S2 (schema/loader) verification:
  Automated: scenario-schema loader validation tests pass on migrated scenarios;
             foreign-key shape now errors.
  Manual: spot-check one migrated scenario loads to the expected canonical object.
  Tools: hive/lib/scenarios/load.mjs + loader tests
  Platforms: node test runner

S3 (verdict/marker) verification:
  Automated: episode-marker terminal-status assertion for a NON-SHA task
             (artifacts-committed + episode-terminal).
  Manual: confirm verdict lands in the single pinned home; agent name resolves.
  Tools: episode-sync.mjs assertions
  Platforms: node test runner

S4 (plan-half) verification:
  Automated: dispatch→poll→marker round-trip for one planning cell.
  Manual: spec-walk scenario confirming /plan emits docs via Multica; daemon-down
          triggers multica→codex→direct fallback.
  Tools: /test --simulated-manual (spec-walk), Multica daemon round-trip
  Platforms: local Multica daemon

S5 (test-half) verification:
  Automated: dispatch→poll→marker round-trip for one test cell.
  Manual: spec-walk scenario confirming /test produces a verdict via a Multica tester.
  Tools: /test --simulated-manual, episode-marker inspection
  Platforms: local Multica daemon

S6 (full cycle) verification:
  Automated: episodes captured for all three phases.
  Manual: plan → execute → test completes on one branch, serial-against-trunk.
  Tools: full /plan /execute /test loop on a demo workstream
  Platforms: local Multica daemon
```

**Verification coverage matrix:**

| Acceptance Criterion | Test Type | Tool | Slice |
|---------------------|-----------|------|-------|
| Squad carrier behavior recorded | Manual round-trip | Multica daemon | S1 |
| One canonical scenario shape validated | Automated (loader) | load.mjs tests | S2 |
| Foreign scenario shape rejected | Automated (loader) | load.mjs tests | S2 |
| Non-SHA task reaches terminal marker | Automated | episode-sync.mjs | S3 |
| Verdict written to single canonical home | Manual | inspection | S3 |
| Agent name resolves (`tester`) | Automated | resolveAgentUuidByName | S3/S5 |
| /plan dispatches team via Multica | Automated + Manual | round-trip + spec-walk | S4 |
| multica→codex→direct fallback | Manual | daemon-down sim | S4 |
| /test produces verdict via Multica tester | Automated + Manual | round-trip + spec-walk | S5 |
| Full cycle end-to-end on one branch | Manual | full loop | S6 |

**What's NOT being verified and why (design discussion §7):**
- Multi-agent parallel dispatch — out of scope; one agent per role today; the
  integration contract re-tightens later. The user can push back if a parallel proof
  is wanted now.
- Multica daemon load/performance — deliberately deferred until the seams exist.
- The full 9-step swarm test pipeline — unchanged by this work.

---

## Part 3b: Cross-Cutting Concerns

- **Error handling strategy.** Each `*-mode-multica` atom must surface dispatch
  failures (agent UUID unresolved, daemon-down, poll timeout) as hard errors with the
  reason, not silent fallthrough. The routing path catches daemon-down and falls back
  multica→codex→direct (S4); the test path has no fallback (a missing tester is a hard
  error, since S3 unified the name).
- **Migration plan.** S2 is a behavioral migration: existing `.pHive/test-scenarios/*.yaml`
  are migrated in place to the canonical shape before any dispatch consumes them.
  Order matters — S2 lands before S5 (hard gate) precisely so no consumer reads the
  schema mid-migration.
- **Rollback plan.** Each slice is an isolated commit on the shared branch. The plan-half
  (S4) and test-half (S5) can be reverted independently. The multica spawn mode is
  opt-in (env/config override defaults off), so reverting wiring leaves direct/codex
  paths intact. Failed S6 demo reverts to no production impact (it adds no code).
- **Performance implications.** None in-scope. Dispatch is serial (one agent per role);
  daemon poll loops reuse the existing `pollTaskUntilTerminal` cadence.
- **Documentation impact.** Likely doc updates: `hive/references/test-scenario-schema.md`
  (S2, required), `.pHive/CONTEXT.md` glossary (add `cell`/squad-as-cell entry and
  reaffirm `Episode` — grill V1/V2), the two new `*-mode-multica` SKILL.md files (their
  own docs), and `planning-routing/SKILL.md` (third path). Flag for the
  post-implementation doc check: CONTEXT.md Terminology + Conventions.
- **Security considerations.** No new attack surface. Multica dispatch reuses existing
  authenticated daemon plumbing from `multica-init`. The backend-split convention
  (Codex for work / Claude for verify) is a cost/quality control, not a security
  boundary, but C2 (honoring `agent_backends`) must hold so dispatch doesn't silently
  bypass the intended routing.

---

## Part 4: File Change Manifest

Grouped by slice; tagged `new` | `modified` | `confirm-only`. `dispatchStoryToSquad`
is CONDITIONAL on the S1 spike result.

```
FILES:

S1 — Squad-as-cell spike (FORK POINT)
  confirm-only:
    - .pHive/multica/squads.yaml — confirm planning-team-squad members seeded
    - .pHive/multica/agents.yaml — confirm member roles + record providers/models
  (artifact, not a repo file):
    - spike carrier verdict — recorded in the epic docs / commit message

S2 — Scenario-schema + loader reconciliation
  modified:
    - hive/references/test-scenario-schema.md — reconcile to ONE canonical shape
    - hive/lib/scenarios/load.mjs — loadScenario validates canonical shape, rejects foreign keys
    - .pHive/test-scenarios/*.yaml — migrate existing scenarios in place
  new:
    - hive/lib/scenarios/load.test.mjs (or sibling) — loader validation tests

S3 — Verdict-location + done-signal / marker shape
  modified:
    - hive/lib/multica-story-dispatch/episode-sync.mjs — non-SHA terminal marker
      (artifacts-committed + episode-terminal); reuse multica-run.yaml
    - skills/test/SKILL.md — §8 verdict home → canonical; manual_verdict.agent → `tester`
    - hive/workflows/steps/test/simulated-manual.md — verdict home → canonical (if cycle-state loses)
  decision (no standalone file):
    - canonical verdict home pinned (story-YAML manual_verdict vs cycle-state)
    - agent name unified to `tester`

S4 — Plan-half dispatch
  new:
    - skills/hive/skills/plan-mode-multica/SKILL.md — new atom paralleling execute-mode-multica
  modified:
    - skills/hive/skills/planning-routing/SKILL.md — Step 0.3 third spawn mode + multica→codex→direct fallback
    - skills/plan/SKILL.md — Phase 0 invokes routing with multica path; override key (Decision 2)
    - hive/lib/multica-story-dispatch/index.mjs — carry backend split per S1 verdict
  conditional (depends on S1 spike = squad-as-unit AND dispatchStoryToAgent insufficient):
    - hive/lib/multica-story-dispatch/index.mjs :: dispatchStoryToSquad — NEW sibling helper

S5 — Test-half dispatch
  new:
    - skills/hive/skills/test-mode-multica/SKILL.md — symmetric sibling atom
  modified:
    - skills/test/SKILL.md — execution section invokes test-mode-multica
    - hive/workflows/steps/test/simulated-manual.md — executor contract routes through test-mode-multica

S6 — Full cycle integration
  (no new production files)
    - demo workstream run; episode capture verification only

CROSS-CUTTING (any slice, flagged for doc check)
  modified:
    - .pHive/CONTEXT.md — add `cell`/squad-as-cell glossary entry; reaffirm `Episode` (grill V1/V2)

UNCHANGED (but affected — confirm still works)
  - skills/hive/skills/execute-mode-multica/SKILL.md — the pattern being mirrored; index.mjs
    changes (backend split / dispatchStoryToSquad) must not break it
  - hive/lib/multica-story-dispatch/episode-sync.mjs consumers — pollTaskUntilTerminal /
    writeMulticaRunEpisode reused as-is by all three mode atoms
  - skills/multica-init/SKILL.md + hive/lib/multica-bootstrap — prerequisite, must be live
```

---

## Part 5: Risk Registry

Folds in the grill findings (H1, H2, U1, U2, U3, C1, C2, V1, V2 + the 5
inconsistency_risk_signals) with mitigation and owning slice.

| # | Risk | Severity | Likelihood | Mitigation | Owner |
|---|------|----------|------------|------------|-------|
| 1 | **Squad-dispatch primitive may not exist** (grill H1): only `dispatchStoryToAgent` (single-agent) confirmed; no squad-assign API verified | high | med | S1 spike confirms/denies before any wiring; if absent, the carrier collapses to per-persona fan-out and S4–S6 internals reshape (not reorder) | S1 |
| 2 | **Squad-as-one-task collapses the Codex/Claude backend split** (grill C1): one squad task on one runtime cannot honor per-persona providers | high | med | S1 spike observes provider per member; if leader-only, S4 fans one issue per persona reading `agent_backends` | S1 → S4 |
| 3 | **Multica spawn path silently bypasses `agent_backends` routing** (grill C2): the spawn path must carry the same routing planning-routing's codex path enforces today | high | med | S4's `plan-mode-multica` reads `agent_backends` and routes each persona; verified in S4's round-trip | S4 |
| 4 | **Scenario-schema drift** (grill / risk-signal HIGH): two divergent shapes (`invocation/expectations` vs `mode/steps`) | high | high (exists today) | S2 reconciles to one canonical shape, migrates scenarios in place, loader rejects foreign keys; HARD GATE before S5 | S2 |
| 5 | **Done-signal gap** (grill / §9.5 HIGH): no code-push SHA for doc/verdict tasks ⇒ poller can't reach terminal | high | high (exists today) | S3 defines artifacts-committed + episode-terminal marker in episode-sync.mjs, reusing multica-run.yaml; HARD GATE before S5 | S3 |
| 6 | **Verdict-location divergence** (grill U3): cycle-state vs story-YAML `manual_verdict` — two homes for one verdict | med | high (exists today) | S3 pins ONE canonical home, updates both consumers; tester writes one place | S3 → S5 |
| 7 | **Verdict-agent vocab clash** (grill V3 / risk-signal): `test-worker` vs `tester` (×3 names) breaks `resolveAgentUuidByName` | med | med | S3 unifies to `tester` (roster name); S1 confirms roster has it | S3 |
| 8 | **Third spawn path has no fallback on daemon-down** (risk-signal spawn-path duality) | med | med | S4 ships multica→codex→direct fallback IN-slice | S4 |
| 9 | **Plan-via-Multica payoff may be marginal** (grill H2): moving an already-working cycle onto a new substrate | med | low | Justified by §9.4 framing (uniform substrate + autopilot triggering for the full cycle); S4 keeps the override opt-in so direct/codex stay default until proven | S4 |
| 10 | **Read-only-docs vs serial-against-trunk** (grill U2): doc/verdict writes are still writes that must rebase-push | med | med | S3/S4 treat doc/verdict writes under the fresh-checkout/rebase-push contract (relaxed only on the SHA-comment, not the rebase); marker/poller designed accordingly | S3/S4 |
| 11 | **`cell` is undefined vocabulary** (grill V1): "cell"/"squad-as-cell"/"cell-as-squad" used interchangeably, not in CONTEXT.md | low | high | Add a CONTEXT.md glossary entry pinning `cell` = (per S1) a Multica squad or a per-story squad instance; prevents downstream drift | cross-cutting |
| 12 | **Marker dialect proliferation** (grill V2): risk of inventing a new marker vs reusing `multica-run.yaml` Episode | med | med | S3 explicitly REUSES multica-run.yaml with a new terminal-derivation rule; no second marker shape | S3 |
| 13 | **S2 migration breaks existing scenarios** | med | med | loader tests + migrate-in-place before any dispatch consumes the schema | S2 |
| 14 | **S6 parallel plan+test cells contend on one branch** | med | low | serial-against-trunk fresh-checkout/rebase-push; single agent per role | S6 |

**Detailed mitigation for the two HIGH gate risks (#4, #5):**
These two are the locked hard gate (§9.5). S5 (test dispatch) is *un-pollable* until
both close. S2 reconciles the scenario shape (the thing the tester replays); S3 defines
the terminal marker (the thing the poller drives to done). Both are doc/loader-only
changes with no downstream consumer yet, so they are low-blast-radius to land early —
the cost of getting them wrong is bounded to the loader tests and the marker assertion,
not a corrupted dispatch.

---

## Part 6: Dependency Map

```
INTERNAL DEPENDENCIES:
  S1 (spike)        → blocks S4, S5, S6 (carrier verdict feeds every dispatch design)
  S2 (schema)       → blocks S5  (canonical scenario shape to replay)  [parallel to S1]
  S3 (verdict/marker) depends_on S2; → blocks S5  (terminal marker + verdict home)
  S2 + S3           → HARD GATE before S5 (both must close)
  S4 (plan-half)    depends_on S1; → provides lib glue reused by S5
  S5 (test-half)    depends_on S2+S3 (hard gate), S1, S4
  S6 (full cycle)   depends_on S4, S5 (+ a real /execute between)

  Layer-level (horizontal plan §3):
    plan-mode-multica   → multica-story-dispatch (dispatch+poll helpers)
    test-mode-multica   → multica-story-dispatch (dispatch+poll helpers)
    multica-story-dispatch → marker contract (non-SHA terminal shape, S3)
    plan-mode-multica   → squad carrier verdict (S1)
    test-mode-multica   → scenario schema/loader (S2) + verdict home + agent name (S3)
    planning-routing 0.3 → plan-mode-multica
    /plan Phase 0       → planning-routing
    /test + sim-manual  → test-mode-multica
    all dispatch        → squads substrate (member roles in agents.yaml)
    all dispatch        → multica-init bootstrap (daemon/agents live)

EXTERNAL DEPENDENCIES:
  #230 (squads/agents) — MERGED (commit 1112d04); provides the squads primitive and the
    post-#230 worktree agents.yaml/squads.yaml.
  hive/lib/multica-story-dispatch/ (index.mjs + episode-sync.mjs) — reused library.
  multica-bootstrap + multica-init skill — daemon/CLI/auth/workspace/daemon/agents
    bootstrap; MUST be live before any dispatch.

BLOCKING QUESTIONS (resolved at sign-off — see Part 8):
  - Does Multica support assigning a task to a SQUAD vs a single AGENT? (answered by S1)
  - Canonical verdict home: story-YAML vs cycle-state? (Decision 1)
  - Exact env/config key names for the plan-half multica override? (Decision 2)
```

---

## Part 7: Elicitation — Stress-Testing This Plan

The team's own adversarial self-critique. Honest answers, not hand-waves.

### Why Won't This Work?

**1. The spike shows leader-only squad execution, silently dropping the backend split.**
- **Failure:** S1 finds Multica runs only the squad leader, not the members. A squad
  task lands on one runtime, collapsing the Codex/Claude per-persona split.
- **Trigger:** Multica's squad semantics are leader-dispatch, not member-fan-out
  (grill H1/C1 say this is genuinely unconfirmed).
- **Impact:** "squad-as-cell" is unbuildable as the carrier; S4–S6 must use per-persona
  fan-out instead.
- **Signal:** S1's recorded carrier verdict — visible *before* any wiring exists.
- **Our answer:** This is exactly why S1 is a spike and a fork point, not an assumption.
  A leader-only result does NOT break the plan — it reshapes S4–S6 *internals*
  (per-persona fan-out, one Multica issue per persona, each routed by `agent_backends`)
  while the slice boundaries and ordering hold (vertical plan §6 moldability). The
  per-persona branch is arguably the *safer* shape because it makes the backend split
  explicit at the dispatch layer rather than trusting the substrate to preserve it.

**2. The done-signal marker never reaches terminal, so the poller hangs.**
- **Failure:** A doc/verdict task with no SHA never trips the terminal predicate;
  `pollTaskUntilTerminal` loops forever or times out.
- **Trigger:** The "artifacts-committed" half of the marker can't be observed (e.g., the
  agent commits but the marker isn't updated, or commit detection is racy).
- **Impact:** Every plan and test dispatch hangs; the cycle can't complete.
- **Signal:** S3's automated episode-marker terminal-status assertion for a non-SHA task
  fails *before* any real dispatch consumes it.
- **Our answer:** The marker terminates on **artifacts-committed AND episode-terminal**.
  Concretely: the dispatched agent commits its artifacts to the shared branch (the same
  commit that the rebase-push contract already produces), and writes the episode status
  to terminal in `multica-run.yaml` (reusing the existing writer). The poller's terminal
  predicate is `episode.status ∈ terminal-set && artifacts_committed`. This reuses the
  exact mechanism `/execute` already drives to terminal — the only new part is deriving
  "done" from episode status rather than from a pushed-code SHA. S3 asserts this in
  isolation so a broken predicate is caught at the gate, not in production.

**3. The Multica spawn path bypasses `agent_backends`, silently undoing the cost split.**
- **Failure:** `plan-mode-multica` dispatches to squad/agent UUIDs without carrying the
  Codex/Claude routing, so verification work runs on Codex (or vice versa).
- **Trigger:** The new path hands work to a UUID and trusts the substrate's defaults.
- **Impact:** Silent convention violation (grill C2); cost/quality split lost; no error.
- **Signal:** S4's round-trip can assert each persona resolved to its expected provider.
- **Our answer:** `plan-mode-multica` reads `agent_backends` and routes each persona
  explicitly (the per-persona branch makes this trivial; the squad-as-unit branch relies
  on the S1-confirmed substrate behavior, and S1 explicitly records the provider per
  member so we don't trust it blindly). The round-trip verification checks provider
  assignment, not just task completion.

**4. Reconciling the scenario schema breaks every existing scenario.**
- **Failure:** S2's migration changes the shape and existing `.pHive/test-scenarios/*.yaml`
  no longer load.
- **Trigger:** A scenario uses a foreign key (`invocation`/`expectations`) that the new
  loader rejects.
- **Impact:** `/test` can't replay any pre-existing scenario.
- **Signal:** S2's loader tests run on the migrated scenarios — a failed migration fails
  the tests immediately.
- **Our answer:** S2 migrates scenarios *in place* and the loader tests assert all
  migrated scenarios pass AND the foreign shape errors. Nothing downstream reads the
  schema yet (S5 is gated behind S2), so the migration window has zero live consumers.

**5. Routing `/plan` through Multica drops the user review gates.**
- **Failure:** The Multica spawn path runs the planning team autonomously and skips the
  collaborative-review / gate-decisions checkpoints that `/plan` enforces today.
- **Trigger:** `plan-mode-multica` owns the team lifecycle and returns only a summary;
  the human gate isn't re-inserted.
- **Impact:** Plans land without the user sign-off that §9 itself came from.
- **Our answer:** This is a real hazard and the answer is a hard design constraint:
  `plan-mode-multica` changes only *who runs the personas* (Multica vs direct/codex), NOT
  the *phase structure* of `/plan`. The gate decisions and collaborative review live in
  `skills/plan/SKILL.md`'s phase sequence (Phase B gate, Phase A2 grill, the
  gate-decisions-marker), which is orchestrated by the caller, not inside the spawn atom.
  The spawn atom dispatches a single phase's team and returns; the caller (`/plan`) still
  drives the inter-phase gates. S4's spec-walk must explicitly confirm the review gate
  still fires when the multica path is active. If it doesn't, the path is wrong.

### What Assumptions Are We Making?

- **VERIFIED — `/execute` already reaches Multica via a clean single dispatch point.**
  (research brief §A: `execute-dispatch` → `execute-mode-multica`, 5+2 reused helpers.)
- **VERIFIED — the dispatch lib exposes reusable poll/episode helpers.**
  (`pollTaskUntilTerminal`, `writeMulticaRunEpisode` reused as-is; research brief §A.)
- **VERIFIED — `/plan` Phase 0 / planning-routing Step 0.3 is the spawn seam, with only
  two paths today (direct, codex) and a codex→direct fallback.** (research brief §B.)
- **VERIFIED — scenario-schema drift and verdict-location divergence exist today.**
  (risk-signals + grill U3; this is why S2/S3 are the gate.)
- **VERIFIED — #230 merged; squads.yaml defines planning-team-squad / verify-team-squad.**
  (research brief Dependencies + Substrate inventory.)
- **ASSUMED — reusing `multica-run.yaml` as the doc/verdict marker (with a new terminal
  rule) is cleaner than a new marker.** Reasonable: it avoids two marker dialects
  (grill V2) and the writer already exists. Comfortable proceeding; S3 proves it.
- **ASSUMED — the per-persona fan-out branch can route via `agent_backends`.** The codex
  path enforces this today; the multica path mirrors that read. Comfortable.
- **RISKY — squad-as-unit dispatch is a real Multica primitive that preserves the
  backend split.** If wrong (S1 = leader-only), S4–S6 internals change to per-persona
  fan-out and `dispatchStoryToSquad` is NOT added. This is the single biggest unknown
  and is deliberately the first slice.
- **RISKY — plan-via-Multica has net value over direct/codex spawn.** (grill H2.) If the
  payoff is marginal, the plan-half could be deferred and the workstream narrowed to
  test-only. Mitigated by keeping the override opt-in (default off) so we can prove
  value before committing the cycle to it.

### What's the Simplest Version?

- **Must have:** S2 (canonical scenario shape) + S3 (terminal marker + verdict home +
  agent name) — these are pre-existing bugs that block *any* test dispatch and are worth
  fixing regardless. S5 (test-half dispatch) — the test framing (§9.4) is the stated WHY
  of the whole workstream. S1 (spike) — without it we can't safely wire anything.
- **Should have:** S4 (plan-half dispatch) — completes the mirror and gives a uniform
  substrate, but plan already works via direct/codex (grill H2). High value for symmetry;
  medium cost (new atom + third spawn path + fallback).
- **Could cut:** S6 (full-cycle demo) could be deferred — S4 and S5 each prove their half;
  the end-to-end loop is confirmation, not new capability. We'd lose the integrated proof
  that the three phases compose on one branch. Also cuttable: routing `/plan` through
  Multica at all (cut S4) — narrows to a test-only workstream with far less risk if the
  gate prefers it (this is Decision 4).

### What Will We Wish We Had Thought Of?

- **Technical debt:** the conditional `dispatchStoryToSquad` helper. If S1 = squad-as-unit
  we add it; if we later move to per-persona fan-out we'd have a half-used helper. Accepted
  now because S1 resolves the branch before we write it.
- **Edge cases deferred:** multi-agent parallel dispatch and branch-contention under true
  parallelism. Safe to defer — one agent per role keeps execution serial; the integration
  contract re-tightens when multi-agent runtimes land.
- **Integration points not fully validated:** whether Multica's episode status genuinely
  goes terminal for a non-pushed-SHA task. S3 validates this in isolation; if it can't, the
  whole done-signal premise needs rework — which is why S3 is a gate, not an afterthought.
- **User workflows not considered:** what happens when the daemon dies *mid-cycle* in S6
  (not at dispatch start). S4's fallback covers dispatch-time daemon-down; a mid-poll death
  is a poll-timeout → STOP-and-report, relying on fresh-checkout to recover on retry.

### Where Are We Over-Engineering?

- **Two new symmetric atoms (Option A) when the lighter seam (Option B) was the author's
  lean.** The gate chose A for cross-phase symmetry with `/execute`. The honest read:
  Option B (one shared helper) is less surface; A's payoff is maintainability and a
  uniform mental model across all three phases. The gate locked A — we honor it — but if
  the maintainer reconsiders, B is a smaller change (Decision is in §9, already locked;
  noted here for transparency).
- **Modeling a parallel-gate enum.** We are NOT — plan docs are read-only and the gate is
  moot; we deliberately omit the `mode_decision` parallel-gate machinery for the plan/test
  seams. This is the one place we resisted mirroring `/execute` exactly.
- **A CONTEXT.md glossary entry for `cell`.** Arguably overhead for a single workstream,
  but the term is load-bearing across S1, S4, S5 and undefined today (grill V1); pinning it
  once is cheaper than letting three slices drift its meaning.

---

## Part 8: Decision Points for Sign-Off

```
DECISIONS REQUIRING SIGN-OFF:

1. [APPROACH] Canonical verdict home — story-YAML `manual_verdict` block vs
   `.pHive/cycle-state/<epic-id>.yaml`. We recommend the story-YAML block (verdict is
   story-scoped and travels with the story record; cycle-state becomes a derived view).
   This is pinned in S3 and the un-chosen consumer is updated to match.
   → Affirm story-YAML / Change to cycle-state

2. [NAMING] New env/config keys for the plan-half Multica override. We propose
   `env.HIVE_PLANNING_MODE == "multica"` OR root `hive.config.yaml` `planning.mode: multica`,
   mirroring `/execute`'s `HIVE_EXECUTION_MODE` / `execution.mode`. Test-half would mirror as
   `HIVE_TEST_MODE` / `test.mode` if a separate override is wanted (else it follows the same
   key). Confirm the exact key names so S4/S5 wire them consistently.
   → Affirm proposed names / Change to {your names}

3. [SCOPE] Ship the plan-half (S4) and test-half (S5) as SEPARATE PRs, or one combined PR.
   The slices are independently revertible and S4 lands first (read-only docs, lower
   contention). We recommend two PRs (plan-half PR, then test-half PR) so the third spawn
   path is reviewed and de-risked before verdict writes appear.
   → Affirm two PRs / Combine into one PR

4. [SCOPE] Keep the plan-half (S4) in this workstream, or narrow to test-only and defer
   plan-via-Multica? Grill H2 questions plan-via-Multica's net value over direct/codex. We
   recommend KEEPING S4 (completes the mirror; override stays opt-in so value can be proven
   before default-on), but the marginal-payoff concern is real.
   → Affirm keep S4 / Narrow to test-only

5. [APPROACH] S6 dogfood target — run the full-cycle demo on a REAL workstream (e.g., a
   small genuine epic) or a THROWAWAY workstream? Real gives a truer end-to-end signal but
   commits real artifacts to a real branch; throwaway is safer but less convincing. We
   recommend a throwaway workstream for S6 (the proof is the dispatch mechanics, not the
   artifact value), reserving a real dogfood for a follow-up.
   → Affirm throwaway / Use a real workstream

6. [RISK ACCEPTANCE] The S1 spike may return "leader-only," forcing per-persona fan-out and
   making `dispatchStoryToSquad` unnecessary (the squad-as-cell framing becomes aspirational).
   We accept this risk: the fork reshapes S4–S6 internals without reordering slices.
   → Accept fork-reshape risk / Require a squad-dispatch confirmation before committing the plan

7. [TRADE-OFF] We chose Option A (two new symmetric atoms) per the locked §9 gate over the
   lighter Option B (one shared helper) — trading more surface area for cross-phase symmetry
   with `/execute`. Already locked at the gate; confirm it still stands now that the full
   surface (Part 4 manifest) is visible.
   → Affirm Option A / Reconsider Option B
```
