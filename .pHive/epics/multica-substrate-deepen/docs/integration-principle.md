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

The invariant that matters is **execution serialness against the latest trunk** — not dispatch sequencing.

1. **Dispatch fanout is queue-ordering.** Today Multica has one bootstrapped agent per role (`developer`, `tester`, `reviewer`). Dispatching 5 issues at once enqueues 5 → the agent processes them one at a time. Execution is serial by single-agent bottleneck regardless of dispatch fanout. Swim-lane visualisation confirms: one ticket in_progress at any moment.

2. **Fresh-checkout at start-of-task.** Each agent's first action MUST be `git fetch origin <epic-branch> + git checkout <epic-branch> + git reset --hard origin/<epic-branch>` — synchronising the workdir to the *latest* trunk at execution time, not the snapshot taken when the issue was dispatched. Without this, agent N processes against the trunk-as-of-dispatch and misses agent N-1's commits even though it ran second. This was the actual bug observed in depth-1: 5 issues dispatched in parallel, executed serially, but each saw a stale snapshot.

3. **Rebase-then-push at end-of-task.** Every agent ends with `git fetch + git rebase + git push origin HEAD:<epic-branch>`. Retry up to 3 times on non-FF rejection. On rebase conflict: STOP and post the conflict diff as a comment — the parallel-dispatch gate let an overlap through and orchestrator must adjudicate.

4. **Final comment carries the SHA.** Agents post pushed commit SHA(s) in the final issue comment so orchestrator + telemetry can correlate Multica issue → trunk commit without scraping workdirs.

5. **Parallel dispatch is safe when execution is also serial.** Today this holds trivially — single agent per role. When multi-agent runtimes land (e.g. multiple developer instances), parallel dispatch becomes parallel execution and the non-overlap gate must hold:
   - `parallel_allowed: true` on every peer story
   - `parallel_rationale ∈ {read-only, bounded-slice}` with explicit declarative proof
     - `read-only` — modifies no production files (spikes, audits, reads)
     - `bounded-slice` — `files_to_modify` non-empty AND disjoint across peers
   - `variation` is NOT sufficient under the build-up principle — variation = different angles on the same surface = destroys coherence even when file-disjoint.

## What this changes for downstream tooling

- `serializeStoryBrief({ integrationBranch })` renders the contract in every brief — fresh-checkout-then-rebase-then-push baked in.
- The `multica` execute mode skill keeps depth-batched dispatch; serialness is enforced by the agent runtime (1 agent per role today) not the dispatch layer.
- The cron sweep no longer needs to cherry-pick from agent workdirs — `git pull --ff-only` surfaces what agents have pushed.
- Epic plans can still author depth-chains for build-up but don't need to artificially serialise sibling stories — execution-serialness gives that for free under today's runtime.

## Cost

No artificial throughput hit. Execution time = sum of per-story wall-clock × agents-per-role. With one developer agent today and ~5–15 min per story, 19 stories ≈ 2–5 hours wall-clock. The cost recovered relative to per-task branch + cherry-pick: orchestrator no longer scrapes workdirs, agent/* branch graveyard stops growing, history stays linear.

## When the principle re-tightens

If we ever spawn multiple developer agents (parallel runtimes per role), dispatch parallelism becomes execution parallelism. At that point rule 5 above is no longer trivially satisfied — the non-overlap gate must hold in practice, and a rebase-conflict signal becomes a runtime fault rather than a theoretical concern.
