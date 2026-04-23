# State and Shipping Boundary

> This document defines what ships to marketplace consumers versus what stays
> local-only to plugin maintainers. It captures the locked boundary as of the
> hive-release-readiness release.

## Quick summary

- **Shipped to consumers:** plugin code, agents, skills, workflows, hooks, and
  a neutral baseline config.
- **Local-only (maintainer):** per-project state in `.pHive/`, the root
  consumer-override config, and any future maintainer-skills.

## The two config layers

| Layer | File | What it is | Ships? |
|---|---|---|---|
| Shipped baseline | `hive/hive.config.yaml` | Plugin-owned neutral defaults safe for marketplace consumers | YES |
| Root consumer override | `hive.config.yaml` (repo root) | Each user's local overrides — populated via kickoff or hand-edit | NO (excluded) |

Precedence: when both files exist, the root override wins; unset keys fall
through to the shipped baseline. Runtime path resolution (via
`hooks/common.sh`) reads ONLY the root override for `paths.*` keys.

## Maintainer-only assets

The `maintainer-skills/` directory and any `*.local.*` files are excluded from
marketplace distribution via `.claude-plugin/marketplace.json`. Distribution
to collaborators happens via repository access only, not marketplace install.

## Per-project state

The `.pHive/` directory holds epic YAMLs, story YAMLs, episode records, cycle
state, insights, sessions, and the metrics event stream when enabled. It is:
- Gitignored (so it never lives in a PR)
- Excluded from marketplace installs (so it never ships)
- Relocatable via `paths.state_dir` (see `state-relocation.md`)

## See also

- `hive/references/configuration.md` — two-file config contract, settings reference
- `hive/references/state-relocation.md` — how to move the state directory
- `.claude-plugin/marketplace.json` — the exclude list that enforces the boundary
- `.pHive/epics/hive-release-readiness/shipping-manifest.txt` — auditable list of
  what actually ships in a consumer install (maintainer audit artifact)
