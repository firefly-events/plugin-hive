# Step 2: Discover Tools

## MANDATORY EXECUTION RULES (READ FIRST)

- Do NOT assume any tool is available without running a check command
- Do NOT proceed to wireframing if Frame0 CLI is not found — STOP and report
- Do NOT silently fall back to text descriptions when Frame0 is expected
- Run each check command and record the result before moving on

## EXECUTION PROTOCOLS

**Mode:** autonomous

Execute all checks in sequence. Produce a tool report. Proceed only if minimum tooling is available (Frame0 CLI at minimum).

## CONTEXT BOUNDARIES

**Inputs available:**
- Screen list from step 1 (determines what tools are needed)
- System environment (PATH, running processes)

**NOT available:**
- Story spec (already consumed in step 1)
- Any .f0 files (not created yet)
- Codebase files (not relevant to tool discovery)

## YOUR TASK

Verify which design tools are available in the current environment and report capabilities.

## TASK SEQUENCE

### 1. Check Frame0 CLI

```bash
which cli-anything-frame-zero
```

Record: available (yes/no), path if found.

If NOT found: STOP. Report to orchestrator:
```
TOOL DISCOVERY FAILED: Frame0 CLI (cli-anything-frame-zero) not found in PATH.
Cannot produce wireframes without Frame0 CLI.
Options: install Frame0, or switch to text-based design briefs (requires user approval).
```

### 2. Check live export capability

If Frame0 CLI is available, check if the Frame0 desktop app is running:

```bash
cli-anything-frame-zero --live export page --help 2>&1 || echo "live mode unavailable"
```

Record: live export capability (yes/no).

- If live mode available: PNGs can be exported directly in step 6
- If live mode unavailable: step 6 will produce export commands for user to run

### 3. Check MCP tools

Scan the session's available MCP tools for:
- Image generation capabilities (for marketing assets or hero images)
- Any other visual tools

Record: image gen available (yes/no), tool names if found.

### 4. Produce tool report

```
TOOL REPORT:
  Frame0 CLI: {yes | no} at {path}
  Live export: {yes | no}
  Image generation: {yes | no} via {tool name}

  Capability summary:
  - Wireframing: {ready | not available}
  - PNG export: {direct | manual — user must run export commands}
  - Image gen: {available | not available}
```

## SUCCESS METRICS

- [ ] `which cli-anything-frame-zero` executed (not assumed)
- [ ] Live mode capability checked
- [ ] MCP tools scanned for image generation
- [ ] Tool report produced with all three capabilities listed
- [ ] If Frame0 CLI missing: workflow stopped with clear error message

## FAILURE MODES

- **Assuming Frame0 CLI exists without running `which`:** Leads to broken commands in steps 4-5. Always verify.
- **Not checking live mode:** Leads to failed `--live export` commands in step 6 when app isn't running.
- **Silently falling back to text descriptions:** User expects .f0 wireframes. If Frame0 isn't available, STOP and ask — don't produce a different artifact type without permission.
- **Checking tools by reading docs instead of running commands:** The environment may differ from documentation.

## NEXT STEP

**Gating:** Tool report is complete. Frame0 CLI is confirmed available.
**Next:** Load `workflows/steps/ui-design/step-03-plan-screens.md`
**If gating fails:** Frame0 CLI not found. Stop workflow and report to orchestrator/user.
