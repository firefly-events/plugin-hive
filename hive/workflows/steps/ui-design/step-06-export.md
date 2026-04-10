# Step 6: Export

## MANDATORY EXECUTION RULES (READ FIRST)

- Check the tool report from step 2 for live mode availability BEFORE attempting any export
- Do NOT attempt `--live export` if live mode was reported as unavailable
- If live mode is unavailable, produce export commands for the user to run — do NOT skip export entirely
- Verify each PNG file exists after export (if live mode)

## EXECUTION PROTOCOLS

**Mode:** autonomous

Check live mode from step 2, then either export directly or produce export commands.

## CONTEXT BOUNDARIES

**Inputs available:**
- .f0 project file from step 4 (file path)
- Page ID mapping from step 4 (screen name → page ID)
- Tool report from step 2 (live mode: yes/no)
- Screen manifest from step 3 (screen names for output file naming)

**NOT available:**
- Design brief content (that's step 7)
- Story spec (work from manifest and page IDs)

## YOUR TASK

Export each wireframe page as a PNG image, or produce the export commands for the user to run manually.

## TASK SEQUENCE

### 1. Determine export path

PNGs go alongside the .f0 file:
```
{wireframe_dir}/{feature-name}-{screen-name}.png
```

### 2a. If live mode available (from step 2 tool report)

For each page, run the export command:

```bash
cli-anything-frame-zero --live export page --page {page-id} --format png --output {output-path}
```

After each export, verify the PNG exists:
```bash
ls -la {output-path}
```

If export fails: record the error, continue with remaining pages, report all failures at the end.

### 2b. If live mode NOT available

Produce a script with all export commands for the user to run when Frame0 is open:

```bash
# Export commands for {feature-name}
# Run these with Frame0 desktop app open:
cli-anything-frame-zero --live export page --page {page-id-1} --format png --output {path-1}
cli-anything-frame-zero --live export page --page {page-id-2} --format png --output {path-2}
```

Save to `{wireframe_dir}/export-commands.sh`.

### 3. Produce export summary

```
EXPORT SUMMARY:
  Mode: {live export | manual commands}
  Pages exported: {count}

  Screen 1: {ScreenName}
    PNG: {path} ({exported | pending})
  Screen 2: {ScreenName}
    PNG: {path} ({exported | pending})
  ...

  Export commands file: {path to .sh file, if manual mode}
```

## COMMAND TEMPLATES

```bash
# Export page as PNG (live mode only)
cli-anything-frame-zero --live export page --page {page-id} --format png --output {output-path}

# Verify export
ls -la {output-path}
```

## SUCCESS METRICS

- [ ] Live mode checked from step 2 tool report (not re-tested)
- [ ] One PNG per screen exported (or one export command per screen if manual)
- [ ] Each PNG verified to exist after live export
- [ ] Export summary produced with paths and status
- [ ] If manual mode: export commands script saved to file

## FAILURE MODES

- **Attempting --live export without checking step 2 report:** Command fails if Frame0 isn't running.
- **Not verifying PNG exists after export:** Export may silently fail — always check.
- **Not providing fallback commands in manual mode:** User gets no wireframe output at all.
- **Exporting to wrong directory:** PNGs should be alongside the .f0 file, not in a random location.

## NEXT STEP

**Gating:** Export summary complete. All pages either exported or have export commands.
**Next:** Load `workflows/steps/ui-design/step-07-design-brief.md`
**If gating fails:** Report which exports failed. Step 7 can still proceed — design briefs don't require PNGs.
