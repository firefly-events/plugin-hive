# Reviewer Node

## Purpose

Run a structured code review on the provided diff / PR / branch and commit the
review artifact (verdict + findings) to the working tree so the downstream
reconcile + gate nodes can validate it.

## Inputs

| Name              | Source  | Required | Notes                                          |
|-------------------|---------|----------|------------------------------------------------|
| `diff_target`     | context | optional | Branch, file list, or diff ref to review.      |
| `pr_number`       | context | optional | PR number when reviewing a pull request.       |
| `branch`          | context | optional | Branch name for `git diff main..branch` path.  |

## Behaviour

1. Resolve the diff using the same argument-parsing table as `skills/review/SKILL.md`.
2. Load `hive/agents/reviewer.md` persona, then resolve its verify skill binding with
   `hive.lib.skill_binding.resolve_skill_binding("hive/agents/reviewer.md", "verifying acceptance-criteria, fallback, and command/test evidence before code review")`.
   The call must resolve to `skills/verify/SKILL.md` — load that skill and invoke its
   Process against the acceptance criteria, diff, fallback claims, and command/test
   results gathered for this story. Emit `[info] verify skill-invoked: path=skills/verify/SKILL.md`
   as the skill-owned marker and record it on the step's episode output. Verify produces
   claim-by-claim evidence only; it does not compute a verdict and does not write
   `review.yaml`.
   **Fail closed:** if this resolve raises `SkillBindingError` (binding missing or the
   bound skill file is unreadable), this node fails without treating the missing
   evidence as a pass and without falling back to inline persona prose. The failure is
   subject to this node's own bounded retry below.
3. Resolve the review skill binding with
   `hive.lib.skill_binding.resolve_skill_binding("hive/agents/reviewer.md", "running any code review")`.
   The call must resolve to `skills/review/SKILL.md` — load that skill and invoke its
   Process phases as the governing procedure, passing the verify evidence from step 2
   as supporting input. The persona supplies identity, rubric, and output-format only.
   Emit `[info] review skill-invoked: path=skills/review/SKILL.md` as the skill-owned
   marker and record it on the step's episode output. Review remains the sole owner of
   `change_verdict` and `review.yaml` — verify evidence is consumed, never a competing
   verdict.
   **Fail closed:** if `resolve_skill_binding` raises `SkillBindingError` (binding
   missing or the bound skill file is unreadable), this node fails without falling
   back to inline persona prose. The failure is subject to this node's own bounded
   retry below — it is not a silent pass-through to a persona-only review.
4. Produce structured findings with a verdict: `passed`, `needs_optimization`, or
   `needs_revision`.
5. Commit the review artifact to the state dir:
   `${HIVE_STATE_DIR}/review-artifacts/{epic-id}/{story-id}/review.yaml`
6. Emit the committed SHA as `commit_sha` for the downstream reconcile node.

## Outputs

| Name              | Type   | Notes                                          |
|-------------------|--------|------------------------------------------------|
| `review_artifact` | string | Serialised review findings + verdict YAML.     |
| `commit_sha`      | string | SHA of the commit containing the artifact.     |
| `skill_invoked`   | json   | Resolved review-skill path(s) from step 3 (skill-owned marker) — a single path string, or a list of paths when the reviewer persona resolves more than one binding (`AgentHandler` stamps all resolved paths); absent if the node failed closed. |
| `verify_evidence` | string | Verify Evidence Report from step 2, plus its own `skill_invoked: skills/verify/SKILL.md` marker; absent if the node failed closed. |

## Retry

When the downstream gate (`gate-review-artifact`) fails, this node re-runs up to
`retry.max_attempts` times (default 3). Each retry is a fresh review pass — no LOOP
primitive.
