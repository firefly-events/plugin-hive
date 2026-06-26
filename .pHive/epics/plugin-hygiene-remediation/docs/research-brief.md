# Research Brief — plugin-hygiene-remediation

**Date:** 2026-06-25
**Source:** codebase-analyst pass over runtime read/write coupling of `.pHive` + root trees.

## Canonical untrack manifest

### A — Full untrack (pure maintainer-only, no runtime read found)
| Tree | Deciding ref |
|------|-------------|
| `.pHive/proposals/` | only `.gitignore` negation; no runtime reader |
| `.pHive/research/` | no runtime ref |
| `.pHive/research-drafts/` | no runtime ref |
| `.pHive/meta-team/` | read only by `maintainer-skills/meta-optimize/run.py` (maintainer-only) |
| `.pHive/upstream-watch/` | maintainer-only, no runtime ref |
| `.hive/insights/` | dev implementation notes only |
| `maintainer-skills/` | no runtime imports |
| `tests/` | test-only |
| `scripts/` | no runtime imports |
| `.github/` | CI config only |
| `.coderabbit.yaml`, `.markdownlint*`, `.yamllint.yml` | tooling configs |
| `docs/reports/` | maintainer-only |
| `.pHive/teams/` | no runtime read (only `.gitignore` negation) |
| `.pHive/CONTEXT.md` | human glossary; no programmatic reader |

### B — Untrack historical CONTENTS only; KEEP parent dir negation (runtime write/read target)
| Tree | Why parent must stay |
|------|---------------------|
| `.pHive/epics/` | `dag_executor/.../agent.py:501` diffs git for epic paths; `validate_output.py:16` takes `--epic-dir`; consumer `/plan` writes new epic dirs (self-allowlists) |
| `.pHive/episodes/` | `dag_executor/episode.py` writes via `resolve_state_dir`; `multica-story-dispatch/{distill,episode-sync}.mjs` write here |
| `.pHive/cycle-state/` | `multica-story-dispatch/{mcp-tools,cli}.mjs` read+write |
| `.pHive/specialist-phases/` | `/plan` writes scenario refs (SKILL.md:641) |
| `.pHive/audits/` | `artifact_lifecycle/registry.py:263` artifact class |
| `.pHive/triage/` | `/triage` consumer skill write target |

Mechanism: parent `!.pHive/epics/` + `.pHive/epics/*` ignore stay; remove the 40+
per-item maintainer negations; `git rm --cached` the maintainer's historical contents.
Consumer runtime self-allowlists its own new dirs (existing `/plan` step 0b behavior).

### C — PULLED from untrack list (KEEP-TRACKED — consumer runtime reads)
| Tree | Deciding ref |
|------|-------------|
| `.pHive/metrics/` | `scope_drift_reader.py:37`, `skill_candidate_mine.py:9` read events; schema ref'd by `budget-gate.js:40` |
| `.pHive/test-scenarios/` | `/plan` writes `scenario_ref` here (SKILL.md:641,654) |
| `.pHive/team-memories/` | `artifact_lifecycle/exclusions.py:64` protected boundary |
| `.pHive/multica/` | `multica-bootstrap/index.mjs:415,566,734` mandatory config (agents/squads/autopilots) |
| `.pHive/project-profile.yaml` | `skill_candidate_mine.py:113`, `meta-optimize`, `/plan`, `/design`, `/kickoff` |
| `.pHive/cross-cutting-concerns.yaml` | `/plan` step 3 loads it |

## Must-preserve gitignore negations (consumer-side)
`.pHive/hive.config.yaml`, `.pHive/runtime/`, `.pHive/runtime/executor-graduated-workflows.yaml`,
`.pHive/cycle-state/` (parent), `.pHive/metrics/` + `/**`, `.pHive/test-scenarios/` + `/**`,
`.pHive/project-profile.yaml`. Total `!` negation lines in `.gitignore` today: **172**.

## Phase B write-path findings
- `dag_executor/episode.py` ALREADY writes via `hive.lib.config.resolve_state_dir` (sdr-1). ✓ no rework needed.
- `multica-story-dispatch` HARDCODES `.pHive/` paths: `cycle-state` (`mcp-tools.mjs:83`, `cli.mjs:143`), episodes (`distill.mjs:103`, `episode-sync.mjs:304`). **← Phase B rework target.**

## Test-runner litter (root pollution, observed live)
~905 junk dirs cleaned during epic setup: `pytest-of-don/`, `h03-gate-latch-*`, `h03-multi-epic-*`,
`hpr4-*`, `slack-notify-test-*`, `hermes-*-test-*`, `.pHive/dag-spawn-state/`. Need gitignore rules.
