# Meta-Team UX — Morning Summary Format

The meta-team runs unattended at 3 AM CDT and produces a morning summary for user review via `/hive:status`. This reference defines the exact format and the rules for what the summary must contain.

---

## Where the Summary Lives

```
.pHive/meta-team/morning-summary.md
```

Written at the end of every meta-team cycle (step 8 — close).

---

## How the User Sees It

When the user runs `/hive:status`, the status skill checks for `.pHive/meta-team/morning-summary.md`. If it exists, it is rendered as a top-level section before the epic status output.

The summary is designed for a 30-second morning review:
- Verdict at the top (passed / partial / poor)
- What actually changed — specific file names and one-line descriptions
- What was found but NOT fixed — so the user knows what the cycle skipped
- Numeric summary at the bottom

---

## Summary Format

```markdown
# Hive Meta-Team — Nightly Cycle Report
**Cycle:** {cycle_id} | **Date:** {YYYY-MM-DD} | **Verdict:** {VERDICT}

---

## What Changed Tonight

{If promoted changes exist:}
- **{file path}** — {one-line description of what was added or created}
- **{file path}** — {one-line description}

{If no changes were promoted:}
- No changes promoted this cycle. See "What Was Found" below.

---

## What Was Found (Not Fixed This Cycle)

{List each finding that was not addressed — either deferred, out-of-scope, or blocked:}
- **{category}** `{location}` — {one-line description} _(reason: {deferred | out_of_scope | needs_human | blocked})_

{If nothing was found:}
- No new issues found. Codebase is in good shape.

---

## Flagged for Human Review

{List any changes or findings that require human decision:}
- **{file}** — {what needs human decision}

{If nothing flagged:}
- Nothing requires your attention.

---

## Cycle Metrics

| Metric | Count |
|--------|-------|
| Findings identified | {N} |
| Proposals generated | {N} |
| Changes promoted | {N} |
| Changes reverted | {N} |
| Flagged for human | {N} |

**Next cycle priority:** {top-ranked deferred finding, or "none"}
```

---

## Verdict Definitions

| Verdict | Meaning |
|---------|---------|
| `PASSED` | ≥ 70% of attempted changes were promoted. Cycle delivered meaningful improvement. |
| `PARTIAL` | 40–70% of changes promoted. Some value delivered; some gaps remain. |
| `POOR` | < 40% of changes promoted. Issues found but not resolved — check "Flagged" section. |
| `CLEAN` | No findings. Codebase passed all audits. No changes needed. |
| `ABORTED` | Cycle crashed or hit the 5-hour budget limit. Partial work may be present. |

---

## Rules for Writing Good Summaries

**Be specific.** "Added vertical-planning.md with H/V methodology guide" is good. "Improved documentation" is not.

**Name files.** Every change entry must name the actual file path — not just "a reference doc".

**Explain why something was NOT fixed.** If a finding was deferred or blocked, say why. The user can't act on "found issues" — they need to know the reason.

**Cap the "What Was Found" list at 10 items.** If there are more, summarize them: "... and N more low-severity findings — see `.pHive/meta-team/cycle-state.yaml` for full list."

**Don't pad.** If nothing was flagged for human, say "Nothing requires your attention." — not a paragraph explaining why nothing was flagged.

---

## Status Skill Integration

The `/hive:status` skill checks for the morning summary at session start. If present, it renders it before the epic status sections. This gives the user immediate visibility into overnight work without requiring a separate command.

See `skills/status/SKILL.md` for the integration hook.
