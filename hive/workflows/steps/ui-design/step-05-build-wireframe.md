# Step 5: Build Wireframe

## MANDATORY EXECUTION RULES (READ FIRST)

- NEVER use the Write tool to modify .f0 files. NEVER edit JSON directly. ALL wireframe changes go through `cli-anything-frame-zero` commands.
- ALWAYS use `--live` flag when Frame0 desktop app is running — the user wants to see wireframes build in real time
- Build shapes in strict order per screen: device frame → section containers → content elements → labels → icons
- NEVER skip the device frame — it is always the first shape on every page
- NEVER add content shapes before their container is created
- ONLY use CLI commands from the Command Templates section — do NOT construct commands from memory
- Do NOT use shell variable assignments — use literal values in every command
- Complete one screen fully before starting the next — do NOT jump between screens
- After every 5 shapes, verify with `shape list` to confirm shapes were created

## EXECUTION PROTOCOLS

**Mode:** autonomous

Build wireframes mechanically from the screen manifest's build order. Each command is pre-planned — execute them in sequence. Verify after each screen is complete.

## CONTEXT BOUNDARIES

**Inputs available:**
- .f0 project file from step 4 (file path)
- Page ID mapping from step 4 (screen name → page ID)
- Screen manifest from step 3 (build order with coordinates per screen)
- Design context from step 1 (colors, spacing, patterns to follow)

