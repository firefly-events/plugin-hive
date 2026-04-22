# BL2.1 Review Memo — Direct-Commit Promotion Adapter

**Reviewer:** Opus 4.7 (adversarial)
**Story:** BL2.1 — Direct-commit promotion adapter
**Implementation:** `hive/lib/meta-experiment/direct_commit_adapter.py`
**Tests:** `tests/meta_meta/test_direct_commit_adapter.py` — 8/8 green (verified locally)

## Verdict

**needs_optimization** — Ship. The adapter is worktree-safe, contract-conformant, and covers every acceptance criterion. The one material ambiguity (exception vs. result-based failure reporting) is a design choice worth noting for BL2.2 callers but not a blocker; remaining items are cleanup-grade.

## Per-dimension scores

| Dim | Dimension | Score | Note |
|-----|-----------|-------|------|
| 1   | Contract conformance | 5/5 | Real `PromotionAdapter` subclass; frozen dataclasses used as designed |
| 2   | Maintainer-local scope | 5/5 | No PR-only assumptions; direct-commit + revert only |
| 3   | Worktree safety | 4/5 | Main tree is preserved on failure paths tested; one reset-on-raise path worth calling out |
| 4   | Failure cleanup (AC#3) | 4/5 | Worktree force-removed on promote failure; `_remove_worktree` is idempotent |
| 5   | Evidence shape fidelity | 5/5 | Always commit-backed; respects `PromotionEvidence` XOR; does not collapse to commit-only close shape |
| 6   | Subprocess hygiene | 4/5 | Consistent `check=True, capture_output=True, text=True`; stderr surfaced in notes; no user-path injection |
| 7   | Test rigor | 3/5 | 8 tests cover ACs but miss worktree-path-injection, rollback failure/mismatch branches, and exception-vs-result semantics |
| 8   | Integration-readiness (BL2.2/BL2.4) | 3/5 | Raising `PromotionFailure` instead of returning `PromotionResult(success=False, …)` will force BL2.2 to wrap calls; the ABC signature promises a result |

---

## Specific findings

### F1 — Exception-vs-result semantics diverge from the ABC contract (major design note)

- **Where:** `hive/lib/meta-experiment/direct_commit_adapter.py:67–74, :98–102, :118–123`
- **What:** `PromotionAdapter.promote` is typed `-> PromotionResult`, and both the research brief (`BL2.1/research-brief.md` §"Failure cases") and the shared `PromotionResult.success: bool` field imply failures are *returned*, not raised. This adapter instead raises `PromotionFailure` on every failure path (needs_revision, unsupported verdict, cherry-pick fail, merge-conflict fall-through). The only time `PromotionResult` is actually returned is on the success path.
- **Why it matters:** BL2.2 orchestration, BL2.3 close integration, and BL2.4 rollback-watch wiring will all call `adapter.promote(...)`. They either need to catch `PromotionFailure` at every call site or the contract needs to document that failures raise. Today the type signature lies.
- **Direction:** acceptable as-is for BL2.1 (failure carries richer structured info than `PromotionResult(success=False, ...)` would), but the ABC docstring in `promotion_adapter.py` must be updated in BL2.2 to document that maintainer adapters may raise. Alternatively, return `PromotionResult(success=False, evidence=…, rollback_target=…, notes=…)` — but that breaks the `PromotionEvidence` XOR invariant (you'd have to fabricate a commit_ref). The exception-based approach is defensible; just surface it.
- **Recommendation:** BL2.2 follow-up — update `PromotionAdapter.promote` docstring to declare `PromotionFailure` as a possible exit.

### F2 — `_reset_head` called after `_abort_git_op` paths that also force-remove worktree (line 114–123)

- **Where:** `direct_commit_adapter.py:114–123` (the outer `except subprocess.CalledProcessError`)
- **What:** If some unexpected `CalledProcessError` escapes the inner try/except (e.g. `git rev-parse HEAD` fails after a successful merge), the handler aborts both merge and cherry-pick, `git reset --hard rollback_target`, then force-removes the worktree. This *does* preserve main-tree invariant, but `reset --hard` on the live branch is a destructive operation that is only safe because `rollback_target` was captured before any mutation.
- **Why it matters:** The comment/docstring does not call this out. A future maintainer could move the `rollback_target = _git(...)` line after the merge and silently break the guarantee.
- **Recommendation:** Add an inline comment at line 79 noting that `rollback_target` MUST be captured before any merge/cherry-pick mutation, because the outer handler depends on it for `reset --hard`.

### F3 — `_validate_worktree_candidate` pre-flight path skips worktree removal on validation failure (line 162–170)

- **Where:** `direct_commit_adapter.py:162–170`
- **What:** When the worktree exists but `HEAD` does not match `candidate_ref`, or when the worktree is missing entirely, the adapter raises `PromotionFailure` *without* removing the worktree. The research brief says "Do NOT remove the worktree (leave it for manual inspection)" on merge conflict, which aligns with this behavior. However, the `needs_revision` branch at line 67 force-removes the worktree, and an ambiguous worktree (e.g. HEAD drift) is arguably more debug-worthy than a needs_revision.
- **Why it matters:** Inconsistent cleanup policy. For `needs_revision` the adapter discards; for "worktree state inconsistent" it preserves. This is actually the right policy (validation failure = debug target), but the difference should be documented.
- **Recommendation:** Add a one-line comment explaining the distinction. No code change required.

### F4 — Rollback mismatch tests are missing (gap in AC coverage)

- **Where:** `tests/meta_meta/test_direct_commit_adapter.py`
- **What:** The 8 tests cover every BL2.1 AC, but `rollback()` has three non-happy branches with no coverage:
  - `parent_ref != rollback_ref` mismatch (line 139–144)
  - `git rev-parse {commit}^` raising (line 131–137)
  - `git revert` failing, triggering `--abort` (line 154–160)
- **Why it matters:** BL2.4 will wire `rollback()` as the auto-revert callback. If any of these three branches regress between BL2.1 and BL2.4, the regression will only surface during the live MVL run in BL2.6 — expensive to debug there.
- **Recommendation:** Add three rollback-failure tests before BL2.4. Not a blocker for BL2.1 integrate because these branches are exercised by code inspection and the adapter is not yet wired live.

### F5 — `_abort_git_op("cherry-pick")` on the outer handler is a no-op when merge is already complete (line 115–116)

- **Where:** `direct_commit_adapter.py:115–116`
- **What:** If the outer `except subprocess.CalledProcessError` fires after the inner merge succeeded (unlikely but possible — e.g. `rev-parse HEAD` fails), we call `merge --abort` and `cherry-pick --abort`, both of which will fail silently. That's fine, but `_reset_head(rollback_target)` *does* run and rewinds the main branch. The visible effect is that an unexpected failure after a successful ff-merge still rolls back the merge commit via `reset --hard`. This is the correct behavior but the combination of "abort-both + reset" is belt-and-suspenders worth a comment.

### F6 — `DEFAULT_WORKTREES_SUBPATH` uses `.pHive/meta-team/...` which is the correct path per isolation.md, but hard-codes the legacy swarm name (line 17)

- **Where:** `direct_commit_adapter.py:17`
- **What:** `DEFAULT_WORKTREES_SUBPATH = ".pHive/meta-team/worktrees"`. The meta-improvement rewrite preserves `meta-team` as the workflow/cycle name but the epic has been discussing a two-swarm split (`meta-meta-optimize` vs `meta-optimize`). If worktrees migrate to a swarm-specific path in a later slice, this default becomes stale.
- **Why it matters:** Low. Callers always override by passing `envelope["worktree_path"]` or `worktrees_root`. This is the documented default, and isolation.md endorses the exact path.
- **Recommendation:** None. Noted for traceability only.

### F7 — Subprocess hygiene check

- All git calls route through `_git()` (line 36–46) which uses `check=True, capture_output=True, text=True` consistently. 
- No user-controlled paths are interpolated without validation: `repo_path` and `worktrees_root` come from constructor; `worktree_path` is either constructor-derived or from `envelope["worktree_path"]` (caller-controlled, but orchestrator is trusted in maintainer-loop scope).
- `candidate_ref` and `commit_ref` flow directly into `git merge`, `git cherry-pick`, `git revert`. Git commit refs are hex SHAs in practice; subprocess `args` list form prevents shell injection; risk is low but *not zero* if an attacker can control envelope fields. **This is maintainer-local scope**, so trust boundary justifies it.
- **Recommendation:** Document the trust boundary (maintainer-only envelope construction) in the class docstring.

---

## Dimension detail — why scores <4

### Dim 7 (Test rigor) — 3/5

Tests hit every BL2.1 AC. Gaps: rollback_ref mismatch, rev-parse parent failure, revert-abort path (F4). Also no test that `_remove_worktree` tolerates a stale worktree cleanup list (git's internal state vs on-disk state). The test `test_remove_worktree_is_idempotent_when_path_disappears` is the right shape but monkeypatches `_git` rather than driving a real git state where the worktree was removed out-of-band.

### Dim 8 (Integration-readiness) — 3/5

Two forward-looking concerns:

1. **F1 raises-vs-returns.** BL2.2 will need `try/except PromotionFailure` wrapped around `adapter.promote(...)`. Acceptable, but the `PromotionAdapter` ABC should document this. Either BL2.2 gates on it or we patch the ABC docstring now.
2. **Rollback envelope shape.** `rollback()` reads `envelope["commit_ref"]` (line 127) and requires `envelope["target_branch"]`. The research brief's "Writes to envelope via `envelope.set_commit_ref()`" does not happen inside the adapter — it's the caller's job. BL2.4 needs to ensure `envelope["commit_ref"]` is populated from `PromotionResult.evidence.commit_ref` before calling rollback. That's a caller contract the adapter does not enforce. Worth calling out in BL2.4 story; not a BL2.1 defect.

---

## Optimization notes (follow-ups, non-blocking)

1. **Update `PromotionAdapter` ABC docstring** (`promotion_adapter.py:44–46`) during BL2.2 to note that concrete adapters MAY raise `PromotionFailure` on failure rather than returning `PromotionResult(success=False, ...)`. Alternatively: refactor `direct_commit_adapter.py` to return failure results — but this conflicts with `PromotionEvidence` XOR and would require a nullable-evidence variant.
2. **Add class-level comment at `direct_commit_adapter.py:79`** noting that `rollback_target` MUST be captured before any merge/cherry-pick mutation, because the outer exception handler's `reset --hard` depends on it.
3. **Add three rollback-failure tests before BL2.4 wires `rollback()` live:** rollback_ref mismatch, rev-parse parent failure, revert-abort path. Stick with pytest tmp_path real-repo pattern used elsewhere, not monkeypatch.
4. **Document trust boundary** in `DirectCommitAdapter` class docstring: envelope fields are maintainer-controlled; adapter does not validate against untrusted input.
5. **BL2.4 story acceptance should require** that the caller populates `envelope["commit_ref"]` from `PromotionResult.evidence.commit_ref` before invoking `rollback()`. The adapter does not enforce this; it will KeyError if omitted.

---

## What passes without reservation

- AC#1: Concrete adapter exists at `hive/lib/meta-experiment/direct_commit_adapter.py` (line 49) — pass.
- AC#2: Returns real commit hash (`PromotionResult.evidence.commit_ref`) and rollback target (`PromotionResult.rollback_target`) — pass, tested.
- AC#3: On promotion failure, worktree is force-removed and main tree is preserved — pass, tested end-to-end in `test_promote_conflict_discards_worktree_and_preserves_main`.
- AC#4: Inherits `PromotionAdapter`, respects `PromotionEvidence` XOR, does not overfit close record to commit-only shape — pass, verified by `test_interface_conformance` and `test_promotion_evidence_enforces_xor`.

---

## Summary

Ship as **needs_optimization**. The adapter does its job. The lowest-scoring dimensions (test rigor on rollback paths, and the raises-vs-returns design) are worth addressing in the BL2.2/BL2.4 window, not as BL2.1 revisions. The escalation risk flagged in S7 (`closure-evidence-shape-mismatch`) is cleanly avoided by always using `commit_ref` and leaving `pr_ref` untouched — the close validator will accept this unchanged.
