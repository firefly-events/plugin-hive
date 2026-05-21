---
name: standup
description: Run the daily ceremony — standup, planning, execution.
---

# Hive Standup

Run the daily ceremony workflow: standup → planning → execution.

**Input:** `$ARGUMENTS` optionally contains an epic ID to focus on, plus the following flags:

| Flag | Description |
|------|-------------|
| `--interactive` | Activates Phase 1.5 (Interactive Routing) between the standup report and planning. Lets the operator redirect or reprioritize before the planning short-list runs. |

**Config knob:** `standup.interactive_default` in `hive.config.yaml` (default: `false`). When `true`, `--interactive` behavior is always active without passing the flag. The CLI flag takes precedence over the config value — passing `--interactive` enables Phase 1.5 regardless of the config setting.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If the kickoff checks pass, proceed silently. This skill is read-only-shaped. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Process

Load `hive/workflows/daily-ceremony.workflow.yaml` and execute its phases. Each phase has step files at `hive/workflows/steps/daily-ceremony/`.

Parse `$ARGUMENTS` before loading the workflow:
1. Extract any epic ID (non-flag token) to pass as focus context.
2. Check for `--interactive` flag.
3. Read `standup.interactive_default` from `hive.config.yaml` (consumer override layer wins over the shipped default of `false`).
4. Set `args.interactive = (--interactive flag present) OR (standup.interactive_default == true)`.

Pass `args.interactive` into the workflow loader so the `when:` gate on the `interactive-routing` step evaluates correctly.

