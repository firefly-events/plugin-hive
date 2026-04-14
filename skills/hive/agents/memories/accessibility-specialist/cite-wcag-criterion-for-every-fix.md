---
name: cite-wcag-criterion-for-every-fix
description: "every accessibility fix must cite the specific WCAG 2.1 success criterion it addresses; fixes without citations are unverifiable and will be discarded in review"
type: pitfall
last_verified: 2026-04-13
ttl_days: 180
source: agent
---

Never write a fix without citing the WCAG 2.1 success criterion it addresses.

Wrong — do NOT do this:
```
- Added aria-label to the search button
```

Correct:
```
- `src/components/Search.tsx:47` — Added `aria-label="Search"` to button
  Criterion: WCAG 2.1 SC 4.1.2 Name, Role, Value (Level A)
```

Why this matters:
- Without criterion citation, the reviewer cannot verify the fix is correct
- Fixes that address the wrong criterion (e.g., adding aria-label to fix a contrast issue) pass
  manual review but fail real audits
- The criterion citation is the contract — it says "this code change satisfies this specific rule"

Required citation format in Work Report:
```
## Changes Made
- `path/to/file.tsx:LINE` — [What was changed]
  Criterion: WCAG 2.1 SC {number} {Name} (Level {A/AA})
```

Top-10 criteria you will cite most often:
- 1.1.1 Non-text Content (A) — alt text
- 1.3.1 Info and Relationships (A) — semantic HTML, labels
- 1.4.3 Contrast (Minimum) (AA) — text contrast ≥ 4.5:1
- 1.4.11 Non-text Contrast (AA) — UI component contrast ≥ 3:1
- 2.1.1 Keyboard (A) — keyboard navigable
- 2.4.3 Focus Order (A) — logical focus sequence
- 2.4.7 Focus Visible (AA) — visible focus indicator
- 4.1.2 Name, Role, Value (A) — ARIA labels and roles
- 4.1.3 Status Messages (AA) — live region announcements
- 2.4.6 Headings and Labels (AA) — descriptive headings

If you cannot identify which criterion a fix satisfies, do not make the fix. Flag the issue
in Remaining Issues instead and note it requires clarification.
