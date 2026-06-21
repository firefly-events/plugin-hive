# Dispatch Parity Matrix

Produced by Slice 6 of substrate-coverage-and-test-cleanup; canonical reference for what's wired across substrates. Each cell carries either a relative path to the active mode-atom skill, the marker `inline` for default-path dispatch through the orchestrator skill itself, or `N/A — reasoning` when the cell has no shipped substrate.

## Last verified: 2026-06-21

## Matrix

| Orchestrator | default | multica | cc-workflows |
|---|---|---|---|
| plan | inline | hive/lib/dag_executor/run.py + hive/workflows/plan.workflow.yaml (s9) | skills/hive/skills/plan-mode-cc-workflows/SKILL.md |
| execute | inline | skills/hive/skills/execute-mode-multica/SKILL.md | skills/hive/skills/execute-mode-cc-workflows/SKILL.md |
| test | inline | skills/hive/skills/test-mode-multica/SKILL.md | skills/hive/skills/test-mode-cc-workflows/SKILL.md |
| design | inline | skills/hive/skills/design-mode-multica/SKILL.md | skills/hive/skills/design-mode-cc-workflows/SKILL.md |
| design-review | inline | skills/hive/skills/design-review-mode-multica/SKILL.md | skills/hive/skills/design-review-mode-cc-workflows/SKILL.md |
| review | inline | skills/hive/skills/review-mode-multica/SKILL.md | skills/hive/skills/review-mode-cc-workflows/SKILL.md |

The `inline` marker means the default dispatch path runs inside the top-level orchestrator skill itself (e.g., `skills/plan/SKILL.md`) — no separate mode-atom skill file exists for the default substrate.

## Future substrate

Placeholder columns for substrates not yet shipped. New substrates land here as `not-shipped` until the full 6-row atom set is available and CI-verified.

| Orchestrator | sandcastle | gh-actions-legacy |
|---|---|---|
| plan | not-shipped — see execution.runtime: sandcastle (Epic D) | not-shipped — superseded by Multica |
| execute | not-shipped — see skills/hive/skills/execute-mode-sandcastle/SKILL.md (Epic D candidate) | not-shipped — superseded by Multica |
| test | not-shipped — see execution.runtime: sandcastle (Epic D) | not-shipped — superseded by Multica |
| design | not-shipped — see execution.runtime: sandcastle (Epic D) | not-shipped — superseded by Multica |
| design-review | not-shipped — see execution.runtime: sandcastle (Epic D) | not-shipped — superseded by Multica |
| review | not-shipped — see execution.runtime: sandcastle (Epic D) | not-shipped — superseded by Multica |

Note: `execute-mode-sandcastle/SKILL.md` exists as an Epic D candidate but the full sandcastle substrate row (all 6 orchestrators) has not shipped. It is listed here as `not-shipped` to keep the matrix forward-extensible.

## Verification

Run `node hive/scripts/verify-dispatch-parity.mjs` from repo root. Exit 0 = all cited paths resolve on disk AND `git ls-files` confirms tracking. Exit 1 = at least one path missing/untracked; checker prints the failing rows. CI runs this on every PR; PRs that move/remove a cited path fail until the matrix is updated.

Pass `--no-bump` to skip the automatic date-stamp update on the `## Last verified:` line.

## Cross-references

- [README.md](../../README.md) — Architecture Overview section references this matrix for the canonical substrate wiring map.
- [skills/hive/skills/planning-routing/SKILL.md](../../skills/hive/skills/planning-routing/SKILL.md) — The plan row of this matrix; routing skill cites this doc as its substrate context.
