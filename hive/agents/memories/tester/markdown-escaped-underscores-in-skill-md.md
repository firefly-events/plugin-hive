---
name: markdown-escaped-underscores-in-skill-md
description: When regex-matching SKILL.md precedence strings, account for markdown-escaped underscores (root\_config stores as two bytes backslash+underscore).
applies_to: tester
---

SKILL.md files escape underscores for markdown rendering: `root\_config` appears in the file as two bytes `\_` (backslash + underscore). The regex `.` matches only one character, so `root.config` fails to match `root\_config` (two chars between `root` and `config`). Use `root.{1,2}config` instead of `root.config` in vitest regex assertions. Affects any line with `shipped_baseline`, `skill_override`, etc. Found in skills/hive/skills/design-review-mode-multica/test/resolver.test.mjs at the 5-tier precedence assertion.
