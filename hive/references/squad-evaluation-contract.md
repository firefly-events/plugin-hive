# Squad-Evaluation Contract

> **Posture:** substrate signal, not authority surface.

## 1. Authority Model

Squad-leader evaluations are consumed by Hive as **one input among many** — a substrate signal surfaced to the user, not a gate that controls execution.

- **User retains merge authority.** The evaluation is advisory. Hive never blocks a merge on the basis of a squad evaluation.
- **The evaluation does NOT gate merge.** Any implementation that treats a squad evaluation as a merge prerequisite violates this contract.

This posture is grounded in the CONTEXT.md North Star: *composable substrate, user-directed* — not a director-chair workflow. See `.pHive/CONTEXT.md`.

### Explicitly rejected interpretation

> ❌ *"Hive holds the PR until the squad leader approves."*

This authority-gate-on-merge interpretation is rejected. Squad evaluations inform; they do not authorize.

---

## 2. Read Moment

The evaluation is read at **`/execute` integrate-step completion**, after all three of the following have occurred:

1. Dispatch reaches a terminal state (`completed`)
2. `git push` succeeds
3. PR opens

The read happens **pre-merge**, during integrate-step housekeeping — not at merge time, not at dispatch time.

---

## 3. Read Path

```
/execute (execute-mode-multica)
  └─ readSquadEvaluation(issueId)          # W2.6 dispatch helper
       └─ adapter.getSquadActivity(issueId) # W2.4 adapter method
            └─ GET /api/issues/{id}/timeline
                 └─ filter: action == 'squad_leader_evaluated'
                      └─ return most-recent match, or null
```

**Timeline endpoint:** `GET /api/issues/{id}/timeline` — returns `{ entries: [...], next_cursor, ... }`. Squad evaluations are `activity` entries with `action == 'squad_leader_evaluated'`.

---

## 4. Data Shape

The squad evaluation is an **activity_log entry**, not a free-text field. The corrected shape (per W2.4 adapter ABI 1.1.0) is:

```typescript
{
  actor_type: string;      // e.g. "squad_leader"
  actor_id:   string;      // UUID of the evaluating actor
  outcome:    'action' | 'no_action' | 'failed';  // fixed enum
  reason:     string | null;  // optional short string
  created_at: string;      // ISO 8601 timestamp
}
```

### Outcome enum

| Value | Meaning |
|-------|---------|
| `action` | Squad leader recommends action (e.g. merge / proceed) |
| `no_action` | Squad leader recommends no action (e.g. hold / revise) |
| `failed` | Evaluation could not be completed |

`outcome` is a **fixed enum** — not free text. Any consumer that treats it as an arbitrary string is incorrect.

> **Correction note:** The original PLU-105 spec assumed `{ leader, evaluation: <free text>, timestamp }` and a dedicated squad endpoint. Both assumptions were wrong. The corrected shape above is authoritative. See W2.4 story for the empirical read-path finding.

---

## 5. Storage

The result of `readSquadEvaluation` is stored in the episode marker under an optional `squad_evaluation` field:

```yaml
# .pHive/episodes/{epic-id}/{story-id}/integrate.yaml
squad_evaluation:
  actor_type: "squad_leader"
  actor_id: "<uuid>"
  outcome: "action"
  reason: "All acceptance criteria met."
  created_at: "2026-06-14T12:00:00Z"
```

A `null` result (no evaluation exists) is stored as an absent field — the episode marker is still written. This provides downstream visibility via W2.7 without requiring an evaluation to be present.

---

## 6. Best-Effort Guarantee

**A null result or a read error must NOT fail `/execute`.**

- If `getSquadActivity` returns `null` (no evaluation activity found), integrate-step continues normally.
- If `getSquadActivity` throws (network error, auth failure, timeout), the error is logged and integrate-step continues normally.
- In both cases, `squad_evaluation` is omitted from the episode marker.

This guarantee exists because:
1. Not every issue will have a squad evaluation.
2. Network or auth transients should not block delivery.
3. The evaluation is advisory; its absence is not a blocker.

---

## 7. Scope Boundary — Write Side Out of Scope

This contract covers **read-side only**.

The write side — POSTing a squad evaluation (`POST /api/issues/{id}/squad-evaluated`, status-flip) — is owned by the **squad-leader-status-flip epic** (stories sls-1..3, PLU-313–315). That epic is independent of this contract.

Hive's `/execute` does not write squad evaluations. It only reads them.

---

## 8. Implementation Reference

| Component | Location | Role |
|-----------|----------|------|
| `getSquadActivity` | `hive/adapters/multica/index.ts` | Adapter method; ABI 1.1.0 |
| `readSquadEvaluation` | execute-mode-multica dispatch helper | W2.6 caller |
| Episode marker storage | `.pHive/episodes/…/integrate.yaml` | W2.7 consumer |
| Timeline endpoint | `GET /api/issues/{id}/timeline` | Multica platform API |

---

## 9. Summary Checklist

- [x] Substrate signal — NOT authority surface
- [x] Read moment: post dispatch-terminal, post `git push`, post-PR-open, pre-merge
- [x] Data shape: `{ actor_type, actor_id, outcome, reason, created_at }`
- [x] Outcome enum: `action | no_action | failed` (fixed, not free text)
- [x] Best-effort: null/error does not fail `/execute`
- [x] Authority-gate-on-merge interpretation explicitly rejected
- [x] Write/status-flip side owned by squad-leader-status-flip epic (out of scope here)
