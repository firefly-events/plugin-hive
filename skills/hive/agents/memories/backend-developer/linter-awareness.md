---
name: linter-awareness
description: "code agent must check team config for lint_commands and run linters before submitting changes"
type: pattern
last_verified: 2026-04-08
ttl_days: 90
source: starter
---

Before marking implementation complete, check the team config's
`context.lint_commands[]` for available linters. Run each lint command
against your changed files. Fix any violations before submitting — the
reviewer will flag lint failures as blocking issues.

If no `lint_commands` are configured, skip this step. Do not guess at
linter configuration that wasn't discovered during kickoff.
