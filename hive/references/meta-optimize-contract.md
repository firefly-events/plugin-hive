# /meta-optimize Contract

> **Status:** foundation document — defines the contract for the public
> `/meta-optimize` surface. The implementing skill ships in a future epic.
> This reference is the authoritative source for the adapter binding,
> target resolution rule, and public-vs-maintainer boundary.

## Core contract

The public `/meta-optimize` skill binds `DirectCommitAdapter.repo_path` to the
resolved target project:

```python
DirectCommitAdapter(repo_path=HIVE_TARGET_PROJECT)
```

`HIVE_TARGET_PROJECT` is resolved by `hooks/common.sh` via
`_resolve_target_project`, which reads `paths.target_project` from the root
`hive.config.yaml` and falls back to the invoking cwd when unset. This is the
locked cycle-state contract from decision `q3-attached-project-semantics`.

This binding is the public surface contract. The workflow, charter render, and
all target-relative edits inherit from the resolved `HIVE_TARGET_PROJECT`
value; they do not infer a different repo root later in the cycle.

## Target resolution

Ordered rule:

1. Config-first: if `paths.target_project` is set in the root
   `hive.config.yaml`, use that absolute path.
2. Cwd fallback: if `paths.target_project` is null or missing, use the
   invoking cwd (`$PWD` at skill-start time).
3. No CLI arg form: `/meta-optimize` does NOT accept a repo path on the
   command line. The target is settled by config / cwd only.

Implications:

- Resolution happens through `_resolve_target_project` in `hooks/common.sh`.
- The configured target path, when present, is authoritative over launch
  location.
- The cwd fallback exists to preserve attached-project behavior without adding
  a separate command-line targeting surface.

## Public-vs-maintainer boundary

| Aspect | /meta-optimize (public) | /meta-meta-optimize (maintainer-only) |
|---|---|---|
| Surface | Ships to marketplace consumers | In maintainer-skills/ — excluded from marketplace |
| Target | Resolved via HIVE_TARGET_PROJECT (config-first, cwd fallback) | Hardwired to the plugin-hive root |
| Adapter | DirectCommitAdapter(repo_path=HIVE_TARGET_PROJECT) | DirectCommitAdapter(repo_path=<plugin-hive root>) |
| Charter | Rendered from hive/references/meta-team-charter-template.md at cycle boot | Local-only maintainer charter under plugin-hive's own .pHive/meta-team/ |
| Taxonomy | Charter-defined (pluggable per target project) | Plugin-hive-specific categories |

This boundary is intentional. The public contract is target-project-relative
and template-driven; the maintainer path remains plugin-hive-local and does not
define the marketplace surface.

## Taxonomy (charter-defined)

The public `/meta-optimize` surface honors the charter-defined taxonomy
contract: the rendered charter's `taxonomy.finding_categories:` list is
the AUTHORITATIVE category set for the cycle, not a hardcoded global.

Consumers of /meta-optimize set their taxonomy in the rendered charter at
`{resolved_state_dir}/meta-team/charter.md` (the default shipped template
at `hive/references/meta-team-charter-template.md` provides 5 generic
categories: code-quality, test-coverage, documentation, performance,
security). Consumers may add, remove, or replace categories to fit their
target project without editing step-02-analysis, step-03-proposal, or
step-06-evaluation.

The maintainer-only `/meta-meta-optimize` workflow continues to use its
plugin-hive-specific taxonomy (MISSING_FILE, SCHEMA_INCONSISTENCY, etc.).
That set is declared in the plugin-hive maintainer charter, not in step
code. See `hive/references/meta-team-charter-template.md` for both example
taxonomies.

## Out of scope

Non-goals for this contract:

- The specific invocation syntax for `/meta-optimize` (that is the
  implementing epic's decision).
- Multi-cycle scheduling or batch semantics.
- Any changes to promotion/revert behavior — those stay exactly as they are in
  the existing meta-team workflow; the adapter binding does not alter them.
- Any changes to the existing maintainer-only `/meta-meta-optimize` — that
  stays local-only and hive-targeting.

## References

- `hive/references/meta-team-charter-template.md` — template-source for
  rendered charter
- `hive/references/state-boundary.md` — shipping boundary (maintainer vs
  consumer)
- `hive/references/state-relocation.md` — `paths.state_dir` relocation guide
- `hive/workflows/meta-team-cycle.workflow.yaml` — workflow definition the
  adapter binds into
- `hooks/common.sh` — the resolver that `_resolve_target_project` lives in

These references are normative for the surrounding system behavior named here.
If an implementing epic needs to extend the public surface, it must do so
without violating this file's adapter binding, target resolution rule, or
maintainer/public split.

## Forward reference

The implementing public skill does not yet exist on this branch. In
particular, `skills/meta-optimize/SKILL.md` is intentionally absent here and
lands in a later epic.

This document is therefore a forward-looking contract, not a skill stub. Per
cycle-state decision `step9-decision-2`, the contract lives in this dedicated
reference document rather than being attached to a partial future skill.

The later implementer must honor this contract exactly:

- bind `DirectCommitAdapter.repo_path` to `HIVE_TARGET_PROJECT`
- resolve `HIVE_TARGET_PROJECT` via config-first, cwd fallback semantics
- keep `/meta-optimize` public and `/meta-meta-optimize` maintainer-only
