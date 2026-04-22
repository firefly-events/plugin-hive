# Step 8: Close

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Close the cycle even if most changes were reverted — partial cycles are valid outcomes
- The morning summary must be useful to a user who has not read the full cycle log
- Commit BEFORE writing the ledger entry — the ledger records what was actually committed
- If commit fails, do NOT append the ledger entry and do NOT mark the cycle as closed

## EXECUTION PROTOCOLS

**Mode:** autonomous

**Authority model:** this step is the ONLY step permitted to perform persistent cycle-state, ledger, and commit writes. Per the rebuilt authority model (A2.1-A2.4), Steps 4-7 are strictly output-graph-only; Step 8 is the single lifecycle-writer. The closure invariant (Section 1 below) is a non-bypassable gate — it runs BEFORE any ledger append or state write. See B0 §1.11 (closure invariant) + user-decisions Q3 + codex-audit-memo §3.6 (historical `commit: TBD` failure this gate prevents).

Finalize the cycle only after the closure invariant passes: validate closure evidence, write the final cycle summary to the swarm-configured cycle-state path, commit all changes, append the ledger entry, and produce the morning summary. If the invariant fails, reject the close before any persistent close write happens.

## CONTEXT BOUNDARIES

**Inputs available:**
- `cycle_id` from step 1
- `promoted_changes` and `reverted_changes` from step 7 — primary close inputs
- Swarm-configured `ledger.yaml` — prior cycle records (legacy `.pHive/meta-team/ledger.yaml` only during the A2.6/A2.7 migration window)
- Active swarm config / team config that determines the cycle-state target path (during the A2.6 migration window this may still resolve to a legacy-compatible path)
- Git (for validating refs and committing changes)

**NOT available:**
- User input
- Any ability to change evaluation verdicts
- Any authority to bypass the closure invariant by reviewer judgment

## YOUR TASK

Close the cycle cleanly under the hard closure gate: validate closure evidence first, then perform the final state write, commit, ledger append, and morning summary in the correct order. If required closure evidence is missing or invalid, reject the close and leave the cycle incomplete.

## TASK SEQUENCE

### 1. Closure invariant (NON-BYPASSABLE)

Before any state write or ledger append: verify the closure evidence required by B0 §1.11 + user-decisions Q3. The close is REJECTED if any of the following are missing or invalid:

| Field | Requirement |
|-------|-------------|
| `commit_ref` | a real git commit hash (40-character SHA-1 OR 7+ char abbrev that resolves via `git rev-parse`). Placeholder values like `TBD`, `pending`, empty string, or any string failing `git rev-parse --verify` MUST fail the check. |
| `metrics_snapshot` | a reference that resolves to a real `metrics_snapshot` payload (per C1.3 envelope schema §3.4). For close step purposes: a non-empty value pointing at a real file path or envelope record. |
| `rollback_ref` | a real git ref (commit SHA or branch/tag name) that `git rev-parse --verify` accepts. This is the atomic-revert target if the cycle's committed work is later auto-reverted per B0 §3.2. |

If any field fails validation:
- HALT before ledger append
- HALT before morning-summary write
- Do NOT mark `status: closed`
- Record the failure in the step's output as `close_rejected: {reason}` with the specific field(s) and their invalid values
- The cycle ends in an incomplete state — NO ledger entry, NO promotion of the close record. The next cycle will find this cycle's state and can retry close after fixing the missing evidence.

This check is the FIRST action in Step 8. It is not advisory. It is not skippable by reviewer judgment. The `hive/lib/metrics/` C1.4 runtime provides the envelope-structure validation; the git-ref validation here uses `git rev-parse --verify`.

### 1a. Assemble envelope from step 6 + step 7 outputs (BL2.3)

Build the close-time envelope from the workflow output graph:

- `metrics_snapshot` <- step-06 evaluation output (the compare-derived dict)
- `commit_ref` <- step-07 `promoted_changes[...]` entry's `commit_ref` (the real SHA captured by the `DirectCommitAdapter`). If the cycle discarded (no promotion), `commit_ref` is absent from the assembled envelope; the close-gate will reject. This is the intended outcome for a cycle with no promotion.
- `rollback_ref` <- step-07 `promoted_changes[...]` entry's `rollback_target`. Rename at assembly time; this is the single canonical translation point.
- `decision` <- cycle's terminal decision (`accept` / `reject` / `reverted`)

This assembly is pure in-memory dict construction. It is not a persistent write yet; the persistent write happens in Section 2 after validation passes.

### 1b. Invoke the shared closure validator (BL2.3)

