# State and Shipping Boundary

> This document defines the INTENDED consumer-vs-maintainer boundary as of the
> hive-release-readiness release, and honestly describes the one enforcement
> gap that still exists (marketplace install filter).

## Quick summary

- **Intended shipping surface:** plugin code, agents, skills, workflows, hooks,
  and a neutral baseline config (`hive/hive.config.yaml`).
- **Intended local-only (maintainer):** per-project state in `.pHive/`, the
  root consumer-override config (`hive.config.yaml`), and any future assets
  under `maintainer-skills/`.

## The two config layers

| Layer | File | What it is | Intended to ship? |
|---|---|---|---|
| Shipped baseline | `hive/hive.config.yaml` | Plugin-owned neutral defaults safe for marketplace consumers | YES |
| Root consumer override | `hive.config.yaml` (repo root) | Each user's local overrides — populated via kickoff or hand-edit | NO |

Precedence: when both files exist, the root override wins; unset keys fall
through to the shipped baseline. Runtime path resolution (via
`hooks/common.sh`) reads ONLY the root override for `paths.*` keys.

## Known enforcement gap (marketplace install filter)

**Status:** Open. Described here so consumers and maintainers aren't misled.

The Claude Code plugin marketplace schema does not expose a supported
`exclude` field on plugin entries (CodeRabbit review on PR #17). Earlier
revisions of `.claude-plugin/marketplace.json` included a top-level
`exclude: [...]` array alongside `source: "./"`; that array was never
guaranteed to be honored by the installer and has been removed.

Today a marketplace install of plugin-hive pulls via `git checkout` of
`source: "./"`. Anything tracked in git ships, including:

- The root `hive.config.yaml` (tracked so maintainers can version consumer-
  override examples; intended local-only for end consumers).
- Tracked subsets of `.pHive/` (the `.gitignore` allowlists specific
  per-epic directories for the meta-improvement-system loop; most other
  `.pHive/` content is gitignored and correctly does not ship).
- Any future `maintainer-skills/` directory, once created and committed,
  would ship unless another mechanism is introduced.

**What this means for consumers right now:** you may receive files that were
intended local-only, including a `hive.config.yaml` at the repo root containing
configuration that is specific to the plugin maintainer's workflow. Treat that
file as example input — overwrite, delete, or replace with your own overrides.
The shipped baseline at `hive/hive.config.yaml` is the consumer-safe starting
point.

**What this means for maintainers:** before the next release, replace the
`source: "./"` checkout model with one of:

1. A prepublish / build script that stages only intended-shipping paths into a
   distinct tree, and a matching `source: <subdir>` entry.
2. A `.marketplaceignore` file or equivalent if Claude Code's installer starts
   honoring one.
3. Moving the maintainer's root `hive.config.yaml` out of the repo, or
   renaming to something marketplace-install-inert.

Any of the three closes the loop. Until one lands, the intended boundary
described above is aspirational — the actual shipping surface is "whatever is
tracked in git under the plugin root."

## Per-project state (`.pHive/`)

The `.pHive/` directory holds epic YAMLs, story YAMLs, episode records, cycle
state, insights, sessions, and the metrics event stream when enabled. It is:

- Mostly gitignored (specific per-epic subdirectories are allowlisted for
  maintainer cross-PR visibility — see `.gitignore` for the exact set).
- Relocatable via `paths.state_dir` — see `state-relocation.md`.

## See also

- `hive/references/configuration.md` — two-file config contract, settings
  reference.
- `hive/references/state-relocation.md` — how to move the state directory.
- `.claude-plugin/marketplace.json` — the marketplace manifest (currently
  relies on git tracking, see gap note above).
