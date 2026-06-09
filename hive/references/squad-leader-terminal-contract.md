# Squad-Leader Terminal Contract

Canonical definition of how a Multica squad-leader run must terminate. This doc
is the source of truth: the live `squad.instructions` carries an applied copy of
this contract (see sls-2 in epic `squad-leader-status-flip`), and the
stale-parent sweep (`scripts/multica-sweep-stale-parents.py`, sls-3) enforces it
as a backstop when a leader fails to follow it.

**Scope.** Applies to interactively-driven and execute-mode squad-leader runs —
any run where an agent holds a parent issue and delegates work to members via
child issues. It does NOT amend `plan-mode-multica`; that skill's per-persona
carrier decision is out of scope here (design-discussion §5, accepted
deviation).

**Why this exists.** Triage t-001: squad-leader parent issues never auto-flip
from `in_progress` to `done`. The leader runs once, delegates via child issues,
and exits terminal — no code path flips the parent when the children all
terminate, so `multica issue list --status in_progress` drifts from reality.
This contract makes the leader itself responsible for terminating its parent
issue.

## The protocol

A squad leader closing out its run MUST execute these four steps, in order.
Steps 1–3 are the happy path; step 4 is the only sanctioned alternative.

### 1. Children-terminal check

Before closing out, verify that **every delegated child issue is terminal for
delegation**. A child is terminal for delegation when its status is one of:

- `done`
- `cancelled`
- `in_review` **with output consumed** — members routinely stop at `in_review`
  rather than flipping their own issues to `done`. That is acceptable: once the
  leader has read/consumed the member's artifact (result comment, pushed
  commits, produced file), the `in_review` child counts as terminal for the
  purposes of this check. The leader does not need to flip the child itself.

A child in `todo`, `in_progress`, `blocked`, or `backlog` is NOT terminal. An
`in_review` child whose output the leader has not consumed is NOT terminal —
consume it first.

If any child fails this check and cannot be unblocked, go to step 4.

### 2. Final summary comment

Post the final summary comment on the leader's **own parent issue**. This is
the existing convention, now binding. The summary MUST list, per child:

- child issue id (use the issue mention format so it links)
- the member it was delegated to
- the child's final status
- a one-line per-task outcome

### 3. Self status flip — LAST action

The leader flips its own issue to `done` as the **last action of the run**:

```sh
multica issue update <own-issue-uuid> --status done
```

The leader's own issue UUID is always available in its task context. Nothing
may run after this command — the flip strictly follows the children-terminal
check (step 1) and the summary comment (step 2), so a self-flip can never race
a still-running child.

### 4. Blocked path

If children are stuck and the leader cannot complete (step 1 fails and the
blockage cannot be resolved), the leader:

1. Posts a **BLOCKED** comment on its own parent issue, naming the stuck
   child(ren) and the reason.
2. Leaves its own status as `in_progress` — does NOT flip to `done` or
   `blocked`.

This parent is then *stale-by-intent*: the stale-parent sweep surfaces it for
operator attention rather than auto-repairing it.

## Enforcement

- **Primary carrier:** the live `planning-team-squad` `squad.instructions`
  carries this contract verbatim, so every future leader run inherits it
  regardless of who authors the brief (Fork A, design-discussion §2). If the
  squad is reconfigured and the instructions are lost, re-apply from this doc —
  this file wins.
- **Backstop:** `scripts/multica-sweep-stale-parents.py` finds `in_progress`
  squad-assigned parents whose children are all terminal and/or whose last
  update exceeds a quiet-age threshold, reports them, and flips them to `done`
  with `--apply` (Fork B, lite form). The sweep re-checks the
  children-terminal invariant before any `--apply` flip.

## Deferred Upstream Ask (Fork C)

**Desired upstream Multica semantics — not implemented in this epic; recorded
here so the upstream issue is ready to file.**

Multica should auto-complete squad-assigned parent issues: when an issue is
(a) assigned to a squad and (b) all of its child issues have reached a terminal
status, the platform flips the parent to `done` automatically — no leader-side
protocol or operator sweep required.

Details for the upstream issue:

- Trigger: last child status transition into a terminal state
  (`done` / `cancelled`; treatment of `in_review` is the platform's call —
  this contract's "in_review with output consumed" rule is a leader-side
  workaround the platform cannot observe, so upstream may reasonably require
  `done`/`cancelled` only).
- Guard: only when the parent is squad-assigned and still `in_progress`.
- Until this lands, the leader-side protocol above plus the sweep remain the
  operative mechanisms; both can be retired (sweep) or relaxed (self-flip)
  once upstream auto-complete ships.

## Related references

- [multica-squads-schema.md](multica-squads-schema.md) — squad declaration
  schema; squads defined there are the runs this contract governs.
- `.pHive/epics/squad-leader-status-flip/docs/design-discussion.md` — fork
  resolution and risk analysis behind this contract.
- `.pHive/proposals/squad-doctrine-and-dynamic-composition.md` — deferred
  doctrine layer this contract will eventually fold into.
