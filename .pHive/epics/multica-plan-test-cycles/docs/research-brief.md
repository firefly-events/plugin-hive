# Research Brief — multica-plan-test-cycles

> Synthesized from `_raw-findings.md` (researcher pass, 2026-05-28) with source paths
> verified against the worktree at `feat/multica-plan-test-cycles`. Citations are
> `path:line` where a single line anchors the claim; otherwise `path` + section.

## Goal

Make Hive's **planning cycle** (`/plan`) and **simulated-testing cycle**
(`/test --simulated-manual`) dispatch through Multica, the way `/execute` already
does — honoring the substrate-deepen integration principle (single shared branch,
serial-against-trunk) and reusing the **squads** primitive as the carrier for
multi-role "cells."

---

## Current-state map

### A. The pattern to mirror — how `/execute` reaches Multica

The code path is a clean, single dispatch point we can study:

- `skills/execute/SKILL.md` step 5 → `skills/hive/skills/execute-dispatch/SKILL.md`
  is the **single dispatch point**.
- **Dispatch Step 0** resolves the run mode with source tracking
  (`skills/hive/skills/execute-dispatch/SKILL.md:44`, `:64`). An explicit override —
  `env.HIVE_EXECUTION_MODE == "multica"` **or** root `hive.config.yaml`
  `execution.mode: multica` — sets `mode_decision=multica`. Env wins over config
  (`execute-dispatch/SKILL.md:18`).
- Dispatch outputs the enum `mode_decision: sessions | team | team-cmux | sequential | sandcastle | multica`
  plus `mode_reason`, `runner_path`, `field_sources`, and `gate_violations[]`
  (`execute-dispatch/SKILL.md:16`).
- On `multica`, `skills/hive/skills/execute-mode-multica/SKILL.md` runs **once per
  parent workflow** (`execute-mode-multica/SKILL.md:8`).
  - **Inputs:** `workflow_path`, `unblocked_stories[]`, `appends_map` (DEFERRED v1),
    `epic_handle`, `hive_config` (`:20`–`:23`).
  - **Outputs:** per-story episode marker
    `${HIVE_STATE_DIR}/episodes/{epic_handle}/{story_id}/multica-run.yaml` +
    `.messages.jsonl` sidecar (`:27`–`:28`); summary back to caller.
  - **Reuses** `hive/lib/multica-story-dispatch/index.mjs` (5 helpers:
    `resolveAgentUuidByName`, `serializeStoryBrief`, `ensureIssueBriefMatches`,
    `dispatchStoryToAgent`, `moveOutOfBacklogIfNeeded`) and `episode-sync.mjs`
    (`pollTaskUntilTerminal`, `writeMulticaRunEpisode`) (`:150`–`:151`).
- **Dispatch mechanics:** `dispatchStoryToAgent` → `PUT(assignee_type/assignee_id)`
  → Multica enqueues. **Serial within depth** (`execute-mode-multica/SKILL.md:71`);
  the caller owns DAG advancement. Each Hive story = one Multica issue assigned to
  the bootstrapped `developer` agent (`:10`).

The shape to copy: **one atomic mode skill, selected by a dispatch atom, that owns
the per-unit lifecycle (dispatch → poll → terminal episode marker) and returns a
summary.**

### B. How `/plan` executes today

- `skills/plan/SKILL.md` Phase 0 → `skills/hive/skills/planning-routing/SKILL.md`.
- **Step 0.1** builds the team: researcher / technical-writer / tpm always;
  architect / ui-designer conditional (`planning-routing/SKILL.md:27`+, `:32`–`:34`).
- **Step 0.3** spawns across **TWO paths only**: direct `TeamCreate`, and Codex
  `agent-spawn → codex-invoke` (`planning-routing/SKILL.md:19`–`:21`, `:56`+). Mixed
  teams are valid; the fallback chain is codex→direct (`:48`–`:54`). **No Multica
  touch in planning-routing.**
- Phases: A research (research-brief), B design discussion, A2 grill
  (`grill-record.md`), B2 H/V, B3 structured-outline (large only), C story
  decomposition, D publishing.
- **Phase D is the ONLY existing Multica seam in `/plan`:**
  `TaskTrackingDispatch.invoke("createStory")` routes through the adapter
  (`github | linear | multica`) — but this publishes story **records**, not team
  dispatch (`_raw-findings.md` Q2).
- **Plausible "plan via Multica" seam:** Phase 0 / planning-routing's spawn step — a
  **new third spawn path** beside direct/codex.

### C. How `/test --simulated-manual` executes today

- `skills/test/SKILL.md`. Default = 9-step swarm pipeline
  (test-scout/architect/worker/inspector/sentinel) via `hive/workflows/steps/test/step-0N-*.md`
  — local orchestration, **no Multica**.
- `--simulated-manual <story-id|scenario-file>` skips steps 0–8 and runs
  `hive/workflows/steps/test/simulated-manual.md` (`test/SKILL.md:37`):
  - Resolve scenario: story `manual_verdict.scenario_ref` **or** direct path via
    `hive/lib/scenarios/load.mjs` `loadScenario` (`test/SKILL.md:23`, `:32`).
  - Eval `preconditions` → walk `steps[]` (`spec-walk` | `implementation-walk`) →
    eval `postconditions` → verdict `pass | fail | inconclusive`
    (`test/SKILL.md:39`–`:42`).
  - Verdict written to the story `manual_verdict` block, schema §8
    (`test/SKILL.md:44`) — **but the step file writes to
    `.pHive/cycle-state/<epic-id>.yaml`** (`simulated-manual.md:97`). Minor target
    divergence between SKILL and step file.
