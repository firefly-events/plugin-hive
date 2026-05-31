# Design Discussion — multica-plan-test-cycles

> Discussion draft. Tensions are deliberately left OPEN — this is a conversation
> starter for the review gate, not a locked design. Source: `research-brief.md` +
> `_raw-findings.md`.

## 1. What Are We Doing?

We want `/plan` (the planning cycle) and `/test --simulated-manual` (the
simulated-testing cycle) to dispatch through **Multica**, the same way `/execute`
already does via `execute-dispatch` → `execute-mode-multica`. Today `/execute` hands
each story to a Multica `developer` agent, polls to terminal, and drops an episode
marker. Planning and testing have **no Multica dispatch at all** — planning spawns
teammates locally (direct `TeamCreate` or Codex), and `--simulated-manual` runs a
local executor step.

The carrier we want to reuse is the **squads** primitive from #230: hand the planning
team to `planning-team-squad` and the test scenario to a Multica `tester` (or
`verify-team-squad`). "Done" looks like: a `/plan` run produces its design docs and a
`/test --simulated-manual` run produces its verdict, both via Multica-dispatched
agents, committed to the single shared epic branch — with a defined completion marker
that is NOT a code-push SHA, because neither cycle pushes source.

## 2. What I Found

- **The dispatch shape to mirror** lives in `skills/hive/skills/execute-dispatch/SKILL.md`
  (Step 0 resolves `mode_decision`, line 44/64) and `execute-mode-multica/SKILL.md`
  (owns dispatch→poll→marker lifecycle, line 8). The reusable plumbing is
  `hive/lib/multica-story-dispatch/index.mjs` (5 helpers) + `episode-sync.mjs`
  (`pollTaskUntilTerminal`, `writeMulticaRunEpisode`).
- **`/plan`'s spawn seam** is `skills/hive/skills/planning-routing/SKILL.md` Step 0.3,
  which today knows only **two** paths — direct `TeamCreate` and Codex
  `agent-spawn → codex-invoke` (line 19–21, 56+). No Multica. The only existing
  Multica touch in `/plan` is Phase D `createStory` through the task-tracking adapter
  — that publishes story *records*, not team dispatch.
- **`/test --simulated-manual`** resolves a scenario via `hive/lib/scenarios/load.mjs`
  `loadScenario`, walks `steps[]`, writes a `manual_verdict` (`skills/test/SKILL.md:37`+;
  executor `hive/workflows/steps/test/simulated-manual.md`). Scenarios are authored at
  plan-time by Phase C with `agent: tester` (`plan/SKILL.md:519`).
- **The substrate** (`.pHive/multica/squads.yaml`, worktree) already defines
  `planning-team-squad` (leader tpm) and `verify-team-squad` (leader peer-validator) —
  so a multi-role cell already exists as a named object. **But** `verify-team-squad`
  references `test-architect`/`test-scout`/`security-reviewer`, and I have not
  confirmed those are seeded in `agents.yaml`.
- **The integration invariant** (`.pHive/epics/multica-substrate-deepen/docs/integration-principle.md`):
  single shared branch `feat/<epic-id>`, serial-against-trunk, fresh-checkout/rebase-push,
  **SHA in the final comment**. That last bit is the rub — plan/test don't produce a SHA.

## 3. My Proposed Approach

I'll frame two candidate shapes rather than pick one — this is the central question
for the gate.

**Option A — full mirror ("multica mode" for each skill).** Add a dispatch atom to
both skills paralleling `mode_decision`: a planning-side resolver that, on a
multica override, routes Step 0.3's spawn to a third path (`TeamCreate` | codex |
**multica**), handing the assembled personas to `planning-team-squad`; and a
test-side resolver that hands the scenario to a Multica `tester` / `verify-team-squad`.
Each gets its own `*-mode-multica` atomic skill that reuses
`multica-story-dispatch` + `episode-sync`, writing episode markers under the same
`${HIVE_STATE_DIR}/episodes/...` tree. Maximal symmetry with `/execute`; maximal new
surface (two new mode skills, a new spawn path with fallback wiring, a generalized
dispatch atom).

**Option B — lighter seam.** Because plan/test produce docs/verdicts (not commits),
skip the full `mode_decision` machinery. Add a single thin "dispatch this cell to a
squad" helper that both skills call: `/plan` hands `planning-team-squad` one task;
`/test` hands the scenario to `tester`. Reuse `dispatchStoryToAgent` /
`pollTaskUntilTerminal` directly, define a doc/verdict episode marker, and don't model
a parallel-gate enum (plan docs are `read-only`, so the gate is moot). Less symmetry,
far less surface, but two skills now have a bespoke seam instead of a shared one.

