# Phase 1.5 — Interactive Routing

## Purpose

Route each open queue item (triage entries + epic story candidates) through
a structured operator decision:

- **push-to-github** — label `hive:ready`; sandcastle picks it up autonomously
- **keep-local** — operator watches this run; item is suppressed from re-routing for 7 days
- **defer** — skip for now; re-surfaces in the next standup

A visibility heuristic recommends a routing direction per item and prints its
reasoning so the operator can challenge it. All decisions are written to
cycle-state for Phase 2 to consume and for retro analysis of heuristic accuracy.

## When This Step Runs

Only when `args.interactive` is `true` (either `--interactive` flag passed to
`/standup`, or `standup.interactive_default: true` in `hive.config.yaml`).
When neither is set, skip this step entirely — workflow behavior is
byte-equivalent to a non-interactive standup.

## MANDATORY EXECUTION RULES

- Read this entire step file before taking any action.
- Present items one at a time, in order — do NOT batch all prompts upfront.
- Do NOT apply a default for low-confidence items — require explicit operator input.
- Do NOT mutate triage queue.yaml — this step is read-only against triage.
- Write the routing_decisions[] block to cycle-state after ALL decisions are collected.

---

## Inputs

| Source | Purpose |
|--------|---------|
| `.pHive/triage/queue.yaml` | Open triage entries (any state not `closed`) — read-only |
| `.pHive/epics/*/stories/*.yaml` | Pending + in-progress story candidates — read-only |
| `.pHive/cycle-state/<epic-id>.yaml` | Prior routing decisions — for suppression and operator-override bias |
| `standup.routing_prompt_cap` from `hive.config.yaml` | Default: `10` |

---

## Item Collection

Gather open items in priority order:

