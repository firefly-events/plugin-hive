---
name: one-screen-per-page-canonical-naming
description: "each screen in the screen list gets exactly one Frame0 page, named identically to the screen list entry — deviations break visual-qa and design-review workflows"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

The mapping rule: one screen in the screen list = one page in the Frame0 project, with
the page name matching the screen list entry exactly (same case, same punctuation).

Why canonical naming matters:
- The visual-qa workflow matches design briefs to .f0 pages by name
- The design-review workflow organizes critique by screen name
- Mismatched names cause "page not found" errors in both downstream workflows

Correct pattern:
- Screen list entry: "User Profile — Edit Mode"
- Frame0 page name: "User Profile — Edit Mode" (exact match)
- Design brief section: "User Profile — Edit Mode" (exact match)

Wrong patterns to avoid:
- "Profile Edit" (abbreviated — doesn't match)
- "user-profile-edit" (slugified — doesn't match)
- "Screen 3" (numbered — loses meaning)
- Combining two screens into one page (breaks the 1:1 mapping)

After creating each page: confirm the page name matches by running:
```
cli-anything-frame-zero --project {file} page list
```
If a name doesn't match: rename the page before moving to the next screen.
