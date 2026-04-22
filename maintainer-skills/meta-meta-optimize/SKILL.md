---
name: meta-meta-optimize
description: |
  LOCAL-ONLY maintainer skill for the plugin-hive repo. Drives the
  /meta-meta-optimize Karpathy-style auto-improvement cycle on the plugin
  itself (control-plane, swarm configs, agent personas). NOT shipped — this
  skill is structurally excluded from .claude-plugin/plugin.json and lives
  outside the public skills/ root by design (cycle-state L9-meta-meta-location
  + user decision Q-new-A).
---

# Meta-Meta Optimize

LOCAL-ONLY maintainer scaffold for the plugin-hive repo.

## Local-only, by design

This skill lives at `maintainer-skills/meta-meta-optimize/SKILL.md`, not
`skills/meta-meta-optimize/SKILL.md`.

Why this path is fixed:

- `L9-meta-meta-location` locks the exact location to `maintainer-skills/meta-meta-optimize/SKILL.md`
- user decision `Q-new-A` says `/meta-meta-optimize` does not ship in the public plugin surface
- `.claude-plugin/plugin.json` continues to point at `./skills/` only, so keeping this file under `maintainer-skills/` makes the packaging boundary structural rather than conventional

## Shared runtime dependency

This skill consumes the shared runtime library at `hive/lib/meta-experiment/`.
It must not define a parallel implementation.

Shared-library modules:

- `envelope`
- `baseline`
- `compare`
- `promotion_adapter`
- `rollback_watch`
- `closure_validator`

## Backlog source

Human-curated proving-run input lives at
`.pHive/meta-team/queue-meta-meta-optimize.yaml` from `BL2i.1`.

This backlog is the source for safe, reversible candidates when metrics are
absent or insufficient. The file is maintainer-edited; this skill does not
auto-append to it.

## Status: scaffold only

This skill is at the SCAFFOLD stage for slice `S8` (`BL2i.3`).

- scope now: document local invocation shape, backlog loading, and shared-library dependency
- deferred to `S9` (`BL2.1`-`BL2.6`): live promotion, rollback, closure, and control-plane mutation

## Dry-run flow (intended)

Target lifecycle once wired in `S9`:

1. Load backlog from `.pHive/meta-team/queue-meta-meta-optimize.yaml`
2. Select one candidate proving run
3. Load `hive/lib/meta-experiment/`
4. Execute baseline capture through `baseline` and `envelope`
5. Execute candidate run
6. Compare baseline vs candidate through `compare`
7. Call the promotion path through `promotion_adapter`
8. Validate closure invariants through `closure_validator`

`S8` in-scope behavior stops after steps 1-2 as documented intent. Steps 3-8
are placeholders only and must not be executed by this scaffold.

### Backlog-fallback step

The fallback branch is owned by
`hive/workflows/steps/meta-team-cycle/step-03b-backlog-fallback.md`.
When wired in `S9`, this skill invokes step-03b after step-02 if no metric
signal is available. In `S8` the step runs in dry-run mode only — it loads the
backlog, reports the selected candidate, and stops. No control-plane mutation,
no promotion, no closure.

## What the skill MUST NOT do in S8

- execute real experiments
- mutate the control plane
- promote any change
- write to the ledger
- close a cycle
- register itself in `.claude-plugin/plugin.json`

## Invocation (placeholder)

Local invocation is via Claude Code using this file path as the skill path:
`maintainer-skills/meta-meta-optimize/SKILL.md`.

Real invocation wiring and execution semantics land in `S9` (`BL2.2`). In `S8`,
this file is documentation-only.

## Key references

- `skills/standup/SKILL.md` for shipped skill-file structure
- `hive/lib/meta-experiment/README.md` for shared runtime boundaries
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` for proving-run candidates
- `.pHive/cycle-state/meta-improvement-system.yaml` for `L9-meta-meta-location`
- `.claude-plugin/plugin.json` for the shipped-surface boundary
