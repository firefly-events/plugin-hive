# BL2.6 Review Memo — Real commit-then-revert proof (MVL integrity gate)

**Verdict:** `passed`
**One-line rationale:** The regressive commit `548c2f6` and the automatic `Revert` at `c869413` are both real on-disk git commits reached via the live `regression_watch.evaluate_watch -> DirectCommitAdapter.rollback` path, with the envelope mutated by `envelope_writer=envelope` (not by hand), satisfying the `rollback-realism-proof-ambiguity` escalation end-to-end.

---

## Integrity checklist (10/10 PASS)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `git rev-parse --verify 548c2f67…` exits 0 AND sha in regressive commit log | **PASS** | `git rev-parse` returns the full sha; `git log --oneline -6` line 3: `548c2f6 meta-meta-exp(meta-2026-04-22-r2): archive audit note proof footer` |
| 2 | `git rev-parse --verify c8694138…` exits 0 AND subject begins with `Revert ` | **PASS** | `git log --format=%s -1 c869413` → `Revert "meta-meta-exp(meta-2026-04-22-r2): archive audit note proof footer"` |
| 3 | Revert commit appears above regressive in `git log --oneline -6`; regressive is ancestor of revert | **PASS** | Order: `bc4adaa, c869413, 548c2f6, …`; `git merge-base --is-ancestor 548c2f6 c869413` → 0; `c869413^` resolves to `548c2f6` (revert’s direct parent IS the regressive commit) |
| 4 | `proof_integrity.manual_revert_used / mock_callback_used / synthetic_closure_used == false` | **PASS** | proof.yaml:38–40 all three are `false` |
| 5 | `auto_revert.callback_binding == "DirectCommitAdapter.rollback (bound method)"` AND `path == "regression_watch -> closure_gate -> auto_revert_callback"` | **PASS** | proof.yaml:29–30 |
| 6 | Script: (a) dirty-tree guard; (b) no `mock/Mock/monkeypatch/unittest.mock/MagicMock` imports; (c) callback bound via `make_direct_commit_auto_revert(DirectCommitAdapter(repo_path=repo_root))`; (d) `evaluate_watch(envelope_writer=envelope)` | **PASS** | run_rollback_realism_proof.py:70–75 (dirty-tree guard fires top of main); grep for mock tokens returns only the literal string `"mock_callback_used": False` at line 340 — no imports; line 210 `adapter = DirectCommitAdapter(repo_path=repo_root)`, line 250 `auto_revert_callback = rollback_watch.make_direct_commit_auto_revert(adapter)`; line 257 `envelope_writer=envelope` (the persistent module, not None) |
| 7 | On-disk envelope shows `decision: reverted`, `regression_watch.state: tripped`, `rollback_result.success: true`, `revert_ref: c8694138…`, written by evaluate_watch | **PASS** | meta-2026-04-22-r2.yaml:7 `decision: "reverted"`, :13 `state: "tripped"`, :21 `success: true`, :22 `revert_ref: "c8694138cfc9ec2b034bfca69529ba99801f741f"`. Written by the `envelope_writer` protocol’s `set_regression_watch` / `set_decision` calls in rollback_watch.py:180–183 — not hand-crafted |
| 8 | Regressive commit physically changed target | **PASS** | `git show 548c2f6 --stat` → `.pHive/meta-team/archive/2026-04-19/AUDIT-NOTE.md  1 file changed, 2 insertions(+)` |
| 9 | Revert commit physically undoes the regressive change | **PASS** | `git show c869413` shows `Revert "…"` with body `This reverts commit 548c2f67…` and diff removing the appended `indexed-for-meta-meta-optimize proving run: meta-2026-04-22-r2` line |
| 10 | `trigger_event` internally consistent: `regression_metrics == ["wall_clock_ms"]`; post_close > baseline * (1 + threshold_pct) | **PASS** | proof.yaml:14–15 `regression_metrics: [wall_clock_ms]`; baseline 39 ms → threshold = 42.9 ms; post_close 78 ms > 42.9 ms (+100%, well over +10%) |

---

## Per-dimension scores (0–5)

| # | Dimension | Score |
|---|-----------|-------|
| 1 | Milestone honesty | **5** |
| 2 | Path signature integrity | **5** |
| 3 | Artifact durability | **5** |
| 4 | Closure evidence shape | **5** |
| 5 | Scope discipline | **5** |
| 6 | Escalation satisfaction | **5** |

