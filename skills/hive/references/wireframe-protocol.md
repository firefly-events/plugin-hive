# Wireframe Approval Protocol

This document defines the human-in-the-loop approval flow for wireframes produced during the planning phase. The UI designer agent creates wireframes; this protocol governs how the user reviews and approves them before they're embedded in story specs.

## When This Runs

During `/hive:plan`, when a story involves net-new UI work. The UI designer agent runs as a planning-phase agent alongside the analyst and architect. Wireframes are produced and approved **before** stories are finalized — by execution time, developers already have the approved design context.

## Rendition Support

- **Default:** 1 rendition per screen/component
- **Configurable:** via story config field `renditions: N` or plan command flag `--renditions N`
- Each rendition is a layout/component variation of the same screen
- All renditions are exported to: `state/wireframes/{epic-id}/{story-id}/`

## Touchpoint 1 — Wireframe Approval

After the UI designer produces renditions:

1. **Present renditions.** Show file paths and suggest the user open them:
   ```
   Wireframe renditions for "{story-title}":
     1. state/wireframes/{epic}/{story}/v1.png
     2. state/wireframes/{epic}/{story}/v2.png
     3. state/wireframes/{epic}/{story}/v3.png
   ```
   If Claude Code can read images (Read tool on PNG), present them inline.

2. **Ask for selection.** Use AskUserQuestion with options:
   - "Rendition 1" / "Rendition 2" / "Rendition N" — approve that version
   - "Request changes" — provide feedback, re-run UI designer with context
   - "More options" — generate additional renditions

3. **Iterate if needed.** On "Request changes" or "More options", pass the user's feedback to the UI designer and repeat from step 1. No limit on iterations — the user decides when to approve.

4. **Lock selection.** Once approved, record the selected rendition index.

## Touchpoint 2 — Story Brief Sign-off

After wireframe selection:

1. **Present the design brief.** Show the structured brief that will be embedded in the story YAML:
   - Screen name and layout description
   - Component list with positioning rationale
   - Interaction notes (tap targets, navigation, state changes)
   - Accessibility notes
   - Export command for downstream agents

2. **Ask for approval.** Use AskUserQuestion:
   - "Approve" — embed in story YAML
   - "Edit" — collect changes via Other/free-text, update brief, re-present

3. **Embed in story.** Once approved, append the `wireframes` section to the story YAML file.

## Story YAML Wireframes Section

Appended to the story file after approval:

```yaml
wireframes:
  approved: state/wireframes/{epic-id}/{story-id}/v{N}.png
  brief: |
    Structured design brief text describing layout decisions,
    component choices, and interaction patterns.
  export_command: |
    cli-anything-frame-zero --live export page --page-id "{page-id}" --format png --output state/wireframes/{epic-id}/{story-id}/approved.png
  renditions:
    - state/wireframes/{epic-id}/{story-id}/v1.png
    - state/wireframes/{epic-id}/{story-id}/v2.png
  selected: 1
```

This section gives the developer agent everything needed to implement the design:
- **approved** — path to the chosen wireframe image
- **brief** — text description of design decisions
- **export_command** — CLI command to re-export (if agent needs a fresh copy)
- **renditions** — all versions for reference
- **selected** — which rendition was approved

## Touchpoint Execution Context

- Touchpoints are **blocking** — planning halts until the user responds
- Touchpoints require **direct user access** — they must run in the main session or team lead, not in a background teammate
- The `AskUserQuestion` tool supports 2-4 options plus a free-text "Other" option
- For complex feedback, use "Other" to collect free-form text

## Integration with Workflows

The wireframe protocol is NOT a workflow step in `development.*.workflow.yaml`. It runs during **planning**, not execution. The plan command invokes the UI designer and runs touchpoints as part of story creation. By the time `/hive:execute` starts, stories already contain the `wireframes` section.
