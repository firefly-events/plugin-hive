# GitHub Adapter — Friction Notes vs ABI 1.0.0

Recorded per the c-3 validator charter so downstream stories (c-4 Linear, c-2 spec revision) have explicit feedback to act on.

## 1. HTTP 422 has no clean ABI mapping

GitHub returns `422 Unprocessable Entity` for legitimate adapter failures that aren't well-covered by the 5-code adapter-emitted enum:

- Sub-issue link request rejected (e.g., circular parent, child already has a parent)
- `assignees` includes a login that isn't a collaborator
- Label string disallowed by repo policy

Current mapping: **`UNKNOWN_METHOD`** with a `(HTTP 422)` suffix on `message`. This is a stretch — `UNKNOWN_METHOD` is intended for missing handlers / version mismatches, not data validation failures.

**Recommendation:** c-2 spec should consider a 6th adapter-emitted code `VALIDATION_ERROR` (terminal, no retry) for "request well-formed but tracker rejected the payload." Without it, Hive's retry/escalation logic can't distinguish "your input was bad" from "your adapter has the wrong method table."

## 2. Sub-Issues API is alpha

The Sub-Issues endpoints (`/repos/{o}/{r}/issues/{n}/sub_issues`) are not yet GA. Concrete consequences:

- Header is the standard `application/vnd.github+json` (no preview header presently needed, but this could change).
- The endpoint takes the integer issue `id` (e.g., `1234567890`), **not** the human-facing `number` (e.g., `42`). The adapter does a 2-call sequence in `linkStories`: GET child issue → POST sub_issues with the resolved integer id.
- Discoverability is one-way: `sub_issue_of` shows up on the child issue in some response shapes but not others. The adapter reads `sub_issue_of` opportunistically when populating `parent_id` on `getStory` / `updateStatus`.

If the API moves to GA with a different shape, both shape mapping and the `linkStories` sequence may need adjustment.

## 3. `assignees` array vs ABI single `assignee_id`

GitHub Issues supports multiple assignees per issue; the ABI's `setAssignee` takes a single `assignee_id` (or `null` to clear). The adapter currently:

- Wraps the single id as a one-element array (`assignees: [assignee_id]`) on PATCH.
- For `null`, sends `assignees: []`.
- **Replaces** existing assignees — there is no ABI-level way to express "add this assignee without removing others."

For Hive's standup/ceremony use cases this is fine (single owner per story). But teams that already use GitHub's multi-assignee feature will see the adapter clobber the extras whenever Hive sets ownership.

**Recommendation:** future ABI minor bump could add an optional `coassignees` array param on `setAssignee` for trackers that support it. Currently no spec change requested — single-owner semantics are a deliberate simplification.

## 4. ABI `state` enum is coarser than GitHub's reality

The adapter declares `supported_states: ["open", "closed"]` because GitHub's state field is just those two. But GitHub *also* has:

- `state_reason` (`completed`, `not_planned`, `reopened`) — orthogonal to `state`
- Project-board column membership (Backlog, In Progress, Done) — entirely separate

These don't map cleanly to the ABI's flat `state` string. Linear-style `in_progress` / `in_review` workflow states are simply not expressible on this adapter without lying about `supported_states`.

Not a spec bug — it's an inherent mismatch with GitHub. Logged here so c-4 (Linear) and the unified-adapter view in c-5a are aware.

## 5. `team_field` / `project_field` semantics

The ABI says these are field *name declarations*. The adapter uses:

- `team_field: "owner"` — runtime `team_value` is the GitHub login or org name.
- `project_field: "repo"` — runtime `project_value` is the repo slug.

This works but is mildly counterintuitive: GitHub itself uses "Projects" (boards) and "Teams" (org sub-units), and neither maps to the ABI's team/project axis. Hive must pass repo coordinates rather than the GitHub "Project" or "Team" features users would think of.

Logged for clarity in c-5a wiring docs.
