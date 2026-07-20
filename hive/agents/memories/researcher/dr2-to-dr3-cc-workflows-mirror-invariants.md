---
name: dr2-to-dr3-cc-workflows-mirror-invariants
description: When mirroring a Multica atom to cc-workflows, carry these 4 invariants verbatim; the no-codex lint will auto-verify.
applies_to: researcher
---

dr-2 (design-review-mode-multica) has a Step 0 that calls resolveMode() + Multica bootstrap. dr-3 replaces that with the Python worktree-preconditions helper + model-tier helper — same shell-out contract as plan-mode-cc-workflows Step 0 and test-mode-cc-workflows Step 0.

The 4 agent() calls (accessibility → animations → ui-designer critique → ui-designer synthesis) are preserved identically; only the dispatch substrate changes. --skip suppresses optional steps A+B only; --artifact-target is forwarded verbatim to Steps C+D. The s-3 lint at hive/scripts/lint-cc-workflows-no-codex.mjs auto-scopes to *-mode-cc-workflows/SKILL.md files — dr-3 lands in scope automatically the moment the SKILL.md is created.
