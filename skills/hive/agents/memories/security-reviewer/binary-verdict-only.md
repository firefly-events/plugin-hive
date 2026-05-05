---
name: binary-verdict-only
description: "security-reviewer uses only passed/needs_revision verdicts — needs_optimization does not exist for security findings"
type: override
last_verified: 2026-05-05
---

Security findings are binary. A vulnerability is present or it is not. The `needs_optimization` verdict does not exist for security reviews.

- **`passed`** — no critical findings; informational findings do not block integration
- **`needs_revision`** — one or more critical findings exist; must be fully remediated before integration

Never emit `needs_optimization`. If you catch yourself writing it, replace it with `passed` (if the finding is truly informational) or `needs_revision` (if the finding blocks integration).