My lean is **Option B for the seam plus a hard prerequisite: reconcile the scenario
schema first** (see §4) — but the gate should decide. Either way, the **done-signal**
must be redefined: a doc/verdict task completes on **artifacts committed to the epic
branch + episode marker terminal status**, not a pushed-code SHA.

## 4. What Could Go Wrong

- **Scenario-schema drift — HIGH (blocks test dispatch).** `test-scenario-schema.md`
  declares `invocation`/`pre_conditions`/`expectations`/`sandcastle_mode_override`;
  the loader + executor expect `mode`/`steps[{action,expected}]`/`preconditions`/`postconditions`.
  Two incompatible shapes. A Multica `tester` told to "replay the scenario" can't know
  which it's getting. This must be reconciled before any test dispatch is wired.
- **Done-signal gap — HIGH.** The integration principle's completion contract is
  "final comment carries the SHA" (`integration-principle.md:36`). Plan/test push no
  source. If we dispatch without first defining the marker shape, the poller has no
  terminal it can trust. Needs an explicit decision (artifacts + episode marker).
- **Squad↔roster mismatch — MEDIUM.** `verify-team-squad` names
  test-architect/test-scout/security-reviewer; if those aren't in `agents.yaml`,
  dispatching the squad-as-cell fails or silently drops roles. Confirm before relying
  on the squad object. Same risk for `planning-team-squad` members.
- **Verdict-agent vocab clash — MEDIUM.** `test/SKILL.md` writes
  `manual_verdict.agent: test-worker`; Phase C seeds `agent: tester`; the roster names
  `tester`. Three names for one role. Multica dispatch must pick one canonical name or
  the assignee resolution (`resolveAgentUuidByName`) misses.
- **Serial-invariant interaction — MEDIUM.** Plan docs are `read-only` so they don't
  contend on trunk, which *relaxes* the serial constraint — but if a Multica planning
  cell and a test cell run against the same branch, fresh-checkout/rebase-push still
  has to hold for whatever each *does* write (docs, scenario YAMLs, verdict YAMLs).
  Don't assume read-only means no branch coordination.
- **Planning third-spawn-path complexity — MEDIUM.** planning-routing today has a
  codex→direct fallback (line 48–54). Adding multica as a third mode means defining
  *its* fallback (multica→? on daemon-down) and an INFO-log vocabulary extension. This
  is real wiring, not a config flag.
- **Mode-enum scope mismatch — LOW/MEDIUM.** `mode_decision` carries story +
  parallel-gate semantics that plan/test don't have. Reusing the enum verbatim would
  drag in irrelevant gate logic; mirroring it means a *new* atom, not reuse.

## 5. Dependencies and Constraints

- **#230 (squads/agents)** — merged (commit `1112d04`); provides `squads.yaml` and the
  post-#230 worktree `agents.yaml`. Prerequisite, satisfied.
- **`hive/lib/multica-story-dispatch/`** (`index.mjs` + `episode-sync.mjs`) — the
  dispatch/poll/marker library both new seams would reuse.
- **`multica-init` bootstrap** (`skills/multica-init/SKILL.md` + `multica-bootstrap/index.mjs`)
  — server/CLI/auth/workspace/daemon/agents must be live before any dispatch runs.
- **Integration principle** — single shared branch + serial-against-trunk; binding on
  whatever plan/test write.
- **Scenario schema** (`hive/references/test-scenario-schema.md` vs `load.mjs`) — a
  blocking divergence that gates the test half of this work.

## 6. Open Questions

1. **Plan-via-Multica, or route test only?** Do we dispatch *both* cycles through
   Multica now, or keep `/plan` local (it already has working direct/codex spawn) and
   only route `/test --simulated-manual`? Planning's value-add from Multica is less
   obvious than execution's.
2. **Reconcile the scenario schema as a prerequisite story?** Should schema
   reconciliation (`invocation`/`expectations` vs `mode`/`steps`) be its own
   blocking story *before* any test dispatch is wired? I think yes — it's a hard
   blocker — but confirm.
3. **Planning team: one squad task or per-persona issues?** Hand `planning-team-squad`
   a *single* task that the squad runs internally, or fan out one Multica issue per
   persona (researcher/architect/writer/tpm)? Squad-as-cell vs roster-as-fanout.
