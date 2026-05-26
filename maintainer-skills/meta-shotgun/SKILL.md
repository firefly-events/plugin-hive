---
name: meta-shotgun
status: live
description: |
  LOCAL-ONLY maintainer skill for monthly batch-cleanup of accumulated
  tier:little-fix backlog candidates. Collects all pending little-fix entries
  from queue-meta-meta-optimize.yaml and ships them as a single PR with
  sections per directory. Maintainer-triggered only; not shipped in plugin.json.
args:
  - name: dry_run
    description: "Print candidate list and exit without making changes. Default: false."
    required: false
trigger_phrases:
  - /meta-shotgun
---

# Meta-Shotgun

This is the LIVE maintainer path for `/meta-shotgun`. Read this file as the runner and follow the referenced workflow in order.

## Scope Boundaries

- Path lock: this skill stays at `maintainer-skills/meta-shotgun/SKILL.md` and is NOT registered in `plugin.json`
- Packaging boundary: local-only, never ships on the public skill surface
- Promotion path: single PR per run titled `meta-shotgun YYYY-MM`; PR targets `develop`
- Swarm boundary: maintainer swarm only; does not share state with `/meta-meta-optimize` cycles

## Preconditions

Before starting, verify all of the following:

- `.pHive/meta-team/queue-meta-meta-optimize.yaml` exists
- At least one entry has `tier: little-fix` AND `status: pending`
- The repo has a clean working tree (no unresolved local state before worktree creation)
- `hive/lib/meta-team/backlog-mutator.mjs` is importable from this repo

**Zero candidates:** if no `tier: little-fix` + `status: pending` entry exists, exit immediately with:

```
meta-shotgun: nothing to do — no tier:little-fix candidates with status:pending in queue-meta-meta-optimize.yaml
```

Do not create a worktree. Do not open a PR. Do not error.

## Process

Dispatch to and follow `hive/workflows/meta-shotgun.workflow.yaml` exactly. Do not reimplement its step logic inline. The workflow carries:

1. **Read queue** — load `.pHive/meta-team/queue-meta-meta-optimize.yaml`, filter `tier: little-fix` AND `status: pending`
2. **Apply changes** — execute all selected candidates in a single worktree (`git worktree add`); no per-candidate worktrees
3. **Validate** — run test suite (`node --test`) and linter; abort and discard worktree if validation fails
4. **Commit** — single batch commit covering all applied candidates (one commit per run, message: `meta-shotgun: batch little-fix candidates YYYY-MM`); matches the `commit-push` step in `hive/workflows/meta-shotgun.workflow.yaml`
5. **Promote** — open a single PR titled `meta-shotgun YYYY-MM` targeting `develop`; PR body contains one section per directory touched
6. **Mark done** — update each processed candidate to `status: done` in the queue file

## Output

- Single PR titled `meta-shotgun YYYY-MM` (e.g. `meta-shotgun 2026-05`)
- PR body structured as one section per directory, listing each candidate applied
- Queue entries for processed candidates updated to `status: done`

## Failure Modes

- **Zero candidates:** exit cleanly with informational message (see Preconditions)
- **Validation failure:** discard the worktree, leave queue entries as `pending`, report which candidate caused the failure
- **PR open failure:** log the error; leave the worktree in place for manual inspection; do not mark queue entries done until PR is open

## What This Skill Must Not Do

- Register itself in `plugin.json` or otherwise ship publicly
- Open more than one PR per invocation
- Process `tier: structural` or `tier: strategic` candidates (those belong to the nightly `/meta-meta-optimize` cycle)
- Mark candidates `status: done` before the PR is successfully opened
- Reimplement the workflow step logic inline; dispatch to the workflow YAML

## References

- `hive/workflows/meta-shotgun.workflow.yaml` — step sequence for this skill
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` — candidate backlog (human-edit only)
- `maintainer-skills/meta-meta-optimize/SKILL.md` — sibling maintainer skill (nightly cycle)
- `.pHive/epics/meta-improvement-reset/docs/design-discussion.md` §3.4 — design rationale
