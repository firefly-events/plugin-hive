# Proposal — Team-Cell execution mode (Multica)

**Status:** draft (pre-/plan)
**Author:** Don Matthews + co-pilot
**Date:** 2026-05-22
**Companion audit:** `.pHive/audits/multica-mode-audit-2026-05-22.md`

## Problem

Current `execute-mode-multica` skill dispatches one Multica issue per Hive
story, assigned to a single `developer` agent that runs all five workflow
phases (research → implement → test → review → integrate) in one Claude
session. This:

- Bypasses the persona split (researcher/developer/tester/reviewer)
- Bypasses the cost-saving backend routing (Codex for work, Opus 4.7 for
  review) per `feedback_codex_general_backend`
- Bypasses cross-LLM verification (`feedback_codex_work_opus_review_split`)
- Produces no per-step episode markers, no insight capture, no pre-shutdown
  handoff
- Differs from session-mode (which DOES respect persona + backend) — Multica
  trades fidelity for autonomy

The North Star ("coordinated agent teams" running research/implement/test/fix
loops/review) requires the team shape to be preserved when Multica is the
substrate.

## Target model

### Core concept: Multica session = team cell

A **team cell** is a Multica session scoped to one phase of one workflow
invocation. Phases:

- `plan` cell — drives `/plan` (kickoff → research → design → DAG)
- `execute` cell — drives `/execute` for one story (research → implement →
  test → review → integrate)
- `review` cell — drives `/review` against an open PR (collaborative review +
  simulated-manual testing)

Each cell:

1. Spawns inside Multica with a phase-appropriate team composition
2. Internally runs the matching skill's full agent flow
3. Reports back via per-step episode markers
4. Closes the cell on phase completion

### Team composition contract

Each cell type declares:

- **`core[]`** — agents that ALWAYS run for this phase
- **`optional[]`** — agents conditionally added based on work signals
- **`signals{}`** — declarative rules mapping work properties → optional slots

Initial spec (refine in /plan):

#### `plan` cell
- core: `researcher`, `architect`, `tpm`, `technical-writer`
- optional:
  - `ui-designer` when story spec mentions UI / wireframe / component
  - `security` when scope touches auth / secrets / permissions
  - `analyst` when scope mentions metrics / events / data warehouse
  - `peer-validator` when collaborative_review enabled

#### `execute` cell
- core: `researcher`, `developer`, `tester`, `reviewer`
- optional:
  - `backend-developer` replaces `developer` when scope is server-side
  - `frontend-developer` replaces `developer` when scope is UI / client
  - `security` reviewer when scope touches auth / secrets
  - `qa-engineer` for simulated-manual testing when story declares it
  - `technical-writer` when scope changes user-facing docs

#### `review` cell
- core: `reviewer`, `peer-validator`
- optional:
  - `security` when changed files touch auth / API / token / permission code
  - `qa-engineer` for simulated-manual testing
  - `ui-designer` when changed files touch visual surfaces

Composition resolves at cell creation time based on story metadata + a small
signal-detector run over scope hints. The hive-side composer is the only place
that knows the full roster; Multica just executes the resolved roster.

### Backend routing (carries over from existing memory)

| Agent role | Backend | Model |
|-----------|---------|-------|
| researcher | codex | gpt-5.4 |
| developer / backend-developer / frontend-developer | codex | gpt-5.4 |
| technical-writer | codex | gpt-5.4 |
| architect | codex | gpt-5.4 |
| tester | claude | sonnet 4.6 |
| reviewer / peer-validator | claude | opus 4.7 |
| security | claude | opus 4.7 |
| qa-engineer | claude | sonnet 4.6 |
| ui-designer | claude | sonnet 4.6 |

Routing lives in `hive.config.yaml.agent_backends`.

### Episode markers

Cell writes markers AS the agents progress, not at cell close:

```
.pHive/episodes/{epic}/{story}/{phase}-{step}.yaml
```

Each phase boundary inside the cell emits one marker. Multica internal
state (per-agent task lifecycle) is opaque to Hive; the markers are the
contract.

### Pre-shutdown protocol

When the cell completes (or the cell host requests close), each agent in the
roster gets the `pre-shutdown-protocol.md` message, captures insights, then
the cell tears down. No agent leaves silently.

## Why Multica primitives can support this

Multica already has:

- Multiple agents per workspace (4 agents already bootstrapped: developer,
  tester, reviewer, spike-claude)
- Parent / child issue support (observed in ABI probe issues)
- Per-issue assignee with runtime routing (provider=claude vs codex visible
  in `runtime list`)
- Workspace + project scoping

The missing primitive (or under-explored): **multi-agent assignment** within a
single issue. Today, one issue = one assignee. The team-cell concept needs
either:

- (a) Parent issue = "the cell", child issues per phase, each child assigned
  to a different role
- (b) Sequential reassignment: same issue re-assigned to next role after each
  phase
- (c) Multica sessions / squads primitive — if Multica supports a multi-agent
  collab scope natively, use that

Decide (a) vs (b) vs (c) in /plan phase A.

## Hand-off to `/plan`

This proposal is the input for `/plan` to decompose into:

- Architecture: which Multica primitive (a/b/c) hosts a cell
- Hive-side composer: `hive/lib/team-cell-composer/` — resolves roster from
  story metadata + signal detectors
- New execute-mode-multica skill shape: per-phase cell creation + marker
  contract
- Migration: feature-flag the new mode, parallel-run for one epic, then flip
- Backwards compat: leave the current single-developer path under a deprecated
  `execute-mode-multica-flat` for one release cycle

Open design questions for /plan to grill:

- Q1: how does the cell react when an optional agent in the roster fails or
  goes idle past its turn? Skip-or-block?
- Q2: which side owns the signal-detection that picks optional slots — hive
  composer (deterministic) or a Multica "router" agent (LLM-driven)?
- Q3: how do cells share state between phases of the same story? Episode
  markers + brief, or persistent session memory?
- Q4: do plan / review cells get their own Multica project, or do they share
  the execute project?
- Q5: where does `/triage` fit — its own cell, or is it always operator-driven?

## Out of scope (defer to follow-on epic)

- Reverse-sync (Multica cancel → story YAML defer) — already covered by
  shipped s2-1 in `story-loop-closure`
- Closer-on-merge — already covered by shipped s1-1, s1-2, s2-1 in
  `story-loop-closure`
- Workspace repo binding fix — needs to land in this epic's slice 0 (a
  cell can't push to the wrong remote)

## Risk register (planning seed)

1. Multica session/squad primitive may not exist — if (c) is not available,
   parent-child issues (a) is heavier but doable
2. Cell startup latency — bootstrapping 4-6 agents per phase could be
   slow; cache hot agents per workspace
3. Cost — Opus 4.7 review on every story is the existing policy; ensure
   short-tail simple stories can opt down to Sonnet review (escape hatch)
4. Token scope — gh OAuth token used by workspace agents must include
   `workflow` scope before any CI-touching story enters a cell
