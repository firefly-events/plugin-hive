---
name: no-codex-lint-scope-is-code-blocks-only
description: When auditing cc-workflows atoms for Codex routing, distinguish prose forbidding-language from code-block routing directives — the s-3 lint scope is fenced code blocks only.
applies_to: reviewer
---

The s-3 no-codex lint (hive/scripts/lint-cc-workflows-no-codex.mjs:163, 188) scans
fenced ``` code blocks only. Prose paragraphs that *forbid* Codex routing
("no Codex `agentType`", "do NOT pass `agentType: codex:codex-rescue`") are
intentionally exempt — they document the contract. The reviewer should grep for
agentType / codex:codex-rescue / agent_backends, then check each hit's CONTEXT
(prose vs code block, asserting vs forbidding) before flagging. Run the lint
directly to confirm (node hive/scripts/lint-cc-workflows-no-codex.mjs).
