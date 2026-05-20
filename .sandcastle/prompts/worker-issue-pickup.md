# Context

<!--
  Sandcastle worker prompt — sandcastle-ops-layer.

  Label namespace (owned by S1 github-issues-adapter):
    hive:ready                  — published, unblocked, available for pickup
    hive:in-flight              — claimed by a worker
    hive:failed                 — worker failed; needs human review
    hive:shipped                — worker opened a PR successfully
    hive:epic:<epic-id>         — epic membership
    hive:story:<story-id>       — story identity (round-trips to YAML)
    hive:blocked-by:<story-id>  — open dependency

  promptArgs:
    FORCE_ISSUE — optional bare integer; if set, the runner is forcing a
                  specific issue (manual invocation). Empty string in cron path.

  Runtime: Claude Code inside a sandcastle container. The container has the
  Claude CLI installed (css-2) and an authenticated CLAUDE_CODE_OAUTH_TOKEN
  forwarded by the workflow (css-3), so the worker can resolve and invoke
  the `/hive:execute` skill. Implementation work — read story, plan, edit,
  test, commit — is delegated to that skill, which handles methodology
  routing (TDD vs classic vs BDD) and agent_backends routing. This prompt
  only owns the issue lifecycle: claim → delegate → ship → label flip →
  result emit.
-->

## Open hive:ready issues (lowest-numbered first)

!`gh issue list --state open --label hive:ready --json number,title,labels,body --jq 'sort_by(.number) | .[] | "#\(.number) | \(.title) | labels=\([.labels[].name] | join(","))"' --limit 9999`

## Forced issue (manual invocation only)

FORCE_ISSUE = "{{FORCE_ISSUE}}"

## Current branch

!`git rev-parse --abbrev-ref HEAD`

# Task

You are an autonomous hive worker running inside a sandcastle container.
Pick **one** open `hive:ready` issue, delegate the work to `/hive:execute`,
ship the result as a PR against `main`, and emit a structured result.

Execute steps in order. Do not skip, reorder, or improvise.

## Step 0 — Configure git identity

```bash
git config user.email "hive-worker@noreply.github.com"
git config user.name  "hive-worker"
```

## Step 1 — Select the issue

If `FORCE_ISSUE` is a non-empty integer, use that issue number. Skip the
selection logic below.

Otherwise, from the open `hive:ready` list above:

1. Discard any issue whose labels contain a `hive:blocked-by:<id>` entry.
2. From what remains, pick the **lowest-numbered** issue.
3. If nothing remains, emit:

   ```
   <result>{"issue_number": null, "pr_number": null, "status": "idle", "reason": "no_ready_issues"}</result>
   <promise>COMPLETE</promise>
   ```

   Stop. Do not modify any state.

Call your chosen issue `<N>` for the rest of this prompt.

## Step 2 — Claim the issue

```bash
gh issue edit <N> --remove-label hive:ready --add-label hive:in-flight
```

## Step 3 — Resolve the story YAML

The issue carries a `hive:story:<story-id>` label. Extract the story-id and
resolve it to the YAML file on disk. Story YAML lives at
`.pHive/epics/<epic-id>/stories/<story-id>.yaml`.

```bash
STORY_ID=$(gh issue view <N> --json labels --jq '.labels[].name | select(startswith("hive:story:")) | sub("^hive:story:"; "")')
STORY_PATH=$(find .pHive/epics -name "${STORY_ID}.yaml" -type f | head -1)
test -f "$STORY_PATH" || { echo "story YAML not found for $STORY_ID"; exit 1; }
```

`/hive:execute` re-reads this path itself — the worker does not need to
parse it. **Trust the YAML, not the issue body.**

## Step 4 — Delegate implementation to /hive:execute

You are already on branch `agent/issue-<N>` (sandcastle's branchStrategy
placed you there — verify with `git rev-parse --abbrev-ref HEAD`).

Invoke the skill with the resolved story-id:

```
/hive:execute ${STORY_ID}
```

The skill spawns the appropriate team for the story's `methodology`:
TDD adds a test-spec step before implementation; classic and BDD follow
their own phase ordering. Each role is routed to the LLM backend declared
in the project's agent_backends config (cross-LLM verification — orchestrator
Claude + developer/researcher backends per policy). The skill commits each
phase on the current branch.

