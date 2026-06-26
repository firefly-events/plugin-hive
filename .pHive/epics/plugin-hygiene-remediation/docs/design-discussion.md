# Design Discussion — plugin-hygiene-remediation

**Epic:** plugin-hygiene-remediation
**Base branch:** develop
**Date:** 2026-06-25
**Source:** Follow-on to `.pHive/audits/plugin-install-payload/report.md` (2026-06-19)

## §0 Prelude

The 2026-06-19 install-payload audit found that **every tracked file ships to every
consumer at install time** (Claude Code plugins are delivered by `git clone`; there is
no native packaging manifest). Of ~2,179 tracked files / ~15.5 MB, **~55% (~8.6 MB,
~1,313 files) is maintainer-only** — planning trees, run logs, audit trails, internal
proposals, CI config, and the maintainer test suite. The single largest contributors
are `.pHive/epics/` (5.5 MB) and `.pHive/episodes/` (1.8 MB), together **47% of the
payload**, and both grow with every new epic.

The maintainer (Don) endorsed a two-phase remediation: **A then B**.

## §1 Goal

Stop shipping maintainer-only files to plugin consumers, in two phases:

- **Phase A (stop-gap, ships first):** untrack all maintainer-only trees via
  `git rm --cached` + `.gitignore` expansion. Removes ~55% of payload immediately.
  Blocks nothing; reversible.
- **Phase B (durable fix, sequenced after A):** relocate maintainer-only trees to a
  separate private `plugin-hive-internal` repo, referenced from the main repo by link
  only. Requires reworking runtime write paths that currently target the working tree.

North star: a fresh `git clone` of the consumer plugin contains only runtime-required
files; maintainer planning/history lives elsewhere but stays accessible to maintainers.

## §2 Proposed Approach

### Phase A — untrack (mechanical, single PR)

1. `git rm --cached -r` the maintainer-only trees (files stay on disk; only the index
   entry is dropped).
2. Rewrite `.gitignore`: remove the 40+ per-epic negation rules that force-re-track
   `.pHive/epics/<name>/` and `.pHive/episodes/<name>/`; add blanket ignores for the
   untracked trees. **Preserve** consumer-side negations (e.g.
   `.pHive/hive.config.yaml`, `.pHive/runtime/`).
3. Add `.gitignore` rules for the test-runner litter that floods repo root
   (`pytest-of-don/`, `h03-*`, `hpr4-*`, `slack-notify-test-*`, `hermes-*-test-*`,
   `.pHive/dag-spawn-state/`) — discovered live during this epic's setup (~905 junk
   dirs cleaned).
4. Verify no consumer runtime reads an untracked tree (research-gated; see §3).

**In-scope trees (untrack):** `.pHive/epics/`, `.pHive/episodes/`, `.pHive/meta-team/`,
`.pHive/specialist-phases/`, `.pHive/proposals/`, `.pHive/audits/`, `.pHive/cycle-state/`,
`.pHive/upstream-watch/`, `.pHive/triage/`, `.pHive/research/`, `.pHive/research-drafts/`,
`.pHive/cross-cutting-concerns.yaml`, `.hive/insights/`, `maintainer-skills/`,
`docs/reports/`, `tests/`, `.github/`, `scripts/`, lint configs (`.coderabbit.yaml`,
`.markdownlint*`, `.yamllint.yml`).

### Phase B — separate maintainer repo (durable)

1. Stand up `plugin-hive-internal` (private). Move maintainer-only trees there,
   preserving history (`git filter-repo` / subtree split).
2. Rework runtime write paths so daemon / multica-dispatch write run-logs to a path
   that is no longer a tracked location in the consumer repo (research-gated; see §3) —
   e.g. a configurable state dir resolved through `hive/lib/config.py` rather than a
   hardcoded `.pHive/episodes/` under the repo root.
3. Replace the in-repo trees with a README pointer to the internal repo.
4. Decide cross-reference strategy for `.pHive/epics/<id>/` links in comments/issues.

## §3 Risks & Open Questions (research-gated)

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Untracking a tree that consumer runtime READS at run time breaks installs | Research pass classifies every tree READ-AT-RUNTIME vs MAINTAINER-ONLY before untrack (Phase A story 1) |
| R2 | Stripping negation rules also drops consumer-side `.pHive/hive.config.yaml` / `.pHive/runtime/` | Research enumerates consumer-side negations to PRESERVE; gitignore rewrite is allowlist-aware |
| R3 | Daemon / multica-dispatch write run-logs into the working tree; untracking leaves them as perpetual untracked noise (Phase A) or breaks writes (Phase B move) | Phase A: files stay writable on disk, just ignored — no break. Phase B: redirect writes via config-resolved state dir |
| R4 | `.pHive/epics/<id>/` links in comments/issues break in fresh clones | Accept for Phase A (maintainer keeps trees locally); Phase B resolves via internal-repo URLs |
| R5 | Ambiguous trees (`.pHive/metrics/` fixtures, `.pHive/test-scenarios/`, `teams/`, `CONTEXT.md`, `project-profile.yaml`) may be consumer-needed | Research resolves each KEEP-TRACKED vs SAFE-TO-UNTRACK with deciding ref |

**Open questions:**
1. Does any consumer skill read `.pHive/CONTEXT.md` / `.pHive/teams/` at runtime? (research)
2. Is `tests/` ever shipped intentionally (consumer-run conformance)? Audit says no.
3. Phase B: separate repo vs. git submodule vs. orphan branch — which carries history best with least operational cost?

## §4 Dependencies

- Phase A research story gates the Phase A untrack story.
- Phase B depends on Phase A landing first (A is the safe reversible base).
- Phase B write-path rework depends on `hive/lib/config.py` state-dir resolution
  (`sdr-1` resolver already Python-primary per the charter).

## §5 Scale Assessment

**Large.** Phase A is medium-mechanical but repo-wide and irreversible-ish (history
visibility). Phase B is a migration (separate repo + runtime write-path rework). Two
clearly-sequenced phases, cross-cutting the gitignore, runtime config, daemon, and
multica dispatch. Recommend full decomposition with Phase A shippable independently.
