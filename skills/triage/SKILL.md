---
name: triage
description: Brownfield bug and feature intake — capture, clarify, prioritize, hand off to /plan or standup. Five-state queue at .pHive/triage/queue.yaml with warning-only kickoff gate.
---

# Hive Triage

Brownfield intake skill for bugs and feature requests. Captures raw reports, walks them through a fixed five-state intake machine, and hands the result to `/plan --from-triage` or surfaces it through standup Phase 1. **Atomic at the surface, process-owning internally** — the skill owns the queue and state transitions, but does not absorb planning or scheduling.

**Input:** `$ARGUMENTS` is one of:

- A free-form bug or feature description (creates a new entry in state `inbox`)
- A queue entry ID (advances or inspects an existing entry)
- `--list` (renders the current queue)
- `--list <state>` (filters by one of the five states below)
- `--hand-off <id>` (pushes a `plan-ready` entry to `/plan --from-triage`)
- `--close <id> [--reason "..."]` (resolves an entry to `closed`)

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** Triage is intended to be standalone-usable on brownfield repos that may not be Hive-initialized. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults — write the queue to `.pHive/triage/queue.yaml`, create the directory if needed. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Five-state intake machine

Triage entries move through exactly five states. The names and ordering are fixed — adding states or reordering is out of scope for this skill (would require a catalog-level change).

| State | Meaning | Operator action to advance |
|---|---|---|
| **`inbox`** | Raw report received. Title + free-form description only. No prioritization yet. | Operator reviews and clarifies the report (asks reporter for missing detail, links related issues, identifies whether bug or feature) → **`clarified`** |
| **`clarified`** | Enough detail to act on. Bug-vs-feature classification done. Reproduction steps or acceptance hints captured. Not yet prioritized. | Operator (with maintainer judgment) sets a priority and severity → **`prioritized`** |
| **`prioritized`** | Priority + severity assigned. Ready for planning OR scheduling. | Either: hand off to `/plan --from-triage` (substantive work, needs decomposition) → **`plan-ready`**; OR mark as `closed` if rejected/duplicate. |
| **`plan-ready`** | Handed to planning. Story-level work has been initiated for the entry. Triage no longer owns the work — it tracks the link to the planned epic/story. | Planning produces stories; orchestration takes over. Triage advances the entry → **`closed`** when the linked work merges. |
| **`closed`** | Resolved (merged), rejected (with reason), or merged into a duplicate. Terminal. | Terminal — no further transitions. Re-opening creates a new entry referencing the closed one. |

**Transition rules:**

- Entries advance forward only. There is no `inbox → prioritized` shortcut — clarification is mandatory before prioritization.
- An entry may be moved from any non-terminal state to `closed` with an explicit reason ("duplicate of #N", "won't fix: out of scope", "implemented in PR #M").
- `plan-ready` is the **only** state that bridges triage and `/plan`. Never call `/plan --from-triage` against an entry that hasn't reached `plan-ready` — the planning skill expects triage's prioritization to have happened.

## Queue persistence

The queue lives at `.pHive/triage/queue.yaml`. The schema is documented in story `a-27-triage-queue-yaml` (separate file). At a high level each entry carries:

- `id` — short stable identifier (e.g., `t-001`)
- `state` — one of the five above
- `kind` — `bug` | `feature` | `unknown`
- `title`, `description`
- `reporter`, `reported_at`
- `priority`, `severity` (populated at `clarified → prioritized` transition)
- `linked_epic` / `linked_story` (populated at `prioritized → plan-ready` transition)
- `closed_reason`, `closed_at` (populated at any state → `closed` transition)
- `state_history` — array of `{state, at}` entries, append-only

The triage skill is the single writer of this file. Other skills read it; only triage updates it.

## Hand-off paths

Two skills consume triage state:

- **`/plan --from-triage <id>`** — planning skill picks up a `plan-ready` entry and produces an epic + stories. On planning success, the planner writes `linked_epic` / `linked_story` back into the triage entry and the operator advances it to `closed` when the work merges. See story `a-27-triage-plan-handoff` for the wiring.
- **standup Phase 1** — daily ceremony surfaces open triage entries (anything not `closed`) so the operator sees the intake backlog alongside in-flight epics. See story `a-27-triage-standup-handoff` for the wiring.

This skill does NOT:

- Spawn the planner or run planning logic. `/plan --from-triage` is the right surface for that — triage owns intake state, plan owns decomposition.
- Surface triage to the user without an explicit `--list` or hand-off invocation. Standup is the daily ceremony for that.
- Push to external trackers (Linear, GitHub Issues). Optional adapter write-back is a separate follow-on (out of scope here per epic.yaml).

## Operator flow

1. **New report arrives.** Operator runs `/hive:triage <description>`. Skill creates entry in `inbox` with auto-generated ID. Returns the ID.
2. **Clarify.** Operator runs `/hive:triage <id>` to inspect, asks reporter for missing detail, then runs `/hive:triage <id> --advance clarified --kind bug --reproduction-steps "..."` (or similar). State moves to `clarified`.
3. **Prioritize.** Operator decides: prioritize, or close as out-of-scope. `/hive:triage <id> --advance prioritized --priority p2 --severity moderate`. State moves to `prioritized`.
4. **Hand off OR close.** Either `/hive:triage <id> --hand-off` (calls `/plan --from-triage <id>`) which moves the entry to `plan-ready` on planner success, or `/hive:triage <id> --close --reason "..."`.
5. **Close after merge.** When the planned work merges, operator runs `/hive:triage <id> --close --reason "shipped in PR #N"` to terminate the entry.

The flow is operator-driven — triage does not auto-advance based on time, planner activity, or merge events. This is intentional: brownfield intake benefits from a human in the loop.

## What's in scope here vs separate stories

**This skill (story a-27-triage-skill-md):** authoritative procedure — five states, transitions, warning-only gate, hand-off references, operator flow.

**Separate stories under A-27 / W3:**

- `a-27-triage-queue-yaml` — `.pHive/triage/queue.yaml` schema spec + warning-only gate text in the schema doc
- `a-27-triage-plan-handoff` — `/plan --from-triage <id>` wiring: input parser, queue read, state advance on planner success, `linked_epic` / `linked_story` write-back
- `a-27-triage-standup-handoff` — standup Phase 1 surfaces open triage entries alongside in-flight epics

**Out of scope (entirely):**

- Optional adapter write-back to external trackers — deferred follow-on (post-2.0 if reopened)
- Auto-advance / time-based queue policy — operator-driven by design
- Triage UI / dashboard — queue.yaml is the source; rendering is a downstream concern
- Multi-queue or per-team queues — single file, single source per atomic-skill posture

## See also

- `.pHive/CONTEXT.md` — domain glossary; defines triage as "atomic skill (W3 of Epic A) for brownfield bug + feature intake; 5-state queue at `.pHive/triage/queue.yaml`"
- `.pHive/epics/hive-composability-audit/docs/recommendation.md` §2.3 — Borrow 3 specification (A-27)
- `.pHive/epics/hive-composability-audit/docs/recommendation-architect-sections.md` row 27 — atomic-at-surface, process-owning-internally posture
- `hive/references/skill-prelude.md` — preamble cited above
- Sibling W3 stories listed under "Separate stories" above
