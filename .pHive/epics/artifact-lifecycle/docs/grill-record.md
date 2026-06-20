# Grill Record — artifact-lifecycle

**Source draft:** `.pHive/epics/artifact-lifecycle/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (7 signals, from research brief)
**Generated:** 2026-06-08T16:30:00Z

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 2 findings
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — "archive" carries two incompatible meanings in the same doc. For tracked artifacts (§1, §2) "archive" = `git rm` and "Git history is the durable archive" (durable, retrievable). For untracked artifacts "archive" = move-to-OS-temp, explicitly "transient cleanup, not long-term records retention" (§2, line 76-77). The user's original ask used "archive" to mean retrievable. A reader scanning the registry will see `archive_action: move-to-temp` and reasonably assume durability that the design says doesn't exist.
  - Draft location: lines 20-28, 76-77
  - Reference: requirement wording ("archived… so they can eventually be cleaned up"); `.pHive/CONTEXT.md`
  - Question for planner: should the two actions get distinct verbs (e.g. `retire` = git-rm-from-tree / `evict` = move-to-temp) so the registry never implies durability it can't deliver?

## Hidden assumptions

- **H1** — The design assumes shipped tracked artifacts are safe to `git rm` from the working tree because "git history is the archive." But several tracked classes are deliberately retained *in the live tree* because tools scan them: `gate-mode-audit.mjs` aggregates `.pHive/audits/post-run/**` ("Tracked so cross-run aggregation sees a stable corpus" — gitignore comment), story-status derivation reads `.pHive/episodes/**`, and cross-run metrics aggregation reads `.pHive/metrics/**`. `git rm`-ing shipped instances removes them from the corpus those consumers walk.
  - Draft location: lines 20-24, 61-69, 90-92
  - Why this matters: archival could silently shrink the input set of audit/metrics/status aggregators — the artifacts exist in git history but the consumers scan the working tree, not `git log`.
  - Question for planner: for each tracked class, does any live consumer scan the directory? If yes, is git-rm archival actually safe, or must those classes stay in-tree (report-only) until consumers are taught to read history?

- **H2** — The active predicate for the largest classes (story/epic/episode/docs) keys on `/ship`-written `status: shipped` + `release_id`. The design assumes `/ship` is the normal terminal path. But most epics in this very repo never ran `/ship` (story status YAMLs are stale by design; many epics merged via PR without a ship step). So the predicate may fire on almost nothing — the sweep archives little, footprint keeps growing — OR legacy epics need a different terminal signal.
  - Draft location: lines 81-88, 214-218
  - Why this matters: a correct-but-rarely-true predicate means the epic's goal (self-bounding footprint) isn't met for the bulk of existing artifacts.
  - Question for planner: what archives the large back-catalog of pre-`/ship` epics? A migration/backfill pass keyed on a different terminal signal (merged-to-main + age), or is `/ship` adoption a prerequisite?

## Unresolved tensions

- **U1** — git-rm archival vs the gitignore allowlist structure. The repo allowlists each tracked epic dir explicitly (`!.pHive/epics/<id>/**`). The design git-rm's shipped epics but never says what happens to the orphaned allowlist entries, or whether removing the entry (re-ignoring the dir) is part of archival.
  - Draft location: lines 61-69, 186-187
  - Tension: archival removes files but leaves dangling allowlist lines; re-ignoring vs leaving them diverge on future re-creation behavior.
  - Question for planner: is allowlist-entry removal part of the archive action for tracked epic dirs, or deliberately left?

- **U2** — Age thresholds (30/60/90d, §5 Q1) require a reliable per-artifact age, but the doc never says how age is measured. For git-tracked files, filesystem mtime resets on every `git checkout`/clone — a fresh clone makes every tracked artifact look brand-new, so an mtime-based sweep would archive nothing after a clone. `git log` last-commit date is the only stable age for tracked files.
  - Draft location: lines 14-15, 198-202
  - Tension: one age source (mtime) works for untracked runtime files but is wrong for tracked; the other (git log) only works for tracked.
  - Question for planner: define the age source per bucket — git-last-commit-date for tracked, file mtime for untracked — and state it in the registry schema.

## Convention violations

- **C1** — `git rm` of shipped tracked metrics/audits contradicts the documented maintainer intent that those trees stay tracked *for ongoing aggregation*. The gitignore carries explicit comments: post-run audits "Tracked so cross-run aggregation (gate-mode-audit.mjs) sees a stable corpus"; metrics fixtures tracked for unit tests. Archiving (removing) shipped instances may erode the very corpus the convention preserves.
  - Draft location: lines 61-65, 103-105, 107-109
  - Convention: `.gitignore` rationale comments; `hive/scripts/gate-mode-audit.mjs` cross-run aggregation
  - Question for planner: explicitly carve metrics/audits out of git-rm archival (report-only or in-tree retention) unless their consumers are migrated to read history — align with or consciously override the convention.

## Posture mismatches

- **P1** — The design leads with a full new subsystem: `hive/lib/artifact_lifecycle/` with registry + planner + executor + CLI/scheduler, spanning ~10 subsystems in one epic. The project posture favors composable, incremental atoms (sdr-8 is one focused sweep). Given H1/H2 leave the git-rm-tracked half genuinely uncertain, building the whole registry-driven service up front risks over-building the half that's blocked on unresolved questions.
  - Draft location: lines 37-47, 236-250
  - Posture reference: composable-substrate / atomic-skill posture (`.pHive/CONTEXT.md`); sdr-8 as the incremental precedent
  - Question for planner: should slice 1 ship only the *untracked-runtime* sweep (a clean sdr-8 generalization, no git-rm, no consumer-corpus risk), and defer the tracked/git-rm machinery to a later slice gated on resolving H1/H2 — rather than committing to the full registry service now?

## Notes

Findings cluster on one theme: **the untracked-runtime half is clean and ready; the git-rm-tracked half is where the real unknowns live** (H1 consumers-scan-live-tree, H2 /ship-rarely-ran, U1 allowlist, U2 age-source, C1 aggregation-corpus). The structured outline should sequence the untracked sweep first (low-risk, immediate footprint relief, direct sdr-8 lineage) and treat tracked-artifact git-rm archival as a second, gated phase once the consumer-corpus and terminal-signal questions are answered. That also de-risks the Large scope.

## Out of scope (this pass)

Grill does not propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner resolves before stories are written.