- Scenarios are authored at plan-time: `/plan` Phase C injects a `scenario` step,
  `agent: tester` (`plan/SKILL.md:519`, also `:361/:384/:411/:419`).
- **Seam:** the scenario-executor step (or the swarm `test-worker`) could dispatch to
  a Multica `tester`.

---

## Substrate inventory

### Agents — `.pHive/multica/agents.yaml` (worktree, 8.6KB, post-#230)

One agent per role. Per `_raw-findings.md` Q4: creators
(developer/backend/frontend/researcher/architect/technical-writer) `provider: codex`;
verifiers (reviewer/peer-validator/tester/tpm) `provider: claude`,
`model: claude-opus-4-7`, `max_concurrent_tasks: 1`. (Note: an older
`multica-bootstrap-*/agents.yaml` snapshot showed `developer`/`tester` on
`claude/claude-sonnet-4-6` — confirm the live roster's providers/models against the
8.6KB worktree file before wiring.) The **repo-root** `.pHive/multica/agents.yaml` is
only 880B and has no squads — the worktree carries the merged #230 version.

### Squads — `.pHive/multica/squads.yaml` (worktree, verified verbatim)

Three squads; a squad **does** represent a multi-role cell (name / leader / members):

| Squad | Leader | Members |
|-------|--------|---------|
| `planning-team-squad` | `tpm` | researcher, architect, technical-writer, tpm |
| `dev-team-squad` | `reviewer` | developer, backend-developer, frontend-developer, reviewer |
| `verify-team-squad` | `peer-validator` | tester, test-architect, test-scout, peer-validator, security-reviewer |

Autopilots are agent-bound, not squad-bound (`_raw-findings.md` Q4).
`hive/lib/multica-bootstrap/index.mjs` seeds agents and reconciles squads/skills
(`reconcileSquads`, `reconcileSkills`, `reconcileAutopilots` per #230 log).

**Caveat (verified):** `verify-team-squad` lists `test-architect` / `test-scout` /
`security-reviewer`. These names must be confirmed present in `agents.yaml` before
treating squad-as-cell as dispatchable — squads can reference roles the roster does
not seed.

---

## Integration invariant & the docs/verdicts-vs-commits distinction

Source: `.pHive/epics/multica-substrate-deepen/docs/integration-principle.md`
(present in worktree).

- **Single shared branch:** all dispatched work commits to ONE epic branch
  `feat/<epic-id>`; the daemon per-task worktree branch is overridden in the brief
  (`integration-principle.md`, Branching dimension).
- **The invariant is execution-serialness against latest trunk, NOT dispatch
  sequencing** (`integration-principle.md:28`). Dispatch fanout is just
  queue-ordering; with one agent per role, execution is serial by single-agent
  bottleneck (`:30`).
- **Fresh-checkout at start** (`fetch + checkout + reset --hard origin/<branch>`,
  `:32`); **rebase-then-push at end** (retry 3×, STOP and post conflict diff on
  rebase conflict, `:34`); **final comment carries the SHA** (`:36`).
- Parallel dispatch is safe **only** while one agent per role; the contract
  re-tightens when multi-agent runtimes land (the non-overlap gate must hold:
  `parallel_allowed` + `read-only | bounded-slice`).

**The key distinction for this workstream — docs/verdicts vs commits:**
The `/execute` contract is **code-mutation push** (rebase/push + SHA comment). But:

- `/plan` produces **DOCS** under `.pHive/epics/{id}/docs/` — annotated
  `parallel_rationale: read-only`, no production source writes.
- `/test --simulated-manual` produces **VERDICTS / scenarios**.

Neither pushes source, so the rebase-push / SHA-comment **done signal is largely
inapplicable**. The "done signal" for a doc/verdict task must be defined differently
— **artifacts committed + episode marker**, not a code-push SHA
(`integration-principle.md` + `_raw-findings.md` Q5). This is the central design
tension carried into the design discussion.

---

## Dependencies

- **#230** (squads/agents) — merged (commit `1112d04`). Provides the squads primitive
  and the post-#230 worktree `agents.yaml` / `squads.yaml`.
- `hive/lib/multica-story-dispatch/` (`index.mjs` + `episode-sync.mjs`) — the dispatch
  + polling + episode-marker library to reuse.
- `multica-bootstrap` + the `multica-init` skill (`skills/multica-init/SKILL.md`) —
  server / CLI / auth / workspace / daemon / agents bootstrap, prerequisite for any
  dispatch.

---

## inconsistency_risk_signals

> Carried verbatim from `_raw-findings.md`. The grill step (`/plan` Phase A2) reads
> this section.

- Verdict-agent vocab clash: `test/SKILL.md` writes `manual_verdict.agent` as
  `test-worker`; the planning skill Phase C seeds `agent: tester`; the Multica roster
  names `tester`, not `test-worker`/`test-architect`/`test-scout`.
- Scenario-schema drift: `hive/references/test-scenario-schema.md` uses
  `invocation`/`pre_conditions`/`expectations`/`sandcastle_mode_override`; the SKILL +
  loader (`loadScenario`) use `mode`(`spec-walk`|`implementation-walk`)/`steps[{action,expected}]`/`preconditions`/`postconditions`.
  Two divergent scenario shapes.
- Mode-enum scope: the `mode_decision` enum is code-path-specific (carries story +
  parallel-gate semantics); the planning and test skills have no equivalent dispatch
  atom — mirroring needs a new seam, not reuse.
- Spawn-path duality: planning-routing models only direct vs codex; a Multica path
  would be a third spawn mode with no current fallback wiring.
- Squad↔roster mismatch: squads.yaml references test-architect/test-scout/security-reviewer;
  confirm in agents.yaml before assuming squad-as-cell is dispatchable.
