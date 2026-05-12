## Required placeholders

- `{for each brief in scope:}`
- `{brief_path}`
- `{export_paths}`
- `{story_id}`
- `{export_path}`
- `{implementation-file}`
- `{line}`
- `{section}`
- `{description}`
- `{stories in scope}`
- `{impl-file}`
- `{discrepancy from design brief}`

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
   that implement the designed screens. Use the tech stack from .pHive/project-profile.yaml
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
