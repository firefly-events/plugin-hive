---
name: markdown-lint-scope-code-blocks-only
description: Scope grep-style lint checks to fenced code blocks when the Markdown file also contains prohibition prose that mentions the forbidden pattern.
applies_to: developer
---

In SKILL.md atoms the same string (e.g., `codex:codex-rescue`, `agent_backends`) appears both in prohibition paragraphs ("do NOT use X") and in schema-doc placeholders inside code blocks. A full-file grep will false-positive on every prohibition sentence. Scope checks 2 and 3 to fenced ``` blocks only so existing prohibition prose stays green. Similarly, schema-doc placeholder values like `<default | codex:codex-rescue>` need an angle-bracket exclusion regex to avoid flagging them in check 1. See `hive/scripts/lint-cc-workflows-no-codex.mjs` lines for the `CODEX_RESCUE_PLACEHOLDER` pattern.
