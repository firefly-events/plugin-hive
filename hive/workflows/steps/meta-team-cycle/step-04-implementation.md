# Step 4: Implementation

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Implement ONLY the approved proposals from step 3 — no scope creep
- Read each target file before writing to it — even for new files, check if it already exists
- NEVER remove more than 50% of a file's existing content in a single operation
- NEVER delete any file
- For additive changes: append or insert; do not replace existing content unless fixing a specific named error
- Track each change with file path, action type, and a brief description in the step's `changes_made` output

## EXECUTION PROTOCOLS

**Mode:** autonomous

**Authority model:** this step's only persistent output is the structured `changes_made` result returned to the workflow. Do NOT write cycle-state, ledger, envelope, or metrics-carrier files inline from this step. Downstream steps (evaluation, promotion, close) own any persistent control-plane writes and the orchestrator coordinates them via the workflow output graph, the B0 envelope contract (`.pHive/epics/meta-improvement-system/docs/b0-consumer-contract.md`), and the C1 runtime primitives (`hive/lib/metrics/`) per the meta-improvement-system epic.

Implement each approved proposal in priority order. Track changes in the implementation outputs as you go.

## CONTEXT BOUNDARIES

**Inputs available:**
- `approved_proposals` JSON from step 3 (each with implementation_plan)
- Full codebase read/write access within charter domain

**NOT available:**
- User input
- Changes to files outside the charter domain
- Config file modifications

## YOUR TASK

Execute each approved proposal's implementation plan. Write new files, add sections, create memory entries. Track every change made in the implementation outputs.

## TASK SEQUENCE

### 1. Process proposals in priority order
For each approved proposal (highest priority first):

#### 1a. Re-read the target file(s)
Before making any change, read the current content of every file in the implementation plan. Confirm:
- The issue the proposal addresses is still present (it might have been fixed by a prior proposal in the same cycle)
- The proposed action won't conflict with existing content

#### 1b. Execute each implementation plan step
For `action: create`:
- Check the file doesn't already exist
- Write the new file following the appropriate schema (step-file-schema, agent-memory-schema, workflow-schema, etc.)

For `action: add_section`:
- Read current file content
- Identify the insertion point (end of file, after a specific section, etc.)
- Add the section without altering surrounding content

For `action: update_field`:
- Read current file content
- Update the specific named field only
- Leave all other content unchanged

For `action: add_entry`:
- Read current file content
- Append the new entry to the appropriate list or section

#### 1c. Track the change in the implementation report output
Immediately after each successful file write, add a structured entry to the `changes_made` output:
```yaml
- proposal_id: proposal-{N}
  action: {action type}
  file: {file path}
  description: {what was written / added / changed}
  status: done
```

### 2. Handle blocked proposals
If a proposal cannot be implemented as planned (target file has changed, dependency missing, content conflict):
- Record it as `status: blocked` with a reason
- Do NOT attempt a workaround — skip it cleanly
- Continue with remaining proposals

### 3. Produce implementation report
This report is the human-readable companion to the structured `changes_made` output.
```
## Implementation Report — Cycle {cycle_id}

Changes made: {N}
Blocked proposals: {N}

Changes:
  [done] {proposal_id} — {file}: {description}
  [blocked] {proposal_id} — {reason}
```

## SUCCESS METRICS

- [ ] Each approved proposal attempted in priority order
- [ ] Each target file read before writing
- [ ] No existing file content removed beyond the minimum needed to fix the named issue
- [ ] Each completed change appears in the `changes_made` output
- [ ] Implementation report produced

## FAILURE MODES

- File write fails: log as blocked, continue with remaining proposals
- Content conflict (target section already exists or was added by a prior proposal): log as blocked with reason `already_exists`, skip
- Accidental scope creep: revert the change, record as blocked with reason `scope_creep`

## WHAT THIS STEP DOES NOT OWN

- Persistent cycle-state or ledger writes (close step / orchestrator own those per the rebuilt authority model)
- Envelope creation or updates (lifecycle library and promotion step own these — B0 §1 contract)
- Metrics-carrier emission (opt-in via kickoff; C2 emitters own this; Step 4 does not emit events)
- Test execution or validation (Step 5)
- Evaluation verdict (Step 6)
- Promotion or revert decisions (Step 7)
- Closure invariant checks (Step 8 close validator)

## NEXT STEP

**Gating:** At least one change in the `changes_made` output, OR all proposals blocked with structured reasons in the same output.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-05-testing.md`
**If gating fails:** Report which proposals failed and why. Do not advance without at least one completed change.
