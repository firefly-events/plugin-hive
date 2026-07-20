---
name: metrics
description: Render a read-only metrics dashboard and summary for a Hive deliverable.
---

# Hive Metrics

Collect and display the metrics currently available for one Hive deliverable.

**Input:** `$ARGUMENTS` optionally contains one deliverable (epic) ID. When it is
omitted, resolve the deliverable from the current run context or the active epic.

This command is **read-only** with respect to the project and Hive state. It never
modifies source files, event logs, episodes, snapshots, or configuration. Generated
report, dashboard, and export artifacts go in a fresh temporary directory.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) —
kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If the kickoff checks pass, proceed
silently. This skill is read-only-shaped. On a fresh repo without
`.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults
instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Process

### 1-3. Resolve, collect, render, and print — via the shared runner

Do not resolve the deliverable, orchestrate collect/render, or format the summary
yourself. All three steps are implemented in one executable helper,
`hive.lib.harness.metrics_runner`, so the command path is real and testable rather
than re-implemented ad hoc in this prompt. Invoke it once from the repository root
and print exactly what it prints to stdout, verbatim:

```bash
python3 -m hive.lib.harness.metrics_runner --deliverable "$ARGUMENTS" --repo "$PWD"
```

Omit `--deliverable` (or pass an empty value) when `$ARGUMENTS` supplies none — the
runner resolves it itself, in this order:

1. `HIVE_SWARM_ID`, when populated for the current run.
2. The current Git branch's final path component, when it exactly matches a
   directory under `.pHive/epics/` that contains `epic.yaml` (for example,
   `feat/metrics-observability` resolves to `metrics-observability`).
3. The only directory under `.pHive/epics/` that contains `epic.yaml`.

Reject more than one value in `$ARGUMENTS` before invoking the runner; the runner
itself rejects identifiers containing `/`, `\\`, `..`, or whitespace. If more than
one active epic remains, or none does, the runner prints the exact message to
report and exits clean — relay that output as-is, do not guess a deliverable.
`HIVE_RUN_ID` identifies the current run for context, but the existing collector
rolls up the deliverable; do not claim that this command filters or attributes
metrics by run.

The runner creates a fresh artifact directory outside the repository, calls
`collect_report(deliverable, repo)` and `render(...)` exactly once each (writing
exports into that artifact directory, never into Hive state), and formats the
summary table:

```text
## Metrics: <deliverable>

| Metric | Value |
| --- | ---: |
| wall_ms_total | <number> |
| human_gate_ms_total | <number> |
| gate_count | <number> |
| tokens.total | <number> |
| tokens.input | <number> |
| tokens.output | <number> |
| tokens.cache_read | <number> |
| tokens.cache_creation | <number> |
| flow | <step ids joined by " -> ", or "no steps"> |

Dashboard: <absolute path to dashboard.html>
```

When at least one skill-attributed token row exists (mo-2), the runner inserts a
`### Tokens by skill` table between `flow` and `Dashboard:`, one row per skill
name with its running total and its most recent invocation's tokens + `run_id`
(e.g. "tokens for the last /plan run" reads off that row's "Last run tokens"
column). The table is omitted entirely when no skill-attributed rows exist —
relay the output as printed, do not fabricate the section.

Zero is used for an absent numeric field and `no steps` for an absent/empty flow.
When `wall_ms_total`, `human_gate_ms_total`, `gate_count`, and every token total are
zero, the runner prints `No metrics yet for <deliverable>. Dashboard rendered with
zero values.` immediately before the table, and still renders the dashboard. The
runner verifies the dashboard file exists before printing its path.

If the runner exits non-zero or raises, report the error and do not fabricate a
summary or artifact path. Do not edit, delete, or normalize any source event while
collecting.

## Scope boundary

The aggregate token fields (`total`, `input`, `output`, `cache_read`,
`cache_creation`) roll up every `tokens` event regardless of source, including the
legacy whole-session bundles. The per-skill rollup (mo-2) only reflects rows
emitted by `hooks/metrics-skill-token-capture.sh` (`dimensions.attribution ==
"skill_boundary"`) — main-thread tokens spent while a `Skill` tool call was open.
It does not include tokens spent by subagents spawned during that skill's
invocation (those still land in the aggregate total, just uncorrelated to the
skill); see `.pHive/epics/metrics-observability/docs/mo-2-skill-token-sensor-spike.md`
for the full mechanism and limits.

## Verification contract

Exercise `hive.lib.harness.metrics_runner.run_metrics` (the same helper this skill
invokes) against a temporary fixture repository and metrics event directory
(`HIVE_STATE_DIR=<fixture-state>`). The fixture must contain at least one matching
tokens event, one wall-clock event, one human-gate event, and an epic with flow
steps. Assert that `stdout` contains every table label above plus `Dashboard:`, and
assert that the printed HTML path exists. Repeat with an empty events directory and
assert the exact `No metrics yet for <deliverable>` prefix, zero-valued table rows,
and an existing dashboard rather than a traceback.
