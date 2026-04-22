# BL2.2 — Orchestrate the Rewritten Control Plane: Research Brief

## 1. Control-plane step sequence (what the skill must traverse)

The skill invokes the meta-team-cycle workflow, which chains 8 steps:

1. **step-01-boot** (orchestrator)
   - **Role:** Initialize cycle; load charter, prior ledger, incomplete prior cycles.
   - **Input:** system date/time, `.pHive/meta-team/charter.md`, `.pHive/meta-team/ledger.yaml` (may not exist).
   - **Output:** `cycle_id`, `prior_ledger`, `boot_report`.
   - **Skill responsibility:** NOT direct. Skill invokes workflow; workflow agent executes step file.

2. **step-02-analysis** (researcher)
   - **Role:** Scan codebase for improvement opportunities (missing files, broken refs, schema gaps).
   - **Input:** `cycle_id` from step-01.
   - **Output:** `findings` (JSON), `analysis_report`.
   - **Skill responsibility:** NOT direct. Delegated to workflow.

3. **step-03-proposal** (architect)
   - **Role:** Rank proposals from findings; apply charter constraints.
   - **Input:** `findings` from step-02.
   - **Output:** `approved_proposals`, `skipped_proposals`.
   - **Skill responsibility:** NOT direct. Delegated to workflow.

4. **step-04-implementation** (developer)
   - **Role:** Execute approved proposals in priority order; write files; return structured `changes_made`.
   - **Input:** `approved_proposals` from step-03.
   - **Output:** `changes_made` (per-file entries with `proposal_id`, `file`, `action`, `status`).
   - **Skill responsibility:** NOT direct. Step is read-only for persistent control writes (no cycle-state, ledger, or envelope mutations inline).

5. **step-05-testing** (tester)
   - **Role:** Validate each change via cross-reference, schema compliance checks. Read-only.
   - **Input:** `changes_made` from step-04.
   - **Output:** `test_results`, `validation_report`.
   - **Skill responsibility:** NOT direct. Delegated. Step must NOT write persistent control-plane files.

6. **step-06-evaluation** (reviewer)
   - **Role:** Assign verdicts (`pass`, `needs_optimization`, `needs_revision`) per test results and charter alignment.
   - **Input:** `test_results` from step-05.
   - **Output:** `evaluation_results` (verdict per change).
   - **Skill responsibility:** NOT direct. Delegated to workflow.

7. **step-07-promotion** (adapter-owner)
   - **Role:** Apply verdicts: promote `pass`/`needs_optimization` via swarm adapter; discard `needs_revision` by removing worktree.
   - **Input:** `evaluation_results`, `promoted_changes`, `reverted_changes`.
   - **Output:** `promoted_changes`, `reverted_changes`, rollback evidence.
   - **Skill responsibility:** NOT direct. Skill ensures DirectCommitAdapter is wired; step file owns decision-to-action mapping.

8. **step-08-close** (NON-BYPASSABLE gate)
   - **Role:** Validate closure invariants (commit_ref, metrics_snapshot, rollback_ref present and valid); update ledger.yaml; produce morning summary.
   - **Input:** `promoted_changes`, `reverted_changes`, envelope with evidence fields.
   - **Output:** closed cycle record, updated ledger, morning summary.
   - **Skill responsibility:** NOT direct. Step file owns validation via `closure_validator.validate_closable(envelope)`.

**Skill's orchestration scope:** Skill creates worktree isolation context, loads backlog, instantiates envelope and adapter, then delegates to workflow. The workflow orchestrator pattern (not the skill) owns step sequencing.

---

## 2. Shared-library API surface the skill uses

**Module: `hive.lib.meta-experiment.envelope`**
- `load(experiment_id: str) → dict` — Read experiment envelope by ID.
- `set_decision(experiment_id, decision: str) → dict` — Update decision field.
- `set_commit_ref(experiment_id, commit_ref: str) → dict` — Update commit reference after promotion.
- `set_metrics_snapshot(experiment_id, snapshot_dict) → dict` — Store metrics snapshot.
- `set_rollback_ref(experiment_id, rollback_ref: str) → dict` — Store atomic-revert target.

**Module: `hive.lib.meta-experiment.baseline`**
- `capture_from_run(run_id: str) → dict | None` — Extract metrics snapshot from run events.
- `persist_to_envelope(experiment_id, snapshot) → dict` — Persist snapshot through envelope wrapper.

