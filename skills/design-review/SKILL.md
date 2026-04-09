---
name: design-review
description: Design review ceremony — structured critique of design artifacts by domain specialists. OR gate (design briefs OR brand system). Supports --skip flags for optional participants.
---

# Hive Design Review

Run a structured design review ceremony on design artifacts (wireframes, design briefs, brand system).

**Input:** `$ARGUMENTS` optionally contains:
- `--skip accessibility` — skip the accessibility-specialist critique (step 1)
- `--skip animations` — skip the animations-specialist critique (step 2)
- Artifact paths to review (overrides auto-detection from design index)

## Before Executing Any Skill

1. **Load your persona.** Read `hive/agents/orchestrator.md` — it contains team evaluation criteria, pre-spawn checklist, circuit breakers, model tier routing, dev-on-standby pattern, decision protocols, and research prompt construction rules. This is WHO you are and HOW you make decisions.
2. **Load project config.** Read `hive/hive.config.yaml` for execution settings (methodology, parallel teams, circuit breaker limits, model overrides).
3. **Load your memories.** Read the `knowledge` paths from your orchestrator frontmatter. Scan `~/.claude/hive/memories/orchestrator/` for all `.md` files. Read each file's frontmatter `description` field. Load the full content of any memories relevant to the current task. If no memories exist yet, proceed — this is expected for new projects.

## Gate Check (OR condition)

Check at least one of:
1. `state/design/index.yaml` — exists
2. `state/brand/brand-system.yaml` — exists

If **both** are missing, display this message and **stop**:

> Nothing to review yet. Design-review needs at least wireframes (run `/hive:ui-design`) or a brand system (run `/hive:brand-system`) before it can run a critique.

If either file exists, the gate passes. Proceed.

See `hive/references/ui-skill-gates.md` for the full gate specification.

## Argument Parsing

Parse `$ARGUMENTS`:

| Argument | Effect |
|----------|--------|
| `--skip accessibility` | Step 1 (accessibility-critique) is skipped |
| `--skip animations` | Step 2 (animations-critique) is skipped |
| Both `--skip` flags | Only steps 3 (design-critique) and 4 (synthesis) run |
| *(neither flag)* | All 4 steps run |
| Explicit file/brief paths | Scope review to those artifacts only |

## Process

### 1. Load workflow

Read `hive/workflows/design-review.workflow.yaml` in full.

### 2. Collect design artifacts

Build the artifact list for review:
- If `$ARGUMENTS` contains explicit paths: use those
- If `state/design/index.yaml` exists: read it, collect all `brief_path` and `export_paths`
- If `state/brand/brand-system.yaml` exists: include it
- If both: include all

### 3. Load specialist personas (for steps that will run)

Read the full persona files for each step that will execute:
- If step 1 runs (no `--skip accessibility`): read `hive/agents/accessibility-specialist.md`
- If step 2 runs (no `--skip animations`): read `hive/agents/animations-specialist.md`
- Always read: `hive/agents/ui-designer.md` (steps 3 and 4 always run)

### 4. Execute workflow steps sequentially

Execute `hive/workflows/design-review.workflow.yaml` steps in order. For each step that is NOT skipped:

**a.** Read the agent persona referenced by the step's `agent` field (already loaded in step 3 above).

**b.** Spawn a subagent with:
- The full agent persona as system context
- The step's `task` description
- The `design_artifacts` context
- Any `inputs` from previous steps (pass as empty/absent for skipped steps)

**c.** Capture the step output.

**d.** Pass captured outputs to subsequent steps as specified in the workflow `inputs`.

Announce which steps are running before execution:
```
Design Review — Participants:
  Step 1: accessibility-specialist [running | SKIPPED (--skip accessibility)]
  Step 2: animations-specialist    [running | SKIPPED (--skip animations)]
  Step 3: ui-designer (critique)   [running]
  Step 4: ui-designer (synthesis)  [running]
```

### 5. Write review record

Generate a timestamp: `{YYYY-MM-DD}T{HHMM}`.

Write the synthesis output (from step 4) to:
```
state/audits/design-review/{timestamp}/report.md
```

### 6. Display structured verdict

```
## Design Review Results

### Participants
{list of specialists who ran, with "SKIPPED" for those that didn't}

### Findings Summary
{domain critique highlights — 3-5 key findings per domain that ran}

### Verdict: {approved | needs_revision | needs_redesign}

#### Blocking
{critical findings that must be addressed before implementation}

#### Significant
{findings that degrade UX but don't block implementation}

#### Cosmetic
{minor polish items}

### Recommended Next Steps
{1-3 concrete next actions based on verdict}

---
Full report: state/audits/design-review/{timestamp}/report.md
```

## Key References

- `hive/workflows/design-review.workflow.yaml` — the ceremony workflow this skill orchestrates
- `hive/agents/accessibility-specialist.md` — step 1 persona
- `hive/agents/animations-specialist.md` — step 2 persona
- `hive/agents/ui-designer.md` — steps 3 and 4 persona
- `hive/references/ui-skill-gates.md` — gate specification (OR condition for design-review)
- `skills/review/SKILL.md` — reference pattern for skills that orchestrate workflows
