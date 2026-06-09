---
name: dispatch-skill-clone-pattern
description: When creating a new *-dispatch skill, clone design-dispatch/SKILL.md verbatim and swap only the varName and log-prefix strings.
applies_to: researcher
---

The execute-dispatch and design-dispatch skills share an identical Step 0/1/1.5/2 body — the only diff is `HIVE_EXECUTE_MODE` → `HIVE_DESIGN_MODE` and the INFO log prefix `[execute-dispatch]` → `[design-dispatch]`. A design-review-dispatch skill follows the same pattern: clone design-dispatch/SKILL.md, change varName to `HIVE_DESIGN_REVIEW_MODE`, update log prefix to `[design-review-dispatch]`, and update the Single Dispatch Point routing targets to `design-review-mode-multica` and `design-review-mode-cc-workflows`. The anchor comment `<!-- Structural mirror anchor: ... -->` at the top of design-dispatch should be replicated pointing at design-dispatch as its mirror parent (not execute-dispatch directly).
