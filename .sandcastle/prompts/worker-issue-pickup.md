# Context

<!--
  Sandcastle worker prompt — sandcastle-ops-layer / s2-sandcastle-worker-prompt.
  Each !`command` block runs inside the sandbox AT PROMPT-RENDER TIME.
  Stdout becomes the literal context the agent sees. Use this to pull live
  state from GitHub so the prompt template stays static.

  Label namespace (owned by S1 github-issues-adapter):
    hive:ready                  — published, unblocked, available for pickup
    hive:in-flight              — claimed by a worker
    hive:failed                 — worker failed; needs human review
    hive:epic:<epic-id>         — epic membership
    hive:story:<story-id>       — story identity (round-trip to YAML)
    hive:blocked-by:<story-id>  — open dependency

  promptArgs:
    FORCE_ISSUE — optional bare integer; if set, the runner is forcing a
                  specific issue (manual invocation). Empty string in cron path.
-->

## Open hive:ready issues (lowest-numbered first)

!`gh issue list --state open --label hive:ready --json number,title,labels,body --jq 'sort_by(.number) | .[] | "#\(.number) | \(.title) | labels=\([.labels[].name] | join(","))"' --limit 9999`

## Forced issue (manual invocation only)

FORCE_ISSUE = "{{FORCE_ISSUE}}"

## Recent merged PRs against dev/hive-2.0

!`gh pr list --state merged --base dev/hive-2.0 --json number,title,mergedAt --limit 10 --jq '.[] | "#\(.number) \(.mergedAt) \(.title)"'`

## Current branch

!`git rev-parse --abbrev-ref HEAD`

# Task

You are a hive worker. Your job is to pick **one** open hive:ready issue, ship
it via the existing `/hive:execute` skill, and emit a structured result.

Execute these steps in order. Do not skip, reorder, or improvise.

## Step 1 — Select the issue

If `FORCE_ISSUE` is a non-empty integer, use that issue number.

Otherwise, from the open hive:ready list above:

1. Discard any issue whose labels contain a `hive:blocked-by:<id>` entry.
2. From what remains, pick the **lowest-numbered** issue.
3. If nothing remains, emit `<promise>COMPLETE</promise>` with output:
   `{ "issue_number": null, "pr_number": null, "status": "idle", "reason": "no_ready_issues" }`
   and stop. Do not modify any state.

Call your chosen issue `<N>` for the rest of this prompt.

## Step 2 — Claim the issue

Run, in this exact order:

1. `gh issue edit <N> --remove-label hive:ready --add-label hive:in-flight`
2. Find the story YAML on disk: it lives at
   `.pHive/epics/*/stories/*.yaml` and has `external_id: <N>`. Use
   `grep -l "^external_id: <N>$" .pHive/epics/*/stories/*.yaml`. Read the file
   in full so you understand the story spec, depends_on, and acceptance
   criteria. Trust the YAML, not the issue body.

## Step 3 — Execute the story

Invoke the `/hive:execute` skill on the story you just read. Follow whatever
flow that skill prescribes (it owns developer/reviewer/tester orchestration).
Commit per hive conventions on a branch named `agent/issue-<N>` (sandcastle's
branchStrategy already placed you on that branch — verify with
`git rev-parse --abbrev-ref HEAD`).

## Step 4 — Ship (success path)

When the work is complete and committed:

1. `gh pr create --base dev/hive-2.0 --head agent/issue-<N> --title "<story title>" --body "Closes #<N>"`
   Capture the PR number from stdout — call it `<P>`.
2. `gh issue comment <N> --body "Shipped via PR #<P>."`
3. Emit `<promise>COMPLETE</promise>` with output:
   `{ "issue_number": <N>, "pr_number": <P>, "status": "shipped", "branch": "agent/issue-<N>" }`

## Step 5 — Failure path

If at any point the work cannot be completed (tests fail unrecoverably,
acceptance criteria can't be met, /hive:execute aborts, etc.):

1. `gh issue comment <N> --body "<redacted one-paragraph failure summary; no secrets, no tokens, no full stack traces>"`
2. `gh issue edit <N> --remove-label hive:in-flight --add-label hive:failed`
3. Emit `<promise>COMPLETE</promise>` with output:
   `{ "issue_number": <N>, "pr_number": null, "status": "failed", "reason": "<one-line cause>" }`

**Critical:** emit `<promise>COMPLETE</promise>` on the failure path too.
Sandcastle's completion signal terminates the iteration loop. Without it the
runner iterates to `maxIterations: 5`, burning quota for nothing.
Do not retry the issue — humans triage `hive:failed`.

# Done

When the task is complete (shipped, failed, or idle), output
`<promise>COMPLETE</promise>` to signal early termination. The runner uses
`Output.object` against the Zod schema in
`hive/lib/sandcastle-worker-schema.js` to parse your structured result, so
the JSON shape above is contract.
