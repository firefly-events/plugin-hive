# meta-optimize Swarm Charter

**Status:** active draft for the public-swarm half of the rebuilt meta-improvement system  
**Scope boundary:** public skill, user-project operation via `/meta-optimize`  
**Supersession:** supersedes `.pHive/meta-team/charter.md` for the public-swarm half of the rebuilt system

## Mission

The `meta-optimize` swarm improves user projects by analyzing the consumer codebase for specific, evidence-backed improvement opportunities, proposing concrete changes, running those changes through the experiment envelope and validation flow, and surfacing a PR artifact for the user to review. It is not a change-management committee; it ships candidate improvements as reviewable pull requests rather than stopping at advice.

## Scope - What the Public Swarm Operates On

The public swarm operates on consumer-project files under `{project_root}/**`, with authority bounded by the per-agent grants in `.pHive/teams/meta-optimize.yaml`. That team file is the authoritative write map for the swarm.

This scope is intentionally consumer-project-facing. It does not inherit the legacy plugin-internal-only restriction from `.pHive/meta-team/charter.md`, and it is allowed to inspect and stage outputs inside the user project where the team grant permits.

Explicit exclusions:

- `plugin-hive` source is not in scope for this swarm. Self-optimization of the plugin itself belongs to `meta-meta-optimize` as defined by `.pHive/teams/meta-meta-optimize.yaml`.
- Plugin-consumer environment settings, shell configuration, secrets stores, and credentials are not in scope.
- Any write authority beyond the paths granted in `.pHive/teams/meta-optimize.yaml` is out of scope.

## Shared Safety Constraints

This charter adopts the shared safety-constraints reference at `hive/references/meta-safety-constraints.md` in full. Do not duplicate the constraint list here; the reference is authoritative.

Public-swarm-specific additions:

- No writes to user repository files outside `{project_root}/.pHive/meta-optimize-candidates/` until the PR adapter ships the candidate as a PR artifact.
- The swarm may inspect `{project_root}/.pHive/**` when the user project contains those files, but it does not inherit the legacy ban on user project `.pHive/` directories. Any write remains limited to the team-file grants.
- Promotion evidence must preserve the experiment envelope fields required by `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`.

## Promotion Model

The public swarm uses a PR-artifact adapter. It never direct-commits to a user repository.

Concretely, the experiment runs in an isolated worktree as defined by `hive/references/meta-experiment-isolation.md`, produces a diff artifact and associated closure evidence, and hands that artifact to the PR adapter owned by S10. The adapter opens a pull request against the user's default branch. The user is the promoter: acceptance happens when the user reviews and merges the PR in the target repository.

## Isolation & Revert

Worktree isolation is the default execution model per `hive/references/meta-experiment-isolation.md`. Each experiment runs in its own git worktree rather than against the live checkout.

Failed or rejected experiments are discarded by removing the worktree with `git worktree remove`. Successful experiments do not mutate the consumer repository directly; they stage PR artifacts for review. User-level rejection of the PR is the revert mechanism for a promoted candidate because the branch never lands unless the user accepts it.

## Boundaries

The public swarm may analyze broadly within `{project_root}/**`, but its implementation path is narrow by design:

- It proposes changes to the consumer project, not to `plugin-hive`.
- It stages candidate outputs and closure evidence, not direct repository mutations.
- It depends on the PR adapter and experiment envelope contract rather than bypassing them with ad hoc file edits.

## Out of Scope (Explicit)

- `plugin-hive` source code changes
- Direct commits to user repositories
- Changes to user config, shell environment, secrets, or credentials
- Any write outside `{project_root}/`

## References

- `hive/references/meta-safety-constraints.md` (A1.2 shared safety constraints)
- `hive/references/meta-experiment-isolation.md` (A1.4 worktree isolation model)
- `.pHive/teams/meta-optimize.yaml` (A2.6 authoritative public-swarm write map)
- `.pHive/teams/meta-meta-optimize.yaml` (maintainer-swarm boundary reference)
- `.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md` (B0 experiment envelope and closure contract)
