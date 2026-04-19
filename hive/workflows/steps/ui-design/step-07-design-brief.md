# Step 7: Design Brief

## MANDATORY EXECUTION RULES (READ FIRST)

- Produce one design brief per screen — not one brief for the whole feature
- Reference actual wireframe coordinates and shapes — do NOT generate briefs from story spec alone
- Include ALL states (loading, empty, error) for each screen
- Include accessibility notes for every screen
- The design brief is the primary handoff artifact to the developer agent — it must be implementation-ready

## EXECUTION PROTOCOLS

**Mode:** autonomous (during /hive:execute) or interactive (during /hive:plan)

### Autonomous mode
- Produce all design briefs and the final summary
- Write briefs to the wireframe directory

### Interactive mode
- Present each brief to user for review
- Wait for confirmation before finalizing
- User may request changes to individual briefs

## CONTEXT BOUNDARIES

**Inputs available:**
- Screen manifest from step 3 (layout plans, component hierarchy, coordinates)
- .f0 project from step 4 (wireframe file path)
- Wireframe shapes from step 5 (actual coordinates and components built)
- Export summary from step 6 (PNG paths)
- Design context from step 1 (colors, spacing, design tokens)

**NOT available:**
- Story spec (work from the manifest and wireframe artifacts)

## YOUR TASK

Produce one markdown design brief per screen that gives the developer agent everything needed to implement the UI without opening the wireframe.

## TASK SEQUENCE

### 1. Produce brief per screen

For each screen in the manifest, write a design brief following this format:

```markdown
## Screen: {ScreenName}

**Overview:** {One sentence describing the screen's purpose and context in the user flow.}

**Wireframe:** {path to .f0 file}, page: {PageName} (ID: {page-id})
**PNG:** {path to exported PNG or "pending export"}

### Layout

| Region | Position | Description |
|--------|----------|-------------|
| Header | y: 0-88 | {Content and visual treatment} |
| Content | y: 88-724 | {Content sections and scroll behavior} |
| Bottom nav | y: 724-812 | {Tab bar items and active state} |

### Components

| Component | Type | Position (x, y, w, h) | Purpose |
|-----------|------|----------------------|---------|
| {Name} | {rect/text/icon} | {x}, {y}, {w}×{h} | {What it does} |
| {Name} | {rect/text/icon} | {x}, {y}, {w}×{h} | {What it does} |

### Interactions

| Element | Trigger | Behavior | Navigation |
|---------|---------|----------|------------|
| {Element} | tap | {What happens} | → {destination screen or none} |
| {Element} | swipe | {What happens} | → {destination or none} |
| {Element} | input | {Validation, formatting} | — |

### States

**Default:** {Description of the normal, data-loaded state}

**Loading:** {What the user sees while data loads — skeleton, spinner, progressive}

**Empty:** {What the user sees when there's no data — illustration, message, CTA}

**Error:** {What the user sees on failure — error message, retry action}

### Accessibility

- **Touch targets:** {List any elements below 44×44px minimum — should be none}
- **Contrast:** {Color pairings used and whether they meet WCAG AA}
- **Screen reader:** {Label strategy for icons, images, and unlabeled elements}
- **Focus order:** {Tab/focus order for keyboard/switch access}
```

### 2a. Write briefs to file

Save all briefs to a single markdown file:
```
{wireframe_dir}/{feature-name}-design-briefs.md
```

Include a table of contents at the top listing all screens.

### 2b. Write briefs to stable canonical paths

In addition to the wireframe directory write above, write to these stable paths that downstream skills (visual-qa, design-review) depend on:

**Per-brief write:**
```
.pHive/design/briefs/{story-id}.md
```
Write the full design brief content for this story (same content as above).

**Manifest write (create or update):**
```
.pHive/design/index.yaml
```

If the file exists, load it and append the new entry. If it doesn't exist, create it. Format:

```yaml
updated_at: "{ISO 8601 timestamp}"
briefs:
  - story_id: "{story-id}"
    brief_path: ".pHive/design/briefs/{story-id}.md"
    wireframe_path: "{path-to-.f0-file}"
    export_paths:
      - "{path-to-png-1}"
    created_at: "{ISO 8601 timestamp}"
```

If a `story_id` entry already exists in the manifest, update it in place (re-run case). Otherwise append.

### 3. Produce final summary

This is the last step — produce the complete output summary:

```
UI DESIGN COMPLETE: {feature-name}

Artifacts:
  Wireframe:     {path to .f0 file}
  Design briefs: {path to briefs markdown}
  PNGs:          {count} exported ({count} pending)
    - {path-1}
    - {path-2}

Screens produced: {count}
  1. {ScreenName} — {one-line description}
  2. {ScreenName} — {one-line description}

Design context applied:
  Colors: {from existing design tokens}
  Patterns reused: {from existing components}
  Existing wireframes extended: {count, if any}

Ready for developer handoff.
```

## SUCCESS METRICS

- [ ] One design brief per screen in the manifest
- [ ] Each brief includes: layout table, component table with coordinates, interactions, all states, accessibility
- [ ] Coordinates in briefs match actual wireframe shapes from step 5
- [ ] Design tokens from step 1 referenced in briefs
- [ ] All briefs written to single markdown file
- [ ] Stable canonical paths written: `.pHive/design/briefs/{story-id}.md` and `.pHive/design/index.yaml` updated
- [ ] Final summary produced listing all artifacts

## FAILURE MODES

- **Generating briefs from story spec instead of wireframe:** Brief describes what SHOULD be built, not what WAS built. Reference actual coordinates and shapes.
- **Missing states:** Developer implements happy path only — no loading, empty, error handling.
- **Missing accessibility:** Shipped product fails accessibility requirements.
- **No coordinates in component table:** Developer has to guess at positioning — defeats the purpose of wireframing.
- **Briefs written to wrong location:** Developer agent can't find them.

## NEXT STEP

This is the final step in the UI design workflow. No next step.

**Output artifacts:**
1. `.f0` wireframe file (from step 4-5)
2. PNG exports (from step 6)
3. Design briefs markdown (from this step — wireframe dir)
4. `.pHive/design/briefs/{story-id}.md` — stable canonical design brief
5. `.pHive/design/index.yaml` — manifest of all briefs and wireframe exports

These artifacts feed into the developer agent during the implementation phase.
