# Sandboxing Patterns for Parallel Agent Work

When multiple dev teams work on independent stories in parallel, they need filesystem isolation to avoid conflicting changes. This reference covers the recommended approach using git worktrees.

## Recommended: Git Worktrees

Git worktrees create linked working directories sharing the same `.git` object database. Each worktree has independent files but shared history and refs.

**Why worktrees:**
- Near-instant creation (no `git clone` overhead)
- Shared git objects = minimal disk for git data
- Claude Code has native support (`EnterWorktree` tool)
- Each agent team gets its own working directory

### How the Orchestrator Uses Worktrees

When spawning parallel dev teams:

1. **Create worktree per team:**
   ```bash
   git worktree add .claude/worktrees/{story-id} -b hive/{story-id}
   ```
   Each team gets a fresh branch based on the current HEAD.

2. **Assign worktree to team:**
   The team lead's agent session uses `EnterWorktree` or is launched with `cwd` pointing to the worktree path.

3. **Teams work independently:**
   Each team reads/writes files in their worktree without affecting others.

4. **Merge on completion:**
   When a story completes, the orchestrator merges the story branch back:
   ```bash
   git checkout main
   git merge hive/{story-id} --no-ff -m "Merge story: {story-id}"
   ```

5. **Cleanup:**
   ```bash
   git worktree remove .claude/worktrees/{story-id}
   git branch -d hive/{story-id}
   ```

### Conflict Resolution

If two stories modify the same file:
- The first to merge wins
- The second gets a merge conflict
- The orchestrator can: auto-resolve (if trivial), re-run the story in the merged state, or escalate to human

### Limitations

- **Cannot check out the same branch in two worktrees.** Each story gets its own branch.
- **node_modules/build artifacts not shared.** Each worktree needs its own `npm install`. Mitigate with pnpm global virtual store (`enableGlobalVirtualStore: true` in `.npmrc`).
- **Database/Docker state not isolated.** Shared daemon, ports, caches. Stories touching shared services need sequential execution.
- **Disk consumption.** Build artifacts per worktree add up. Clean up promptly after merge.

## When to Use Worktrees

| Scenario | Use Worktrees? |
|----------|---------------|
| Two stories editing different files | Yes — parallel is safe |
| Two stories editing the same module | Maybe — risk of merge conflicts |
| Stories touching shared services (DB, Docker) | No — run sequentially |
| Stories that are all documentation/config | No — too lightweight, coordination overhead isn't worth it |

## When NOT to Use Worktrees

Per the team evaluation criteria in `agents/orchestrator.md`:
- If the work is editing markdown/YAML/config
- If all stories require the same skill type
- If a single agent can finish faster than the coordination overhead

Worktrees are for **real parallel code implementation** — multiple agents writing code in different parts of the codebase simultaneously.

## Alternative: Docker Devcontainers

For stronger isolation (untrusted generated code, network isolation):
- Use Claude Code's reference devcontainer setup
- Each container gets its own filesystem, network, and process space
- Heavier than worktrees but stronger guarantees
- See the research at `/Users/don/Documents/project-hive/docs/research/agentic-sandboxing-parallel-execution.md`

## Claude Code Native Support

Claude Code's `EnterWorktree` tool creates worktrees at `.claude/worktrees/` with auto-generated branch names. The orchestrator can use this directly or create worktrees manually for more control over branch naming.
