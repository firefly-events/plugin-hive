# Proposal — Squad doctrine layer + dynamic squad composition

**Date:** 2026-06-08. **Status:** design insight — **VALIDATION SPIKE PASSED** (see below); ready to scope as an epic. **Origin:** planning-queue (cluster B) squad dogfood — the orchestration brief was hand-written into the *issue*; that content actually belongs to a durable squad-level layer Hive doesn't model yet.

## The missing-middle layer

Hive's current composition layers:

| Layer | Answers | Lives in | Scope |
|---|---|---|---|
| **Agent persona** | WHO each member is | `hive/agents/<role>.md` via `persona_ref` | per-agent |
| **Roster / membership** | WHICH agents form the team | `squads.yaml` members / spine+specialist slots | per-team (static) |
| **Workflow / skill** | WHAT process the team runs | `skills/.../SKILL.md` | per-task-type |
| **Per-issue brief** | WHAT this specific job is | Multica issue description | ephemeral |

**The gap:** nothing durably encodes *HOW this team operates as a unit* — the leader's standing orchestration protocol, the delegation contract, "gates stay local," commit conventions, backend-split awareness. This session that doctrine was bolted into the PLU-277 issue description (ephemeral, re-written per task). That is the symptom of a missing layer.

**Multica already gives us the slot:** `squad.instructions` — a persistent, squad-scoped directive. We've never populated it. It is the **team operating doctrine** layer — a "squad-wide persona," distinct from per-agent personas.

## It maps onto the existing persona mechanism (small build)

The agent path is the template:

```
agents.yaml entry → persona_ref: hive/agents/<x>.md → reconciler resolves → Multica agent.instructions
```

Mirror it for squads:

```
squads.yaml entry → doctrine_ref: hive/squads/<x>.md → reconciler resolves → Multica squad.instructions
```

Build deltas (all small, all symmetric with existing code):
1. New dir `hive/squads/` with archetype doctrine files (`planning-squad.md`, `dev-squad.md`, `verify-squad.md`).
2. New optional `doctrine_ref:` field in `squads.yaml`.
3. Extend `reconcileSquadsWithDeps` (`hive/lib/multica-bootstrap/index.mjs` ~L427) to resolve `doctrine_ref` → push `squad.instructions`, exactly as `buildAgentPayload` does for agents (L371). CLI surface already exists (`multica squad update --instructions`).

### Archetype doctrine examples (durable, per-squad-type)
- **planning-squad:** leader decomposes the ask, delegates each sub-task via a child issue per member, runs the event-driven re-wake loop, **never advances a user/review gate** (gates stay local to the human orchestrator), members commit artifacts to the epic branch.
- **dev-squad:** implement per story, self-review before handoff, one commit per story, respect the integration branch contract.
- **verify-squad:** adversarial posture — hunt for failures, refute don't confirm, every terminal state reported.

## Dynamic axis (the user's second point)

Two things become dynamic, not one:

1. **Membership** — already designed in [[project_dynamic_planning_team]]: classify the ask → work-type tags → **spine** (researcher/architect/writer/tpm, always) + **specialist slots** (security / performance / ui) filled only when the ask triggers them (per `specialist-triggers.md`). For plugin-hive's *own* work the spine covers ~everything; security/perf/ui are rare. The dynamism matters most for consumer projects.

2. **Doctrine** — the squad `instructions` materialized at squad-create time = **static archetype doctrine** (from `hive/squads/<archetype>.md`) **+ dynamic overlay** (this ask's active specialists, the locked decisions, the epic context). Composed once, written to `squad.instructions` when the ephemeral per-epic squad is created (`multica squad create` + `member add`).

**This unifies three previously-separate threads:**
- [[project_dynamic_planning_team]] — composition classifier (PLANNED)
- [[project_team_cell_execution_mode]] cell-as-squad — SUPERSEDED, salvaged into mpt
- squad `instructions` primitive — discovered 2026-06-08

The doctrine layer is the missing piece that makes dynamic squads coherent: you choose members **and** write the team's operating contract in one composition act, then tear the squad down after the epic.

## VALIDATION GATE (spike first — do not build until this passes)

**We have zero evidence `squad.instructions` changes leader behavior.** This session's delegation worked because the protocol was in the *issue description*, not the squad field. The field has never been populated. Before any of the above:

> **Spike:** set `planning-team-squad.instructions` to a distinctive directive (e.g. "always begin your first comment with `DOCTRINE-ACK`"). Assign a trivial task whose issue body does NOT repeat it. Observe whether the leader's behavior reflects the squad instructions. If yes → Multica feeds squad.instructions to the leader → the whole layer is real. If no → the field is decorative and this proposal collapses to "keep putting doctrine in the issue/skill."

~5 minutes. Gates everything downstream.

> **RESULT — PASSED (2026-06-08).** Set `planning-team-squad.instructions` to "begin every comment with `DOCTRINE-ACK:`", assigned a trivial haiku task whose body never mentioned the marker (PLU-293). The leader's comment came back: `DOCTRINE-ACK: Cards drift left to right—…`. The marker lived only in `squad.instructions`, so the field demonstrably reaches the leader at runtime. The doctrine layer is real. (Instructions reset to empty + probe cancelled after the test.) Proceed to scope the build: `hive/squads/<archetype>.md` + `doctrine_ref` in squads.yaml + reconciler extension mirroring the agent `persona_ref` path.

## Open questions
1. Does Multica inject `squad.instructions` into the leader only, or all members? (Changes where archetype vs persona content belongs.)
2. Static archetype + dynamic overlay: concatenate, or does Multica support layering? (Likely we concatenate into the single `instructions` string at create time.)
3. Does the doctrine layer also belong on `dispatchStoryToPersonas` fan-out (non-squad) runs, or is it squad-only? (Probably squad-only — fan-out has no leader.)
4. Relationship to per-persona fan-out: if squad-as-cell + doctrine proves out, does it *replace* fan-out as the planning carrier, or coexist (fan-out for simple, squad for complex/multi-wave)?

## Not in scope
- Rewriting the shipped fan-out carrier — that stays the proven default until the spike + a squad-carrier story land.
- Building any doctrine file before the validation spike passes.
