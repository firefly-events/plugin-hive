# Secondary Predicate Wiring Audit (S6.3)

**Conducted:** 2026-05-15 during /plugin-hive:execute kg-signal-revival run
**Story:** S6.3-secondary-predicate-wiring (conditional, UX-driven)
**Anti-pattern guard from story spec:** Do NOT wire predicates "just in case." Wire iff there's a current consumer (`/hive:why` surface) that names them.

## Method

For each of the five candidate secondary predicates, inspect S6.1's `/hive:why` implementation (`hive/lib/kg_why.py` + `skills/hive/skills/why/SKILL.md`) and answer one question:

> Does `/hive:why`'s merge / render / surface logic reference this predicate by name?

If YES → wire the emission seam per design-discussion v3 §2.
If NO → defer; no code change.

## Candidate predicates

| Predicate | Named by `/hive:why`? | Decision | Reason |
|---|---|---|---|
| `phase_started` | No | **DEFER** | `kg_why.py` is predicate-agnostic — it accepts any predicate via `--strict --predicate <name>` or as a Phase A LIKE match in free-form mode. It does not specifically reference `phase_started` in render, dedupe, or sort logic. The skill SKILL.md examples use `decided` as the canonical demo predicate, not `phase_started`. No current consumer that names this predicate. |
| `phase_complete` | No | **DEFER** | Same as `phase_started` — predicate-agnostic surface. The Act I exit gate (S2.3) cares about `phase_failed` / `phase_blocked` / `superseded`, not `phase_complete`. No current consumer. |
| `assigned_to` | No | **DEFER** | `/hive:why` does not bias toward ownership-shaped triples. The skill returns whatever triples match the query regardless of predicate semantics. No current consumer that names this predicate. |
| `blocked_by` | No | **DEFER** | The story-spec dependency graph (depends_on field in YAML) already encodes blocking relationships at planning time. Surfacing these as KG triples would duplicate the YAML source-of-truth without /hive:why specifically asking for them. No current consumer. |
| `depends_on` | No | **DEFER** | Same as `blocked_by` — soft dependencies already live in story YAML `depends_on:` lists. No current consumer that names this predicate as a KG-side surface. |

## Outcome

**5 of 5 secondary predicates DEFERRED.** Zero net code change for this story per the story spec's allowed exit condition:

> If audit yields zero predicates needing wiring, story closes with audit doc as sole deliverable.

This audit doc IS the S6.3 deliverable.

## What would trigger a re-audit?

Any of the following changes would re-open this audit and likely lead to wiring one or more predicates:

1. **`/hive:why` adds a `--phase <state>` flag** that filters specifically on `phase_started` / `phase_complete` triples → wire those two.
2. **`/hive:why` adds an `--owner <agent>` surface** that joins on `assigned_to` → wire that predicate.
3. **`/hive:why` adds dependency-graph rendering** (e.g. "what was this decision blocked by?") → wire `blocked_by` and/or `depends_on`.
4. **A new skill (`/hive:status`, `/hive:owner`, etc.) is introduced** that names one of these predicates as part of its surface design → wire whichever is named.

Until one of those triggers fires, the production emit sites named in design-discussion v3 §2 stay dark and the secondary predicates remain catalog-only.

## Cross-reference

- S2.x established the three priority predicates (`phase_failed`, `phase_blocked`, `superseded`) — those are the surface-required predicates for /meta-optimize step-02c. Wired and shipping.
- S6.1 established `/hive:why` as the user-facing audit-trail surface. Predicate-agnostic by design — exactly the right shape for a retrospection tool, but it means no secondary predicate is structurally REQUIRED to be wired right now.
- This audit was deliberately conservative per the story spec's anti-pattern guard. The risk of wiring "just in case" is producer/consumer drift: emit sites fire from production code while the consumer surface ignores the data, accumulating telemetry debt without observability value.

## Status

S6.3 closes with **audit-only deliverable**. No code mutations. No tests added. No emit-site wiring. Follow-on epic can revisit when a UX consumer for one of the five predicates materializes.
