# Step 4: Create .f0 Project

## MANDATORY EXECUTION RULES (READ FIRST)

- NEVER use the Write tool to create .f0 files. NEVER hand-craft JSON. The .f0 format is managed exclusively by the Frame0 CLI. Hand-written JSON will not be registered by Frame0 desktop app and will be invisible to it.
- ONLY use `cli-anything-frame-zero` CLI commands from the Command Templates section below — do NOT construct commands from memory
- ALWAYS use `--live` flag when Frame0 desktop app is running (prefer live mode for immediate visual feedback)
- Do NOT use shell variable assignments (e.g., `PG1="abc"`) — they trigger permission prompts. Use literal values in every command.
- Do NOT proceed to building wireframes (step 5) until ALL pages are created and their IDs captured
- Create one page per planned screen from the manifest — no more, no less
- Capture page IDs immediately after creation using `page list`

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute commands in strict sequence. Capture all page IDs. Verify page count matches manifest before proceeding.

## CONTEXT BOUNDARIES

**Inputs available:**
- Screen manifest from step 3 (project name, page names, page count)
- Frame0 CLI availability from step 2 (confirmed available)

**NOT available:**
- Wireframe content (that's step 5)
- Export paths (that's step 6)
- Story spec (already consumed — work from the manifest)

## YOUR TASK

Create the .f0 project file and add one page per planned screen. Capture all page IDs for step 5.

## TASK SEQUENCE

### 1. Determine project file path

Use the project name from the screen manifest. Place the .f0 file in the wireframes directory specified by the story spec (typically `state/wireframes/{epic-id}/{feature-name}/`):

```
{wireframe_dir}/{feature-name}.f0
```

If the directory doesn't exist, create it first.

### 2. Create the project

```bash
cli-anything-frame-zero project new --name "{feature-name}"
```

This creates `{feature-name}.f0` in the current directory. Move it to the wireframe directory if needed.

### 3. Add pages (one per screen)

For each screen in the manifest, add a page. Run one command per page:

```bash
cli-anything-frame-zero --project {path/to/file.f0} page add --name "{ScreenName}"
```

Use PascalCase for page names (e.g., "CategorySelection", "EventDetail", "CreateEventForm").

### 4. List pages and capture IDs

```bash
cli-anything-frame-zero --project {path/to/file.f0} page list
```

This outputs page names and their IDs. Record the mapping:

```
PAGE ID MAPPING:
  ScreenName1 → {page-id-1}
  ScreenName2 → {page-id-2}
  ScreenName3 → {page-id-3}
```

### 5. Verify page count

Count pages from the list output. Compare against the screen manifest:
- If counts match: proceed
- If counts don't match: report the discrepancy. Do NOT proceed.

## COMMAND TEMPLATES

These are the ONLY commands you should use in this step. Copy and fill placeholders.

```bash
# Create project
cli-anything-frame-zero project new --name "{feature-name}"

# Add a page
cli-anything-frame-zero --project {file.f0} page add --name "{PageName}"

# List pages to get IDs
cli-anything-frame-zero --project {file.f0} page list
```

**NEVER** use these patterns:
```bash
# BAD — Writing JSON directly bypasses CLI and Frame0 won't register the file
Write tool → file.f0 with JSON content   # ABSOLUTELY FORBIDDEN

# BAD — variable assignment triggers permission prompt
F0="path/to/file.f0"
cli-anything-frame-zero --project "$F0" page add --name "Foo"

# BAD — multi-line with backslash triggers "contains newlines" prompt
cli-anything-frame-zero --project path/to/file.f0 \
  page add --name "Foo"
```

**ALWAYS** use single-line commands with literal values:
```bash
# GOOD — single line, literal values
cli-anything-frame-zero --project path/to/file.f0 page add --name "Foo"
```

## SUCCESS METRICS

- [ ] .f0 project file created at the correct path
- [ ] One page added per screen in the manifest
- [ ] `page list` executed and all page IDs captured
- [ ] Page count matches manifest screen count
- [ ] Page ID mapping recorded for step 5
- [ ] No shell variable assignments used
- [ ] All commands were single-line with literal values

## FAILURE MODES

- **CRITICAL — Writing .f0 JSON directly with Write tool:** Frame0 desktop app will not see the file. The CLI registers projects in Frame0's internal index. Hand-written JSON bypasses this entirely. ALWAYS use `cli-anything-frame-zero project new`.
- **Using shell variable assignments:** Triggers "command contains newlines" permission prompt for every subsequent command. Use literal values.
- **Not capturing page IDs:** Step 5 cannot add shapes without page IDs. Always run `page list` after creating pages.
- **Creating extra or missing pages:** Page count must match manifest exactly. Verify before proceeding.
- **Using multi-line commands with backslash continuation:** Triggers newline permission prompts. Keep commands on a single line.
- **Constructing commands from memory:** Use the command templates above. Wrong flags or syntax cause silent failures.

## NEXT STEP

**Gating:** .f0 file exists, all pages created, all page IDs captured, page count matches manifest.
**Next:** Load `workflows/steps/ui-design/step-05-build-wireframe.md`
**If gating fails:** Report what's wrong (missing pages, wrong count, missing IDs). Do not proceed.
