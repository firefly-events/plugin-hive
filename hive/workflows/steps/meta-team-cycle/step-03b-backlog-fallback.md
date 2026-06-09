# Step 03b: Backlog Fallback

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Run this step ONLY when step 2 produced ZERO findings AND step 2b produced ZERO external_research_candidates AND step 2c produced ZERO kg_findings AND no metric signal is present. If ANY of the four actionable inputs exist, the cycle MUST route to step-03-proposal — never step-03b. This is a FALLBACK path, not the default path
- `metric_signal` is a perf-baseline-only flag and is orthogonal to findings. A cycle that produced findings but no perf delta routes to step-03, not here
- S8 is dry-run only and non-destructive: read the backlog, report which candidate would be selected, and stop
- Do NOT mutate backlog files, do NOT invoke promotion, and do NOT advance to step 4 from this step in S8
- The backlog is human-edited only (`Q-new-D` locked): do NOT auto-populate, auto-surface, or reorder entries
- Candidate selection is first-pending wins; no priority scoring, ranking, or heuristics are allowed

## EXECUTION PROTOCOLS

**Mode:** autonomous (with dry-run gate)

This step exists to make the backlog fallback branch explicit when analysis
cannot produce a metric-backed next action. In `S8`, the gate is strict:
load the human-maintained backlog, determine which candidate would be selected,
emit one structured dry-run report, and end the cycle without side effects.

## CONTEXT BOUNDARIES

**Inputs available:**
- Step 2 outcome showing no usable metric signal
- `.pHive/meta-team/queue-meta-meta-optimize.yaml` — human-edited fallback backlog
- Shared runtime library context under `hive/lib/meta-experiment/` for boundary awareness only

**NOT available:**
- Promotion authority
- File mutation authority for backlog or control-plane state
- Experiment execution
- Step 4 advancement from this fallback branch in `S8`

## YOUR TASK

Load the backlog, find the first candidate whose `status` is `pending`, and
report which candidate would be selected without changing any files. If no
pending entry exists, report `no-fallback-available` and stop the cycle
gracefully.

## TASK SEQUENCE

### 1. Confirm this branch is actually eligible
Before reading the backlog, verify that the cycle has NO actionable input from step 2, step 2b, or step 2c.

- If step 2 `findings` is non-empty: STOP and return to step-03-proposal (findings drive proposals regardless of metric signal)
- If step 2b `external_research_candidates` is non-empty: STOP and return to step-03-proposal
- If step 2c `kg_findings` is non-empty: STOP and return to step-03-proposal
- If a metric signal is present (perf-baseline delta usable for ranking): STOP and return to step-03-proposal
- ONLY if all four are empty (zero findings AND zero external candidates AND zero kg findings AND no metric signal): continue into backlog fallback mode

This routing rule is the canonical resolution to the conflation bug where `metric_signal: false` was treated as equivalent to "nothing to do" even when structural findings existed (see meta-2026-04-29 nightly: 8 findings ignored).

### 2. Read the backlog as-is
Load `.pHive/meta-team/queue-meta-meta-optimize.yaml` from disk.

- Treat the file header and `Q-new-D` lock as binding instructions
- Preserve the human-authored order exactly as written
- Do not add derived candidates, inferred candidates, or synthetic metadata

### 3. Filter tier-ineligible candidates

Before selecting, remove any candidate whose `tier` field equals `little-fix`.
These belong to the shotgun path (`/meta-shotgun`, mir-6/mir-7) and must NOT
be consumed by nightly cycles.

Filter rule (implemented in `hive/lib/meta-team/backlog-loader.mjs →
filterNightlyEligible`):
- `tier: little-fix` → **exclude** (remains `status: pending` in the backlog, untouched)
- `tier: structural` → include
- `tier: strategic`  → include
- `tier` absent      → treat as `structural` → include (backward-compatible)

Record the number of excluded candidates as `filtered_count` for the dry-run
report.

### 4. Select the fallback candidate
Inspect the **filtered** candidate list in listed order.

- Pick the FIRST entry with `status: pending`
- Do not priority-score entries
- Do not skip a pending entry because another one "looks better"
- If no pending entry exists after filtering: the fallback result is empty and the cycle ends

### 5. Build the dry-run report
Emit exactly one structured YAML report with this shape:

```yaml
# (report shape emitted by this step)
selected:
  candidate_id: null              # or a string like "mmo-2026-04-21-001"
  target: null                    # filled when candidate_id is non-null
  type: null
  description: null
  safety_notes: null
filtered_count: 0                 # number of little-fix candidates excluded from consideration
decision: no-fallback-available   # enum: would-execute | no-fallback-available
```

Rules:
- `decision: would-execute` when a pending candidate was found in the filtered pool
- `decision: no-fallback-available` when no pending candidate exists after filtering
- `decision` MUST match whether `selected.*` are populated or `null`
- All fields other than `decision` and `filtered_count` mirror the selected backlog entry or become `null`
- `filtered_count` is always set (0 when no candidates were excluded)

Example A: no fallback candidate available

```yaml
selected:
  candidate_id: null
  target: null
  type: null
  description: null
  safety_notes: null
filtered_count: 0
decision: no-fallback-available
```

Example B: candidate found, dry-run would execute (with little-fix candidates excluded)

```yaml
selected:
  candidate_id: mmo-2026-04-21-001
  target: hive/workflows/steps/meta-team-cycle/step-04-execute.md
  type: workflow-doc-fix
  description: Clarify fallback execution handoff wording
  safety_notes: Docs only; no runtime mutation
filtered_count: 2
decision: would-execute
```

### 6. Stop after reporting
After the report is emitted:

- Do NOT edit the backlog
- Do NOT write cycle-state, ledger, or envelope data
- Do NOT invoke the promotion adapter
- Do NOT run the experiment library
- Do NOT advance to step 4 in `S8`

## SUCCESS METRICS

- [ ] Step used only when all actionable inputs were empty: step 2 findings = 0, step 2b external_research_candidates = 0, and no metric_signal
- [ ] Backlog loaded from `.pHive/meta-team/queue-meta-meta-optimize.yaml` without modification
- [ ] `tier: little-fix` candidates excluded from selection pool; filtered candidates remain `status: pending` (untouched)
- [ ] First `status: pending` candidate from the filtered pool selected with no priority scoring
- [ ] Dry-run report includes `filtered_count` reflecting how many little-fix candidates were excluded
- [ ] Exactly one structured YAML report emitted
- [ ] (S8) No promotion, mutation, experiment execution, or step-4 advancement occurred (S9/BL2.2+ live mode: step-4 advancement is expected — see NEXT STEP forward-compatibility note)

## FAILURE MODES

- Backlog file missing: emit the structured YAML report with all nullable fields set to `null` and `decision: no-fallback-available`
- Backlog YAML invalid: report the parse failure in operator-facing logs, then emit `decision: no-fallback-available`
- Backlog has zero pending entries: emit `decision: no-fallback-available` and end the cycle
- All pending entries are `tier: little-fix` (filtered out): emit `decision: no-fallback-available` with `filtered_count` set to the number excluded; do not promote any little-fix candidate to fill the gap
- Caller invokes this step even though step 2 produced findings, step 2b produced external candidates, OR a metric signal is present: reject the fallback run and return control to step-03-proposal (see §1 eligibility check)

## NEXT STEP

**Gating:** One structured YAML dry-run report was produced.
**Next in S8:** Stop after this step; there is no step-4 handoff from backlog fallback during the dry-run slice.
**Forward compatibility:** In `S9` (`BL2.2+`), this same step file becomes the live fallback owner. The file stays stable; what changes is whether step 4 consumes the report.