4. **What is the canonical done-signal / marker shape for doc/verdict tasks?** Since
   there's no code-push SHA: artifacts-committed + episode-marker-terminal? A new
   marker field? This must be pinned before dispatch can poll to terminal.
5. **Does cell-as-squad belong in THIS workstream or a sibling?** The salvaged
   cell-as-squad idea (treating a squad as a dispatchable multi-role unit) could be
   foundational here, or it could be its own epic that this one merely *consumes*.

## 7. Verification Strategy

How we'd verify the dispatch seams actually work — fittingly, via the very
`--simulated-manual` cycle this workstream touches, plus the existing Multica
round-trip pattern.

```
VERIFICATION PLAN:
  Tools: /test --simulated-manual (spec-walk + implementation-walk),
         hive/lib/scenarios/load.mjs validation, episode-marker inspection,
         Multica daemon round-trip (as in #230 w4-5 pilot-roundtrip-validation)
  Platforms: local Multica daemon (Podman); single-agent-per-role roster
  Automated: scenario-schema loader validation; episode-marker terminal-status
             assertions; dispatch→poll→marker round-trip for one planning cell
             and one test cell
  Manual: spec-walk scenario confirming /plan emits docs via Multica;
          spec-walk scenario confirming /test produces a verdict via Multica tester
  Not verifying: multi-agent parallel dispatch (out of scope — one agent per role
             today; re-tightens later per integration principle); load/perf of the
             daemon; the full 9-step swarm test pipeline (unchanged by this work)
```

The verdict-target divergence (story YAML §8 vs `.pHive/cycle-state/<epic-id>.yaml`)
should be settled as part of verification so the test cell writes to one agreed place.

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~8-14
    (planning-routing/SKILL.md, plan/SKILL.md, test/SKILL.md,
     simulated-manual.md, test-scenario-schema.md + load.mjs reconciliation,
     1-2 new *-mode-multica atomic skills, multica-story-dispatch reuse glue,
     squads.yaml/agents.yaml confirmation)
  Subsystems: planning cycle, simulated-test cycle, Multica dispatch lib,
              scenario schema/loader, squads substrate
  Migration required: yes (scenario-schema reconciliation is a behavioral migration)
  Cross-team coordination: no (single maintainer), but cross-skill coordination: yes
  Unknowns: 5 (the open questions above), at least 2 of them blocking

  RECOMMENDATION: Medium — Needs structured outline before story decomposition
  RATIONALE: This spans three skills (/plan, /test, planning-routing), introduces a
    new dispatch seam (third spawn path and/or new mode atom), AND requires a
    blocking schema reconciliation before the test half can land. That's a
    multi-front change with a hard prerequisite and an unresolved foundational
    decision (full mirror vs lighter seam; squad-as-cell scope). It is not Small —
    a single design discussion doesn't sequence the schema-first dependency or the
    plan-vs-test split cleanly. It is not Large — it's bounded to known files, reuses
    existing dispatch plumbing, and runs on a single-agent roster (no parallelism
    design needed yet). A structured outline should resolve the schema-first ordering
    and the spawn-seam shape before stories are written.

<!-- gate-decisions-marker -->

## 9. Gate Decisions (locked 2026-05-28)

User review gate resolved the open questions:

1. **Seam shape → Option A (full mirror).** Build `plan-mode-multica` and
   `test-mode-multica` atomic skills symmetric with `execute-mode-multica`, each
   with its own dispatch atom. Rationale: the cycle is **plan → execute → test**;
   keeping all three dispatch shapes consistent is worth the extra surface.
2. **Squad model → spike squad-as-cell first.** A bounded foundational story
   assigns a throwaway task to `planning-team-squad` and observes whether Multica
   distributes work across member-agents (each on its `agents.yaml` provider —
   which would preserve the Codex/Claude split for free) or runs only the leader.
   The spike result picks the carrier (squad-as-unit vs per-persona fan-out) for
   the real plan-dispatch stories. Resolves grill H1 + C1.
3. **Scale → Large.** Run H/V planning + a structured outline before story
   decomposition.
4. **Framing.** `/test --simulated-manual` is the **verification checkpoint** that
   execution matched the plan — the manual-style pass that catches false
   positives/negatives unit/integration tests miss. This is the WHY for routing
   test through Multica as the cycle's final gate.
5. **Blocking foundational stories (locked).** Scenario-schema reconciliation
   (`invocation/expectations` vs `mode/steps`) + verdict-location divergence
   (cycle-state vs story YAML) MUST land before any test dispatch; the
   doc/verdict **done-signal / episode-marker shape** must be defined before any
   dispatch can poll to terminal.
```
