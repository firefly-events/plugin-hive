---
name: polish-audit
description: Fun-factor polish pass — animations specialist identifies motion and delight opportunities; ui-designer synthesizes a polish report. Gates on .pHive/audits/ui-audit/latest.yaml.
---

# Hive Polish Audit

Run a focused polish pass to identify animation, motion, and delight opportunities that elevate UI quality beyond baseline compliance.

**Input:** `$ARGUMENTS` optionally contains artifact paths to target. If none provided, reads scope from `.pHive/audits/ui-audit/latest.yaml`.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Gate Check

Check `.pHive/audits/ui-audit/latest.yaml`:

1. Verify the file exists (existence check only — the `verdict` field is NOT checked)

If the check fails, display this message and **stop**:

> No ui-audit found. Run `/hive:ui-audit` first — polish-audit builds on audit findings to identify refinement opportunities.

See `hive/references/ui-skill-gates.md` for the full gate specification.

Note: Even a clean ui-audit (verdict: passed) justifies a polish pass. The gate checks existence, not verdict.

## Process

### 1. Load prior audit context

Read `.pHive/audits/ui-audit/latest.yaml` to get:
- `report_path` — read the prior audit report for context
- `verdict` — include in polish report header for reference

### 2. Load personas

Read both agent personas in full before spawning any subagents:
- `hive/agents/animations-specialist.md`
- `hive/agents/ui-designer.md`

### 3. Determine artifact scope

Parse `$ARGUMENTS` for artifact paths. If none provided, derive scope from the prior audit report.

### 4. Step 1 — Animations specialist polish pass

Spawn a subagent with the full animations-specialist persona and this task:

```
Run a focused polish pass to identify animation and motion opportunities in:
{artifact_paths}

Prior ui-audit context (for reference — do not re-audit baseline issues):
{prior_audit_report_summary}

Focus exclusively on OPPORTUNITIES — things that don't exist yet but would improve UX:

1. **Micro-interactions** — button press feedback, toggle animations, success/error state transitions
2. **Loading states** — skeleton screens, progressive loading, shimmer effects
3. **Empty states** — illustrated animations, onboarding motion, invitation to interact
4. **List animations** — staggered entry, item add/remove transitions, reorder animations
5. **Navigation transitions** — page entry/exit, modal open/close, tab switching
6. **Spring physics** — natural-feeling bounce and overshoot for modals, drawers, pull-to-refresh
7. **Parallax / scroll effects** — header collapse, sticky behavior, scroll-triggered reveals
8. **Gradient and color animations** — background gradient shifts, color transition on hover/focus

For each opportunity:
- Cite the specific file and element: `path/to/component.tsx:42`
- Describe the animation: type, duration, easing curve recommendation
- Estimate implementation effort: low (CSS only) | medium (JS animation) | high (custom physics)
- Note any prefers-reduced-motion alternative

Use the 5-section Work Report format from your persona.
```

Capture the animation opportunities output.

### 5. Step 2 — UI designer synthesis

Spawn a subagent with the full ui-designer persona and this task:

```
Synthesize animation and polish opportunities into a polish report.

Animation opportunities from animations-specialist:
{animation_opportunities}

Prior ui-audit verdict (for context): {prior_verdict}

Produce a polish report using the Work Report format. Add a priority matrix:

## Work Report: Polish Audit — {timestamp}

## Findings
- `{file}:{line}` — {opportunity} [effort: low | medium | high] [impact: high | medium | low]

## Changes Made
(Leave empty — this is a discovery pass, not a fix pass.)

## Remaining Issues
- Opportunities that require design decisions or brand direction before implementation
- Anything that conflicts with existing UX patterns and needs human sign-off

## Summary
One-paragraph assessment: overall polish opportunity, highest-ROI items to tackle first.

## Priority Matrix
| Opportunity | File | Effort | Impact | Recommendation |
|-------------|------|--------|--------|----------------|
| ... | ... | low | high | Do immediately |
| ... | ... | high | low | Defer |
```

Capture the synthesis output.

### 6. Write polish report

Generate a timestamp: `{YYYY-MM-DD}T{HHMM}`.

Write the synthesis output to:
```
.pHive/audits/polish-audit/{timestamp}/report.md
```

### 7. Write latest.yaml pointer (on success only)

Only after the report is successfully written, write:
```yaml
# .pHive/audits/polish-audit/latest.yaml
completed_at: "{ISO 8601 timestamp}"
report_path: ".pHive/audits/polish-audit/{timestamp}/report.md"
findings_count: {total opportunity count}
verdict: "opportunities_identified"
```

**Do NOT write latest.yaml if any step fails.**

### 8. Report output

```
Polish Audit Complete

Report: .pHive/audits/polish-audit/{timestamp}/report.md
Opportunities: {count} total ({low} low-effort, {medium} medium, {high} high-effort)

Top high-impact / low-effort picks:
  1. {opportunity 1}
  2. {opportunity 2}
  3. {opportunity 3}

Built on: {prior_audit_report_path} (verdict: {prior_verdict})
```

## Key References

- `hive/agents/animations-specialist.md` — Step 1 persona (motion opportunities)
- `hive/agents/ui-designer.md` — Step 2 synthesis persona
- `hive/references/ui-skill-gates.md` — gate specification for polish-audit
- `.pHive/architecture/ui-team-skills-arch.md` — latest.yaml pointer pattern