Before any persistent state write, call:

    from hive.lib.meta_experiment.closure_validator import validate_closable, CloseValidationError
    try:
        validate_closable(envelope)
    except CloseValidationError as exc:
        # HALT — do not append ledger, do not write cycle-state
        close_rejected = {"reason": str(exc), "error_class": type(exc).__name__}
        # emit close_rejected output and stop
        return

This is the FIRST executable action in step 8. It is not advisory. It delegates structural validation to the shared library so direct-commit and PR-only paths share one gate.

### 1c. Arm rollback watch for accepted experiments (BL2.4)

If the validated envelope decision is `accept`, arm the post-close rollback watch before any persistent close write so `rollback_watch.evaluate_watch(...)` can later observe a real committed experiment inside a concrete observation window.

```python
from hive.lib.meta_experiment.rollback_watch import arm_watch

armed = arm_watch(
    envelope,
    observation_window_hours=4,
    now="<ISO now>",
    envelope_writer=envelope,
)
```

Rules:
- Default observation window is 4 hours unless the active maintainer path config overrides it
- The `armed` payload's `regression_watch` and `observation_window` fields MUST be present in the Section 2 persistent write so post-close `evaluate_watch(...)` finds an armed state
- For `reject` or `reverted`, skip arming and record `regression_watch: {state: 'not_applicable'}` in the close payload
- `evaluate_watch(...)` remains a post-close concern; step 8 only arms the watch

### 2. Write final cycle summary to cycle-state

After Section 1 passes, write the final cycle summary to the swarm-configured cycle-state target path. Do NOT hardcode `.pHive/meta-team/cycle-state.yaml` as the universal destination; the active swarm config determines the path. During the A2.6 split window, the target may still be a legacy-compatible location, but this step owns the close-time write.

The final summary should capture the completed cycle state:
```yaml
status: closing
phase: close
closed: {ISO 8601 timestamp once close succeeds}
summary:
  total_findings: {N}
  proposals_generated: {N}
  changes_attempted: {N}
  changes_promoted: {N}
  changes_reverted: {N}
  flagged_for_human: {N}
  cycle_verdict: {passed | partial | poor}
closure_evidence:
  commit_ref: {validated git ref}
  metrics_snapshot: {validated snapshot ref}
  rollback_ref: {validated git ref}
```

Notes:
- `promoted_changes` and `reverted_changes` are the primary sources for promotion/discard counts and top-change summaries
- Leave the cycle in a non-closed status until commit, ledger append, and morning summary all succeed
- If the close is later rejected or commit fails, preserve the incomplete close state rather than fabricating closure

### 3. Commit all changes

Commit all modified and created files under:
- `hive/`
- `skills/hive/agents/memories/`
- swarm-owned `.pHive/` state paths that were legitimately touched this cycle
- `.pHive/teams/`
- Any other files touched during the cycle

Use commit message:
```
{swarm_prefix} Cycle {cycle_id} — {N changes}: {one-line summary of what changed}
```

`{swarm_prefix}` is resolved from the active swarm config at close time. For
`/meta-meta-optimize` the prefix is `[meta-meta-optimize]` (see
`.pHive/meta-team/charter-meta-meta-optimize.md`); for `/meta-optimize` the
prefix is `[meta-optimize]` (see `.pHive/meta-team/charter-meta-optimize.md`).
A legacy `[meta-team]` prefix is acceptable only during the documented A2.6/A2.7
migration window when the active swarm config is not yet resolvable.

Examples:
- `[meta-meta-optimize] Cycle meta-2026-04-09 — 3 changes: vertical-planning.md, status skill meta section, orchestrator memory`
- `[meta-meta-optimize] Cycle meta-2026-04-09 — 0 changes: analysis found 5 issues, all blocked by charter scope`

Rules:
- The commit MUST succeed before any ledger append
- `commit_ref` used for closure evidence must resolve to the actual recorded commit, not a placeholder
- `{swarm_prefix}` MUST resolve to a concrete prefix from the active swarm config; unresolved `{swarm_prefix}` placeholders MUST fail the close
- Fabricated values such as `commit: TBD` are explicit rejection cases and MUST fail the close

### 4. Forward plugin-level issues (opt-in)

**Only if the active swarm config enables GitHub forwarding.**

- `/meta-optimize` may forward plugin-level issues when its forwarding setting is enabled
- `/meta-meta-optimize` stays local and does NOT forward issues to GitHub

For findings marked for forwarding by the active swarm:

```bash
gh issue create --title "[meta-team] {finding title}" --body "{description with evidence}" --label "meta-team-auto"
```

Record any created issue URL in the cycle-state summary under `forwarded_issues`. If forwarding is disabled or the active swarm is `/meta-meta-optimize`, skip this step entirely.

