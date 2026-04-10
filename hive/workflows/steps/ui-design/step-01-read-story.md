# Step 1: Read Story and Discover Design Context

## MANDATORY EXECUTION RULES (READ FIRST)

- Read this entire step file before taking any action
- Do NOT start planning screens until you have completed design context discovery
- Do NOT read files outside the story spec and design context (no MAIN.md, no product briefs, no unrelated services)
- Do NOT assume the project has no existing wireframes — always check
- Do NOT skip the design context discovery even if the story spec seems self-contained

## EXECUTION PROTOCOLS

**Mode:** autonomous (during /hive:execute) or interactive (during /hive:plan)

### Autonomous mode
- Execute the task sequence without waiting for user input
- Produce the screen list and design context report as output artifacts
- Proceed to next step when all success metrics are met

### Interactive mode
- Present the screen list and design context to user for confirmation
- Wait for confirmation before proceeding
- If user identifies missing screens or incorrect context, update and re-present

## CONTEXT BOUNDARIES

**Inputs available:**
- Story spec YAML (the story being executed — provided by orchestrator)
- Project codebase (for design context discovery)

**NOT available (do not read or assume):**
- Other story specs in the epic (each story is self-contained)
- MAIN.md, GUIDE.md, or hive system files (not your concern)
- Product briefs or PRDs (unless referenced in story spec's `references` field)

## YOUR TASK

Extract wireframe targets from the story spec and discover the project's existing design context so new wireframes are consistent with the established design language.

## TASK SEQUENCE

### 1. Read the story spec

Read the story YAML file provided by the orchestrator. Extract:

- **Screens to wireframe:** Each distinct screen or screen state mentioned in `description` and `acceptance_criteria`
- **Components per screen:** UI elements mentioned (buttons, forms, cards, lists, modals, etc.)
- **Screen states:** Loading, empty, error, success states for each screen
- **User flow:** Navigation between screens (which screen leads to which)
- **Device target:** Phone, tablet, or desktop (from `context.tech_stack` or story description)

### 2. Design context discovery (MANDATORY)

Before planning any new wireframes, understand what already exists:

**a. Scan for existing wireframes:**
```bash
# Find all .f0 wireframe files in the project
find {codebase_path} -name "*.f0" -type f
```
- If existing .f0 files found: list them with their page names
- Check if any existing wireframe covers screens you're about to create
- If overlap found: flag it — you should extend/modify, not recreate

**b. Scan for existing design language:**
- Look for design token files: `find {codebase_path} -name "*theme*" -o -name "*tokens*" -o -name "*colors*" -o -name "*design*" | grep -E "\.(ts|js|json|yaml|css|scss)$"`
- Look for component libraries: check for directories named `components/`, `ui/`, `shared/`
- Look for existing screens: check for screen/page/view directories
- Extract: color palette, spacing values, typography, component patterns

**c. Produce design context report:**
```
DESIGN CONTEXT:
  Existing wireframes: {count} .f0 files found
    - {path}: {page names}
  Overlap with this story: {yes/no — list overlapping screens}
  Design tokens: {found at path | not found}
  Colors: {primary, secondary, background, text colors if found}
  Spacing: {base unit if found}
  Component patterns: {list of existing component types found}
  Device target: {phone | tablet | desktop}
```

### 3. Produce screen list

Combine story spec extraction and design context into a structured screen list:

```
SCREEN LIST:
  1. {ScreenName}
     - Components: {list}
     - States: default, loading, empty, error
     - Existing wireframe: {yes — path | no — new}
     - Design notes: {reference existing patterns}

  2. {ScreenName}
     ...

DESIGN CONTEXT SUMMARY:
  Reuse from existing: {what to carry forward}
  New patterns needed: {what doesn't exist yet}
  Color tokens: {to use in wireframes}
```

## SUCCESS METRICS

- [ ] All screens from story spec are identified (check against acceptance criteria — each criterion typically implies at least one screen or state)
- [ ] Design context discovery completed — existing .f0 files scanned
- [ ] Existing design tokens read (or confirmed not found)
- [ ] Overlap with existing wireframes flagged (if any)
- [ ] Screen list includes states (loading, empty, error) for each screen
- [ ] Device target identified

## FAILURE MODES

- **Not scanning existing wireframes:** Produces duplicate wireframes that don't match existing design language. This is the #1 failure mode observed in real runs.
- **Not reading design tokens:** Produces wireframes with arbitrary colors/spacing instead of project palette.
- **Missing screen states:** Developer gets wireframes for happy path only — no loading, empty, or error states.
- **Reading beyond story spec:** Scope drift — reading unrelated services, product briefs, or orchestrator files.
- **Assuming no existing wireframes exist:** Always check, even if the story doesn't mention them.

## NEXT STEP

**Gating:** Screen list is complete with design context. In interactive mode, user has confirmed the list.
**Next:** Load `workflows/steps/ui-design/step-02-discover-tools.md`
**If gating fails:** Report what's missing. Do not continue workflow.
