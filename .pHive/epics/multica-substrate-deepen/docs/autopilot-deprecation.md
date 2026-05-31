# Autopilot Deprecation: Local Schedule Migration Guide

This document is for maintainers of consumer projects adopting the Multica autopilot layer introduced in Wave W3 of the `multica-substrate-deepen` epic. It records which local invocation patterns each autopilot replaces, how to opt in, and how to prevent dual-firing.

---

## Autopilot inventory

### `metrics-check-post-merge`

| Field | Value |
|---|---|
| Trigger | Webhook — fires on GitHub PR `merged` event |
| Skill invoked | `/hive:metrics-check` |
| Owner persona | `analyst` (or `tpm` — confirmed in W3.2 implementation step) |
| Mode | `run_only` |

**Prior local equivalent**

No standing local schedule existed for `/hive:metrics-check`. The skill was invoked manually by a maintainer after an epic closed, or called by the `/hive:standup` M-06 ceremony when it surfaced overdue `verify_at` dates. There is no `CronCreate` entry or GitHub Actions cron job to remove.

After adopting this autopilot, the webhook replaces the manual "run metrics-check after merge" habit. A maintainer no longer needs to remember to invoke `/hive:metrics-check` — it fires automatically on every PR merge that reaches the wired GitHub event.

---

### `visual-qa-post-merge`

| Field | Value |
|---|---|
| Trigger | Webhook — fires on GitHub PR `merged` event |
| Skill invoked | `/hive:visual-qa` |
| Owner persona | `ui-designer` |
| Mode | `run_only` |

**Prior local equivalent**

No standing local schedule existed for `/hive:visual-qa`. The skill was invoked manually by the ui-designer persona or a maintainer after implementation landed. There is no `CronCreate` entry or GitHub Actions cron job to remove.

After adopting this autopilot, the webhook replaces the manual post-merge visual-QA step. For epics without UI stories the skill's own gate check (`design/index.yaml` must exist) produces a clean no-op, so the autopilot is safe to wire project-wide.

---

## When migration takes effect

Migration is **per-project, consumer opt-in**. Nothing changes globally.

1. The autopilots exist in the Multica substrate after `reconcileAutopilots` runs during `/hive:multica-init` (or the next bootstrap reconcile cycle). Webhook URLs are generated at that point.
2. The consumer wires the GitHub repository's "Pull request — merged" webhook event to each autopilot's URL.
3. From that moment, the autopilot fires on every merge. Local manual invocation is no longer required (but remains available as a fallback — see dual-firing section below).

Until the webhook is wired, local invocation behavior is completely unchanged.

---

## Projects not using Multica

Local scheduling and manual invocation continue **unchanged**. The autopilot layer is additive; it has no effect on projects that have not run `/hive:multica-init`. No action is required.

---

## Preventing dual-firing

If a project wires the autopilot webhook AND retains a local invocation (e.g., a standup-ceremony reminder, a CI step, or a developer habit), both will fire after a merge. Dual-firing is harmless (both runs produce the same verdict) but wastes tokens and produces duplicate episode writes.

To suppress local invocation when the autopilot is active, set the following in the project's `hive.config.yaml`:

```yaml
multica:
  autopilots:
    metrics_check_post_merge:
      disable_local_scheduling: true
    visual_qa_post_merge:
      disable_local_scheduling: true
```

**Effect of each flag**

| Flag | Behaviour when `true` |
|---|---|
| `metrics_check_post_merge.disable_local_scheduling` | The `/hive:standup` M-06 step skips its "overdue verify_at" metrics-check reminder. Manual `/hive:metrics-check` still works; only the ceremony's automatic prompt is suppressed. |
| `visual_qa_post_merge.disable_local_scheduling` | No local mechanism currently fires visual-qa automatically, so this flag is a forward-compat guard. Set it now to prevent accidental dual-firing if a future ceremony step adds a visual-qa call. |

Setting both flags to `false` (or omitting them) restores the default behaviour — the autopilot and any local invocations coexist.

> **Note:** These flags are project-level only. There is no global override; each consumer configures independently in their own `hive.config.yaml`.

---

## Summary table

| Autopilot | Replaces | Removal required? | Config flag to silence local path |
|---|---|---|---|
| `metrics-check-post-merge` | Manual post-merge `/hive:metrics-check` call; standup M-06 overdue-metric reminder | No (no cron/schedule to remove) | `multica.autopilots.metrics_check_post_merge.disable_local_scheduling: true` |
| `visual-qa-post-merge` | Manual post-merge `/hive:visual-qa` call | No (no cron/schedule to remove) | `multica.autopilots.visual_qa_post_merge.disable_local_scheduling: true` |
| _(not yet adopted)_ standup-daily | `/hive:standup` cron / Routines daily trigger — see `hive/references/routines-integration.md` | Yes, decommission the external cron when wiring the autopilot | _(deferred to follow-on epic)_ |

---

## Related references

- `hive/references/multica-autopilots-schema.md` — autopilot YAML schema
- `.pHive/multica/autopilots.yaml` — live autopilot definitions for this project
- `hive/references/routines-integration.md` — existing Routines / cron integration for the daily ceremony (standup autopilot scope, deferred)
- `skills/metrics-check/SKILL.md` — skill invocation details and gate overrides
- `skills/visual-qa/SKILL.md` — skill gate requirements (`design/index.yaml`, `project-profile.yaml`)