**Module: `hive.lib.meta-experiment.direct_commit_adapter`**
- `DirectCommitAdapter(repo_path, worktrees_root=None)` — Constructor. Defaults worktrees_root to `.pHive/meta-team/worktrees/`.
- `.promote(envelope, decision) → PromotionResult` — Promote worktree tip to live repo. Returns `PromotionResult(success, evidence, rollback_target, notes)`.
- `.rollback(envelope, rollback_ref) → RollbackResult` — Revert prior promotion. Returns `RollbackResult(success, revert_ref, notes)`.

**Module: `hive.lib.meta-experiment.closure_validator`**
- `validate_closable(envelope: dict) → None` — Raise `CloseValidationError` if `commit_ref`, `metrics_snapshot`, or `rollback_ref` are missing/invalid. Uses `git rev-parse --verify`.
- `is_closable(envelope) → bool` — Return boolean without raising.

**Pass-through contracts:**
- Envelope is dict-like, keyed by experiment_id; schema per C1 contract (B0 §1.11).
- PromotionResult and RollbackResult are frozen dataclasses with boolean `success`.
- All shared-lib functions validate input (e.g., envelope must have `decision` in {`"accept"`, `"reject"`, `"reverted"`} for close).

---

## 3. Worktree-default invocation mechanics

**Creation:**
1. Skill instantiates `DirectCommitAdapter(repo_path="/Users/don/Documents/plugin-hive")`.
2. Adapter defaults `worktrees_root = repo_path / ".pHive/meta-team/worktrees"`.
3. On first step that needs isolation: `git worktree add .pHive/meta-team/worktrees/{experiment_id} {baseline-ref}`.
   - `experiment_id` is generated in step-01-boot (e.g., `meta-meta-20260422-0001`).
   - Baseline is the commit the experiment declares as starting point.

**Execution inside worktree:**
- Steps 2–7 work inside `.pHive/meta-team/worktrees/{experiment_id}` checkout.
- Implementation (step 4) writes files relative to worktree root.
- Tests (step 5) validate worktree state.
- Promotion (step 7) commits to worktree, then adapter merges/cherry-picks the tip into main.

**Closure and cleanup:**
- Step 8 calls `closure_validator.validate_closable(envelope)` — must pass before ledger append.
- After successful promotion and close, worktree is removed via `git worktree remove .pHive/meta-team/worktrees/{experiment_id}` (step 7 or close, TBD).
- Isolation ends when worktree is removed; main repo contains the promoted commit.

---

## 4. Two-swarm boundary — what the skill must and MUST NOT do

**MUST do:**
- Use `DirectCommitAdapter` (maintainer-local, signed user decision, direct main-tree mutation).
- Default worktree isolation via `.pHive/meta-team/worktrees/{experiment_id}/`.
- Consume shared library (envelope, baseline, adapter, closure_validator) rather than replicating logic.
- Respect the non-bypassable close gate (step 8); do not skip validation.

**MUST NOT do:**
- Assume public-swarm PR flow (meta-optimize uses PRs; meta-meta-optimize uses direct commits).
- Register the skill in `plugin.json` (maintainer skills are local-only, not exposed as public plugin features).
- Attempt to mutate the live repo outside the adapter's control (adapter owns main-tree writes).
- Bypass closure_validator checks or allow incomplete envelopes to reach the ledger.
- Revive single-swarm assumptions (charter, ledger, adapter paths are now swarm-specific).

**Boundary enforcement:**
- `.pHive/meta-team/charter.md` is archived; active charter is `.pHive/meta-meta-optimize/charter.yaml` (A2.6/A2.7 migration).
- Ledger writes append to swarm-configured ledger.yaml (typically `.pHive/meta-meta-optimize/ledger.yaml`).
- PromotionAdapter is swarm-specific; meta-meta-optimize uses DirectCommitAdapter; meta-optimize (S10) uses PR-style adapter.

---

## 5. Closure gate wiring

**Non-bypassable invariant (step 08, task 1):**
Before any ledger append or close record write:

```python
from hive.lib.meta-experiment.closure_validator import validate_closable
validate_closable(envelope)  # Raises if envelope incomplete/invalid
```

**Fields required in envelope:**
- `commit_ref` (string, 40-char SHA-1 or 7+ char abbrev, must resolve via `git rev-parse --verify`).
- `metrics_snapshot` (non-empty dict or reference to metrics record).
- `rollback_ref` (commit SHA or branch/tag resolvable via `git rev-parse --verify`).
- `decision` (value in {`"accept"`, `"reject"`, `"reverted"`}; not `"pending"`).

**Failure handling:**
- If validation fails, step-08 records `close_rejected: {reason}` and HALTS before ledger append.
- No ledger entry, no promotion of close record. The cycle ends incomplete.
- Next cycle finds the incomplete state and can retry close after envelope is fixed.

