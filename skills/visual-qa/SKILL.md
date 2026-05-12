---
name: visual-qa
description: Post-implementation design fidelity check — compares design briefs and wireframe PNGs against the actual implementation. Gates on .pHive/design/index.yaml.
---

# Hive Visual QA

Run a visual QA pass to verify the implementation matches the design briefs and wireframe exports.

**Input:** `$ARGUMENTS` optionally contains specific story IDs or implementation file paths to compare. If none provided, checks all entries in `.pHive/design/index.yaml`.

## Before Executing Any Skill

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

## Gate Check

Check both files in order:

1. Verify `.pHive/design/index.yaml` exists. If missing, display this message and **stop**:
   > No design briefs found. Run `/hive:ui-design` on a story first — visual-qa needs design briefs and wireframe exports to compare against the implementation.

2. Verify `.pHive/project-profile.yaml` exists. If missing, display this message and **stop**:
   > Hive hasn't been set up for this project yet. Run `/hive:kickoff` first — visual-qa needs the tech stack profile to locate implementation files.

Both checks must pass before proceeding.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Process

### 1. Load design manifest

Read `.pHive/design/index.yaml`. Extract:
- All `brief_path` entries
- All `export_paths` entries (wireframe PNGs)
- All `story_id` values (to locate implementation files)

Filter by `$ARGUMENTS` if story IDs or file paths were provided.

### 2. Load ui-designer persona

Read `hive/agents/ui-designer.md` in full.

### 3. Spawn ui-designer for fidelity comparison

Read and cite `hive/references/ui-prompts/visual-qa.md` as the canonical ui-designer task prompt.

Inject the following placeholder values before passing to the subagent: scoped design artifact entries including `{brief_path}`, `{export_paths}`, `{story_id}`, and `{export_path}` where available.

Spawn a subagent with the full ui-designer persona (`hive/agents/ui-designer.md`) and the rendered prompt body.

Capture the fidelity report output.

### 4. Write QA report

Generate a timestamp: `{YYYY-MM-DD}T{HHMM}`.

Write the report to:
```
.pHive/audits/visual-qa/{timestamp}/report.md
```

### 5. Report output

```
Visual QA Complete

Report: .pHive/audits/visual-qa/{timestamp}/report.md
Verdict: {fidelity-passed | fidelity-acceptable | fidelity-needs-revision}
Discrepancies: {count} total ({blocking} blocking, {significant} significant, {cosmetic} cosmetic)

Stories checked: {story_id list}
Design briefs: {count}
Wireframe PNGs: {count available} / {count total}
```

## Key References

- `hive/agents/ui-designer.md` — agent persona for fidelity comparison
- `hive/references/ui-skill-gates.md` — gate specification for visual-qa
- `.pHive/design/index.yaml` — design brief manifest (gate file)
