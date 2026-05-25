# Multica Issue Closer — Runbook

Operational reference for `hive/lib/multica-issue-closer.mjs`.

---

## Flow

```
PR merge
  └─► integrate hook (CI / post-merge script)
        └─► closeStoryIssue({ epic_id, story_id })
              ├─ read  .pHive/episodes/{epic_id}/{story_id}/multica-run.yaml
              ├─ load  ~/.multica/config.json
              ├─ GET   Multica API → current issue state
              └─ PUT   status: "done"  (or skip — see return shapes)
```

The closer is best-effort: every failure path returns a structured envelope and never throws to the caller.

---

## Return Shapes

| `reason` | `ok` | Meaning | Action |
|---|---|---|---|
| `no_marker` | `false` | Episode marker missing — story was never run through Multica execution, or the marker file was not committed. | Verify the agent wrote `multica-run.yaml` during its run. If intentional (story skipped), no action needed. |
| `no_auth` | `false` | `~/.multica/config.json` absent or missing `token`/`server_url`/`workspace_id`. | Authenticate with `multica auth login` on the machine running the hook, then retry. |
| `already_done` | `true` | Issue was already `done` before the closer ran. | No action — idempotent success. |
| `cancelled` | `true` | Issue was `cancelled` — intentionally left in terminal state. | No action — closer treats `cancelled` as a valid terminal state and skips the PUT. |
| `agent_drift` | `false` | Marker `assignee_id` ≠ current issue `assignee_id`. Issue was reassigned after the episode marker was written. | Inspect the issue on the Multica board. Close manually if appropriate, or leave for the new assignee. |
| `transport_error` | `false` | HTTP call to Multica API failed (network error, timeout, non-2xx response). `error` field contains the sanitized message. | Check connectivity to the Multica server. Retry via manual sweep (below). |
| `was_changed: true` | `true` | Issue transitioned from `prior_status` → `done`. | Normal success path. |

---

## WARN Lines

The closer emits `[multica-issue-closer] <message>` to stderr in two cases:

| Log pattern | Cause |
|---|---|
| `No Multica auth config found; skipping issue close.` | `no_auth` path — config missing at hook runtime. |
| `Failed to fetch issue <id>: <msg>` | Transport error on GET. |
| `Failed to close issue <id>: <msg>` | Transport error on PUT. |

**Escalate when:** the closer emits a WARN on 5 or more consecutive runs for the same story. At that point assume systemic auth or connectivity failure rather than transient error. Check the Multica auth config and network path from the CI host, then perform a manual sweep.

---

## Manual Sweep

Use when the closer skipped issues due to transient errors or was not run (e.g., CI was bypassed):

```bash
# 1. List all issues still stuck in review
multica issue list --status in_review

# 2. For each stale issue that a merged story owns:
multica issue status <key> done
```

`<key>` is the routable identifier printed by `issue list` (e.g. `PLU-27`). Use `--output json` and filter by `project_id` if the workspace has multiple projects.

To find the Multica issue key for a specific story, read the episode marker:

```bash
cat .pHive/episodes/<epic-id>/<story-id>/multica-run.yaml
# issue_id field → use multica issue get <id> to resolve the key
```

---

## See Also

- `hive/lib/multica-issue-closer.mjs` — implementation
- `hive/references/episode-schema.md` — episode marker format (`multica-run.yaml` lives in the same directory)
