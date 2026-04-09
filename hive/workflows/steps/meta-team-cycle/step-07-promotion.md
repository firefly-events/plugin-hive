# Step 7: Promotion

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Changes with `needs_revision` verdict MUST be reverted — do not leave broken content in place
- `needs_optimization` changes are kept as-is with a follow-up note for the next cycle
- `pass` changes are kept and may generate memory insights
- Do NOT revert changes that passed — even if you think they could be better
- Reverting means restoring the prior file content, not deleting the file

## EXECUTION PROTOCOLS

**Mode:** autonomous

Promote approved changes. Revert rejected changes. Write insights for the next cycle.

## CONTEXT BOUNDARIES

**Inputs available:**
- `evaluation_results` from step 6 — verdicts per change
- Full codebase read/write access within charter domain
- `state/meta-team/cycle-state.yaml`

**NOT available:**
- User input
- The ability to change a `needs_revision` verdict — that's set

## YOUR TASK

Apply the evaluation verdicts: keep passing changes, revert rejected ones, and capture any insights worth preserving for the meta-team's own memory.

## TASK SEQUENCE

### 1. Process `needs_revision` changes
For each change with `needs_revision` verdict:
- If the change created a new file: write a note in `cycle-state.yaml` under `reverted`. The file will remain but should be treated as incomplete. Flag it for the next cycle's analysis.
- If the change modified an existing file: check if the modification can be isolated. If so, restore the original content of the affected section. If not (the change is entangled), flag for human review.
- Record: `status: reverted` or `status: flagged_for_human`

### 2. Process `pass` and `needs_optimization` changes
For each change with `pass` or `needs_optimization` verdict:
- Leave the file as-is
- Record: `status: promoted`
- For `needs_optimization`: add a note in `cycle-state.yaml` with the optimization suggestion for the next cycle

### 3. Generate meta-team insights
Look for patterns across the cycle's work that would help future cycles run better:

Examples of promotable insights:
- A finding category that appears frequently → pattern insight for analysis step
- An implementation approach that worked well → pattern for implementation step
- A type of change that often gets `needs_revision` → pitfall for proposal step

For each insight worth capturing, write to `state/insights/meta-team/cycle-{cycle-id}/`:
```yaml
agent: researcher  # or architect, developer, etc. — whoever benefits
type: pattern | pitfall | override
summary: "{one-line description}"
detail: |
  {Full explanation. Be specific.}
scope: universal
```

### 4. Compile promoted and reverted lists
```
promoted:
  - proposal_id: {id}
    file: {path}
    verdict: pass | needs_optimization
    optimization_note: {if applicable}

reverted:
  - proposal_id: {id}
    file: {path}
    reason: {revision notes from evaluation}
    action_taken: reverted | flagged_for_human
```

### 5. Update cycle-state.yaml
Append to `state/meta-team/cycle-state.yaml`:
```yaml
phase: promotion
promoted_changes: {N}
reverted_changes: {N}
flagged_for_human: {N}
insights_staged: {N}
promoted:
  - {promoted objects}
reverted:
  - {reverted objects}
```

### 6. Produce promotion report
```
## Promotion Report — Cycle {cycle_id}

Promoted: {N}
Reverted: {N}
Flagged for human: {N}
Insights staged: {N}

Promoted changes:
  {proposal_id} — {file} [{verdict}]
    {optimization_note if applicable}

Reverted changes:
  {proposal_id} — {file}: {reason}
```

## SUCCESS METRICS

- [ ] All `needs_revision` changes have a revert or flag action taken
- [ ] All `pass` and `needs_optimization` changes recorded as promoted
- [ ] Any insights staged to `state/insights/meta-team/`
- [ ] `cycle-state.yaml` updated with promotion results
- [ ] Promotion report produced

## FAILURE MODES

- File can't be restored (no original content available): flag for human with full context
- Insight staging fails: log warning, continue — insights are best-effort
- No changes promoted (all reverted): valid outcome — record as `partial` cycle

## NEXT STEP

**Gating:** Promotion report produced. All `needs_revision` changes actioned.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-08-close.md`
**If gating fails:** Report which changes could not be processed.
