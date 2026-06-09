---
name: agenttype-schema-vs-literal-lint-trap
description: When linting SKILL.md files for agentType: "codex:codex-rescue", distinguish schema-doc placeholders from actual routing literals.
applies_to: researcher
---

`plan-mode-cc-workflows/SKILL.md` line 221 contains `agentType: <default | codex:codex-rescue>` as a YAML schema template, not a routing call. A naive grep for `agentType:` will flag this line as a violation. The s-3 lint's AST check must target the pattern `agentType: "codex:codex-rescue"` (quoted string value) or `agentType: codex:codex-rescue` (unquoted) — both as actual assignments, not schema angle-bracket placeholders. A regex like `/agentType:\s*["']codex:codex-rescue["']/` avoids the false positive at schema-doc lines.
