# BL2.5 Review Memo — First Live No-Op Cycle + Verification Doc

**Reviewer:** Opus 4.7
**Story:** BL2.5 — Execute first live no-op cycle and write verification doc
**Slice:** S9
**Branch:** meta-improvement-system-s9
**Verdict:** **passed**
**Rationale:** A real `/meta-meta-optimize` cycle executed end-to-end on the live repo, produced a commit resolvable via `git rev-parse --verify`, closed the envelope with all six closure fields armed, and cleaned up its worktree; the proof doc properly scopes BL2.5 and defers rollback-realism to BL2.6.

---

## Per-Dimension Scores (0-5)

| # | Dimension | Score | Notes |
|---|-----------|-------|-------|
| 1 | AC1 — worktree isolation | 5 | `git worktree list` shows only main; proof.yaml records `cleanup_status: removed` with branch `meta-meta-exp-meta-2026-04-22`; script deletes worktree + local branch in success & error paths. |
| 2 | AC2 — durable artifact references | 5 | commit_ref + rollback_ref both resolve (`git rev-parse --verify` green); envelope, events, cycle-state, ledger, and latest.yaml all present and non-empty. |
| 3 | AC3 — scope discipline | 5 | proof.yaml line 33-35 explicitly defers deliberate-regression proof to BL2.6; a dedicated test asserts the string "BL2.6" appears in the proof. |
| 4 | No-stub realism | 5 | Real `DirectCommitAdapter.promote()` ran on the real repo; `96d4100` is the head commit on `meta-improvement-system-s9` with a real +1 diff on MANIFEST.md. Tests verify via subprocess git, not YAML round-trip. |
| 5 | Reproducibility | 4 | `_next_cycle_id()` handles date collisions via `-r2/-r3` suffix from the ledger. Deducts one point: `candidate_id` default is hard-coded to `mmo-2026-04-21-001`, and the backlog requires the candidate to be `step_03b_backlog_fallback`-eligible; re-running the same date would re-promote the same file a second time (append-line-twice) — OK semantically but not true idempotence. |
| 6 | Safety rails | 4 | Branch-guard (`_ensure_current_branch`), target-exists guard, try/except with `_cleanup_worktree_and_branch` + `_rollback_repo(pre_run_head)` + `_cleanup_created_paths`. Missing: explicit `git status --porcelain` dirty-tree refusal. The pre-run HEAD reset is destructive (`reset --hard`) and runs only on exception, but a dirty tree at start would be silently clobbered on error. |
| 7 | BL2.4 observation_window bug workaround | 4 | Workaround is pragmatic: envelope pre-seeds observation_window at `create()` using the same `now` later handed to `arm_watch(..., envelope_writer=None)`, then persists `regression_watch` manually. Correct behavior preserved, but latent fragility (two code paths must stay in sync). Agreed BL2.6 should resolve `IMMUTABLE_ENVELOPE_FIELDS` / `set_observation_window` contradiction. |
| 8 | Envelope shape — 6 closure fields + window | 5 | Envelope contains experiment_id, decision=accept, commit_ref, rollback_ref, metrics_snapshot (3 sub-fields), regression_watch (state/armed_at), and observation_window (start/end). `closure_validator.validate_closable` ran. |
| 9 | Candidate selection rationale | 5 | Target is `.pHive/meta-team/archive/2026-04-19/MANIFEST.md` — a documentation file in a dormant archive directory; appending an HTML comment is trivial, reversible, and has zero runtime impact. Matches backlog safety guidance for a proving run. |

**Lowest dimensions:** 5 (Reproducibility) and 6 (Safety rails), both 4/5.

---

## Findings

### F1 — Dirty-tree guard missing (dim 6, minor)
`scripts/run_first_live_cycle.py` checks branch name and target existence but never `git status --porcelain`. If invoked on a dirty worktree and the run later hits an exception, `_rollback_repo(pre_run_head)` does `git reset --hard` which would clobber uncommitted work. Not a blocker because the current invocation completed cleanly, but should be hardened.

**Recommendation (BL2.6 or follow-up):** add pre-flight `git status --porcelain` check; abort with `NEEDS_WORK: repo is dirty` before any mutation.

### F2 — BL2.4 `observation_window` immutability bug (dim 7, latent)
`hive/lib/meta-experiment/envelope.py:30` defines `set_observation_window`, but `rollback_watch.py:78` only calls it when `envelope_writer` is provided — and `IMMUTABLE_ENVELOPE_FIELDS` rejects the update when it is. BL2.5 sidesteps by pre-seeding at `envelope.create()` time. Implement-episode notes agree this needs cleanup.

**Recommendation for BL2.6:** either (a) remove `observation_window` from `IMMUTABLE_ENVELOPE_FIELDS` with a narrow "only if currently unset" rule, or (b) delete `set_observation_window` entirely and formalize pre-seeding as the contract. (a) is preferable because `arm_watch` is the conceptual owner.

### F3 — Idempotence caveat (dim 5, minor)
Re-invoking on `2026-04-22` would produce `meta-2026-04-22-r2` (correct), but the script would also append a *second* `<!-- reviewed-on: meta-2026-04-22-r2 -->` line to MANIFEST.md — so the same "dormant target" is not idempotent across invocations on the same branch. Fine for a proving run; non-issue for BL2.6 which will use a different target.

---

## Must-Fix Before Integrate

**None.** Verdict is `passed`. All ACs met, tests green, artifacts durable and resolvable.

---

## BL2.6 Preparation Notes

1. **observation_window immutability** — resolve in BL2.6 before arming a second real cycle (F2). Without a fix, every live cycle must keep the pre-seed workaround.
2. **Dirty-tree guard** — fold into BL2.6's orchestrator (or generalize `run_first_live_cycle.py` into a reusable harness) (F1).
3. **Rollback target for BL2.6** — the current `rollback_ref` (`ea5b73a`) is the immediate pre-promotion parent; BL2.6's deliberate-regression path can reuse this exact cycle's `armed` observation window or spawn a new one. The proof doc's `scope_boundary` language "against this same armed path" suggests BL2.6 can re-enter the live watch while it is still within the 14:29:48Z window — worth confirming timing.
4. **Candidate for BL2.6** — pick a target where *reverting* the change produces a functional difference visible to metrics (the MANIFEST.md approach here produces a no-op revert by design).

---

*Artifacts inspected:*
- `/Users/don/Documents/plugin-hive/.pHive/audits/mvl-proof/2026-04-22T10-29-48Z/proof.yaml`
- `/Users/don/Documents/plugin-hive/.pHive/metrics/experiments/meta-2026-04-22.yaml`
- `/Users/don/Documents/plugin-hive/.pHive/metrics/events/meta-2026-04-22.jsonl` (3 events)
- `/Users/don/Documents/plugin-hive/.pHive/meta-team/cycle-state.yaml`
- `/Users/don/Documents/plugin-hive/.pHive/meta-team/ledger.yaml`
- `/Users/don/Documents/plugin-hive/.pHive/meta-team/archive/2026-04-19/MANIFEST.md`
- `/Users/don/Documents/plugin-hive/scripts/run_first_live_cycle.py`
- `/Users/don/Documents/plugin-hive/tests/meta_meta/test_first_live_cycle.py`
- `git show 96d4100 --stat` — single-file +1 append
- `git worktree list` — only main tree present
