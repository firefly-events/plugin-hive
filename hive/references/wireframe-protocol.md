# Wireframe Approval Protocol

This document defines the human-in-the-loop approval flow for wireframes. The UI designer agent creates wireframes; this protocol governs how the user reviews and approves them before they're embedded in story specs or design briefs.

## Canonical entry point

`/hive:design` is the canonical entry point that runs this protocol. It is callable two ways:

- **Standalone** — for ad-hoc UI exploration, mid-execution redesigns, and polish passes. No prior planning state is required.
- **/plan-delegated** — `/plan` Phase C step 16 (UI detection) invokes `/design` via an atomic external Skill call when a story matches the UI-keyword detection. `/plan` does NOT inline the wireframe ceremony.

See [`skills/design/SKILL.md`](../../skills/design/SKILL.md) for the full skill contract. This document defines the touchpoint protocol that skill applies.

## When This Runs

Whenever `/hive:design` runs — either standalone or delegated from `/hive:plan` during planning of a net-new UI story. The UI designer agent runs through the touchpoints below; wireframes are produced and approved **before** stories are finalized so by execution time developers already have the approved design context.

## Rendition Support

- **Default:** 1 rendition per screen/component
- **Configurable:** via story config field `renditions: N` or plan command flag `--renditions N`
- Each rendition is a layout/component variation of the same screen
- All renditions are exported to: `.pHive/wireframes/{epic-id}/{story-id}/`

## Touchpoint 1 — Wireframe Approval

After the UI designer produces renditions:

1. **Present renditions.** Show file paths and suggest the user open them:
   ```
   Wireframe renditions for "{story-title}":
     1. .pHive/wireframes/{epic}/{story}/v1.png
     2. .pHive/wireframes/{epic}/{story}/v2.png
     3. .pHive/wireframes/{epic}/{story}/v3.png
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
  approved: .pHive/wireframes/{epic-id}/{story-id}/v{N}.png
  brief: |
    Structured design brief text describing layout decisions,
    component choices, and interaction patterns.
  export_command: |
    cli-anything-frame-zero --live export page --page "{page-id}" --format png --output .pHive/wireframes/{epic-id}/{story-id}/approved.png
  renditions:
    - .pHive/wireframes/{epic-id}/{story-id}/v1.png
    - .pHive/wireframes/{epic-id}/{story-id}/v2.png
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

## Handoff Payload Contract

The wireframe handoff payload is the bundled artifact set that /design produces and downstream consumers (e.g., /design-review, manual review, future Hermes) consume. The payload shape is **extensible-minimum**: at minimum these three fields, downstream consumers MAY require additional fields, and new fields are add-only.

Minimum payload fields:

- `wireframe.png` — PNG render of the wireframe (always present)
- `wireframe.f0` — Frame0 source (always present)
- `constraints.md` — bundled accessibility + animations constraint notes (present when /design was invoked with `--include-constraints`, absent otherwise)

**Posture:** extensible-minimum. Downstream consumers MAY require additional fields. New fields are add-only and reversible — earlier consumers seeing fewer fields will not break. This posture was set by TPM escalation in outline-collab-review-record (cite: 'the minimum payload, d-5 is free to add fields if a downstream consumer surfaces a need during the manual exercise step').

When /design `--include-constraints` is ON, the `constraints.md` field is populated with the bundled accessibility-specialist + animations-specialist constraint notes produced by /design Phase A (d-1). When the flag is OFF, the `constraints.md` field is absent or empty; PNG + .f0 always ship.

The payload is **field-named** (not file-glob-based) so bundle composition cannot accidentally leak ui-designer working state. Only the three named fields above are part of the canonical minimum; additional fields require explicit naming.

**Q9 resolution** (design-discussion.md §6): "Wireframe-artifact handoff payload — PNG + `.f0` only, or include constraint doc from accessibility + animations?" Resolved: PNG + `.f0` + bundled constraint doc. Payload contract locked per user Q9 resolution and outline-collab-review-record researcher review.

**Artifact producers:** d-1 (Phase A, `/design` skill) produces the constituent constraint artifacts (`accessibility-constraints.md` + `animations-constraints.md`). d-3 (`design-mode-multica`) and d-4 (`design-mode-cc-workflows`) produce per-persona outputs that become the constituent artifacts. d-5 defines this payload shape — the bundle field names and extensible-minimum posture.