**NOT available:**
- Export functionality (that's step 6)
- Design brief content (that's step 7)

## YOUR TASK

Add wireframe shapes to each page following the build order from the screen manifest. Produce complete wireframes for all planned screens.

## TASK SEQUENCE

### 1. Confirm inputs

Before building, verify you have:
- .f0 file path: `{path}`
- Page IDs for all screens (from step 4 mapping)
- Build order for each screen (from step 3 manifest)

### 2. Build each screen (repeat for every page)

For each screen in the manifest, in order:

**a. Add device frame (ALWAYS FIRST)**

```bash
cli-anything-frame-zero --project {file.f0} shape frame --page-id {page-id} --preset phone --left 0 --top 0
```

For dark backgrounds, add `--fill "#1C1B1F"` (or use the project's background color from design context).

**b. Add section containers**

Create rectangles for major screen regions (header, content sections, bottom nav):

```bash
cli-anything-frame-zero --project {file.f0} shape rect --page-id {page-id} --left {x} --top {y} --width {w} --height {h} --corner-radius {r}
```

For colored sections, add `--fill "{color}"`.

**c. Add content elements**

Add text, icons, and images within the containers:

```bash
# Text
cli-anything-frame-zero --project {file.f0} shape text --page-id {page-id} --content "{text}" --left {x} --top {y} --font-size {size}

# Icon (search Lucide icons first if unsure of name)
cli-anything-frame-zero icon search "{keyword}"
cli-anything-frame-zero --project {file.f0} shape icon --page-id {page-id} --icon-name "{name}" --left {x} --top {y}

# Image placeholder
cli-anything-frame-zero --project {file.f0} shape rect --page-id {page-id} --left {x} --top {y} --width {w} --height {h} --corner-radius {r} --fill "#E0E0E0"
```

**d. Verify shapes (every 5 shapes or after completing a screen)**

```bash
cli-anything-frame-zero --project {file.f0} shape list --page-id {page-id}
```

Count shapes. Compare against manifest build order. If shapes are missing, investigate before continuing.

### 3. Standard phone coordinate grid

```
Phone frame: 375 × 812

y=0    ┌─────────────────────────┐
       │  Status bar area        │
y=44   ├─────────────────────────┤
       │  Header / Nav bar       │
y=88   ├─────────────────────────┤
       │                         │
       │  Content area           │
       │  x: 16 to 359 (margins)│
       │                         │
y=724  ├─────────────────────────┤
       │  Bottom nav / Tab bar   │
y=812  └─────────────────────────┘

Common widths:
  Full width:         375
  Content width:      343 (16px margins each side)
  Card width:         343 (16px margins)
  Half width:         167 (for 2-column grid with 9px gap)
  Third width:        109 (for 3-column grid with 8px gap)

Common heights:
  Button:             48 (corner-radius 8-12)
  Input field:        48 (corner-radius 8)
  Card:               80-120 (corner-radius 12)
  List item:          56-72
  Section header:     32 (font-size 14-16)
  Bottom sheet handle: 4 (corner-radius 2, centered)

Spacing:
  xs: 4    sm: 8    md: 12    lg: 16    xl: 24    xxl: 32

Touch targets: minimum 44×44 for all interactive elements
```

### 4. Handle screen states

For screens that need state variants (loading, empty, error):
- Create additional pages for each state OR
- Note the state in the design brief (step 7) with description of how it differs

The screen manifest from step 3 specifies which approach to use per screen.

## COMMAND TEMPLATES

These are the ONLY commands you should use. Copy and fill placeholders. ALL commands must be single-line with literal values.

```bash
# Device frame
cli-anything-frame-zero --project {file.f0} shape frame --page-id {page-id} --preset phone --left 0 --top 0

# Device frame with dark background
cli-anything-frame-zero --project {file.f0} shape frame --page-id {page-id} --preset phone --left 0 --top 0 --fill "#1C1B1F"

# Rectangle (containers, cards, buttons, input fields)
cli-anything-frame-zero --project {file.f0} shape rect --page-id {page-id} --left {x} --top {y} --width {w} --height {h} --corner-radius {r}

# Rectangle with fill color
cli-anything-frame-zero --project {file.f0} shape rect --page-id {page-id} --left {x} --top {y} --width {w} --height {h} --corner-radius {r} --fill "{color}"

# Text
cli-anything-frame-zero --project {file.f0} shape text --page-id {page-id} --content "{text}" --left {x} --top {y} --font-size {size}

# Icon (search first, then add)
cli-anything-frame-zero icon search "{keyword}"
cli-anything-frame-zero --project {file.f0} shape icon --page-id {page-id} --icon-name "{name}" --left {x} --top {y}

# Image placeholder (colored rect)
cli-anything-frame-zero --project {file.f0} shape rect --page-id {page-id} --left {x} --top {y} --width {w} --height {h} --fill "#E0E0E0"

# Verify shapes on a page
cli-anything-frame-zero --project {file.f0} shape list --page-id {page-id}
```

**FORBIDDEN PATTERNS:**
```bash
# BAD — shell variable
PG1="abc123"
cli-anything-frame-zero --project "$F0" shape rect --page-id "$PG1" ...

# BAD — multi-line with backslash
cli-anything-frame-zero --project file.f0 shape rect \
  --page-id abc123 --left 0 --top 0 ...

# BAD — command constructed from memory with wrong flags
cli-anything-frame-zero --project file.f0 shape add --type rect ...
```

## BEHAVIOR MATRIX

| Condition | Behavior |
|-----------|----------|
| Frame0 CLI command fails | STOP. Report the exact error and the command that failed. Do NOT retry with different flags. Do NOT improvise. |
| Shape list shows fewer shapes than expected | Investigate which command failed. Re-run the missing command. |
| Screen has more than 15 components | Build in batches of 5 shapes. Run `shape list` after each batch. |
| Design context specifies dark theme | Use `--fill "#1C1B1F"` on device frame and appropriate dark colors on containers. |
| Manifest specifies tablet or desktop frame | Use `--preset tablet` or `--preset desktop`. Adjust coordinates for larger canvas. |
| Icon name not found in Lucide search | Use closest match or a rect placeholder. Note in design brief. |

## SUCCESS METRICS

- [ ] Every page has a device frame as its first shape
- [ ] All components from the manifest's build order have corresponding shapes
- [ ] Shape list for each page shows expected component count
- [ ] Shapes are positioned within frame bounds (not outside 375×812 for phone)
- [ ] No shell variables or multi-line commands were used
- [ ] Each screen was completed fully before starting the next
- [ ] Design context colors/patterns were applied where specified

## FAILURE MODES

- **Skipping device frame:** All shapes render without a phone outline — wireframe is unreadable.
- **Using shell variable assignments:** Every subsequent command triggers a permission prompt, creating massive friction.
- **Adding content before containers:** Shapes overlap or have wrong z-order.
- **Jumping between screens:** Produces inconsistent screens with missing elements.
- **Not verifying with shape list:** Silently missing shapes that were never created.
- **Improvising CLI flags:** Using `--type` instead of `--preset`, wrong flag names, etc.
- **Shapes outside frame bounds:** Components render outside the phone outline.
- **Ignoring design context colors:** Wireframe doesn't match project's design language.

## NEXT STEP

**Gating:** All screens have complete wireframes. Shape list for each page matches the manifest build order. All screens completed sequentially.
**Next:** Load `workflows/steps/ui-design/step-06-export.md`
**If gating fails:** Report which screens are incomplete and which shapes are missing. Do not proceed.
