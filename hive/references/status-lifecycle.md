# Status Lifecycle

**Status:** canonical reference
**Audience:** workflow authors, command implementers, reviewers, and release operators
**Companion docs:**
- [`story-yaml-schema.md`](story-yaml-schema.md) - story YAML shape and legacy advisory `status:` behavior
- [`episode-schema.md`](episode-schema.md) - marker-derived story state inside Hive
- [`cycle-state-schema.md`](cycle-state-schema.md) - epic-level state and task-tracking projections

## Purpose

This document defines the canonical story status lifecycle that workflow
commands must implement. It is the source of truth for command-owned
transitions, review rework, and release shipping. Local episode markers remain
the authoritative in-Hive evidence of work performed; status fields in story
YAML, cycle state, task trackers, and session registries are projections that
must follow this contract.

## State Set

Canonical story states:

```text
pending -> in_progress <-> in_review -> complete -> shipped
```

`blocked` is orthogonal: any command may move a story from its current lifecycle
state to `blocked` when work cannot proceed because of an external dependency,
missing input, unavailable infrastructure, or an explicit human gate. When the
block clears, the story returns to the state it occupied before the block.

| State | Meaning |
|---|---|
| `pending` | Story is planned but no execution owner has started it. |
| `in_progress` | Implementation, test repair, or review-failure rework is actively owned. |
| `in_review` | Implementation has finished and is awaiting automated or manual review verdict. |
| `complete` | Review has passed, or manual review has been reconciled as passed, but the story has not yet shipped. |
| `shipped` | `/ship` has successfully executed the configured ship action and advanced the story after release. |
| `blocked` | Temporary stall outside the forward lifecycle; preserve the prior lifecycle state for unblock. |

### Compatibility Note

Older references and markers use `completed` or `done` in some places. Going
forward, command-facing story status uses `complete`. Existing marker status
values such as `status: completed` in `.pHive/episodes/.../*.yaml` remain valid
marker vocabulary; they are evidence used to derive lifecycle state, not the
canonical lifecycle state name.

## Transition Ownership

Only the owning command writes each transition.

| Transition | Owning command | Rule |
|---|---|---|
| `pending -> in_progress` | `/execute` | Write when a story is dispatched or claimed for work. |
| `in_progress -> in_review` | `/review` entry, or `/test` when it is the review gate | Write only after implementation/test work is ready for review. |
| `in_review -> complete` | `/review` pass, or `/ship` pre-flight reconciliation | Write after a passing automated review, or when `/ship` verifies that manual review already passed. |
| `in_review -> in_progress` | `/review` fail | First-class rework edge: reassign to the appropriate implementation owner and re-trigger pickup. |
| `complete -> shipped` | `/ship` only | Write only after the configured ship action succeeds. |
| `* -> blocked` | Any command | Write when the command cannot proceed because of a dependency stall. |
| `blocked -> previous state` | The command that clears or retries the stall | Restore the preserved lifecycle state; do not infer a forward transition from unblock alone. |

`/status` is read-only. It reports the current derived/projected state and must
not write story YAML, cycle state, task tracker state, session registry state, or
episode markers.

## Rework Edge

`in_review -> in_progress` is a normal lifecycle transition, not a separate
`rework` state.

When review fails:

1. `/review` records the failed verdict.
2. `/review` moves the story from `in_review` back to `in_progress`.
3. `/review` assigns the story to the correct repair owner.
4. `/review` re-triggers pickup through the same dispatch path used for normal
   in-progress work.

The story re-enters `in_review` only after the repair owner finishes the next
implementation/test pass. This keeps repeated review loops visible without
adding another state.

## Manual Review And Complete

`complete` must be reachable without an automated `/review` run.

Some projects use manual review, and there may be no automated hook that can
observe the moment review passes. In that case, `/ship` owns pre-flight
reconciliation before it attempts release:

1. Inspect each target story currently in `in_review`.
2. Verify that review has actually passed through the configured evidence for
   the project, such as a merged PR, accepted manual verdict, maintainer
   approval, or task-tracker review state.
3. If the evidence passes, explicitly move `in_review -> complete`.
4. If the evidence fails, move `in_review -> in_progress` through the rework
   edge and stop shipping that story.

This reconciliation path is intentionally explicit. `/ship` may set `complete`
only as a pre-flight correction for manual review that already passed; `/ship`
does not replace review, and it remains the only owner of `complete -> shipped`.

## Current Writer Migration Map

rl-3 must migrate the existing scattered writers to the ownership table above.

| Current surface | Current write vocabulary | Forward owner/transition |
|---|---|---|
| `skills/plan/SKILL.md` story template | Seeds `status: pending` in new story YAML. | Keep plan-time seed as initial scaffolding only. `/plan` does not own runtime transitions. |
| `skills/execute/SKILL.md` task-tracker projection | Describes phase-based updates such as in-progress, in-review, and done through `updateStatus`. | Own `pending -> in_progress` at story dispatch/claim. Stop treating integrate/done as final completion; later review/ship commands own `complete` and `shipped`. |
| `skills/hive/skills/execute-mode-session/SKILL.md` session records | Writes session `status: pending`, `active`, `completed`, or `failed`. | Keep as session-lifecycle state only. Project story state from it as `pending -> in_progress` when the session becomes active; do not map session `completed` directly to story `complete`. |
| `skills/hive/skills/session-registry/SKILL.md` session index | Adds records with `status: pending`; updates `active` and heartbeat fields. | Keep registry vocabulary scoped to sessions. It may support `/execute`'s `pending -> in_progress` projection, but it must not own review, complete, or shipped transitions. |
| `skills/execute/references/team-execution.md` tracking map | Tracks `pending|active|complete|failed` for spawned surfaces. | Keep as dispatch/surface tracking. `active` corresponds to story `in_progress`; surface `complete` means the execution surface ended, not story `complete`. |
| `hive/references/story-yaml-schema.md` advisory story `status:` | Documents `pending`, `in_progress`, `completed`, `deferred`, `blocked`, and `failed` as advisory or derived. | Update downstream docs/code to name canonical lifecycle `complete`; preserve legacy `completed` only as marker/compatibility vocabulary. |
| `hive/references/cycle-state-schema.md` task projection | Mentions per-story `pending` / `in_progress` / `done` in cycle state. | Treat cycle state as a projection of canonical lifecycle. Replace `done` with `complete` where story lifecycle state is meant. |

## Implementation Rules

- A command may write only transitions it owns in the transition table.
- A command must gate forward transitions on successful completion of the
  required work; no command should mark a story complete on entry to a step.
- `blocked` writes must retain enough context to restore the prior lifecycle
  state when unblocked.
- Task-tracker, cycle-state, and session-registry writes are projections. If
  they conflict with episode markers and git evidence, the authoritative local
  state remains the marker/git-derived state until rl-3 updates the projections.
- `/ship` is the only command that may write `shipped`.