All dimensions ≥ 4. No sub-4 justifications required.

---

## Findings (file:line refs)

**Load-bearing structural evidence — no defects found:**

- `scripts/run_rollback_realism_proof.py:70–75` — dirty-tree guard `_git_output("status", "--porcelain")` fires at top of `main()` before any mutation.
- `scripts/run_rollback_realism_proof.py:210` — `adapter = DirectCommitAdapter(repo_path=repo_root)` constructs a real adapter bound to the repo root (not a dummy).
- `scripts/run_rollback_realism_proof.py:250` — `auto_revert_callback = rollback_watch.make_direct_commit_auto_revert(adapter)` binds to `adapter.rollback` (see `rollback_watch.py:86–91` — returns `adapter.rollback` itself, inspectable as a bound method).
- `scripts/run_rollback_realism_proof.py:257` — `envelope_writer=envelope` uses the live envelope module, so `set_regression_watch` / `set_decision` persist to `.pHive/metrics/experiments/meta-2026-04-22-r2.yaml`.
- `scripts/run_rollback_realism_proof.py:273–282` — post-trip assertions: top git log entry must start with `Revert "` AND top sha must match `rollback_result.revert_ref` — explicit guard against the exact failure mode the escalation worried about.
- `scripts/run_rollback_realism_proof.py:284–298` — re-loads the envelope from disk and asserts `decision=reverted`, `state=tripped`, `revert_ref` matches. Guarantees the envelope mutation came through the live path, not the proof doc.
- `hive/lib/meta-experiment/rollback_watch.py:152–185` — evaluate_watch invokes `auto_revert_callback(envelope, rollback_ref)` inline and only then writes `set_regression_watch` + `set_decision("reverted")` to the writer. End-to-end live path — no synthetic closure.
- `hive/lib/meta-experiment/direct_commit_adapter.py:126–167` — `rollback()` performs real `git revert --no-edit <commit>` and returns a `RollbackResult` carrying the real revert sha; no in-memory fabrication.
- `tests/meta_meta/test_rollback_realism_e2e.py:81–98` — CI-replayable checks: the two commit shas resolve in git, `merge-base --is-ancestor regressive revert` holds, revert subject starts with `Revert "`. On a fresh clone these tests provide an independent verification.
- `proof.yaml:31–35` closure_evidence carries commit_ref (regressive 548c2f6), rollback_ref (pre-promotion HEAD c2407ca), metrics_snapshot (baseline 39/0/true), decision=reverted — the full AC6 closure shape.

**Observations (non-blocking, for future hardening):**

- `proof.yaml:32` `commit_ref` under closure_evidence is the regressive sha, and the same sha appears at `auto_revert.commit_hash_regressive`. Correct per AC, but a future sibling field `pre_promotion_head` would make the two refs more semantically distinct to casual readers. Not a defect — closure_evidence.rollback_ref (c2407ca) does unambiguously name pre-promotion HEAD.
- `.pHive/metrics/experiments/meta-2026-04-22-r2.yaml:12–17` — `regression_watch` uses the slightly-looser `tripped_by` shape (direct flatten) while closure_evidence uses `metrics_snapshot`. Internally consistent, documented by the test file; downstream schemas may eventually converge these — out of BL2.6 scope.

---

## Escalation resolution statement

**`rollback-realism-proof-ambiguity` — RESOLVES.**

The escalation demanded that "regression-watch trigger the auto-revert path end-to-end" so that the milestone claim cannot be read as a manual revert. BL2.6 proves this three ways:

1. **Live code path**: `evaluate_watch` is called with a real `envelope_writer` and a bound `DirectCommitAdapter.rollback` callback — the only mutation path to the on-disk envelope.
2. **Real git artefacts**: both the regressive commit `548c2f6` and the `Revert` commit `c869413` exist on the branch; `c869413^` resolves to `548c2f6` (the automatic revert’s parent IS the regressive commit — no history rewrite).
3. **Negative assertions**: `proof_integrity.manual_revert_used / mock_callback_used / synthetic_closure_used` are all `false`, and the script contains no `mock`/`Mock`/`monkeypatch`/`MagicMock` imports. The only token match was the literal field name `"mock_callback_used": False` in the proof-doc payload.

No manual, mocked, or synthetic shortcut survives this evidence set. Milestone integrity is honored.
