---
name: status
description: Check the status of active Hive workflow epics and stories, including a drift trend across the last 5 runs.
---

# Hive Status

Report the status of active workflow epics.

**Input:** `$ARGUMENTS` optionally contains an epic ID to filter to a single epic.

This command is **read-only** — it never modifies state files. It is safe to run while a workflow is executing in another session.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If the kickoff checks pass, proceed silently. This skill is read-only-shaped. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults instead of stopping. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Process

### 1. Find Active Epics

Scan `.pHive/epics/` for subdirectories. Each subdirectory containing an `epic.yaml` is an active epic. If `.pHive/epics/` does not exist or is empty, output:

```
No active workflows. Run /hive:plan to create an epic.
```

### 2. Load Epic Metadata

For each epic, read `.pHive/epics/{epic-id}/epic.yaml` to get:
- `title` — epic display name
- `stories` — list of story entries with `id`, `title`, `depends_on`

### 3. Determine Story Status

For each story in the epic, call `deriveStoryStatus({ epic_id, story_id })` from
`hive/lib/story-status.mjs`. This function is the authoritative deriver — do NOT
read story YAML `status:` fields directly (they lag reality; see
`hive/references/story-yaml-schema.md §2a`).

The deriver checks episode markers, git state, and the story's `deferred:` block.
Its return values map to display symbols as follows:

| Derived status | Symbol |
|----------------|--------|
| `pending` | `·` |
| `in_progress` | `⧖` |
| `completed` | `✓` |
| `failed` | `✗` |
| `blocked` | `·` (with blocked note) |
| `deferred` | `–` |

For **in-progress** stories, identify the current phase from the last episode.
For **blocked** stories, list which `depends_on` stories are not yet completed.

### 4. Format Output

```
## Epic: {epic-id} — {title}
Progress: {completed}/{total} stories completed

Stories:
  ✓ {story-id} — {title} [completed]
  ⧖ {story-id} — {title} [{current-step} → {step-status}]
  · {story-id} — {title} [pending]
  · {story-id} — {title} [blocked: {dep-1}, {dep-2}]
  ✗ {story-id} — {title} [failed: {step} — {conclusion-summary}]
```

### 5. Dependency Graph

After the story list, render a text-based dependency graph:

```
Dependency Graph:
  {story-a} ──┐
  {story-b} ──┼──→ {story-d}
  {story-c} ──┘        │
  {story-e}             └──→ {story-f}
  {story-g}  (no dependencies)
```

For large epics (10+ stories), skip the graph and show blocked/unblocked status inline.

### 6. In-Progress Story Detail

For each in-progress story, show a one-line summary from the most recent episode's `context_for_next_phase` field (first 120 characters):

```
  ⧖ cache-strategy — Design Redis Caching [research → completed]
    ↳ "Redis cluster topology evaluated. Single-node sufficient for…"
```

### 7. Multi-Epic Display

If multiple epics are active, display each as a separate block. Order by most recently modified (check episode timestamps).

### 8. Meta-Team Morning Summary

After all epic status blocks, check for `.pHive/meta-team/morning-summary.md`.

If the file exists, render it as a separate section at the END of the status output:

```
---

## Hive Meta-Team — Last Nightly Cycle

{Full content of .pHive/meta-team/morning-summary.md}
```

If the file does not exist, check `.pHive/meta-team/ledger.yaml`:
- If the ledger exists and has at least one entry: show a one-line summary of the last cycle
  ```
  Meta-Team: Last cycle {cycle_id} on {date} — {verdict} ({N} changes promoted)
  ```
- If neither file exists: omit the meta-team section entirely (meta-team has not been configured or run yet)

### 9. Drift trend (last 5 runs)

`scope_drift_score` events (story `ed-3-drift-metric-emit`) live in the
per-run JSONL at `.pHive/metrics/events/*.jsonl`. Surface the trend by
shelling out to the read-only helper from story
`ed-4-drift-status-surface`:

```
python3 -m hive.lib.scope_drift_reader
```

Render the helper's stdout verbatim as a section after the meta-team
block. Example:

```
---

Drift trend (last 5 runs):
  run-2026-05-19 2026-05-19T12:00:00Z [none=3, minor=1, major=0, divergent=0]
  run-2026-05-18 2026-05-18T15:30:00Z [none=2, minor=2, major=1, divergent=0]
  ...
```

**Silent on absence.** If the helper prints nothing (greenfield project,
maturity gate skipped emit, or no events on disk), omit the section
entirely — do not render an empty placeholder. Malformed JSONL rows
are skipped with a one-line warning by the helper itself, so this skill
does not need to handle parse errors.

See [`hive/references/metrics-event.schema.md`](../../hive/references/metrics-event.schema.md)
for row shape, bucketing rules, and the maturity gate that govern
these events.

### 10. PENDING manual_verdict aging (story wr-3-manual-verdict-aging)

Every story's `manual_verdict` block (see
[`hive/references/story-yaml-schema.md §9`](../../hive/references/story-yaml-schema.md))
still PENDING (`verdict: null`) is a device pass someone owes an epic — left un-nagged,
it rots silently (see the campaign evidence in
`.pHive/epics/wfd-retro-hardening/docs/design-discussion.md` sec 2, wr-2). Surface the
trend by shelling out to the read-only helper from story `wr-3-manual-verdict-aging`:

```python
from pathlib import Path
from hive.lib.manual_verdict_status import find_pending_manual_verdicts, format_pending_aging_section

print(format_pending_aging_section(find_pending_manual_verdicts(repo_root, state_dir)))
```

or equivalently `python3 -m hive.lib.manual_verdict_status` from the repo root.

Render the helper's output verbatim as a section after the drift-trend block:

```
---

PENDING manual_verdict aging:
  wfd-e9 / e9-auth-flow — PENDING (12d)
  wfd-e9 / e9-checkout-flow — PENDING, waived (31d) by dana: device unavailable this cycle
```

A waived entry is never hidden — it still shows with its aging so a waive stays a
visible, owned decision rather than a silent bypass (grill T3).

**Silent on absence.** If no story anywhere has a PENDING `manual_verdict`, the helper
prints nothing and this section is omitted entirely — same posture as the drift-trend
section above. This also covers projects that never use the `simulated-manual`/actual
concern at all: no `manual_verdict` blocks anywhere means nothing to surface.
