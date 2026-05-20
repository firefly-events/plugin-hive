# Episode: s1-gitignore-template

**Story:** s1-gitignore-template — Add .sandcastle/ to canonical gitignore  
**Timestamp:** 2026-05-12  
**Branch:** feat/sandcastle-adoption-followon  
**Commit SHA:** ce1f7ba

## Files Touched

- `.gitignore` — added `.sandcastle/` entry after `.claude/*.lock` (line 70)

## Verification Output

### git check-ignore
```
.gitignore:70:.sandcastle/    .sandcastle/logs/fake.log
```
Rule matched at line 70 of root `.gitignore`. Confirms `.sandcastle/` and all contents are ignored.

### git status (regression check)
No previously-tracked `.pHive/` planning artifacts became newly-ignored. The existing `.pHive/*` + negation whitelist rules are unaffected. `.pHive/metrics/**`, `.pHive/epics/meta-improvement-system/**`, and all other whitelisted subtrees continue to surface as untracked (correct behavior — they are un-ignored by negation rules).

## Security Gate Evidence

- Canonical template path confirmed: `/Users/don/Documents/plugin-hive/.gitignore` (no separate kickoff gitignore template exists in this repo).
- Rule is non-anchored (`sandcastle/` not `/.sandcastle/`) — matches `.sandcastle/` at any depth, consistent with how `.history/` and `agents/memories/` are written in this file.
- Both auth config and logs under `.sandcastle/` are covered by the directory-level ignore.

## Decision Notes

- Insertion point: after `.claude/*.lock`, before `__pycache__/` block — consistent with existing hidden-state/lock cluster.
- No negation rule needed: `.sandcastle/` contains only generated runtime state; no planning artifacts live there.
