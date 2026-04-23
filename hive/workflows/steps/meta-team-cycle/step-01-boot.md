> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 1: Boot

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Read `<HIVE_STATE_DIR>/meta-team/charter.md` BEFORE doing anything else — the charter defines what you may change
- Do NOT assume the ledger is up to date — read from disk
- Do NOT proceed without charter constraints: if the charter does not exist at `$HIVE_STATE_DIR/meta-team/charter.md`, render it from the shipped template at `hive/references/meta-team-charter-template.md` using the unified resolver in `hooks/common.sh`. Substitute the four Mustache placeholders:
  - `{{target_project}}` — derive from the target project's name (basename of `paths.target_project` if set, or the invoking cwd's basename otherwise)
  - `{{target_project_path}}` — absolute path, from `_resolve_target_project` via `hooks/common.sh`
  - `{{charter_version}}` — ISO date + sequence (e.g., `2026-04-22-1` — use the current date and a 1-based counter if a same-day render already occurred)
  - `{{render_timestamp}}` — ISO-8601 via `date -u +%Y-%m-%dT%H:%M:%SZ`
  Write the rendered file to `$HIVE_STATE_DIR/meta-team/charter.md` and, if `_resolve_state_dir` in `hooks/common.sh` resolves `HIVE_STATE_DIR` to a relative path, anchor it to `$HIVE_ROOT` per the helper contract.
- If a prior cycle is marked `status: running`, that cycle crashed — log it as `status: aborted` before starting a new one

## EXECUTION PROTOCOLS

**Mode:** autonomous

Load all state, establish the cycle ID, and produce a boot report. No changes to the codebase in this step.

## CONTEXT BOUNDARIES

**Inputs available:**
- `<HIVE_STATE_DIR>/meta-team/charter.md` — objectives, constraints, scope
- `<HIVE_STATE_DIR>/meta-team/ledger.yaml` — prior cycle history (may not exist on first run)
- `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` — prior incomplete cycle (may not exist)
- Current date/time (from system)

**NOT available:**
- Analysis findings (produced in step 2)
- Any user input — this runs unattended

## YOUR TASK

Initialize the nightly cycle: assign a cycle ID, load prior state, check for incomplete prior cycles, and produce a boot report.

## TASK SEQUENCE

### 1. Read the charter
Read `<HIVE_STATE_DIR>/meta-team/charter.md`. Confirm it exists and extract:
- Objectives (in priority order)
- Scope (what domains may be modified)
- Hard constraints list

### 2. Read the ledger
Check if `<HIVE_STATE_DIR>/meta-team/ledger.yaml` exists.
- If it exists: read all entries, note the last cycle ID and outcome
- If it does not exist: record "first run — no prior history"

### 3. Check for incomplete prior cycles
Check if `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` exists.
- If it exists AND `status: running`: the prior cycle crashed. Record it as aborted. Log: `Prior cycle {cycle_id} was running — marking as aborted`.
- If it exists AND `status: closed` or `status: aborted`: prior cycle completed normally. Note findings for reference.
- If it does not exist: first run.

### 4. Baseline availability check (BL2.3)

Before declaring the boot report complete, verify baseline metrics are available for the cycle via `hive/lib/meta-experiment/baseline.py` and `hive/lib/metrics`.

- Resolve `prior_run_id` before calling metrics helpers. `prior_run_id` means the
  most recent completed run for the same swarm cycle from the prior cycle metadata:
  read the previous cycle's recorded run metadata from
  `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml -> steps.step_01_boot.run_id` and
  confirm its companion events file at `<HIVE_STATE_DIR>/metrics/events/{prior_run_id}.jsonl`.
- Use `hive.lib.metrics.read_run_events({prior_run_id})` to inspect that prior
  run's recorded events.
- If events exist for at least one MVP metric type (`tokens`, `wall_clock_ms`, `fix_loop_iterations`, `first_attempt_pass`, `human_escalation`):
  - record `baseline_available: true` in the boot report
- Otherwise:
  - record `baseline_available: false` in the boot report
  - emit the actionable stop-message: `BL2.3: baseline capture prerequisites missing (no metric events for run_id=<id>). Stop cycle after boot. No implementation work may begin.`
  - return `boot_report` with `status: stop_no_baseline` and HALT

This check aligns with the BL2.2/BL2.3 stop condition and is non-bypassable. Do
not show any "ready for Step 2" wording when `baseline_available: false`, and do
not allow manual continuation into analysis or implementation. Later baseline
capture may call `hive.lib.meta_experiment.baseline.capture_from_run()` or
`capture_and_persist()` only after this step has recorded
`baseline_available: true`.

### 5. Assign cycle ID
Generate a cycle ID in the format `meta-YYYY-MM-DD` using today's date. If today's date already exists in the ledger (cycle already ran today), append `-r2`, `-r3`, etc.

### 6. Initialize cycle-state.yaml
Write `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` with:
```yaml
cycle_id: {cycle-id}
started: {ISO 8601 timestamp}
status: running
phase: boot
charter_constraints:
  - {extracted from charter}
prior_cycle:
  id: {last cycle id or null}
  outcome: {last outcome or null}
changes: []
findings: []
```

### 7. Produce boot report
```
## Boot Report

Cycle ID: {cycle-id}
Started: {timestamp}
Charter loaded: yes
Prior cycles: {count}
Last cycle: {id} — {outcome}
Baseline available: {true|false}
Status: {ready_to_analyze | stop_no_baseline}
```

## SUCCESS METRICS

- [ ] Charter read and constraints extracted
- [ ] Ledger read (or noted as absent on first run)
- [ ] Any crashed prior cycle marked as aborted
- [ ] Baseline availability checked before the boot report is finalized
- [ ] Cycle ID assigned following naming convention
- [ ] `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` written with `status: running`
- [ ] Boot report produced

## FAILURE MODES

- Charter does not exist: STOP only after rendering is blocked. Use `hooks/common.sh` as the canonical resolver for `state_dir` and `target_project`; if `$HIVE_STATE_DIR/meta-team/charter.md` is absent, render it from `hive/references/meta-team-charter-template.md`, substitute the Mustache placeholders, and write the result to `$HIVE_STATE_DIR/meta-team/charter.md` before continuing.
- Ledger is corrupt YAML: log the parse error, continue with empty history (don't halt cycle).
- Cycle-state.yaml has unknown status: treat as aborted, log warning, continue.
- Baseline prerequisites missing: emit `status: stop_no_baseline`, include the BL2.3 stop-message, and halt after boot.

## NEXT STEP

**Gating:** Boot report is complete, `cycle-state.yaml` is written, and
`baseline_available: true`.
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-02-analysis.md` only
when the BL2.3 gate passed.
**If gating fails:** Report which initialization step failed, emit
`status: stop_no_baseline` when applicable, and stop. No manual continuation.
