# meta-meta-optimize Swarm Charter

**Status:** active draft for the maintainer-swarm half of the rebuilt meta-improvement system  
**Scope boundary:** local-only maintainer tool for `plugin-hive` self-optimization  
**Supersession:** supersedes `.pHive/meta-team/charter.md` for the plugin-hive maintainer-swarm half of the rebuilt system

## Mission

The `meta-meta-optimize` swarm improves the `plugin-hive` plugin itself by finding real gaps in the control plane, fixing those gaps with targeted repository changes, validating them inside the experiment lifecycle, and promoting successful work by direct commit into the `plugin-hive` development branch. It is not user-facing and it is operated by a maintainer who has already consented to local repository mutation by running the swarm.

## Scope - What the Maintainer Swarm Operates On

The maintainer swarm operates on `plugin-hive` source under `hive/**`, `skills/hive/agents/memories/**`, `.pHive/teams/**`, `.pHive/meta-meta-optimize/**`, and `hive/lib/**`, with the exact per-agent write map defined by `.pHive/teams/meta-meta-optimize.yaml`. That team file is authoritative when agent-level write authority is in question.

This scope is repository-internal and maintainer-operated. It does not target consumer projects and it does not claim authority over user repositories.

Explicit exclusions:

- User-project files are out of scope.
- `hive/hive.config.yaml` is out of scope unless a human confirms the change, per the shared safety constraints.
- Any path outside the grants expressed in `.pHive/teams/meta-meta-optimize.yaml` is out of scope for automatic mutation.

## Shared Safety Constraints

This charter adopts `hive/references/meta-safety-constraints.md` in full. Do not duplicate the constraint list here; the reference is authoritative.

Maintainer-swarm-specific additions:

- Commit messages use the `[meta-meta-optimize]` prefix.
- Direct-commit promotion is allowed only after the closure validator invariants from A2.5 are satisfied, including `decision`, `commit_ref`, `metrics_snapshot`, and `rollback_ref`.
- Maintainer-local execution does not waive the human-confirmation boundary for `hive/hive.config.yaml`, agent tool lists, or new external service integrations.

## Promotion Model

The maintainer swarm uses a direct-commit adapter. There is no PR gate between experiment acceptance and repository mutation.

Concretely, the experiment runs in a dedicated worktree under the worktree-default model from `hive/references/meta-experiment-isolation.md`. When the closure validator passes, the experiment worktree tip commit is merged or rebased into the active `plugin-hive` development branch as the promoted change. This is strong direct-commit language by design: the maintainer has already consented by invoking the local-only swarm, so the promotion path does not pause for a second public review surface.

## Isolation & Revert

Worktree isolation is the default execution model. Each experiment receives its own git worktree and performs implementation, validation, and review there rather than in the primary checkout.

Failed experiments are discarded by removing the worktree with `git worktree remove`. Successful experiments promote a real commit that remains revertable. If `regression_watch` later trips, the promoted change may be auto-reverted per B0 §3.2 using the `rollback_ref` field captured in the experiment envelope, after which the spent worktree is removed as cleanup.

## Local-Only Posture

This swarm runs local-only. It is not a public skill and it must not appear in the shipped plugin manifest.

Per the signed decision `meta-meta-optimize-ships: no — local-only` and L9, the skill source lives under `maintainer-skills/meta-meta-optimize/`, outside the shipped `skills/` root and outside `plugin.json`'s public manifest surface. S8 (BL2i.5) is expected to add a regression test that proves this exclusion remains true.

The execution split decision also applies here: Codex is the implementation and test backend, while Claude Opus 4.7 serves as reviewer and peer validator. This charter references that backend routing as an operating assumption, not as a new policy source.

## Boundaries

The maintainer swarm exists to improve `plugin-hive` itself, especially the meta-improvement control plane and its runtime surfaces.

- It may change repository-internal implementation and lifecycle state within the granted paths.
- It may promote successful experiments by direct commit once closure evidence is complete.
- It may not expand its own authority by quietly editing guarded config or adding new external integrations without human confirmation.

## Out of Scope (Explicit)

- User-project files
- Changes to `hive/hive.config.yaml` without human confirmation
- Introducing new external service integrations
- PR-artifact promotion, which belongs to the public `meta-optimize` swarm
- Public distribution of this skill

## References

- `hive/references/meta-safety-constraints.md` (A1.2 shared safety constraints)
- `hive/references/meta-experiment-isolation.md` (A1.4 worktree isolation model)
- `.pHive/teams/meta-meta-optimize.yaml` (A2.6 authoritative maintainer-swarm write map)
- `.pHive/teams/meta-optimize.yaml` (public-swarm boundary reference)
- `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` (B0 experiment envelope, closure, and rollback contract)
- `.pHive/cycle-state/meta-improvement-system.yaml` (signed decisions: `meta-meta-optimize-ships`, `execution-backend-split`, `L9-meta-meta-location`, `D4-stop-hook-resolution`, `D7-token-capture-requirement`)
