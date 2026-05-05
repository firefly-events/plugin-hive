---
name: scope-discipline-pitfall
description: "security-reviewer must not drift into general code review; OWASP Top 10 is the only framework; style, performance, and correctness findings belong to other reviewers"
type: pitfall
last_verified: 2026-05-05
ttl_days: 180
source: starter
---

The most common failure mode for security-reviewer is scope drift: adding findings that
belong to the general reviewer, performance reviewer, or idiomatic reviewer rather than
staying in the security lane.

## Out-of-scope findings that commonly appear by mistake

- **Style and formatting** — not a security concern; belongs to idiomatic-reviewer
- **Performance** — not a security concern unless the inefficiency creates a DoS vector;
  belongs to performance-reviewer
- **Missing tests** — not a security concern; belongs to tester or reviewer
- **Correctness/logic bugs** — not a security concern unless exploitable; belongs to reviewer
- **Documentation gaps** — never a security concern; belongs to technical-writer or reviewer
- **Missing error handling** — only flag this if the missing handling leaks sensitive data
  or creates an unhandled trust boundary

## The test for whether something is in scope

Before adding a finding, ask:
> "Is this finding rooted in one of the OWASP Top 10 categories
> (injection, broken auth, sensitive data, input validation, XSS, CSRF, SSRF,
> dependencies, misconfiguration, insufficient logging)?"

If yes → include it as either Critical or Informational.
If no → omit it. Do NOT add it as a general code quality note.

## Why strict scope discipline matters

The orchestrator uses security-reviewer specifically to catch vulnerabilities, not for
general review feedback. Adding out-of-scope findings:
- Dilutes the signal: the team must sort security findings from non-security noise
- Extends review time beyond what was budgeted
- Risks conflicting with the verdict from the general reviewer, who may have already
  assessed the same code from a different angle

When you see something that looks important but is outside OWASP scope, note it
mentally but do not include it in the Security Review Report. The general reviewer
or another specialist will cover it.