**Skill's role:** The skill does not invoke closure_validator directly. Step-08 does. Skill ensures envelope fields are populated by prior steps (step-07 populates commit_ref via adapter; step-04/05 populate metrics_snapshot; adapter also populates rollback_ref).

---

## 6. Orchestrator vs. workflow boundary

**Skill (SKILL.md) is a thin orchestrator:**
- Load backlog (`.pHive/meta-team/queue-meta-meta-optimize.yaml`).
- Select one proving candidate.
- Create experiment_id and envelope.
- Instantiate DirectCommitAdapter.
- **Invoke the workflow** (meta-team-cycle.workflow.yaml).
- Delegate step execution, sequencing, and decision-making to the workflow.

**Workflow owns orchestration logic:**
- Step sequencing (boot → analysis → proposal → implementation → testing → evaluation → promotion → close).
- Input/output passing (via workflow output graph; not inline step-to-step).
- Gating (each step's SUCCESS METRICS determine whether to proceed to NEXT STEP).
- Authority enforcement (e.g., tester is read-only; step-08 is non-bypassable).

**"Thin skill" means:**
- No duplicate experiment lifecycle logic (shared lib owns that).
- No ad-hoc worktree creation (adapter owns that).
- No envelope mutation outside the shared API (envelope module owns that).
- No step-file execution (workflow agent owns that).
- Skill is a procedural wrapper: "load backlog → pick one → invoke workflow → await close → report outcome."

---

## 7. Concrete implementation outline

**SKILL.md structure (pseudo-content):**

```markdown
# Meta-Meta-Optimize (Live Orchestration)

## Purpose
Local maintainer entry point to the rewritten meta-team control plane.
Invokes the nightly cycle against a single proving-candidate from the backlog.

## Prerequisites
- `.pHive/meta-team/charter.md` exists (defines scope and constraints).
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` exists (candidate backlog).
- `hive/lib/meta-experiment/` modules are importable.
- `hive/workflows/meta-team-cycle.workflow.yaml` exists.

## Invocation

### Step 1: Load backlog
Read `.pHive/meta-team/queue-meta-meta-optimize.yaml`.
If empty or missing, HALT with "No candidates available."

### Step 2: Select candidate
Pick the first (or user-specified) candidate.
Record: `candidate_name`, `target_path`, `edit_style`.

### Step 3: Initialize experiment
Generate `experiment_id` (e.g., `meta-meta-{YYYYMMDD}-{seq}`).
Create experiment envelope via `envelope.create({experiment_id, candidate_name, ...})`.
Store envelope path for later reference.

### Step 4: Wire adapter
Instantiate `DirectCommitAdapter(repo_path=repo_root, worktrees_root=None)`.
(defaults worktrees_root to `.pHive/meta-team/worktrees/{experiment_id}`)

### Step 5: Invoke workflow
Call the meta-team-cycle workflow orchestrator.
Pass: `cycle_id`, `envelope`, `adapter`, `candidate`, `charter_constraints`.

### Step 6: Await close
Workflow runs autonomously: steps 1–8 in sequence, with gating on success.
If any step fails and cannot auto-recover, halt and report the failure.

### Step 7: Validate envelope before close
Skill calls `closure_validator.is_closable(envelope)` as a sanity check before awaiting close.
(Step-08 does the authoritative check; this is defensive.)

### Step 8: Report outcome
After close:
- If `status: closed` and `verdict: passed`: success message + promoted changes list.
- If `status: closed` and `verdict: partial`: report which changes were reverted.
- If `close_rejected`: report which envelope fields are invalid; suggest fix.

## Imports
- `from hive.lib.meta_experiment import envelope, direct_commit_adapter, closure_validator`
- `from hive.workflows.meta_team_cycle import orchestrate` (or equivalent workflow invocation API)
- YAML, git subprocess, standard library only. No experiment logic reimplementation.
```

---

## 8. Test plan

**File:** `tests/meta_meta/test_skill_orchestration.py`

**Fixtures:**
```python
@pytest.fixture
def repo_root(tmp_path):
    """Initialize a test repo with minimal meta-team structure."""
    repo = git.Repo.init(tmp_path)
    # Create .pHive/meta-team/
    # Create charter, queue, worktrees root
    # Return tmp_path

@pytest.fixture
def skill_module():
    """Import SKILL.md (or its Python equivalent)."""
    # Return skill orchestration functions

@pytest.fixture
def mock_workflow(monkeypatch):
    """Mock the meta-team-cycle workflow to track step invocations."""
    # Track step calls, inputs, outputs
    # Return mock
```

**Test cases:**

1. **test_traverses_approved_workflow_sequence**
   - Invoke skill with valid backlog candidate.
   - Assert that mock workflow is called with steps in order: boot → analysis → ... → close.
   - Assert that each step's inputs match prior step's outputs.

2. **test_defaults_to_worktree_isolation**
   - Invoke skill.
   - Assert that adapter instantiated with `worktrees_root = .pHive/meta-team/worktrees`.
   - Assert that DirectCommitAdapter is used (not a parallel adapter).

3. **test_imports_shared_lib_not_duplicates**
   - Run `rg -n "def capture_baseline|def validate_close|class.*Envelope|class.*Adapter" /Users/don/Documents/plugin-hive/maintainer-skills/meta-meta-optimize/`.
   - Assert NO matches (no reimplementation of shared lib logic in skill).

4. **test_respects_close_gate**
   - Mock step-08 to return `close_rejected: "metrics_snapshot is empty"`.
   - Assert that skill does NOT write ledger entry.
   - Assert that skill reports the rejection reason to the user.

5. **test_envelope_populated_end_to_end**
   - Invoke skill with valid candidate and mock successful steps.
   - Assert that envelope has:
     - `commit_ref` set by step-07 (adapter promotion).
     - `metrics_snapshot` populated by step-05 or step-06 (test/eval).
     - `rollback_ref` set by adapter before main-tree mutation.
     - `decision` set to one of {`"accept"`, `"reject"`, `"reverted"`}.

6. **test_two_swarm_not_revived**
   - Invoke skill.
   - Assert `.pHive/meta-team/charter.md` is read as fallback only; primary is `.pHive/meta-meta-optimize/charter.yaml`.
   - Assert that skill does NOT register in `plugin.json`.
   - Assert that DirectCommitAdapter is used (not PR-style adapter).

---

## 9. Risks / open questions

### Confirmed working surfaces:
- ✓ Workflow YAML structure (8 steps, clear input/output contracts).
- ✓ Shared library modules exist and have stable APIs.
- ✓ DirectCommitAdapter is implemented and ready.
- ✓ Closure validator is implemented (validates envelope fields + git refs).
- ✓ Worktree isolation model is documented in `meta-experiment-isolation.md`.
- ✓ Two-swarm split is defined (charter paths, ledger paths, adapter type).

### Open questions:
1. **Step-06 (evaluation) is not detailed in current sources.** We know it assigns verdicts, but the exact prompting/decision tree is not yet spelled out. Skill assumes it exists and delegates; no implementation risk, but spec is TBD.

2. **Workflow orchestrator invocation API is not specified.** We know YAML is the contract, but how does the skill call it? (Python function? Subprocess? Built-in to Claude Code?)  Assumption: exists as `hive.workflows.invoke(workflow_id, context)` or similar. Needs clarification before implementation.

3. **Backlog schema (queue-meta-meta-optimize.yaml) is frozen per BL2i.3, but no example candidate with all required fields is present.** Need sample candidate to ensure skill's candidate selection logic is robust.

4. **Ledger path resolution during A2.6/A2.7 migration.** Close step allows fallback to legacy `.pHive/meta-team/ledger.yaml`. Skill should not hardcode the path; it should query the swarm config. Exact swarm-config API not yet specified.

5. **Worktree cleanup timing.** Step-07 or Step-08? Spec says step-07 removes worktree after promotion decision, but step-08 may need the worktree path for rollback_ref validation. Recommend: step-07 commits the worktree tip and records the ref; step-08 validates the ref; after close, any cleanup is delegated to the adapter or a post-cycle hook.

### Gaps in rewritten control plane:
- **Step-06 (evaluation) spec is missing.** Skill assumes it exists; developer must implement or clarify delegation.
- **Workflow orchestrator invocation contract not finalized.** How does skill spawn the workflow? Blocking decision for implementation.
- **Sample backlog candidate not present.** Needed for integration testing.

---

**Brief compiled by:** researcher  
**Date:** 2026-04-22  
**Sources:**  
- BL2.2.yaml (story spec)  
- meta-team-cycle.workflow.yaml (workflow definition)  
- step-*.md (8 step files in meta-team-cycle/)  
- envelope.py, baseline.py, closure_validator.py, direct_commit_adapter.py, promotion_adapter.py (shared lib)  
- meta-experiment-isolation.md (isolation reference)  
- queue-meta-meta-optimize.yaml (backlog schema)  
- Step-08-close.md (closure gate detail)  
