# Episode: s5-adoption-guide

**Story:** s5-adoption-guide
**Epic:** sandcastle-adoption-followon
**Agent:** technical-writer
**Date:** 2026-05-12
**Status:** complete

## Work done

Created `hive/references/sandcastle-adoption-guide.md` — the canonical end-user adoption guide for Sandcastle execution mode.

## Sections covered

1. Setup — pointer to `/hive:sandbox-setup` skill + checklist; auth.json mount semantics; key rotation V1 path; `printf` vs `--env-file` vs `printenv` anti-pattern.
2. Provider defaults — Podman default, Docker opt-in, `userns: false`, `.sandcastle/codex-config` mount, `@ai-hero/sandcastle >=0.5.10 <0.6.0` version pin.
3. userns:false macOS-dev-only caveat — moderate security finding carried from impl-audit; production Linux must not use `userns: false`.
4. Routing — `HIVE_EXECUTION_MODE=sandcastle` env var OR `execution.mode: sandcastle` in root `hive.config.yaml`; field-source precedence `env > config > default`.
5. Codex-path only — `claudeCode()` blocked by upstream #191; pointer to `.pHive/upstream-watch/sandcastle-191.md`.
6. Branch strategy and worktree lifecycle — `branchStrategy: { type: "branch", branch: storyId }`; split `wt.close()` ownership rule.
7. Log redaction — three forms covered (argv, Bearer header, JSON KV); V1 gaps: hyphenated headers (`X-API-KEY`), base64 secrets, `printenv` env-dump.
8. Hooks — Sandcastle lifecycle hooks are NOT Hive PreToolUse hooks; V1 surface is `host.onWorktreeReady` only.
9. .sandcastle/ gitignore — non-anchored rule scope warning (minor finding).
10. Sidecar bundles — V1 neither consumes nor produces; explicit neutral.
11. Warm pool — pointer to placeholder; V1 is fresh-sandbox-per-run.
12. Validation evidence — outcome class B (blocked-on-prereq); pointer to S4 results.

## Cross-links verified

All 8 referenced file paths confirmed on disk before commit.

## Insights

- Adoption guides for sandboxed modes benefit from a "what these hooks are not" section early — the Sandcastle/Hive PreToolUse confusion is the highest-probability reader error.
- V1 gap documentation (redaction regex, userns:false Linux caveat) belongs in the guide, not deferred to a separate findings doc — readers need it at the point of adoption.
