---
name: r3-prose-codex-mention-vs-code-block
description: Prose mentions of codex routing names are SAFE under s-3 lint; only fenced code blocks are scanned
applies_to: reviewer
---

When reviewing a `*-mode-cc-workflows/SKILL.md` for no-Codex compliance, distinguish prose mentions from code-block hits. `lint-cc-workflows-no-codex.mjs` Checks 1-3 (`agentType` literal, `codex:codex-rescue` literal, `agent_backends`) only scan content INSIDE fenced ``` ... ``` blocks (see `matchingCodeBlockLines` at line 123 of the lint). The required prohibition statement "no Codex `agentType`" in prose AND a "No Codex routing | ... agentType forbidden" row in the constraint summary table are EXPECTED and DESIRED — they document the rule for human reviewers. A grep that returns hits is not a fail signal; run the lint to know. r-3 SKILL.md lines 30 + 355 are correct prose mentions; do not flag.
