---
name: ui-audit
description: Collaborative UI audit — accessibility specialist and animations specialist surface findings; ui-designer synthesizes a unified audit report. Gates on .pHive/project-profile.yaml.
---

# Hive UI Audit

Run a collaborative UI audit — accessibility and animation specialists surface domain findings, ui-designer synthesizes a unified report.

**Input:** `$ARGUMENTS` optionally contains artifact paths to audit (wireframes, implementation files). If none provided, the skill audits the full project UI surface.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Gate Check

Check `.pHive/project-profile.yaml`:

1. Verify the file exists
2. Verify it has a `tech_stack` key that is non-empty

If either check fails, display this message and **stop**:

> Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — ui-audit needs the tech stack profile to audit against the right conventions.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Process

### 1. Load personas

Read all three agent personas in full before spawning any subagents:
- `hive/agents/accessibility-specialist.md`
- `hive/agents/animations-specialist.md`
- `hive/agents/ui-designer.md`

### 2. Determine artifact scope

Parse `$ARGUMENTS` for artifact paths. If none provided, use:
- All files under `.pHive/wireframes/`
- All files under `.pHive/design/`
- Any frontend source files identified in `.pHive/project-profile.yaml` tech stack

### 3. Step 1 — Accessibility specialist audit

Spawn a subagent with the full accessibility-specialist persona and this task:

```
Audit the following artifacts for WCAG 2.1 AA accessibility issues:
{artifact_paths}

Tech stack context from .pHive/project-profile.yaml: {tech_stack}

Produce a Work Report covering:
- ARIA attribute issues
- Keyboard navigation gaps
- Focus management problems
- Contrast ratio violations
- Semantic HTML errors
- Screen reader compatibility issues

Also surface opportunities — areas where proactive improvements would significantly improve
accessibility beyond current violations.

Use the 5-section Work Report format from your persona.
```

Capture the accessibility findings output.

### 4. Step 2 — Animations specialist audit

Spawn a subagent with the full animations-specialist persona and this task:

```
Review the following artifacts for animation and motion design opportunities:
{artifact_paths}

Accessibility findings from Step 1 (for cross-reference):
{accessibility_findings}

Produce a Work Report covering:
- Missing or inadequate prefers-reduced-motion support
- Animation performance issues (layout thrashing, non-compositor properties)
- Motion design opportunities that would improve UX feedback
- Transition timing inconsistencies

Cross-reference the accessibility findings above — flag any animations that compound
accessibility issues identified there.

Use the 5-section Work Report format from your persona.
```

Capture the animation findings output.

### 5. Step 3 — UI designer synthesis

Spawn a subagent with the full ui-designer persona and this task:

```
Synthesize the following specialist audit findings into a unified UI audit report.

Accessibility findings:
{accessibility_findings}

Animation/motion findings:
{animation_findings}

Artifact scope:
{artifact_paths}

Produce a unified Work Report using the 5-section format. Your synthesis role:
- Merge findings across domains, deduplicating overlapping issues
- Rank by severity: blocking (WCAG violations, broken interactions) → significant → cosmetic
- Distinguish findings that require design decisions vs. code fixes
- Provide a verdict: passed | needs_optimization | needs_revision

Use this output structure:

## Work Report: UI Audit — {timestamp}

## Findings
- `{file}:{line}` — {finding} [severity: blocking | significant | cosmetic] [domain: accessibility | motion | design]

## Changes Made
(Leave empty — this is an audit, not a fix pass. Changes will be addressed in follow-up stories.)

## Remaining Issues
- Any findings that require human design decisions or are outside automated remediation scope

## Summary
One-paragraph assessment covering: overall UI health, top 3 issues to address first, whether the verdict is passed/needs-optimization/needs-revision.

## Verdict
passed | needs_optimization | needs_revision
```

Capture the synthesis output.

### 6. Write audit report

Generate a timestamp: `{YYYY-MM-DD}T{HHMM}` (e.g., `2026-04-09T1430`).

Write the synthesis output to:
```
.pHive/audits/ui-audit/{timestamp}/report.md
```

### 7. Write latest.yaml pointer (on success only)

Only after the report is successfully written, write:
```yaml
# .pHive/audits/ui-audit/latest.yaml
completed_at: "{ISO 8601 timestamp}"
report_path: ".pHive/audits/ui-audit/{timestamp}/report.md"
findings_count: {total finding count from report}
verdict: "{passed | needs_optimization | needs_revision}"
```

**Do NOT write latest.yaml if any step fails.** An incomplete audit must not unblock the polish-audit gate.

### 8. Report output

```
UI Audit Complete

Report: .pHive/audits/ui-audit/{timestamp}/report.md
Verdict: {verdict}
Findings: {count} total ({blocking} blocking, {significant} significant, {cosmetic} cosmetic)

Specialists:
  accessibility-specialist — {a11y finding count} findings
  animations-specialist    — {motion finding count} findings
  ui-designer (synthesis)  — unified report

Next: Run /hive:polish-audit to identify refinement opportunities based on these findings.
```

## Key References

- `hive/agents/accessibility-specialist.md` — Step 1 persona
- `hive/agents/animations-specialist.md` — Step 2 persona
- `hive/agents/ui-designer.md` — Step 3 synthesis persona
- `hive/references/ui-skill-gates.md` — gate specification for ui-audit
- `.pHive/architecture/ui-team-skills-arch.md` — collaborative skill pattern, latest.yaml spec
