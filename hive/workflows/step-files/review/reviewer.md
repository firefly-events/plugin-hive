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
2. Load `hive/agents/reviewer.md` persona and execute the review.
3. Produce structured findings with a verdict: `passed`, `needs_optimization`, or
   `needs_revision`.
4. Commit the review artifact to the state dir:
   `${HIVE_STATE_DIR}/review-artifacts/{epic-id}/{story-id}/review.yaml`
5. Emit the committed SHA as `commit_sha` for the downstream reconcile node.

## Outputs

| Name              | Type   | Notes                                          |
|-------------------|--------|------------------------------------------------|
| `review_artifact` | string | Serialised review findings + verdict YAML.     |
| `commit_sha`      | string | SHA of the commit containing the artifact.     |

## Retry

When the downstream gate (`gate-review-artifact`) fails, this node re-runs up to
`retry.max_attempts` times (default 3). Each retry is a fresh review pass — no LOOP
primitive.
