---
name: visual-qa
description: Post-implementation design fidelity check — compares design briefs and wireframe PNGs against the actual implementation. Gates on state/design/index.yaml.
---

# Hive Visual QA

Run a visual QA pass to verify the implementation matches the design briefs and wireframe exports.

**Input:** `$ARGUMENTS` optionally contains specific story IDs or implementation file paths to compare. If none provided, checks all entries in `state/design/index.yaml`.

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Gate Check

Check both files in order:

1. Verify `state/design/index.yaml` exists. If missing, display this message and **stop**:
   > No design briefs found. Run `/hive:ui-design` on a story first — visual-qa needs design briefs and wireframe exports to compare against the implementation.

2. Verify `state/project-profile.yaml` exists. If missing, display this message and **stop**:
   > Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — visual-qa needs the tech stack profile to locate implementation files.

Both checks must pass before proceeding.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Process

### 1. Load design manifest

Read `state/design/index.yaml`. Extract:
- All `brief_path` entries
- All `export_paths` entries (wireframe PNGs)
- All `story_id` values (to locate implementation files)

Filter by `$ARGUMENTS` if story IDs or file paths were provided.

### 2. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full.

### 3. Spawn ui-designer for fidelity comparison

Spawn a subagent with the full ui-designer persona and this task:

```
Run a visual QA comparison between the design artifacts and the implementation.

Design artifacts to compare:
{for each brief in scope:}
  Brief: {brief_path}
  Wireframe PNG: {export_paths}
  Story: {story_id}

For each screen/story in scope:

1. Read the design brief at {brief_path} — extract:
   - Layout regions and positions
   - Component list with expected positions (x, y, w, h)
   - Color and typography specifications
   - Interaction requirements
   - Accessibility requirements

2. Read the implementation files for {story_id} — locate the frontend components
   that implement the designed screens. Use the tech stack from state/project-profile.yaml
   to find the right file locations.

3. If wireframe PNG is available at {export_path}: use it as the visual reference.
   If PNG is not available: rely on the brief's component table and layout descriptions.

4. Compare design intent to implementation:

For each discrepancy found, report:
- `{implementation-file}:{line}` vs design brief `{brief_path}:{section}` — {description}
- Severity: blocking (wrong component, missing feature) | significant (wrong sizing/spacing) | cosmetic (color shade, font size off by 1)

Produce a Work Report using the 5-section format from your persona:

## Work Report: Visual QA — {stories in scope}

## Findings
- `{impl-file}:{line}` — {discrepancy from design brief} [severity: blocking | significant | cosmetic]

## Changes Made
(Leave empty — this is a QA pass, not a fix pass.)

## Remaining Issues
- Any design brief ambiguities that make fidelity hard to assess
- Intentional implementation deviations that should be noted

## Summary
Overall fidelity assessment: how closely does the implementation match the design briefs?
Verdict: fidelity-passed | fidelity-acceptable | fidelity-needs-revision
```

Capture the fidelity report output.

### 4. Write QA report

Generate a timestamp: `{YYYY-MM-DD}T{HHMM}`.

Write the report to:
```
state/audits/visual-qa/{timestamp}/report.md
```

### 5. Report output

```
Visual QA Complete

Report: state/audits/visual-qa/{timestamp}/report.md
Verdict: {fidelity-passed | fidelity-acceptable | fidelity-needs-revision}
Discrepancies: {count} total ({blocking} blocking, {significant} significant, {cosmetic} cosmetic)

Stories checked: {story_id list}
Design briefs: {count}
Wireframe PNGs: {count available} / {count total}
```

## Key References

- `hive/agents/ui-designer.md` — agent persona for fidelity comparison
- `hive/references/ui-skill-gates.md` — gate specification for visual-qa
- `state/design/index.yaml` — design brief manifest (gate file)
