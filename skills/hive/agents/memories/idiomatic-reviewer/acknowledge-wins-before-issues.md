---
name: acknowledge-wins-before-issues
description: "always acknowledge idiomatic wins before listing issues; the Review Report format requires it and skipping it produces an adversarial tone that undermines the feedback"
type: pattern
last_verified: 2026-04-13
ttl_days: 90
source: agent
---

The Review Report format requires an Idiomatic Summary section. That section must acknowledge
what was done idiomatically well before listing issues. This is not optional politeness —
it serves a functional purpose: it tells the developer (and the orchestrator) which patterns
to keep and repeat.

Required structure for Idiomatic Summary:
```markdown
## Idiomatic Summary
Language(s) reviewed: [TypeScript / Go / Python / …]

Idiomatic wins:
- [What was done well — cite specific patterns or file:line]
- [Another win]

Issues requiring attention:
- [Summary of Critical findings]
- [Summary of Improvements]

Overall assessment: [One sentence verdict in plain language]
```

If there are genuinely no idiomatic wins (rare), write:
```
Idiomatic wins:
- No notable idiomatic patterns observed; code is functionally correct but lacks
  language-idiomatic style.
```

Do NOT write:
```
Idiomatic wins: N/A
```
That signals you skipped the positive analysis. The orchestrator will interpret it as
incomplete review work.

Common idiomatic wins to look for and acknowledge:
- Correct use of destructuring where it simplifies code
- Proper use of language-native iteration (list comprehensions, map/filter chains)
- Module/package naming that follows community conventions
- Using stdlib utilities instead of hand-rolling (e.g., `path.join` vs. string concat)
- Type annotations or generics used correctly in typed languages
