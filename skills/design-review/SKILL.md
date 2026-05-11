---
name: design-review
description: Target-aware UI review ceremony for design artifacts or implementation artifacts. Supports --artifact-target {design|implementation} plus --skip flags for optional participants.
---

# Hive Design Review

Run a structured review ceremony on UI artifacts. By default this critiques design artifacts
(briefs, wireframes, brand system); with `--artifact-target implementation`, it audits running
code, screens, and components while preserving the historical ui-audit record path.

**Input:** `$ARGUMENTS` optionally contains:
- `--artifact-target {design|implementation}` — choose artifact mode; default is `design`
- `--artifact-target={design|implementation}` — equivalent form
- `--skip accessibility` — skip the accessibility-specialist critique (step 1)
- `--skip animations` — skip the animations-specialist critique (step 2)
- Artifact paths to review (overrides auto-detection)

## Before Executing Any Skill

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

## Argument Parsing

Parse `$ARGUMENTS` before gate checks. Default `artifact_target` to `design`.
Accept `--artifact-target design`, `--artifact-target=design`,
`--artifact-target implementation`, and `--artifact-target=implementation`.
Accept only `design` or `implementation`; if any other value is supplied, stop with:

```
Usage: /hive:design-review [--artifact-target {design|implementation}] [--skip accessibility] [--skip animations] [artifact paths...]
```

Preserve the `--skip` parsing pattern exactly: `--skip accessibility` skips step 1,
`--skip animations` skips step 2, and both flags leave only ui-designer critique plus
synthesis. Treat all remaining non-flag tokens as explicit artifact paths.

## Gate Check

Use the gate for the selected target.

### Design target

Check for `.pHive/design/index.yaml` OR `.pHive/brand/brand-system.yaml`. If **both**
are missing, display this message and **stop**:

> Nothing to review yet. Design-review needs at least wireframes (run `/hive:ui-design`) or a brand system (run `/hive:brand-system`) before it can run a critique.

### Implementation target

Check `.pHive/project-profile.yaml` exists and has a non-empty `tech_stack` key. If either
check fails, emit the warning below and proceed with sane defaults — do NOT stop. The audit
runs with reduced fidelity (generic conventions instead of project-specific tech-stack rules):

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Process

### 1. Load workflow

Read `hive/workflows/design-review.workflow.yaml` in full.

### 2. Collect artifacts

Build `artifact_paths` for the selected target.

For `artifact_target: design`, use explicit paths if provided; otherwise collect
`.pHive/design/index.yaml` `brief_path` and `export_paths` entries plus
`.pHive/brand/brand-system.yaml` when present. Set `record_type` to `design-review`,
`report_dir` to `.pHive/audits/design-review/{timestamp}/`, and verdict vocabulary to
`approved | needs_revision | needs_redesign`.

For `artifact_target: implementation`, use explicit paths if provided; otherwise collect
all files under `.pHive/wireframes/`, all files under `.pHive/design/`, and frontend source
files identified from `.pHive/project-profile.yaml` `tech_stack` when available. Include
`tech_stack` context when available; otherwise include a generic conventions note. Set
`record_type` to `ui-audit`, `report_dir` to `.pHive/audits/ui-audit/{timestamp}/`, and
verdict vocabulary to `passed | needs_optimization | needs_revision`.

Pass the selected target, artifact paths, record type, verdict vocabulary, and any tech-stack
context as workflow context. The workflow still receives `design_artifacts` for compatibility;
for implementation mode, treat that key as the implementation artifact list.

### 3. Load specialist personas

Read the full persona files for each step that will execute:
- `hive/agents/accessibility-specialist.md` if step 1 runs (skippable)
- `hive/agents/animations-specialist.md` if step 2 runs (skippable)
- `hive/agents/ui-designer.md` always (critique plus synthesis)

### 4. Execute workflow steps sequentially

Execute `hive/workflows/design-review.workflow.yaml` steps in order. For each step that is
NOT skipped, spawn a subagent with the full persona, the step `task`, `artifact_target`,
target-specific `artifact_paths` passed as `design_artifacts`, target-specific verdict
vocabulary, implementation `tech_stack` context when available, and prior step outputs.
Capture each output and pass it to subsequent steps as specified in workflow `inputs`.

Announce which steps are running before execution:

```
Design Review — Target: {design | implementation}
Participants:
  Step 1: accessibility-specialist [running | SKIPPED (--skip accessibility)]
  Step 2: animations-specialist    [running | SKIPPED (--skip animations)]
  Step 3: ui-designer (critique)   [running]
  Step 4: ui-designer (synthesis)  [running]
```

### 5. Synthesize target-aware verdict

The final synthesis must:
- Merge findings across domains, deduplicating overlapping issues
- Rank by severity: blocking → significant → cosmetic
- Distinguish findings that require design decisions from findings that require code fixes
- Use design wording for design artifacts and implementation wording for implementation artifacts
- Emit one verdict from the target-specific verdict vocabulary

Use this shared report structure:

```
## Work Report: Design Review — {timestamp}
## Findings
- `{file-or-artifact}:{section-or-line}` — {finding} [severity: blocking | significant | cosmetic] [domain: accessibility | motion | design]
## Changes Made
(Leave empty — this is an audit/review, not a fix pass.)
## Remaining Issues
- Findings requiring human design decisions, code fixes, or follow-up validation
## Summary
One-paragraph assessment covering overall UI health, top issues, and readiness.
## Verdict
{target-specific verdict}
```

### 6. Write report

Generate a timestamp: `{YYYY-MM-DD}T{HHMM}`.

Write the synthesis output to `.pHive/audits/design-review/{timestamp}/report.md` for
`artifact_target: design`, or `.pHive/audits/ui-audit/{timestamp}/report.md` for
`artifact_target: implementation`.

### 7. Write latest.yaml pointer (on success only)

Only after the report is successfully written, write:

```yaml
completed_at: "{ISO 8601}"
report_path: ".pHive/audits/{design-review|ui-audit}/{timestamp}/report.md"
artifact_target: "{design|implementation}"
findings_count: {N}
verdict: "{target-specific verdict}"
```

Write the pointer to:
- `.pHive/audits/design-review/latest.yaml` for `artifact_target: design`
- `.pHive/audits/ui-audit/latest.yaml` for `artifact_target: implementation`

**Do NOT write latest.yaml if any step fails.** An incomplete implementation audit must not unblock the polish-audit gate.

### 8. Display results

Display target, report path, verdict, total findings by severity, specialist finding counts
or skipped status, and a target-aware next action. For implementation target, the next action
may be `/hive:polish-audit` because the preserved `.pHive/audits/ui-audit/latest.yaml`
pointer satisfies its gate.

## Key References

- `hive/workflows/design-review.workflow.yaml` — shared review workflow
- `hive/agents/accessibility-specialist.md` — step 1 persona
- `hive/agents/animations-specialist.md` — step 2 persona
- `hive/agents/ui-designer.md` — steps 3 and 4 persona
- `hive/references/ui-skill-gates.md` — target-aware gate specification
- `skills/review/SKILL.md` — reference pattern for skills that orchestrate workflows
