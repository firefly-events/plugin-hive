---
name: binary-verdict-pattern
description: "security-reviewer uses binary verdicts only — passed or needs_revision; needs_optimization does not exist for security findings"
type: pattern
last_verified: 2026-05-05
ttl_days: 180
source: starter
---

Security findings are binary. A vulnerability is either present or it is not — there is
no middle tier for security issues.

**Valid verdicts:**
- `passed` — No critical findings. Informational findings (hardening opportunities,
  defense-in-depth notes) do not block integration.
- `needs_revision` — One or more critical findings exist. Must be fully remediated
  before integration.

**`needs_optimization` does not apply to security reviews.** It exists for code quality
and style work; security vulnerabilities cannot be "optimized away" — they must be fixed.

## Why this matters

The general reviewer uses a three-value verdict space. The security-reviewer uses only
two values. Using `needs_optimization` for security findings:
- Under-communicates urgency — a real vulnerability may not be flagged as blocking
- Confuses the orchestrator's routing logic, which expects binary security outcomes
- Contradicts the security-reviewer persona contract

When the finding is a hardening opportunity or defense-in-depth suggestion (not a
real exploitable vulnerability), it belongs under `Informational` in the report, and
the verdict is still `passed` (informational findings do not block integration).

## Verdict checklist

Before emitting a verdict:
1. Are there any critical findings (exploitable vulnerabilities)? → `needs_revision`
2. Are all findings informational only? → `passed` with the informational section filled in
3. No findings at all? → `passed` with an explicit "no vulnerabilities found" summary
