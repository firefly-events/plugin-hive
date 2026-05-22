# Primitive Spike Evidence — team-cell-execution-mode

**Author:** developer agent (tce-1 implement step)
**Date:** 2026-05-22
**Branch:** feat/team-cell-execution-mode
**Throwaway issues:** PLU-44 (parent), PLU-45–48 (children, option a), PLU-49 (option b v1), PLU-50 (option b v2)

---

## Scope-Probe Result

**`workflow` OAuth scope is ABSENT.**

```
gh auth status output (2026-05-22):
  Token scopes: 'admin:public_key', 'delete_repo', 'gist', 'read:org', 'repo'
  — 'workflow' NOT listed
```

The prerequisite chore (`chore:multica:auth-refresh-workflow-scope`, documented in
[tce-0-f5-oauth-scope-prereq](../stories/tce-0-f5-oauth-scope-prereq.yaml)) has not
been run.

**Runbook:** Before tce-7 dispatch can proceed on CI-touching stories, run:
1. `multica setup` (or re-run GH OAuth flow with `workflow` scope selected)
2. Verify: `gh auth status | grep workflow` — must show `workflow` in token scopes
3. Reference: story `tce-0-f5-oauth-scope-prereq` for full context

This does NOT block the spike itself (no GH push required for primitive validation
of options a/b/c). It DOES block tce-7 epic dispatch for any CI-workflow-touching story.

---

## Option (a) — Parent issue + child issues per workflow-phase

### Evidence

**Spike issues created (throwaway):**

| Role | Identifier | ID (prefix) | parent_issue_id |
|------|-----------|-------------|-----------------|
| parent (container) | PLU-44 | fe51d841 | null |
| research child | PLU-45 | 0918eeed | fe51d841... ✓ |
| implement child | PLU-46 | d8333bac | fe51d841... ✓ |
| test child | PLU-47 | 557a6e34 | fe51d841... ✓ |
| review child | PLU-48 | 22dfec6b | fe51d841... ✓ |

**CLI commands exercised:**

```sh
# Create parent (no assignee — pure container)
multica issue create \
  --title "[SPIKE] parent" \
  --project d23d0d43-... \
  --output json
# → parent_issue_id: null, assignee_id: null ✓

# Create child (per phase)
multica issue create \
  --title "[SPIKE] child: research" \
  --project d23d0d43-... \
  --parent fe51d841-a75c-4ca9-9787-7eb6d946971b \
  --output json
# → parent_issue_id: fe51d841... ✓

# Assign child to role agent
multica issue update d8333bac-... --assignee developer --output json
# → assignee_id: d9946f9a... (developer), parent_issue_id unchanged ✓
```

**Querying children:** No dedicated `--parent` filter on `issue list`. Must fetch full
list and filter client-side by `parent_issue_id`:

```sh
multica issue list --output json | jq '[.issues[] | select(.parent_issue_id == "<parent-uuid>")]'
```

4 children returned correctly after filtering.

### Findings

- `--parent <uuid>` on `issue create` correctly sets `parent_issue_id` on the child.
- Parent issue is a valid "pure container": no assignee required, no task run triggered.
- Each child has an independent `--assignee` (any agent UUID or name).
- Parent-child relationship is persistent and queryable (via full-list filter).
- No CLI limit on number of children per parent observed (created 4, no error).
- `project_id` carries through from parent → is NOT inherited; must be set explicitly
  on each child via `--project`.

### Conclusion

**Option (a) is viable on Multica 0.3.4.** End-to-end confirmed: parent issue as
container + N child issues per workflow-phase, each independently assigned to a role
agent. This is the sole primitive that cleanly maps one workflow-phase → one Multica
issue → one episode marker (per-phase marker contract intact).

---

## Option (b) — Sequential reassignment via `multica issue update --assignee`

### Evidence

**Spike issues:**

| Identifier | ID (prefix) | Scenario |
|-----------|-------------|----------|
| PLU-49 | db555b69 | backlog → reassign → promote to todo |
| PLU-50 | f3e1de69 | create todo+developer → reassign to tester |

**Scenario 1 — PLU-49 (backlog → reassign → promote):**

```sh
# Created: --status backlog --assignee developer → 0 runs
multica issue update PLU-49 --assignee tester    # reassign while backlog → 0 runs
multica issue status PLU-49 todo                 # promote to todo → STILL 0 runs
# After 30s: runs count = 0
```

