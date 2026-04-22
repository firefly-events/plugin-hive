# BL2.1 Implementation Brief: Direct-Commit Promotion Adapter

## Shared contract summary

- **PromotionAdapter ABC shape:** Two abstract methods — `promote(envelope: dict, decision: dict) -> PromotionResult` and `rollback(envelope: dict, rollback_ref: str) -> RollbackResult`. Both are abstract; the concrete maintainer adapter will inherit and implement both.
- **Evidence-exactly-one rule:** PromotionEvidence enforces exactly one of `commit_ref` or `pr_ref` must be set (frozen dataclass with `__post_init__` validation). The direct-commit adapter will always use `commit_ref` (PR path uses `pr_ref` later).
- **PromotionResult envelope:** success flag, PromotionEvidence object (carries commit_ref), rollback_target string (pre-candidate commit hash for later auto-revert), optional notes field.
- **Rollback target semantics:** the commit hash to which the live branch should revert if regression-watch later trips. For direct-commit, this is the main-tree HEAD before the promotion commit was merged.

## Envelope fields the adapter reads / writes

**Reads from `envelope` dict:**
- `candidate_ref` (str) — identifies the worktree tip commit to be promoted to main
- `decision` (dict) — decision verdict carrying acceptance status and metadata; must read `decision["success"]` to detect accept vs reject

**Reads from `decision` dict:**
- `success` (bool) — true if verdict was accept
- `rollback_target` (str) — caller-provided reference to restore on future regression

**Writes to envelope via envelope.set_commit_ref(), envelope.set_rollback_ref():**
- `commit_ref` (str) — the merged commit hash on the live branch (the artifact of successful promote)
- `rollback_ref` (str) — must be set to rollback_target (closure validator requires it)

## Direct-commit promotion mechanics (maintainer-local)

**Workflow (success case):**

1. **Precondition:** A worktree exists at `.pHive/meta-team/worktrees/{experiment_id}/` with a real commit tip (`candidate_ref`).
2. **Step 1: Fetch mainline state** — `git -C <worktree> fetch origin main` to ensure the worktree knows the live main branch state.
3. **Step 2: Merge to mainline** — `git -C main-checkout merge --ff-only <candidate_ref>` (or equivalent). If --ff-only fails, the merge conflict is a promotion failure; report `success=False` and skip worktree removal (see failure section).
4. **Step 3: Capture post-merge commit** — read the new HEAD of main after merge; this is the `commit_ref` to return in PromotionResult.
5. **Step 4: Record evidence** — return `PromotionResult(success=True, evidence=PromotionEvidence(commit_ref=<merged_hash>), rollback_target=<provided_target>, notes=None)`.
6. **Step 5: Record in envelope** — caller invokes `envelope.set_commit_ref(<commit_ref>)` and `envelope.set_rollback_ref(<rollback_target>)` after promote returns.
7. **Step 6: Clean up worktree** — `git worktree remove <worktree_path>` (on success only; see failure case).

**Failure cases:**

- **Merge conflict:** If `git merge --ff-only` fails or any git command raises, return `PromotionResult(success=False, ...)` immediately. Do NOT remove the worktree (leave it for manual inspection). Do NOT write to the main tree.
- **Pre-flight validation:** If `decision["success"]` is false (verdict was needs_revision or reject), short-circuit; return success=False with appropriate notes. Do NOT attempt merge. Do NOT touch worktree.

## Worktree discard-on-failure obligations

**Invariant:** On any promote() failure, main tree state is unchanged and worktree is retained for debugging. On promote() success, worktree is removed.

**Cleanup on failure:**
- If promote() raises or returns success=False midstream, the adapter must NOT call `git worktree remove`.
- The worktree remains on disk for manual inspection by maintainer.
- The main tree's HEAD, branches, and working directory are guaranteed unchanged (all git work happens in worktree or is rolled back on error).

**Cleanup on success:**
- After promote() returns success=True and the caller has recorded evidence in the envelope, explicitly remove the worktree: `git worktree remove <worktree_path>`.
- This is not the adapter's responsibility — the caller (promotion orchestrator or step-07) does this after PromotionResult is returned.
- Adapter may document the expectation but need not implement removal itself.