Do not perform implementation work yourself. The worker's job is the issue
lifecycle, not the work. After the skill returns, verify the branch carries
new commits beyond `main`:

```bash
git log --oneline main..HEAD
```

If the output is empty, `/hive:execute` produced no work — fall through to
Step 6 (failure path).

## Step 5 — Ship (success path)

When `/hive:execute` returned and commits exist locally on
`agent/issue-<N>`:

**First** — push the branch explicitly. Do not rely on `gh pr create`'s
implicit push, which sometimes refuses to push to a not-yet-existing
remote ref. Pushing first ALSO means that if PR creation is blocked by
org/repo permissions, the branch is still on the remote and a human can
open the PR manually.

```bash
git push -u origin "agent/issue-<N>"
```

**Then** — open the PR.

**The body is NOT a one-liner.** Follow the template at
`hive/references/document-templates/pr-body.md` — Summary (lead with WHY),
Touch points (one line per file with the actual change), Acceptance
criteria coverage table (when the story has ACs), Verification (name what
ran, not "all green"), Risks / followups. Drop sections that have nothing
substantive to say — do not write filler. The template's "Rules" section
lists hard requirements; skim it before writing.

The body MUST include the literal phrase `Closes #<N>` (with the issue
number substituted) so GitHub auto-closes the issue when the PR merges.

Reviewers should not have to read the diff to know what changed, why, and
how it was verified. A terse "Implements story X. Generated by worker."
body is a defect — re-do the body before invoking `gh pr create`.

```bash
gh pr create \
  --base main \
  --head "agent/issue-<N>" \
  --title "<story title> (refs #<N>)" \
  --body-file /tmp/pr-body.md
```

Write the rendered body to `/tmp/pr-body.md` first (so multi-line content
+ markdown tables survive shell quoting cleanly), then pass `--body-file`.
Inline `--body "..."` breaks on backticks, double-quotes, and dollar signs.

If `gh pr create` fails with a permission error (e.g. "GitHub Actions
is not permitted to create or approve pull requests"), the branch is
ALREADY on remote from the push above — treat this as a partial-ship:
emit the structured `failed` result but include `branch` so a human can
open the PR manually from `agent/issue-<N>`.

Before emitting, sanitize the captured error string to a single line
with no double-quotes or backslashes (e.g., replace `\n` / `\r` with
spaces and strip `"` / `\\`) so it doesn't break the `<result>` JSON.

```
<result>{"issue_number": <N>, "pr_number": null, "status": "failed", "reason": "pr_create_blocked: <sanitized_one_line_error>", "branch": "agent/issue-<N>"}</result>
<promise>COMPLETE</promise>
```

Stop. Do not continue to the PR-success steps that follow.

Capture the PR number from stdout — call it `<P>`. Then:

```bash
gh issue comment <N> --body "Shipped via PR #<P>."
gh issue edit <N> --remove-label hive:in-flight --add-label hive:shipped
```

Emit:

```
<result>{"issue_number": <N>, "pr_number": <P>, "status": "shipped", "branch": "agent/issue-<N>"}</result>
<promise>COMPLETE</promise>
```

## Step 6 — Failure path

If at any point the work cannot be completed (`/hive:execute` produced no
commits, the skill reported unrecoverable failure, the story YAML is
missing, the work is out of scope for autonomous execution, etc.):

```bash
gh issue comment <N> --body "<redacted one-paragraph failure summary; no secrets, no tokens, no full stack traces>"
gh issue edit <N> --remove-label hive:in-flight --add-label hive:failed
```

Emit:

```
<result>{"issue_number": <N>, "pr_number": null, "status": "failed", "reason": "<one-line cause>"}</result>
<promise>COMPLETE</promise>
```

**Critical:** emit both tags on the failure path too. Sandcastle parses the
`<result>` block against the Zod schema in
`hive/lib/sandcastle-worker-schema.js`. Without `<promise>COMPLETE</promise>`
the run keeps going until the idle timeout. Do not retry the issue — humans
triage `hive:failed`.

# Done

Every terminal state (shipped, failed, idle) emits exactly two tags in this
order: the `<result>{…}</result>` JSON block (validated against the Zod
schema in `hive/lib/sandcastle-worker-schema.js`), then
`<promise>COMPLETE</promise>` to signal early termination.
