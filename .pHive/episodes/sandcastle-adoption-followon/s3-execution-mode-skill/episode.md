# Episode: s3-execution-mode-skill

**Story:** s3-execution-mode-skill  
**Epic:** sandcastle-adoption-followon  
**Branch:** feat/sandcastle-adoption-followon  
**Commit:** 072e678  
**Date:** 2026-05-12  
**Agent:** technical-writer

## What was done

Created `skills/hive/skills/execute-mode-sandcastle/SKILL.md` — the Sandcastle execution mode skill consumed by `/execute` after dispatch selects `sandcastle`.

## Acceptance criteria coverage

| AC | Status |
|---|---|
| Instructs callers to use `hive/lib/sandcastle-provider.js`, not inline `SandboxProvider` | PASS — Provider Construction section + Constraint summary |
| Fails before auth/hook/provider setup when version is below 0.5.10 | PASS — Required runtime preflight section, Step 1+2 of Process |
| Requires `wt.close()` for Sandcastle-created worktrees | PASS — Worktree Ownership section + Step 5 |
| Forbids `wt.close()` for legacy `.claude/worktrees/{story-id}` handed-in worktrees | PASS — Worktree Ownership section (verbatim wording included) |
| Sandcastle hooks described as lifecycle hooks, not Hive PreToolUse | PASS — Hooks section, first sentence |

## Key decisions captured

- Verbatim ownership wording from the work spec included exactly as specified.
- `claudeCode()` subscription lane deferred explicitly with upstream #191 reference.
- HostHookCmd constraints (`no sudo`, `no cwd`) surfaced in the Hooks section so callers don't hit wrapper throws.
- Ship gate (`.sandcastle/` gitignore) and setup precondition (`/hive:sandbox-setup`) both listed under Preconditions.
- Mirrored frontmatter + heading shape from `execute-mode-session/SKILL.md` and `execute-mode-team-cmux/SKILL.md`.

## Insights for reuse

- execute-mode SKILL files use a consistent pattern: frontmatter (name + description), opening "Atomic skill, NOT inline prose" disclaimer, then Invocation contract → Process steps → teardown.
- Preconditions and constraint summary tables (at top and bottom) are new to this mode — consider back-porting to other execute-mode skills if they acquire hard gates.
