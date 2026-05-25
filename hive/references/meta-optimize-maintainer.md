# Meta-Optimize Maintainer Procedures

## Purpose

This reference covers procedures for maintainers of the `plugin-hive`
meta-improvement system. It applies to the **maintainer-local** swarm
(`/meta-meta-optimize`) only — not the public consumer-facing `/meta-optimize`
skill. See `hive/references/meta-optimize-contract.md` for the public-path
contract.

## Nightly Cycle

The nightly cycle is driven by
`maintainer-skills/meta-meta-optimize/SKILL.md`. Run it from the
`plugin-hive` root on a clean working tree. The skill:

1. Boots and checks baseline availability (BL2.3 gate).
2. Analyzes the codebase for structural issues.
3. Proposes and implements fixes in a dedicated git worktree.
4. Promotes successful work via `DirectCommitAdapter` (direct commit, no PR).
5. Appends a ledger entry and writes a morning summary.

The candidate queue lives at
`.pHive/meta-team/queue-meta-meta-optimize.yaml`. Each nightly run processes
exactly one candidate. The queue is human-edited only (`Q-new-D` locked).

### Queue Management — `tier` Field

Each candidate may carry an optional `tier:` field that classifies work by
size and risk. When absent, `structural` is assumed (backward-compatible).

| Value | Meaning | Target cycle |
|-------|---------|--------------|
| `little-fix` | <50 lines diff, no schema/skill behavior change | `/meta-shotgun` (shotgun) |
| `structural` | File/module-scope changes — **default** | Nightly cycle |
| `strategic` | Cross-cutting / multi-epic changes | Manual planning only |

Set `tier: little-fix` only when the diff is trivially small and carries zero
behavioral risk. Set `tier: strategic` for anything that touches multiple epics
or alters public skill contracts — those candidates must be promoted through a
planning epic before the automated cycle can consume them.

## MVS Proof

Regenerate the canonical BL3.6 MVS proof by running:

```
HIVE_WRITE_MVS_PROOF=1 pytest tests/meta_optimize/test_meta_optimize_e2e.py
```

The repeatable proof script is `scripts/run_rollback_realism_proof.py`.
Proof artifacts land under `.pHive/audits/mvl-proof/` as YAML files with
`type: mvl-proof-rollback-realism`.

## Key Files

| File | Purpose |
|------|---------|
| `maintainer-skills/meta-meta-optimize/SKILL.md` | Canonical cycle runner |
| `.pHive/meta-team/charter-meta-meta-optimize.md` | Active maintainer charter |
| `.pHive/meta-team/ledger.yaml` | Per-cycle history and closure evidence |
| `.pHive/meta-team/queue-meta-meta-optimize.yaml` | Human-edited candidate backlog |
| `hive/lib/meta-experiment/` | Shared runtime library |
| `hive/references/meta-experiment-isolation.md` | Worktree isolation model |

## Scope and Charter

The maintainer swarm operates on `hive/**`, `skills/hive/agents/memories/**`,
`.pHive/teams/**`, `.pHive/meta-meta-optimize/**`, and `hive/lib/**`. It must
not target user-project files or touch `hive/hive.config.yaml` without a
human confirmation. See
`maintainer-skills/meta-meta-optimize/SKILL.md` §Scope Boundaries for the
full authority map.