1. Triage entries in states `prioritized` and `plan-ready` (human has already clarified + prioritized — highest signal)
2. Triage entries in states `inbox` and `clarified`
3. Epic story candidates with `status: pending` and no `shipped` or `cancelled` marker (from the standup's focus epic, or all epics if no focus was passed)

**Suppression check:** Before adding an item to the presentation list, check
`routing_decisions[]` in cycle-state for a prior decision on this `item_id`
where `route: keep-local` AND `expires_at` is in the future. If found, skip
the item. Log suppressed items once before presenting the first prompt:

```
Suppressed: N item(s) — keep-local suppression active (expires within 7 days).
```

**Cap:** Truncate the presented list at `routing_prompt_cap` (default 10). If
items exceed the cap, show a footer after the last prompt:

```
Showing 10 of <N> items. Re-run /standup --interactive to route remaining items.
```

---

## Visibility Heuristic

For each item, compute a visibility recommendation before displaying its
prompt. The heuristic evaluates the item's `description`, `title`, story
`complexity`, triage `priority`/`severity`, and story `metric.applies` field.

### Input signals

| Signal | Detection | Direction bias |
|--------|-----------|----------------|
| UI work | Description or title contains: `component`, `screen`, `render`, `CSS`, `layout`, `design`, `animation`, `visual`, `UI`, `frontend`, `view` | → `local` (strong) |
| External integration | Description references: API, webhook, OAuth, third-party, payment, email, SMS, push notification, external service | → `sandcastle` (strong) |
| Security-sensitive path | Description mentions: auth, token, credential, secret, encryption, RBAC, permission, privilege, signing | → `local` (moderate) |
| Falsifiable metric | Story has `metric.applies: true` — measurement needs isolation | → `sandcastle` (moderate) |
| High complexity / priority | Story `complexity: high` OR triage `priority: p1` or `p2` | → `local` (moderate — high stakes, human oversight preferred) |
| Prior operator override | Same `item_id` in `routing_decisions[]` with `operator_override: true` | Bias toward the operator's prior choice (moderate) |

### Confidence rules

| Condition | visibility | confidence |
|-----------|-----------|------------|
| 2+ strong signals same direction | that direction | `high` |
| 1 strong signal OR 2+ moderate signals same direction | that direction | `medium` |
| All signals absent OR signals conflict | `either` | `low` |

**Low confidence always requires explicit operator choice.** There is no
implicit default for `low` confidence prompts.

---

## Operator Prompt Format

Present one prompt per item in this format:

```
────────────────────────────────────────────────────
Item <index>/<total>: <item_id> — <item_title>
Type: <triage | story>   State: <state>   Priority: <priority or n/a>

Heuristic: visibility=<local|sandcastle|either>   confidence=<low|medium|high>
Reasoning: <one-line explanation citing the strongest signals>

  [1] push-to-github  — label hive:ready; runs autonomously in sandcastle
  [2] keep-local      — operator watches; suppressed from routing for 7 days
  [3] defer           — skip now; re-surfaces in next standup

Enter 1, 2, or 3 (default: <recommended option number>):
```

**Low-confidence prompt — no default shown.** Replace the last line with:

```
⚠ Low confidence — no default. Enter 1, 2, or 3:
```

**Default mapping (medium/high confidence only):**

| visibility | default |
|-----------|---------|
| `local` | `[2] keep-local` |
| `sandcastle` | `[1] push-to-github` |
| `either` (non-low) | `[3] defer` |

---

## Operator Confirmation Contract

| Operator action | operator_override value |
|-----------------|------------------------|
| Selects the heuristic-recommended option | `false` |
| Selects a different option than recommended | `true` |
| Presses Enter on medium/high confidence prompt | `false` (default applied) |
| Presses Enter on low-confidence prompt | Re-prompt once; if Enter again → `defer`, `operator_override: false` |
| Enters an invalid value | Re-prompt once; if invalid again → `defer`, log `routing_input_error` |

---

## Cycle-State Writeback

After collecting all routing decisions for this pass, write the
`routing_decisions[]` block to cycle-state.

**Target path:** `.pHive/cycle-state/<epic-id>.yaml`

- If a standup focus epic was passed as an argument, use that epic's cycle-state.
- If no focus epic was passed and multiple epics are in-flight, write to
  `.pHive/cycle-state/_standup.yaml` (a shared cross-epic routing log).
- If the target cycle-state file does not exist, create a minimal one before
  appending:

  ```yaml
  epic_id: <epic-id>
  created: "<ISO 8601 now>"
  updated: "<ISO 8601 now>"
  routing_decisions: []
  ```

**Merge strategy:** Load the existing `routing_decisions[]` array, append the
new decisions, then write back. Do NOT replace prior decisions — they are the
suppression record for the next standup run.

**Entry shape:**

```yaml
routing_decisions:
  - item_id: t-001                        # triage entry id or story id
    item_type: triage                     # triage | story
    route: keep-local                     # push-to-github | keep-local | defer
    visibility: local                     # heuristic recommendation
    confidence: high                      # heuristic confidence
    operator_override: false              # true if operator chose against heuristic
    reasoning: "UI work — description contains 'component', 'screen'"
    applied_at: "2026-05-21T10:30:00Z"   # ISO 8601
    expires_at: "2026-05-28T10:30:00Z"   # present only when route=keep-local (applied_at + 7 days)
```

`expires_at` is set ONLY when `route: keep-local`. The suppression window is
7 days from `applied_at`. Omit the field for `push-to-github` and `defer`.

---

## Post-Routing Summary

After writing cycle-state, print a summary before handing off to Phase 2:

```
Phase 1.5 — Interactive Routing complete.

Decisions this pass:
  push-to-github:  N  (sandcastle execution queued; GH label applied in A.3)
  keep-local:      N  (suppressed for 7 days)
  defer:           N  (re-surfaces next standup)

Operator overrides: N
Items skipped (cap):             N
Items suppressed (keep-local):   N
```

---

## Failure Modes

| Failure | Recovery |
|---------|---------|
| Triage queue missing (`.pHive/triage/queue.yaml` not found) | Treat triage entries as empty; continue with story candidates only — no error emitted |
| Cycle-state write fails | Warn: `⚠ Could not write routing_decisions to cycle-state: <reason>`. Routing decisions are still printed to the terminal. |
| Operator input timeout (automated / scheduler run) | Default `defer` for all remaining items; emit `routing_timeout` in summary and cycle-state |
| Invalid operator input twice | Apply `defer`; log `routing_input_error` per item |

---

## Next Step

`planning-select-work` (Phase 2) reads the routing summary from cycle-state.
Items routed `push-to-github` are candidates for the GH adapter call (story A.3).
Items routed `keep-local` are added to the local priority queue.
Items routed `defer` are excluded from today's short-list.

**Gating:** All prompted items have a decision (or a `defer` default from timeout/error).
Cycle-state has been written successfully (or warning emitted on failure).
**Next:** Load `hive/workflows/steps/daily-ceremony/step-04-select-work.md`
