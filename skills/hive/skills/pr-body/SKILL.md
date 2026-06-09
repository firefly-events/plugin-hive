---
name: pr-body
description: Author a PR body — a reviewer-first summary of what changed, why, and how it was verified, so reviewers don't have to read the diff to understand the change. Use when an agent ships a PR through Hive.
---

# Hive PR Body

Write a **reviewer-first PR body**: a reviewer should not have to read the diff to know
what changed, why, and how it was verified. Canonical structure:
[`hive/references/document-templates/pr-body.md`](../../../hive/references/document-templates/pr-body.md).
This skill makes its sections mandatory.

**Input:** the shipped change (diff/commits), the story/issue it closes, and the
verification that was run. `$ARGUMENTS` carries the issue/epic context.

## When to use

- An autonomous worker or any agent is opening a PR through Hive and needs its body written.

## Mandatory sections (produce in this order — see template for detail)

1. **Summary** — what changed and why, in prose a reviewer reads first.
2. **Touch points** — the files/areas changed, each with a one-line note on what changed there.
3. **Acceptance criteria coverage** — each AC from the story, mapped to how this PR satisfies it.
4. **Verification** — exactly what was run/checked (tests, manual steps) and the result.
5. **Risks / followups** — what could regress, what's deferred, what to watch.
6. **Notes for the reviewer** — where to focus, any judgment calls, anything non-obvious.

Include the `Closes #<issue>` link so the issue auto-closes on merge (a missing closes-link
strands shipped issues as zombies).

## Completeness gate (do not skip)

All 6 sections present. **Acceptance criteria coverage** and **Verification** are the
sections reviewers rely on most — never omit them. If verification was partial or skipped,
say so explicitly under Verification rather than implying full coverage. Confirm the
`Closes #N` link is present.

## Tone & style

Reviewer-first and honest. Report what was actually verified, not what should have been.
Concise but complete — the diff is the detail; this is the map.

## Output

The PR body text (passed to `gh pr create` or the worker's PR step), not a repo file.

## What this skill is NOT

- **Not the commit message.** Commits narrate the change history; this orients the reviewer.
- **Not marketing.** No overselling — accurate scope and honest verification status only.
- **Not a place to hide gaps.** Partial verification or deferred work is stated plainly.