**Scenario 2 — PLU-50 (create todo → reassign):**

```sh
# Created: --status todo --assignee developer → 1 run (queued immediately)
multica issue update PLU-50 --assignee tester
# After 8s: runs count = 2
#   run 0: status=running  created=2026-05-22T18:59:54Z  (tester, new)
#   run 1: status=cancelled created=2026-05-22T18:59:08Z (developer, cancelled)
```

### Findings

- `--assignee` mutation on a `todo` issue **does** spawn a fresh task run immediately.
  Previous run for the prior assignee is **cancelled** by the daemon.
- `--assignee` mutation on a `backlog` issue does NOT spawn a run.
- Promoting from `backlog` to `todo` (status-only, no assignee change) does NOT spawn
  a run — even if a valid assignee is set.
- Trigger rule: `(assignee_change) AND (status == todo)` → new run fires.
- All phases share one issue ID → one issue history → per-phase episode markers would
  need to be distinguished by phase name (e.g., `multica-run-research.yaml` vs
  `multica-run-implement.yaml`) rather than by issue UUID.

### Conclusion

**Option (b) is viable as a fallback for failure recovery, with constraints:**

1. The issue must remain in `todo` status throughout the phase sequence.
2. Each phase transition is a `multica issue update --assignee <next-role>` call.
3. The marker contract is satisfied only if `writeMulticaRunEpisode` is extended to
   support a `phase` parameter (per design §10 H1) — otherwise all phases write the
   same `multica-run.yaml` filename, overwriting prior phase records.
4. **NOT preferred over option (a)** for the primary workflow: shared issue ID conflates
   phase history, complicates rollup, and increases marker-collision risk.
5. **Use case:** failure recovery only — if a child issue in option (a) reaches a
   terminal-failed state and needs to be retried under a different assignee, option (b)
   provides a mutation path without creating a new issue.

---

## Option (c) — Multica session / sessions primitive

### Evidence

```sh
multica --help
# CORE COMMANDS: agent, autopilot, issue, label, project, repo, skill, squad,
#                workspace
# RUNTIME COMMANDS: daemon, runtime
# ADDITIONAL: attachment, auth, config, login, setup, update, user, version
# — no 'session' or 'sessions' entry

grep -i "session\|sessions" <(multica --help)
# → NO MATCH
```

Multica 0.3.4 CLI surface (full list as of 2026-05-22): `agent`, `autopilot`,
`issue`, `label`, `project`, `repo`, `skill`, `squad`, `workspace`, `daemon`,
`runtime`, `attachment`, `auth`, `config`, `login`, `setup`, `update`, `user`,
`version`. The word "session" appears only in internal daemon task context as
`resume_session=false` (agent CLI session resume, not a collaboration scope).

`squad` exists and accepts an issue assignment (`--assignee <squad-name>`), but
daemon evidence (research-brief §1.4) shows `max_concurrent_tasks=1` per agent and
no parallel-multi-agent dispatch on a single task. Squad-as-assignee routes to a
single "squad leader evaluation," not true parallel multi-agent execution.

### Conclusion

**No `session` or `sessions` command exists on Multica 0.3.4.** Re-confirms
research-brief §1.1. Option (c) collapses. Squad is a member-grouping container, not
a parallel multi-agent collaboration scope.

---

## Recommendation

Slice-1 (tce-2) commitment to **option (a)** is confirmed sound:

| Option | Verdict | Use |
|--------|---------|-----|
| (a) parent + child issues | **Viable — primary path** | One parent container + N child issues per workflow-phase. Full marker contract intact. |
| (b) sequential reassignment | **Viable — fallback only** | Use for failure-recovery reassignment of an existing child, not for primary phase sequencing. Requires `writeMulticaRunEpisode` `phase` param (H1). |
| (c) session/squad primitive | **Not viable** | No `session` command; `squad` is not a parallel multi-agent scope. |

**Scope gate:** `workflow` OAuth scope must be present before tce-7 dispatch.
See tce-0 runbook above. No other blockers on slice-1 commitment.

**Additional finding (option a, querying children):** No `--parent` filter on
`issue list`. The dispatch orchestrator must filter client-side by `parent_issue_id`.
This should be documented in the tce-8/tce-9 story specs.
