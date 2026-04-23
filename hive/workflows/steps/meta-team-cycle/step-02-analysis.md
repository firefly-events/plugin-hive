> `$HIVE_STATE_DIR` resolves from `paths.state_dir` in `hive.config.yaml` (default `.pHive`).

# Step 2: Analysis

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- ONLY read — no writing to the target-project codebase in this step
- Run all checks in the prescribed order — skipping checks leads to missed findings
- Do NOT propose solutions in this step — only identify and document problems
- Respect charter scope: only flag issues in domains the meta-team is allowed to change

## EXECUTION PROTOCOLS

**Mode:** autonomous

Systematic scan of the target-project codebase (`$HIVE_TARGET_PROJECT`). Produce a findings report. Do not fix anything.

## CONTEXT BOUNDARIES

**Inputs available:**
- `cycle_id` from step 1
- The full target-project codebase at `$HIVE_TARGET_PROJECT` (resolved from paths.target_project via `hooks/common.sh`, cwd fallback when unset). For plugin-hive maintainers, HIVE_TARGET_PROJECT resolves to the plugin-hive root — analysis then scans the same `hive/` and `skills/` trees as before.
- `<HIVE_STATE_DIR>/meta-team/charter.md` — scope boundaries
- `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml` — for writing findings to disk

**Target resolution fallback:** If `paths.target_project` is unset in `hive.config.yaml`, the analyzer falls back to the invoking cwd (the directory where the cycle was started). This preserves maintainer behavior for plugin-hive: running the cycle from the plugin-hive root with no config override resolves to the plugin-hive codebase, making the generalized step functionally identical to the prior hardcoded form.

**NOT available:**
- User input
- Prior cycle findings (for independence — re-analyze fresh each cycle)

## YOUR TASK

Systematically audit the target-project codebase (`$HIVE_TARGET_PROJECT`, resolved per hooks/common.sh) and produce a ranked findings list with severity and category for each issue.

## TASK SEQUENCE

### 1. Cross-reference audit — dangling references
For each reference doc listed in the target project's top-level documentation manifest (e.g., plugin-hive's `hive/GUIDE.md` and `hive/MAIN.md`; adapt to the target project's equivalent structure if different):
- Check that the referenced file actually exists at the stated path
- Record any files listed but missing as `MISSING_FILE` findings

Also check: if the target project has workflow YAML files (plugin-hive does under `hive/workflows/`; other projects may not), check that all `step_file` paths actually exist.

### 2. Schema consistency audit
Compare field usage across instances of the same schema type:
- Read 3+ agent persona files and check frontmatter field consistency
- Read 2+ team config files (if they exist) and check schema compliance
- Read workflow YAML files and confirm steps follow `workflow-schema.md`

Record any missing required fields or undocumented fields as `SCHEMA_INCONSISTENCY` findings.

### 3. Step file completeness audit
If the target project has step files under a workflows/steps/ tree (plugin-hive uses `hive/workflows/steps/`), for each step file verify it contains all 7 required sections per `step-file-schema.md`:
- Verify each step file contains all 7 required sections:
  1. Title (`# Step N: Name`)
  2. MANDATORY EXECUTION RULES
  3. EXECUTION PROTOCOLS
  4. CONTEXT BOUNDARIES
  5. YOUR TASK / TASK SEQUENCE
  6. SUCCESS METRICS
  7. FAILURE MODES and NEXT STEP
- Record incomplete step files as `INCOMPLETE_STEP_FILE` findings

### 4. Agent memory starter set audit
If the target project has an agent roster document (plugin-hive lists agents in `hive/GUIDE.md`), inspect each listed agent:
- Check whether the target project's agent-memory location for that agent (plugin-hive uses `skills/hive/agents/memories/{agent}/`) contains any `.md` files beyond `.gitkeep`
- Agents with zero memories: record as `MEMORY_GAP` finding (low severity — expected for new agents)
- Agents with memories: check frontmatter completeness (required: name, description, type)

### 5. Reference documentation audit
If the target project has a shared references directory (plugin-hive uses `hive/references/`), for each doc in that directory:
- Read the first 20 lines to confirm it has a title, clear purpose statement, and usable content
- Flag docs that are stubs (< 30 lines of content) as `STUB_DOC` findings

### 6. Workflow completeness audit
If the target project has workflow YAML files (plugin-hive uses `hive/workflows/`), read each workflow YAML:
- Confirm `name`, `version`, `steps` fields present
- Confirm each step has either `task` or `step_file`
- Flag missing step files as `MISSING_STEP_FILE` findings

### 7. Compile findings
For each finding, record:
```yaml
id: finding-{N}
category: MISSING_FILE | SCHEMA_INCONSISTENCY | INCOMPLETE_STEP_FILE | MEMORY_GAP | STUB_DOC | MISSING_STEP_FILE | OTHER
severity: critical | high | medium | low
location: {file path}
description: {one-line description}
evidence: {specific field, line, or pattern that demonstrates the issue}
```

Sort findings by severity descending, then by category.

### 8. Update cycle-state.yaml
Append all findings to `<HIVE_STATE_DIR>/meta-team/cycle-state.yaml`:
```yaml
phase: analysis
findings:
  - {finding objects}
```

### 9. Produce analysis report
```
## Analysis Report — Cycle {cycle_id}

Total findings: {N}
  Critical: {N}
  High: {N}
  Medium: {N}
  Low: {N}

By category:
  MISSING_FILE: {N}
  SCHEMA_INCONSISTENCY: {N}
  INCOMPLETE_STEP_FILE: {N}
  MEMORY_GAP: {N}
  STUB_DOC: {N}
  OTHER: {N}

Top findings:
  [{severity}] {category} — {location}: {description}
  ...
```

## SUCCESS METRICS

- [ ] All 6 audit checks executed (cross-ref, schema, step files, memories, reference docs, workflows)
- [ ] Each finding has category, severity, location, description, evidence
- [ ] Findings appended to `cycle-state.yaml`
- [ ] Analysis report produced with counts by severity and category

## FAILURE MODES

- File not found during audit: log as finding, continue (don't stop the audit)
- YAML parse error on a workflow/config file: log as `critical` finding, continue
- Large codebase slows scan: prioritize critical and high checks; skip low checks if time is short

## NEXT STEP

**Gating:** Analysis report complete with at least one finding (or explicit "no findings" if clean)
**Next:** Load `hive/workflows/steps/meta-team-cycle/step-03-proposal.md`
**If gating fails:** Report which audit checks could not run and why.