### 5. Update ledger.yaml

Only after the closure invariant passes AND the commit succeeds, append to the
swarm-configured ledger path. The active swarm config determines the target —
typically `.pHive/meta-meta-optimize/ledger.yaml` for `/meta-meta-optimize` and
the consumer-project-scoped ledger for `/meta-optimize`. The legacy
`.pHive/meta-team/ledger.yaml` is acceptable only as an explicit migration
fallback during the A2.6/A2.7 window when the active swarm config is not yet
resolvable. Append format:
```yaml
- cycle_id: {cycle_id}
  date: {YYYY-MM-DD}
  started: {ISO 8601}
  closed: {ISO 8601}
  verdict: {passed | partial | poor}
  changes_promoted: {N}
  changes_reverted: {N}
  findings_identified: {N}
  top_changes:
    - {file}: {one-line description}
  commit: {git commit hash}
  metrics_snapshot: {validated snapshot ref}
  rollback_ref: {validated rollback ref}
  notes: |
    {Any notable context: first run, all blocked, large improvement, etc.}
```

Prerequisite check before append:
- Re-confirm that `commit_ref`, `metrics_snapshot`, and `rollback_ref` are all still present and valid
- Re-confirm that the commit hash being written is the real resolved commit, not `TBD`, `pending`, empty, or other placeholder text
- If any prerequisite fails at this point, HALT without appending the ledger entry and record `close_rejected`

If the resolved `ledger.yaml` does not exist at the swarm-configured path, create it with a YAML list header.

### 6. Produce morning summary

Write the morning summary to the swarm-owned morning-summary target for the active control plane. During the migration window, `.pHive/meta-team/morning-summary.md` remains an acceptable legacy-compatible target if the swarm-specific path is not yet present.

Follow the format in `hive/references/meta-team-ux.md`.

Minimal format if that reference doesn't exist:
```markdown
# Hive Meta-Team — Nightly Cycle Report
**Cycle:** {cycle_id} | **Date:** {date} | **Verdict:** {verdict}

## What Changed
{Bulleted list of promoted changes with one-line descriptions}

## What Was Found (Not Fixed This Cycle)
{Bulleted list of findings that were skipped, deferred, or flagged for human}

## Metrics
- Findings: {N} | Proposals: {N} | Promoted: {N} | Reverted: {N}
- Next cycle priority: {top deferred finding}
```

If the closure invariant failed earlier, do NOT write the normal morning summary. Instead produce a diagnostic morning-summary-stub that names the missing or invalid closure evidence and states that the cycle remains incomplete.

### 7. Final confirmation

Verify:
- The closure invariant passed before any persistent close write
- The swarm-configured cycle-state target reflects the final close summary
- The git commit succeeded
- The swarm-configured `ledger.yaml` has the new entry
- The morning summary or rejection stub exists at the configured target

## SUCCESS METRICS

- [ ] Closure invariant passed before any state write or ledger append
- [ ] Final cycle-state summary written to the swarm-configured target path
- [ ] All changed files committed with the swarm-resolved `{swarm_prefix}` prefix
- [ ] Swarm-configured `ledger.yaml` updated with cycle entry including real commit hash, metrics snapshot, and rollback ref
- [ ] Morning summary written per format in `meta-team-ux.md`
- [ ] No files left in uncommitted state from this cycle

## FAILURE MODES

- Closure invariant fails: record `close_rejected` with missing / invalid fields, write only a diagnostic morning-summary-stub, and leave the cycle incomplete
- Git commit fails: leave cycle-state in incomplete close status, do NOT append ledger, and record the commit error in the close output
- Ledger YAML parse error: create a fresh ledger with only this cycle entry, but only after the closure invariant and commit prerequisites have passed
- Morning summary format reference missing: use the minimal format from this step file

## WHAT THIS STEP DOES NOT OWN

- Evaluation verdicts (Step 6 owns; this step consumes them)
- Promotion or discard decisions (Step 7 owns)
- Metrics-carrier event emission (C2 emitters, opt-in — S5 story scope)
- Experiment envelope creation (B0 §1 + C1.3 schema; lifecycle library S7)
- PR-artifact promotion adapter for /meta-optimize (S10 scope)
- Re-opening a closed cycle (out of cycle lifecycle scope)

## CYCLE COMPLETE

This is the final step of the meta-team cycle. No next step.

The close is SUCCESSFUL only when:
- The closure invariant passed
- Commit succeeded
- Ledger append happened
- Morning summary written

If the closure invariant FAILED: record `close_rejected` in the output and produce a diagnostic morning-summary-stub that names what's missing. Do NOT call the cycle `closed`.