**Phase 1 — Standup:** Reconstruct state from previous sessions. Read status markers (`.pHive/episodes/`), cycle state (`.pHive/cycle-state/`), task tracker (pending human items), agent memories, the **triage queue** at `.pHive/triage/queue.yaml`, and **metrics health** across story-declared `metric:` blocks (per [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §3). Surface open triage items (any entry whose `state` is not `closed`) alongside in-flight epics so the operator sees the intake backlog before selecting today's work. Surface OVERDUE and FAIL metric verdicts alongside the same context so claim-vs-reality gaps land in the operator's eye before they pick today's work. Present structured report to user.

**Story status in cycle summaries — use derived status.** When surfacing in-flight epics or story counts, call `deriveStoryStatus({ epic_id, story_id })` from `hive/lib/story-status.mjs` instead of reading the raw YAML `status:` field. The YAML field lags reality (stale after PR merge); the deriver is authoritative. See `hive/references/story-yaml-schema.md §2a`.

**Triage surfacing — read-only.** Phase 1 is the only point where standup touches triage. Surface open items as ceremony context — title, state, priority/severity if set, and entry id — so the operator can decide whether to hand off via `/hive:triage <id> --hand-off` (which routes to `/plan --from-triage`) or defer. Standup does NOT mutate the triage state machine; the triage skill remains the single writer of `queue.yaml`. If `.pHive/triage/queue.yaml` is missing, treat the surfacing as empty (no warning needed — triage is opt-in per its warning-only kickoff posture).

**Metrics health — read-only.** Phase 1 is also the only point where standup touches story-level metrics. This section surfaces the gap between declared metric claims and observed verdicts so the operator sees regressions and overdue verifications before selecting today's work. Standup READS story YAMLs only — it does NOT invoke `/metrics-check`, query event JSONLs, open the KG, or read experiment envelopes. Verdict computation belongs to `/metrics-check` (M-05); standup is the read-side surfacing of whatever verdicts that skill has already written back.

Scan `.pHive/epics/*/stories/*.yaml`. For each story:

1. Skip files without a top-level `metric:` block (story declared no falsifiable claim).
2. Skip stories with `metric.applies: false` (planning-time opt-out, recorded by M-01/M-03; nothing to verify).
3. Otherwise, classify the story into one of three buckets based on the `metric.verdict:` sub-block (written by `/metrics-check`):
   - **OVERDUE:** `metric.verify_at` resolves to a past timestamp (use the resolution table in `skills/metrics-check/SKILL.md` §1a; if unresolvable, treat the story as `verify_at_unparseable` and skip it from this bucket) AND no `metric.verdict:` sub-block exists.
   - **FAIL:** `metric.verdict.outcome == "FAIL"` (regardless of `verify_at`).
   - **HEALTHY:** any other state (`PASS`, `INCONCLUSIVE`, `MANUAL`, or not-yet-due with no verdict).

Emit the section in the standup report only when OVERDUE > 0 OR FAIL > 0. Empty-state collapse is mandatory: on repos with zero `metric:` blocks, or with all stories HEALTHY, the section MUST be silent — no header, no zero-count line, no padding. The triage section uses the same collapse-on-empty discipline.

When the section IS emitted, render it as:

```
### Metrics health

Counts: overdue=<N>, fail=<N>

Top 5 oldest overdue (oldest verify_at first):
  · <epic-id>/<story-id> — <metric.name> <direction>: target=<target>; verify_at=<resolved ISO-8601>; overdue by <duration>

Failing verdicts:
  ✗ <epic-id>/<story-id> — <metric.name> <direction>: measured=<verdict.measured_value> vs target=<target>; ran_at=<verdict.ran_at>
      action: <one-line suggestion>

→ Run `/metrics-check` for the latest verdicts.
```

Section sizing rules:
- OVERDUE list is capped at the 5 oldest. Additional overdue stories are summarized as `… and <N> more older than <oldest displayed verify_at>`.
- FAIL list is uncapped (regressions are higher-signal than overdue; capping would hide active failures). If the FAIL count exceeds 10, render the top 10 by `verdict.ran_at` descending (most recently observed first) plus the same `… and <N> more` summary tail.
- The closing `→ Run /metrics-check` hint appears only when OVERDUE > 0 (suggesting a fresh verdict pass); on FAIL-only sections, the per-row action suggestions carry the call-to-action and the trailing hint is omitted.

One-line action suggestion (FAIL rows): templated per `metric.direction` and `metric.source.kind`:
- `direction: up` → "consider follow-up story to close the gap or revisit `target` if over-ambitious"
- `direction: down` → "consider reverting the regressing change or file a follow-up story to bring the number back below target"
- prefix `source.kind: events` rows with "review event rows at `verdict.evidence_ref` first to confirm not a sampling artifact; "
- prefix `source.kind: manual` rows with "manual source — re-run the read recipe in `metric.source.ref` and re-run /metrics-check; "

Failure modes:
- `.pHive/epics/` missing or empty: silent (no error, no section). This is the canonical empty-state case.
- A story YAML fails to parse: count it as a `parse_error` and increment a single rolled-up note at the end of the section (`Note: <N> story YAML files failed to parse — run /hive:status for details`). Do NOT abort phase 1.
- `metric.verify_at` is `"eventually"`, `"someday"`, empty, or otherwise unparseable: skip the story from the OVERDUE bucket (it is the planning-time gate's job to reject these per M-03/M-01, not standup's job to flag them again). FAIL classification is unaffected.

**Phase 1.5 — Interactive Routing (opt-in):** Activated when `args.interactive` is `true`. Runs the `interactive-routing` step (`step-interactive-routing.md`). The operator can redirect work, reprioritize epics, or inject new context before the planning short-list runs. When `args.interactive` is `false` (the default), this phase is skipped entirely — workflow behavior is byte-equivalent to pre-A.1.

**Phase 2 — Planning:** User short-lists today's work. Evaluate whether items need new planning or are already storied. If new work, run a compressed planning swarm. Present plan with agent-ready checklist results. User approves.

**Phase 3 — Execution:** Kick off dev team(s) for approved work. After completion, run session-end evaluation for insight promotion/discard.

**Daily restart model:** The orchestrator starts fresh each day with a 1M context window. The standup phase compresses prior state into the new session via status markers, cycle state, and task tracker — not by resuming a prior conversation.

## Anthropic Routines (Recommended Scheduler)

For scheduled daily ceremony runs, use Anthropic Routines as the recommended scheduler. Routines should own the cron schedule and webhook delivery, while Hive continues to run the same `daily-ceremony.workflow.yaml` described above.

Use [../../hive/references/routines-integration.md](../../hive/references/routines-integration.md) as the full bridge contract for this setup, including the scheduler boundary, webhook trigger model, sandbox dry-run guidance, and fallback behavior when Routines is absent.

When wiring the scheduled path, make sure the workflow-level scheduler signal is present in [../../hive/workflows/daily-ceremony.workflow.yaml](../../hive/workflows/daily-ceremony.workflow.yaml): the `plan-approval` pause step must declare `under_scheduler.auto_approve: true`. That step-level metadata is what allows a non-interactive scheduler run to pass through plan approval without blocking; interactive runs still use the normal approval behavior.

This recommendation is additive only. Manual invocation via `/hive:standup` remains supported and should continue to run the same daily ceremony workflow when a human operator starts it directly.

## Step Files

| Step | File | Phase |
|------|------|-------|
| Load state | `hive/workflows/steps/daily-ceremony/step-01-load-state.md` | Standup |
| Load memories | `hive/workflows/steps/daily-ceremony/step-02-load-memories.md` | Standup |
| Present standup | `hive/workflows/steps/daily-ceremony/step-03-present-standup.md` | Standup |
| Interactive routing | `hive/workflows/steps/daily-ceremony/step-interactive-routing.md` | Interactive Routing (opt-in) |
| Select work | `hive/workflows/steps/daily-ceremony/step-04-select-work.md` | Planning |
| Validate stories | `hive/workflows/steps/daily-ceremony/step-05-validate-stories.md` | Planning |
| Approve plan | `hive/workflows/steps/daily-ceremony/step-06-approve-plan.md` | Planning |
| Kick off | `hive/workflows/steps/daily-ceremony/step-07-kick-off.md` | Execution |
| Session end | `hive/workflows/steps/daily-ceremony/step-08-session-end.md` | Execution |

## Key References

- `hive/workflows/daily-ceremony.workflow.yaml` — workflow definition
- `hive/references/agent-memory-schema.md` — insight evaluation at session end
- `hive/references/episode-schema.md` — status marker format
- `hive/agents/orchestrator.md` — orchestrator coordination guidance
- [`hive/references/story-yaml-schema.md`](../../hive/references/story-yaml-schema.md) §3 — `metric:` block shape that the Metrics health section reads
- [`skills/metrics-check/SKILL.md`](../metrics-check/SKILL.md) — verdict computation (the writer of the `metric.verdict:` sub-block Phase 1 surfaces)
