# Artifact Lifecycle — Design Gate Decisions

**Resolved:** 2026-06-08 · maintainer sign-off at the `/plan` design-discussion gate.
Supersedes the *recommended answers* in `design-discussion.md` §5 and resolves the
grill-record findings. Story decomposition consumes THIS file as binding.

## Core decisions

### D1 — Phasing: untracked-first, tracked/git-rm half gated (grill P1/H1)
- **Slice 1 (this epic's spine):** the **untracked-runtime sweep** only — a clean generalization of the sdr-8 prototype. Covers untracked/ignored runtime artifacts (DAG run-state, runtime metrics stop/spawn streams once consumed, context snapshots, acknowledged interrupts, promoted/discarded staged insights, Chroma sidecars, scratch). Action = **move-to-temp**. No `git rm`. No consumer-corpus risk.
- **Tracked/`git rm` archival is DEFERRED** to a later, separately-gated slice — not built in this epic until H1 (consumer-corpus) is resolved per D2. The registry may *declare* tracked classes but their action in this epic is **report-only** (D2).

### D2 — Tracked classes scanned by live consumers: REPORT-ONLY (grill H1/C1)
- Classes a live tool walks in the working tree — `.pHive/audits/**` (`gate-mode-audit.mjs` aggregation), `.pHive/episodes/**` (story-status derivation), `.pHive/metrics/**` (cross-run aggregation) — are **never `git rm`'d in this epic**. The sweep **reports** them only.
- Rationale: those trees are deliberately tracked *for ongoing aggregation* (gitignore rationale comments). Removing shipped instances would shrink the corpus the consumers scan; they read the live tree, not `git log`. Revisit only if/when consumers are taught to read git history (out of scope here).

### D3 — Back-catalog terminal signal: add merged+age backfill (grill H2)
- Beyond `/ship`-written `status: shipped` + `release_id`, add a **legacy terminal signal**: epic/stories whose feature branch is **merged to the default branch** AND older than the class threshold. This lets the bulk of pre-`/ship` epics become eligible (most existing epics never ran `/ship`; YAML `status:` is advisory/stale).
- Applies to the eligibility predicate; the **action** still obeys D1/D2 (untracked→move-to-temp now; tracked→report-only this epic).

### D4 — Vocabulary: distinct action verbs (grill V1)
Registry `archive_action` enum uses non-overlapping verbs so durability is never implied falsely:
- **`evict`** — untracked → OS temp. Transient cleanup; NOT durable (OS purge reclaims).
- **`retire`** — tracked → `git rm` (durable via git history). **Deferred** this epic.
- **`report`** — list candidates only, take no action. Default for D2 classes + dry-run.

### D5 — Age source per bucket (grill U2)
- **Untracked** artifacts: filesystem **mtime**.
- **Tracked** artifacts: **git last-commit date** (mtime resets on clone/checkout — unreliable). Stated in the registry schema per class.

## Open-question rulings (design-discussion §5 — defaults accepted)
1. **Thresholds:** conservative — 30d completed DAG runs + consumed interrupts; 60d metrics after observation windows; 90d post-ship/close for episodes/design/test/audits/docs.
2. **`.pHive/team-memories/**`:** treat as **memories → forever; hard-exclude.**
3. **Release artifacts:** **retain** as release provenance by default.
4. **Epic-closed signal:** derive from all in-scope stories shipped + `release_id`; add explicit epic terminal field only if edge cases appear. (Plus D3 merged+age for legacy.)
5. **Failed DAG runs:** **not** archived in first sweep (resumable).
6. **Legacy in-repo archives** (`.pHive/meta-team/archive/**`): leave as committed evidence.
7. **Scan scope:** default resolved `paths.state_dir` + explicit **compatibility scan** for legacy hardcoded `.pHive`.

## Forever hard-exclude (never evict/retire/report-for-removal)
`~/.claude/hive/memories/**`, `.pHive/team-memories/**`, KG sqlite (`~/.claude/hive/kg.sqlite` / `$HIVE_KG_SQLITE_PATH`), ChromaDB collection/index data. (Chroma pid/port/lock/log sidecars ARE evictable.)

## Dependencies
- **state-dir-resolver** — sweep operates on resolved `paths.state_dir`; sdr-8 is the prototype mechanism to generalize. sdr-8 itself stays in the state-dir-resolver epic; this epic extends the pattern (do not double-build).
- **Python-first** per language-strategy ADR (Option B) — library under `hive/lib/artifact_lifecycle/`.

## Scale
Phasing (D1) shrinks active scope to the untracked sweep + registry + backfill predicate + weekly automation + report-only tracked declaration. **Medium** — proceed to decomposition without a full structured outline.

version_bump: **minor**.
