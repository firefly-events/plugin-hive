---
name: d4-insight-capture-suffix-line-split
description: When testing SKILL.md string presence, prose phrases can be split across lines — use regex with `si` flags instead of toContain for multi-word mandatory-phrase assertions.
applies_to: tester
---

SKILL.md at `skills/hive/skills/design-mode-cc-workflows/SKILL.md` line 192 has
`Insight-capture suffix (MANDATORY` as a section heading — the words "insight-capture"
and "suffix" appear contiguously but the "MANDATORY" qualifier is parenthetical on the
same line. When writing a test that checks "insight-capture suffix is MANDATORY", use
`toMatch(/MANDATORY.*insight-capture|insight-capture.*MANDATORY/si)` rather than
`toContain('insight-capture suffix (MANDATORY')` to avoid fragility from formatting changes.
The same pattern applies to any cc-workflows SKILL.md with prose that may wrap or use
parenthetical qualifiers in headings.
