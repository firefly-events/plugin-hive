# Meta-Shotgun Runbook

## Purpose

`/meta-shotgun` is a LOCAL-ONLY maintainer skill that batch-processes
accumulated `tier: little-fix` backlog candidates into a single PR. It is the
designated path for small-scope fixes that would clog the nightly
`/meta-meta-optimize` cycle (which is reserved for `structural` and `strategic`
candidates). Cadence: monthly, maintainer-triggered. Not registered in
`plugin.json` — never ships publicly.

## Prerequisites

1. Working tree is clean (`git status` shows no uncommitted changes).
2. `.pHive/meta-team/queue-meta-meta-optimize.yaml` exists.
3. At least one entry has `tier: little-fix` AND `status: pending`.
4. `hive/lib/meta-experiment/` is importable (standard plugin-hive checkout).

If prerequisite 3 is not met, the skill exits cleanly with no side effects —
no worktree, no PR, no error.

## Running a Shotgun Cycle

**Dry run (recommended first):**

```
/meta-shotgun dry_run=true
```

Prints the list of candidates that would be processed and exits. No changes to
the working tree or queue file.

**Live run:**

```
/meta-shotgun
```

1. Reads the queue, filters `tier: little-fix` + `status: pending`.
2. Creates a single git worktree.
3. Applies all candidates in the worktree (one commit per file or logical group).
4. Runs test suite (`node --test`) and linter; aborts and discards the worktree
   on validation failure.
5. Opens a PR titled `meta-shotgun YYYY-MM` targeting `develop`.
6. Marks processed candidates `status: done` in the queue file.

## PR Shape

- Title: `meta-shotgun YYYY-MM`
- Base branch: `develop`
- Body: one section per directory touched, listing each candidate applied.
- One PR per invocation — never more.

## Failure Recovery

| Failure | State left behind | Recovery |
|---------|------------------|----------|
| Validation failure (test/lint) | Worktree at `.git/worktrees/<name>`; queue unchanged | Fix the failing candidate in the queue or remove it; re-run |
| PR open failure | Worktree in place; queue unchanged | Inspect `git worktree list`; open PR manually or run again after fixing the cause |
| Zero candidates | Nothing | No action needed |

After manual PR creation following a PR-open failure, mark the processed
candidates `status: done` in the queue file by hand.

## Queue Hygiene

- `tier: little-fix` definition: diff < 50 lines, no schema change, no skill behavior change.
- Set `tier: structural` (the default) for anything that touches file/module structure.
- Set `tier: strategic` for cross-cutting or multi-epic changes — those require a planning epic before the automated cycle can consume them.
- The nightly `/meta-meta-optimize` cycle excludes `tier: little-fix` candidates entirely; they accumulate until the next shotgun run.

## Key Files

| File | Purpose |
|------|---------|
| `maintainer-skills/meta-shotgun/SKILL.md` | Runner contract (canonical) |
| `hive/workflows/meta-shotgun.workflow.yaml` | Step sequence |
| `.pHive/meta-team/queue-meta-meta-optimize.yaml` | Candidate backlog (human-edit only) |
| `hive/references/meta-optimize-maintainer.md` | Broader maintainer procedures |

## Relationship to Nightly Cycle

The nightly `/meta-meta-optimize` cycle and the monthly `/meta-shotgun` cycle
share the same queue file but process disjoint candidate pools:

| Cycle | Consumes | Cadence |
|-------|----------|---------|
| `/meta-meta-optimize` | `tier: structural`, `tier: strategic` | Nightly (automated) |
| `/meta-shotgun` | `tier: little-fix` | Monthly (maintainer-triggered) |

A candidate with no `tier:` field defaults to `structural` and is processed
by the nightly cycle. Add `tier: little-fix` explicitly to route to shotgun.
