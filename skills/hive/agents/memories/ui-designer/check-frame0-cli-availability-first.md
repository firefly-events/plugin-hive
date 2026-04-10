---
name: check-frame0-cli-availability-first
description: "always verify Frame0 CLI availability before starting wireframe work; silently proceeding without it produces unusable text-only outputs that fail the workflow"
type: pitfall
last_verified: 2026-04-10
ttl_days: 180
source: agent
---

The Frame0 CLI (`cli-anything-frame-zero`) is a required tool for wireframe production.
Before touching any design work, run the availability check:

```
which cli-anything-frame-zero
```

If the CLI is found: proceed with the normal wireframe workflow using .f0 files.

If the CLI is NOT found:
1. Check if the Frame0 desktop app is running (live export mode may still work)
2. If neither is available: activate the fallback mode — produce text-based layout specs
   and ASCII mockups instead of .f0 files. Note the fallback explicitly in your output.
3. Do NOT silently skip wireframes. Do NOT produce a design brief without acknowledging
   that wireframes could not be generated.

The fallback is defined in your persona's `required_tools` section:
"Produce text-based layout specs and ASCII mockups instead of .f0 files"

Why this matters: the visual-qa workflow and design-review workflow expect .f0 files or
PNG exports. If you skip wireframes silently, those workflows fail with no explanation.
Always declare the fallback so the orchestrator can decide whether to proceed or escalate.
