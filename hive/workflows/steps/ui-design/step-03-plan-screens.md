# Step 3: Plan Screens

## MANDATORY EXECUTION RULES (READ FIRST)

- Plan ALL screens before creating ANY .f0 files
- Do NOT run any `cli-anything-frame-zero` commands in this step — this is planning only
- Do NOT skip screens that have existing wireframes — plan whether to extend, modify, or skip them
- Reference existing design patterns from the design context report (step 1)

## EXECUTION PROTOCOLS

**Mode:** autonomous (during /hive:execute) or interactive (during /hive:plan)

### Autonomous mode
- Produce the screen manifest based on story spec and design context
- Proceed to step 4 when manifest is complete

### Interactive mode
- Present the screen manifest to user for review
- Wait for user confirmation before proceeding
- User may add, remove, or modify planned screens

## CONTEXT BOUNDARIES

**Inputs available:**
- Screen list and design context report from step 1
- Tool report from step 2 (determines device frame capabilities)

**NOT available:**
- The actual .f0 project (not created yet — that's step 4)
- Other stories' wireframes (each story is independent)

## YOUR TASK

Create a detailed screen manifest that plans every screen's layout, component hierarchy, and coordinate positions before any Frame0 commands are executed.

## TASK SEQUENCE

### 1. Review inputs

Read the screen list and design context from step 1. For each planned screen, note:
- Is there an existing wireframe to extend? (from design context)
- What design tokens/patterns should be reused? (from design context)
- What device frame is needed? (from tool report)

### 2. Plan layout per screen

For each screen, define:

**Layout approach:**
- Header region (y: 0-88 on phone)
- Content region (y: 88-724 on phone)
- Bottom nav region (y: 724-812 on phone)
- Whether content scrolls or is fixed

**Component hierarchy (build order):**
```
Screen: {ScreenName}
├── Device frame (phone, 320×690)
├── Header (rect: 0, 0, 320, 76)
│   ├── Back button (icon: "arrow-left", 16, 38)
│   ├── Title (text: "{title}", 48, 38, font-size 18)
│   └── Action button (icon: "{icon}", 280, 38)
├── Content area
│   ├── Section 1 (rect: 0, 88, 375, {height})
│   │   ├── Component A (type, x, y, w, h)
│   │   └── Component B (type, x, y, w, h)
│   └── Section 2 (rect: 0, {y}, 375, {height})
│       └── Component C (type, x, y, w, h)
└── Bottom nav (rect: 0, 724, 375, 88)
    ├── Tab 1 (icon + text)
    ├── Tab 2 (icon + text)
    └── Tab 3 (icon + text)
```

### 3. Standard coordinate grid reference

Use these standard positions for phone wireframes (320×690):

```
┌─────────────────────────────────┐ y=0
│  Status bar (system)            │ y=38
├─────────────────────────────────┤
│  Header / Navigation bar        │ y=76
├─────────────────────────────────┤
│                                 │
│  Content area                   │
│  (left margin: 16px)            │
│  (content width: 288px)         │
│                                 │
├─────────────────────────────────┤ y=614
│  Bottom navigation / Tab bar    │ y=690
└─────────────────────────────────┘

Common component heights:
  Button: 44px (corner-radius 8-12)
  Input field: 44px (corner-radius 8)
  Card: 72-108px (corner-radius 12)
  List item: 48-64px
  Section header: 28px
  Spacing between elements: 8, 12, 16, or 24px
  Icon size: 24px (standard), 20px (small), 32px (large)
  Touch target minimum: 44×44px
```

### 4. Handle existing wireframes

For screens that overlap with existing .f0 files (from step 1 design context):
- **If existing wireframe covers the same screen:** Plan to open and modify the existing .f0 file instead of creating a new one. Note which shapes to add/change.
- **If existing wireframe covers a similar screen:** Plan to use it as reference for layout consistency, but create a new page.
- **If no existing wireframe:** Plan as new.

### 5. Produce screen manifest

```
SCREEN MANIFEST:

Project name: {feature-name}
Device: phone (320×690)
Pages: {count}
Design tokens: {colors, spacing from design context}

Screen 1: {ScreenName}
  Status: {new | extend existing at {path}}
  Layout: {description}
  Components: {count}
  Build order:
    1. frame --type phone --left 0 --top 0
    2. rect (header) --left 0 --top 0 --width 375 --height 88
    3. text (title) --content "{title}" --left 56 --top 44 --font-size 18
    4. icon (back) --icon-name "arrow-left" --left 16 --top 44
    ...
  States: default, loading, empty, error

Screen 2: {ScreenName}
  ...
```

The build order is the exact sequence of Frame0 CLI commands that step 5 will execute. Planning them here means step 5 is mechanical — it just runs the commands.

## SUCCESS METRICS

- [ ] Every screen from step 1's screen list has a layout plan
- [ ] Component hierarchy defined with approximate coordinates for each screen
- [ ] Build order specified per screen (exact sequence of shape types and positions)
- [ ] Existing wireframes handled (extend/reference/skip decisions made)
- [ ] Design tokens from step 1 referenced in the manifest
- [ ] No `cli-anything-frame-zero` commands were executed (planning only)

## FAILURE MODES

- **Starting Frame0 commands before planning is complete:** Produces inconsistent wireframes. Plan everything, then build everything.
- **Not planning ALL screens before starting ANY:** Leads to inconsistent layout decisions across screens.
- **Ignoring existing wireframes:** Produces duplicates that clash with established design language.
- **Not specifying coordinates:** Step 5 will guess at positions, producing overlapping or misaligned shapes.
- **Planning layout without considering states:** Missing loading/empty/error states means incomplete wireframes.

## NEXT STEP

**Gating:** Screen manifest is complete with build orders for all screens. In interactive mode, user has approved the manifest.
**Next:** Load `workflows/steps/ui-design/step-04-create-project.md`
**If gating fails:** Report incomplete screens. Do not proceed to Frame0 commands.
