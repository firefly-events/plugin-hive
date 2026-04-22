# Meta Experiment Isolation

## Purpose

This reference defines the authoritative isolation model for meta-swarm experiments that modify the `plugin-hive` repository itself. It applies to self-modifying experiment classes going forward and replaces legacy file-copy sandboxing as the default contract.

## Authority and scope

- **Binding source:** `.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md` Q4 (`Worktree default`, signed 2026-04-19).
- **Shared safety bar:** `hive/references/meta-safety-constraints.md` remains the shared constraint reference that all meta swarms inherit.
- **Envelope semantics:** `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` remains authoritative for experiment-envelope fields, closure semantics, and rollback expectations.
- **Scope of this reference:** the git-level isolation model for self-modifying experiments, including creation, lifecycle execution, promotion, discard, and revert handling.

## Why worktrees, not file-copy sandboxing

File-copy sandboxing is not an acceptable default for self-modifying experiment classes because it cannot represent multi-file atomic changes, cannot exercise real commit/revert semantics, and cannot catch regressions that only surface when a change interacts with its siblings. Worktrees provide real git-level isolation in which an experiment can run its full lifecycle against an actual repository state, including read, write, commit, test, and review, and can then be discarded or promoted atomically.

## The model

Meta-swarm experiments use git worktrees created via `git worktree add` into `.pHive/meta-team/worktrees/{experiment_id}/`. The exact path is an implementation judgment call; this reference uses that path only as the default illustration.

Each experiment follows the same isolation lifecycle:

1. At creation time, the orchestrator allocates a dedicated worktree for the experiment.
2. The experiment runs its implement, test, and review steps inside that worktree, not against the main checkout.
3. The worktree produces a real git tip commit that serves as the candidate artifact for decisioning and later rollback.
4. On accept, the swarm promotes that worktree tip through the promotion adapter appropriate to the swarm:
   - `meta-meta-optimize`: direct commit promotion, per signed user decision.
   - `meta-optimize`: PR-style artifact promotion, not direct repo mutation.
5. On reject or auto-revert, the worktree is removed with `git worktree remove`.

This model is intentionally git-native. An experiment is not considered isolated if it only writes copied files outside a real worktree.

## Lifecycle expectations

### 1. Worktree creation

- The orchestrator creates one worktree per experiment with `git worktree add`.
- The worktree is bound to a single `experiment_id`.
- The worktree starts from the repo state that the experiment declares as its baseline.

### 2. In-worktree execution

- Implementation writes occur inside the worktree.
- Validation, tests, and review run against the worktree state.
- Any commit produced during the experiment is a real git commit reachable from that worktree's branch or detached HEAD, depending on the adapter design.

### 3. Promotion

- Acceptance promotes the worktree tip commit, not a copied file bundle.
- Promotion mechanism is swarm-specific:
  - `meta-meta-optimize` may promote by direct commit because Q4 and the later promotion decision allow maintainer-local repo mutation there.
  - `meta-optimize` must emit a PR artifact rather than mutating the target repository directly.
- Promotion should preserve a stable `commit_ref` for the experiment envelope.

### 4. Rejection and cleanup

- Rejected experiments do not copy files back into the main checkout.
- The rejection cleanup path is `git worktree remove` for the experiment worktree.
- Cleanup may preserve envelope evidence and logs, but the isolated checkout itself is removed.

## Clean discard / revert semantics

Discard and revert are distinct:

- **Discard:** remove the experiment worktree with `git worktree remove`. No promoted change exists, so no main-repo revert is needed.
- **Revert:** if a promoted experiment later regresses, revert the promoted commit in the main repository with `git revert`, then remove the experiment worktree with `git worktree remove`.

This maps cleanly to the B0 auto-revert path in §3.2 of `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`: `regression_watch` trips, the system restores the promoted state by reverting the promoted commit, and the now-spent experiment worktree is removed as cleanup.

## What worktree isolation does NOT replace

Worktree isolation is the repo-isolation mechanism. It does not replace adjacent contracts:

- It does **not** replace the B0 consumer contract. Envelope fields and their meanings remain authoritative in `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`.
- It does **not** replace the closure invariant. `decision`, `commit_ref`, `metrics_snapshot`, and `rollback_ref` are still required before a cycle may close.
- It does **not** commit the system to a single filesystem path. Implementations may override `.pHive/meta-team/worktrees/{experiment_id}/` if they preserve one-worktree-per-experiment isolation.
- It does **not** commit the system to a specific orchestration mechanism. Shell wrappers, git libraries, or other adapters are all acceptable if they preserve the same worktree semantics.

## Cross-links

- Shared safety constraints: `hive/references/meta-safety-constraints.md`
- Envelope and closure semantics: `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`

These references are complementary. Safety constraints define the shared bar. B0 defines the experiment-envelope contract. This document defines the isolation model used when an experiment mutates the repository itself.

## Retirement note

`hive/references/meta-team-sandbox.md` is retired as an authoritative procedure. It is preserved only as historical context for the earlier file-copy sandbox model and for any risk-routing ideas that remain useful as operator background, but it no longer defines the active isolation contract for meta-swarm experiments.
