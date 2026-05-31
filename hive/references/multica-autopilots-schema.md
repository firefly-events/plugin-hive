# Multica Autopilots Schema

See the canonical workspace config at [.pHive/multica/autopilots.yaml](../../.pHive/multica/autopilots.yaml).

## Purpose

`.pHive/multica/autopilots.yaml` declares the Multica autopilot set that plugin-hive manages via the bootstrap reconciler. Each autopilot maps a recurring trigger (schedule or webhook event) to a persona-backed agent action — either creating a new Multica issue for the agent to claim (`create_issue`) or running a skill directly against the workspace without creating an issue (`run_only`).

Autopilots replace local scheduling mechanisms (CronCreate, `/loop`) for tasks that benefit from Multica's native dispatch, observability, and retry guarantees.

## Schema reference

Top-level fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `schema_version` | integer | yes | none | Current value is `1`. |
| `autopilots` | array | yes | none | Ordered list of autopilot definitions. |

Per-autopilot fields:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `name` | string | yes | none | Stable kebab-case autopilot identifier. |
| `title` | string | yes | none | Human-readable display name. |
| `mode` | string | yes | none | `create_issue` or `run_only`. See Mode semantics. |
| `agent` | string | yes | none | Persona name. Must match an entry in `.pHive/multica/agents.yaml`. |
| `description` | string | yes | none | One-line description of what the autopilot does and when it runs. |
| `priority` | string | no | `medium` | Issue priority when `mode: create_issue`. One of `none`, `low`, `medium`, `high`, `urgent`. |
| `triggers` | array | yes | none | One or more trigger definitions. At least one trigger is required. |

Per-trigger fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string | yes | `schedule` or `webhook`. Sent as `kind` in the API payload. |
| `cron` | string | yes (if `kind: schedule`) | Standard cron expression (5-field UTC). Required when `kind` is `schedule`. |
| `label` | string | no | Informational label (e.g., `post-merge`). Used as part of the reconciler's identity key alongside `kind`. Not validated by the server. |

Webhook `url` is server-assigned at creation time. Do not write `url` into source YAML. The reconciler reads the server-assigned URL back and surfaces it to programmatic callers via the returned `webhookUrlsCaptured` map. It is not persisted to the source manifest.

## Mode semantics

- **`create_issue`** — on trigger, Multica creates a new issue titled after the autopilot's `title` and assigns it to `agent`. The agent's daemon picks it up and works the task. Use this mode when the work produces a result that should be tracked (audit trail, reviewable output).
- **`run_only`** — on trigger, Multica invokes the agent directly without creating a visible issue. Use this for lightweight health checks or fire-and-forget actions where issue overhead is not warranted.

## Validation rules

1. **Agent must exist.** The `agent` value must match the `name` field of an entry in `.pHive/multica/agents.yaml`. The reconciler rejects any autopilot whose agent name is not present at reconcile time.
2. **At least one trigger.** Each autopilot entry must have a non-empty `triggers` array. The reconciler rejects entries with zero triggers.
3. **Cron required for schedule triggers.** A trigger with `kind: schedule` must include a valid 5-field cron expression in `cron`.
4. **Webhook URL is server-generated.** Webhook `url` values are assigned by the Multica server when the autopilot is created. Do not write `url` into the source YAML. The reconciler reads the server-assigned URL back and surfaces it programmatically via `webhookUrlsCaptured`, but it is not a stable config field.
5. **`title` is the idempotency key.** The current reconciler matches existing autopilots by `title`. Changing `title` is treated as a new autopilot — the prior entry is **not** auto-deleted; orphan autopilots with no matching `title` in YAML emit a warning. To force prune behavior, delete the orphan manually in the Multica UI. (Note: `name` remains the trigger-key prefix and the agent reference, but is not used as the autopilot identity key by the current reconciler.)

## Resolution rules

At reconcile time (run via `reconcileAutopilots` in the bootstrap):

1. Load `.pHive/multica/autopilots.yaml`.
2. For each autopilot entry, resolve `agent` → entry in `.pHive/multica/agents.yaml`. Fail fast if the agent does not exist.
3. Diff the declared list against the live Multica autopilot list (`multica autopilot list`).
4. **Create** autopilots present in YAML but absent from Multica.
5. **Update** autopilots present in both where fields diverge (title, mode, description, priority, triggers).
6. **Preserve** autopilots present in Multica but absent from YAML. Out-of-band entries are **not** deleted by the current reconciler — they emit a warning only. Delete orphans manually in the Multica UI when intentional.
7. After create/update, read server-assigned webhook URLs back into `webhookUrlsCaptured` (returned to programmatic callers; not written into the source manifest). The reconciler logs only that a URL was captured per autopilot, not the URL itself.

## schema_version semantics

`schema_version: 1` is the current schema. The reconciler rejects unknown future versions instead of guessing how to interpret them.

## Concrete example

```yaml
schema_version: 1
autopilots:
  - name: metrics-check-post-merge
    title: Metrics Check (post-merge)
    mode: create_issue
    agent: tpm
    description: Run /metrics-check after each merge to main; creates a Multica issue for the tpm agent to process and post results.
    priority: low
    triggers:
      - kind: webhook
        label: post-merge
        # url is server-assigned — do not populate

  - name: visual-qa-post-merge
    title: Visual QA (post-merge)
    mode: create_issue
    agent: ui-designer
    description: Run /visual-qa after each merge to main; creates a Multica issue for the ui-designer agent to review visual diffs and flag regressions.
    priority: medium
    triggers:
      - kind: webhook
        label: post-merge
        # url is server-assigned — do not populate
```

Both autopilots use `mode: create_issue` so their results are trackable on the Multica issue board. The `label: post-merge` value is informational; the actual webhook must be wired to the CI/CD pipeline using the server-assigned URL captured by the reconciler (read from `webhookUrlsCaptured`, not stdout).

## Relationship to other schema files

| File | Role |
| --- | --- |
| `multica-agents-schema.md` | Declares the agent set. Autopilot `agent` fields must resolve to entries here. |
| `multica-squads-schema.md` | Declares squad membership. Autopilots are not squad-bound — they fire independently of squad assignment. |
| `hive/references/routines-integration.md` | Describes the broader scheduling and automation surface. Autopilots are the Multica-native subset of that surface. |

## Drift contract

The config is re-runnable. Reconciler upserts — it does not blindly recreate. On repeated runs, no-op entries produce no server calls. Updates patch diverged fields only. The `title` field is the autopilot identity key; trigger identity is `(kind, label)`. Order in the YAML is not significant.

## Deprecation scope

When a local scheduling mechanism (CronCreate entry, `/loop` cron, or equivalent) is migrated to an autopilot, the local equivalent must be removed in the same story or the immediately following one. The migration list lives at `.pHive/epics/multica-substrate-deepen/docs/autopilot-deprecation.md`.
