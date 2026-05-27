# Integration Principle — single shared branch, default serial

This epic adopts a **single-shared-branch + default-serial** dispatch model. The principle is twofold: branching strategy AND build-up strategy.

## Branching dimension

All dispatched work commits directly to the epic branch (e.g. `feat/<epic-id>`). The Multica daemon's per-task `agent/developer/<task_id>` worktree branch is overridden in the brief — agents `git checkout` the epic branch, `reset --hard origin/<epic-branch>`, then commit + rebase + push back.

The rationale rejects all four alternatives explored in the design discussion:

- **Per-story branches + cherry-pick sweep** — brittle, depends on local workdir persistence, orchestrator becomes single point of failure
- **PR-per-story** — slow, costly (CodeRabbit per PR), 19+ PRs per epic
- **Agent opens PR + auto-merge** — adds CI dependency, branch-protection setup overhead
- **Daemon-side auto-PR** — upstream dependency, weeks-to-months timeline

Single shared branch is safe ONLY when the parallel-dispatch gate enforces non-overlap. Both must hold together.

## Build-up dimension

The deeper rationale is cognitive: parallel agents on isolated branches **cannot build on each other's work in real time**. Each one starts from a snapshot of the trunk taken at dispatch time and develops in isolation. When their branches reconverge at merge, integration is mechanical — but the *thinking* behind story N+1 never benefited from the *thinking* embedded in story N.

This is the same reason trunk-based development beat long-lived feature branches for human teams: not just the merge cost, but the loss of compounding context. AI agents pay the same tax, possibly worse — they have no informal channels (Slack threads, hallway conversations, code review back-and-forth) to discover what peers learned. The trunk IS the channel.

> We can't all be building the foundation at the same time in different areas. We need to work together. If we coalesce and build a structure, then we can figure out ways to build upon that structure in parallel.

## Operational rules

1. **Default serial.** Dispatch one story at a time. Each agent fetches the latest trunk before starting; their work becomes the trunk for the next agent. Compounding context is preserved.

2. **Parallel only when proven non-conflict.** Two conditions must BOTH hold:
   - `parallel_allowed: true` on every peer story (per-spec opt-in)
   - `parallel_rationale ∈ {read-only, bounded-slice}` with explicit declarative proof:
     - `read-only` — the work modifies no production files (spikes, audits, reads)
     - `bounded-slice` — `files_to_modify` is non-empty AND disjoint across peers
   - `variation` is NOT sufficient for the trunk-based model — variation means "different angles on the same surface," which destroys cognitive coherence even when file-disjoint.

3. **Rebase-then-push.** Every agent ends with `git fetch + git rebase + git push origin HEAD:<epic-branch>`. If push rejected: retry up to 3 times after re-fetching. If rebase conflicts: STOP and post the conflict diff as a comment — the parallel gate let an overlap through and orchestrator must adjudicate.

4. **Final comment carries the SHA.** Agents post their pushed commit SHA(s) in the final issue comment so orchestrator + telemetry can correlate Multica issue → trunk commit without scraping workdirs.

## What this changes for downstream tooling

- `serializeStoryBrief({ integrationBranch })` renders the contract in every brief.
- The `multica` execute mode skill's dispatch should default to serial — parallel only when ALL peer stories at the current depth carry the two-condition non-overlap proof.
- The cron sweep no longer needs to cherry-pick from agent workdirs — it just `git pull --ff-only` to surface what agents have pushed.
- Epic plans should err toward depth-chains (build-up) rather than wide-fanout (parallel breadth) when authoring story DAGs.

## Cost

The throughput hit is real: 19 stories serial at ~5–15 min each = several hours. But the alternative (parallel branch merge hell + lost cognitive compounding + orchestrator-side integration risk) has been observed to be worse in practice — both in this epic and in the broader plugin-hive history with isolated-branch agents that produced misaligned work needing later harmonization.
