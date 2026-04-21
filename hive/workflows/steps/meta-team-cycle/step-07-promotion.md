# Step 7: Promotion

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Changes are produced in a throwaway worktree (see `hive/references/meta-experiment-isolation.md`). Reverting a `needs_revision` change means DISCARDING that worktree — uncommitted content is lost atomically. The live repo is unaffected because no promotion write occurred.
- Promoting a `pass` or `needs_optimization` change means bringing the worktree's approved content into the live repo via the swarm's promotion adapter (direct-commit for `/meta-meta-optimize` per user decision; `/meta-optimize` adapter is S10 scope).
- `needs_revision` changes MUST be discarded — do not leave failed content partially applied in the live repo
- `needs_optimization` changes are promoted with an optimization note for the next cycle
- `pass` changes are promoted and may generate reusable insights
- Do NOT change evaluation verdicts in this step — Step 6 owns those decisions

## Execution Protocols

**Mode:** autonomous

**Authority model:** this step bridges the isolated experiment worktree (A1.4 / Q4) to the live repo. Verdict-to-action mapping is unambiguous: `pass`/`needs_optimization` promote via the swarm's adapter; `needs_revision` discards the worktree. No persistent cycle-state, ledger, or envelope writes happen inline from this step — `promoted_changes` + `reverted_changes` return via the workflow output graph; envelope + closure writes are Step 8's job per B0 §1.11 + B0 §3.2. `.pHive/meta-team/charter.md` is ARCHIVED.

Apply the evaluation verdicts under the worktree-default isolation model. Promote approved work through the active swarm adapter, discard rejected work by removing the experiment worktree, and stage reusable insights for future cycles.

## CONTEXT BOUNDARIES

**Inputs available:**
- `evaluation_results` from step 6 — verdicts per change
- Full codebase read/write access within charter domain
- `hive/references/meta-experiment-isolation.md` — authoritative worktree isolation model

**NOT available:**
- User input
- The ability to change a `needs_revision` / `needs_optimization` / `pass` verdict — Step 6 already set it

## YOUR TASK

Map every verdict in `evaluation_results` to exactly one action, compile the structured workflow outputs, and stage any reusable insights. This step applies verdicts; it does not re-evaluate them.

## TASK SEQUENCE

### 1. Process verdicts — one action per verdict

| Verdict | Action |
|---------|--------|
| `pass` | **Promote.** Apply the worktree's approved content to the live repo via the active swarm's promotion adapter. Record `status: promoted`. |
| `needs_optimization` | **Promote with note.** Same promotion action as `pass`. Record `status: promoted` plus an `optimization_note` from the evaluation for the next cycle's analysis phase. |
| `needs_revision` | **Discard.** The experiment's worktree is removed (`git worktree remove` or equivalent discard). No live-repo writes happen. Record `status: discarded` with the evaluation's `revision_notes` as the reason. The underlying finding returns to the next cycle's analysis phase; it is NOT flagged to a human and is NOT left partially-applied in the live repo. |

There is no human-escalation verdict path in this step. Human escalation only appears in FAILURE MODES when infrastructure problems prevent the verdict-to-action mapping from executing at all.

### 2. Apply the mapping to every evaluation entry

For each evaluation in `evaluation_results`:
- Read the verdict and corresponding rationale / notes from Step 6
- Execute the single action required by the table above
- Add a structured entry to either `promoted_changes` or `reverted_changes`

Notes:
- `reverted_changes` remains the workflow output field name for backwards compatibility with existing wiring, but its entries use `status: discarded`
- Discard means the isolated worktree is removed; it does NOT mean undoing a live-repo mutation

### 3. Generate swarm insights

Look for patterns across the cycle's work that would help future cycles run better:

Examples of promotable insights:
- A finding category that appears frequently → pattern insight for analysis step
- An implementation approach that worked well → pattern for implementation step
- A type of change that often gets `needs_revision` → pitfall for proposal step

For each insight worth capturing, write to `.pHive/insights/{swarm-name}/cycle-{cycle-id}/`:
```yaml
agent: researcher  # or architect, developer, etc. — whoever benefits
type: pattern | pitfall | override
summary: "{one-line description}"
detail: |
  {Full explanation. Be specific.}
scope: universal
```

Transition note: during the A2.6/A2.7 two-swarm migration window, `.pHive/insights/meta-team/` remains acceptable as a legacy-compatibility fallback if the swarm-specific path is not present yet.

### 4. Compile promoted and discarded lists

These structured dictionaries are the workflow outputs for this step, not side-effect writes:
```yaml
promoted_changes:
  - proposal_id: {id}
    file: {path}
    verdict: pass | needs_optimization
    status: promoted
    optimization_note: {if applicable}

reverted_changes:
  - proposal_id: {id}
    file: {path}
    verdict: needs_revision
    status: discarded
    reason: {revision_notes from evaluation}
```

### 5. Compile promotion results

The compiled promotion result for this step is the combination of:
- `promoted_changes`
- `reverted_changes`
- summary counts for promoted / discarded
- `insights_staged`

This compiled dict is returned through the workflow output graph. No inline cycle-state update happens here.

### 6. Produce promotion report

```
## Promotion Report — Cycle {cycle_id}

Promoted: {N}
Discarded: {N}
Insights staged: {N}

Promoted changes:
  {proposal_id} — {file} [{verdict}]
    {optimization_note if applicable}

Discarded changes:
  {proposal_id} — {file}: {reason}
```

## SUCCESS METRICS

- [ ] Every verdict from `evaluation_results` mapped to exactly one action
- [ ] All `pass` and `needs_optimization` changes recorded in `promoted_changes` with `status: promoted`
- [ ] All `needs_revision` changes recorded in `reverted_changes` with `status: discarded`
- [ ] Any insights staged to `.pHive/insights/{swarm-name}/` or the legacy fallback path
- [ ] `promoted_changes` and `reverted_changes` outputs emitted with per-change entries
- [ ] Promotion report produced

## FAILURE MODES

- Worktree discard fails (`git worktree remove` or equivalent cannot complete): flag for human with full context because the discard action could not execute
- Promotion adapter fails to apply approved content to the live repo: flag for human with the adapter error and affected proposal IDs
- Insight staging fails: log warning, continue — insights are best-effort
- No changes promoted (all discarded): valid outcome — record as `partial` cycle

## WHAT THIS STEP DOES NOT OWN

- Closure invariant enforcement (Step 8 close validator per B0 §1.11)
- Envelope writes (Step 8 + lifecycle library)
- Metrics-carrier emission (C2 emitters, opt-in)
- PR-only public-swarm promotion semantics (S10 scope — `/meta-optimize` only)
- Evaluation verdict changes (Step 6 owns; this step applies verdicts, does not re-evaluate)
- Implementing content fixes for `needs_revision` changes (next cycle's analysis + implementation phases handle re-work)

## NEXT STEP

**Gating:** Every verdict from `evaluation_results` mapped to exactly one action (promote / promote-with-note / discard). `promoted_changes` and `reverted_changes` outputs compiled. No live-repo writes for discarded changes.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-08-close.md`
**If gating fails:** Report which verdicts could not be executed and why.
