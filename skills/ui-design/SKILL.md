---
name: ui-design
description: Run the UI design workflow for a story — produces wireframes (.f0 + PNG exports) and canonical design briefs. Required before running /hive:visual-qa or /hive:design-review on implementation artifacts.
---

# Hive UI Design

Run the full UI design workflow for a story: read the story spec, discover design context, plan screens, build wireframes using Frame0, export PNGs, and write design briefs that serve as the developer handoff artifact.

**Input:** `$ARGUMENTS` must contain the story spec path (e.g., `.pHive/epics/{epic-id}/stories/{story-id}.yaml`) or a story ID. If omitted, prompt the user for it.

## Before Executing Any Skill

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

## Gate Check

Check that a story spec exists at the resolved path:

```bash
ls .pHive/epics/*/stories/{story-id}.yaml 2>/dev/null
```

If no story spec is found, display:

> No story spec found. Provide the path to a story YAML file (e.g., `.pHive/epics/{epic-id}/stories/{story-id}.yaml`). To plan stories first, run `/hive:plan`.

## Argument Parsing

Parse `$ARGUMENTS` before proceeding:

- If `$ARGUMENTS` is a full path ending in `.yaml`: use it as the story spec path directly.
- If `$ARGUMENTS` is a story ID (e.g., `s3-login-screen`): search for it under `.pHive/epics/*/stories/`.
- If `$ARGUMENTS` is empty or ambiguous: list candidate stories from `.pHive/epics/` and prompt the user to select one.

Resolve the `story_id` from the story spec YAML's `id` field (used for canonical output paths).

## Process

### 1. Load the ui-designer persona

Read `hive/agents/ui-designer.md` in full. This is the agent you will spawn across the workflow steps. The persona includes Frame0 CLI discovery, tool availability checks, and design brief output format.

### 2. Run the UI design workflow

Execute `hive/workflows/ui-design.workflow.yaml` using the orchestrator-narrated path. Walk the 7 steps in sequence, spawning the ui-designer agent for each step:

| Step | File | What happens |
|------|------|-------------|
| 1 | `step-01-read-story.md` | Parse story spec, scan for existing wireframes and design tokens |
| 2 | `step-02-discover-tools.md` | Verify Frame0 CLI availability (`frame0 --version`) |
| 3 | `step-03-plan-screens.md` | Produce screen manifest with layout plans |
| 4 | `step-04-create-project.md` | Create the `.f0` wireframe project file |
| 5 | `step-05-build-wireframe.md` | Build all screens in the `.f0` file |
| 6 | `step-06-export.md` | Export PNG renditions for each screen |
| 7 | `step-07-design-brief.md` | Write per-screen design briefs |

If Frame0 CLI is unavailable (step 2), the workflow produces text-based layout specs instead of `.f0` files. See the ui-designer persona for the text fallback path.

### 3. Report output

After the workflow completes, report:

```
UI Design Complete: {story-id}

Artifacts:
  Wireframe:       {path-to-.f0-file}
  Design briefs:   .pHive/design/briefs/{story-id}.md
  Manifest:        .pHive/design/index.yaml (updated)
  PNG exports:     {count} screens
    - {path-to-png-1}
    - {path-to-png-2}

Screens produced: {count}
  1. {ScreenName} — {one-line description}
  2. {ScreenName} — {one-line description}

Next steps:
  - Run /hive:design-review to critique the wireframes
  - Run /hive:execute to implement the story (design briefs are the handoff)
  - Run /hive:visual-qa after implementation to compare against design briefs
```

## Key References

- `hive/workflows/ui-design.workflow.yaml` — the 7-step workflow this skill executes
- `hive/agents/ui-designer.md` — ui-designer persona (Frame0 CLI reference, design brief format)
- `hive/references/wireframe-protocol.md` — wireframe approval protocol during /hive:plan
- `hive/references/ui-skill-gates.md` — gate spec for all UI-related skills
