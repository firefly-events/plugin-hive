# Sandcastle Ops Layer — Planning Memo (v2 — minimal)

**Date:** 2026-05-15
**Revision:** v2 — corrects v1 overbuild. Sandcastle already designs for GH-issue pickup.

---

## Sandcastle's native model (what we missed in v1)

From sandcastle README + `.sandcastle/prompt.md` template:

- Prompt files support `!\`command\`` syntax — shell commands run *inside the sandbox* at prompt-render time, output inlined into context.
- The shipped example explicitly demonstrates:
  ```
  !`gh issue list --state open --label Sandcastle --json number,title,body,labels,comments`
  ```
- `completionSignal: "<promise>COMPLETE</promise>"` (default) ends iteration.
- `Output.object(zodSchema)` returns structured result to caller.
- `branchStrategy: { type: "branch", branch: "agent/fix-42" }` gives per-agent branches with no caller coordination.

**Implication:** sandcastle is *intentionally designed* to be pointed at a labeled-issue queue. We don't build a dispatcher — we write a prompt that uses the pattern.

---

## What sandcastle does NOT provide

- **Scheduler / loop.** `sandcastle run` is one-shot. Caller decides how/when to invoke.
- **Concurrency policy.** Caller decides parallel vs serial.
- **Failure routing.** Caller reads result + decides.

These three are the only things we own.

---

## Minimal ops layer — three stories

### S1 — Story-to-Issue Adapter (outbound)
**File:** `hive/lib/external/github-issues-adapter.js`
- `/plan` post-step iterates finalized stories, calls `gh issue create` per story
- Title: `[<epic-id>/<story-id>] <story-title>`
- Body: rendered story YAML (acceptance criteria, deps, refs)
- Labels: `hive:ready`, `hive:epic:<id>`, `hive:story:<id>`, plus dependency labels
- Writes `external_id: <issue#>` back into story YAML
- Closing an issue is the signal that a downstream blocked-story becomes ready (use `hive:blocked-by:<id>` label, sweep on close webhook OR per-tick)

### S2 — Sandcastle Worker Prompt
**File:** `.sandcastle/prompts/worker-issue-pickup.md`

Skeleton:
```markdown
# Context
Open hive-ready issues:
!`gh issue list --state open --label hive:ready --json number,title,body,labels`

Recent merged PRs (for "what's just landed"):
!`gh pr list --state merged --limit 5 --json number,title,mergedAt`

Current branch:
!`git rev-parse --abbrev-ref HEAD`

# Task
You are a hive worker agent. From the open issues above:
1. Filter out any with `hive:blocked-by:*` labels pointing to still-open issues.
2. Pick the issue with the highest priority (label `hive:priority:*` if present, else lowest issue number).
3. Read the linked story YAML (`.pHive/epics/<epic>/stories/<story>.yaml`) for full spec.
4. Mark the issue `hive:in-flight` via `gh issue edit`.
5. Execute the story following the existing /hive:execute workflow.
6. Commit with the standard hive format.
7. Open a PR referencing the issue (`Closes #<n>`).
8. Comment on the issue with PR link + COMPLETE signal.

# Done
When PR is open and issue commented, emit `<promise>COMPLETE</promise>`.
On unrecoverable failure, comment the failure summary on the issue, mark `hive:failed`, emit `<promise>COMPLETE</promise>` anyway (loop should not retry without human review).
```

- Caller passes Zod-validated structured result: `{ issue_number, pr_number, status: "shipped" | "failed", reason? }`
- Branch strategy: `{ type: "branch", branch: "agent/issue-<n>" }` (sandcastle handles merge-to-head)

### S3 — Loop trigger
**Option A (default):** GitHub Actions workflow
- `.github/workflows/hive-worker.yml`
- Schedule: every 15 minutes via `cron: '*/15 * * * *'` + `workflow_dispatch`
- Single job: `npx sandcastle run --prompt .sandcastle/prompts/worker-issue-pickup.md`
- Concurrency group `hive-worker` with `cancel-in-progress: false` (serial by default)
- Token budget gate: query daily-spend before spawning (read `.pHive/metrics/...`)

**Option B (later):** local-host daemon for power-user mode. Not needed v1.

---

## What we do NOT build (vs v1 draft)

- ❌ Custom dispatcher daemon — sandcastle prompt + cron *is* the dispatcher
- ❌ Branch-lease coordination — `branchStrategy: branch` gives unique per-issue branches
- ❌ Worktree lifecycle code — sandcastle owns it
- ❌ Session-capture wiring — sandcastle defaults to on, JSONLs land in `~/.claude/projects/...` natively
- ❌ Custom `hive:dispatch` skill — replaced by the prompt file

---

## Risks (smaller surface now)

1. **`gh` auth in CI** — GH Actions ships `GITHUB_TOKEN`, scope it correctly (issues:write, pulls:write, contents:write). For local-host run, user's `gh auth` works.
2. **Token runaway** — same mitigation as v1: budget check before spawn (`hive.config.yaml.token_budget_limits`).
3. **Issue/story drift** — issue body is snapshot at create time; story YAML can update. Worker re-reads YAML inside sandbox at runtime (`!\`cat .pHive/epics/...\``), so it always sees latest. Issue body = pointer, not source of truth.
4. **Concurrency** — start serial (`cancel-in-progress: false` w/ single-job group). Parallel later, gated by per-epic lock label.
5. **Loop hang** — sandcastle has internal timeout config (`timeouts: {...}`); set worker iteration cap (`maxIterations: 5`) to bound.

---

## Open decisions

1. **Hosting:** GH Actions cron (default) vs local cron — recommend GH Actions for v1
2. **Cadence:** every 15 min (default) vs faster? — start 15m, tune from telemetry
3. **Concurrency cap:** serial (default) vs parallel-by-epic — serial first
4. **Failure policy:** auto-retry once vs human-on-first-fail — human-on-first-fail, mark `hive:failed`
5. **Where to commit prompt:** `.sandcastle/prompts/worker-issue-pickup.md` (default) vs as a skill — keep as plain file; sandcastle native consumes paths, not skills

---

## Epic shape

**"sandcastle-ops-layer"** — 3 stories, sibling of Epic D/E/F, lands on `dev/hive-2.0`.

- S1 — `github-issues-adapter` + `/plan` post-step
- S2 — Worker prompt template + Zod result schema
- S3 — GH Actions workflow + token-budget gate

Likely <1 week elapsed. Smaller than v1's 8-story shape.