## Test plan

**Test 1: Interface conformance**
- Verify concrete DirectCommitAdapter inherits PromotionAdapter and implements both methods without abstract marker.
- Verify PromotionResult and PromotionEvidence dataclasses match the contract exactly (frozen, exact field names, __post_init__ validation).

**Test 2: Success promote (accept verdict)**
- Given: tmp worktree with committed change on a detached HEAD, main tree at known commit.
- When: promote(envelope with accept decision and valid candidate_ref, decision dict) is called.
- Then: returns PromotionResult(success=True, evidence=PromotionEvidence(commit_ref=<hash>), rollback_target=<target>).
- And: main tree HEAD has advanced to the merged commit; worktree still exists (caller removes it).

**Test 3: Needs-revision discard**
- Given: envelope with needs_revision decision.
- When: promote(envelope, decision with success=False) is called.
- Then: returns PromotionResult(success=False, notes="verdict was needs_revision").
- And: main tree is unchanged; worktree is retained.

**Test 4: Failure cleanup (merge conflict)**
- Given: worktree with candidate_ref that conflicts with main.
- When: promote() attempts merge and encounters conflict.
- Then: returns PromotionResult(success=False, notes="merge conflict").
- And: main tree is unchanged; worktree is retained for inspection.

**Test 5: Rollback success**
- Given: a prior promotion (commit recorded in envelope, rollback_ref set).
- When: rollback(envelope, rollback_ref=<prior_commit>) is called.
- Then: returns RollbackResult(success=True, revert_ref=<revert_commit_hash>).
- And: main tree HEAD has moved to a new revert commit that undoes the original promotion.

**Test 6: Decision dict structure**
- Given: a decision dict with required fields (success, rollback_target, optional notes).
- When: promote() reads decision["success"] and decision["rollback_target"].
- Then: PromotionResult carries rollback_target unmodified.

**Fixture approach:**
- Use pytest tmp_path to create isolated worktree and main-tree repos.
- Initialize each repo with `git init`, create commits, set up branch structure.
- Use subprocess.run() or GitPython to invoke git commands.
- Follow existing test patterns in test_promotion_adapter.py and test_rollback_watch.py (importlib loading, unittest.TestCase).

## Open questions / risks

**None identified.** The shared contract is explicit, worktree semantics are documented in isolation.md, Q4 decision is signed, and failure behavior is clearly specified.

---

## Implementation checklist for developer

1. **Create `/Users/don/Documents/plugin-hive/hive/lib/meta-experiment/direct_commit_adapter.py`**
   - Import PromotionAdapter, PromotionResult, PromotionEvidence, RollbackResult from promotion_adapter.
   - Class DirectCommitAdapter(PromotionAdapter) with __init__ accepting worktree_path and main_tree_path.
   - Implement promote(envelope, decision) and rollback(envelope, rollback_ref).

2. **Git operations:**
   - Use subprocess.run(['git', ...], cwd=...) or GitPython for all git invocations.
   - All git work in worktree; main tree only receives `git merge --ff-only`.
   - Capture commit hashes with `git rev-parse HEAD` after each state change.

3. **Error handling:**
   - Catch subprocess.CalledProcessError and git conflicts; return success=False without touching main tree.
   - Preserve worktree on failure for debugging.

4. **Tests:**
   - New file `/Users/don/Documents/plugin-hive/hive/lib/meta-experiment/tests/test_direct_commit_adapter.py`.
   - Follow unittest.TestCase pattern from existing tests.
   - Use tmp_path fixture for isolated repo setup.
   - Cover all 6 cases above.

5. **Documentation:**
   - Add docstring to DirectCommitAdapter explaining worktree-native default and rollback target semantics.
   - Consider brief update to `/Users/don/Documents/plugin-hive/hive/references/meta-experiment-isolation.md` (§3 Lifecycle expectations) noting concrete direct-commit adapter behavior.
