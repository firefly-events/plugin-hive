This document gates S1/S2 emit-site schema work by naming the consumer contract for each KG predicate. It prevents the anti-b0-sliver-pattern of emitting predicates no consumer reads.

| predicate | consumer | source-of-truth | example query |
|-----------|----------|-----------------|---------------|
| `decided` | Deferred to S6.3 | `hive/references/knowledge-graph-schema.md` predicate vocabulary: deliberate architectural or implementation decision | `query_decisions({ predicate: "decided", as_of: now })` |
| `superseded` | `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` | `hive/references/knowledge-graph-schema.md` predicate vocabulary; step-02c §3 query contract | `supersessions = query_decisions({ predicate: "superseded", as_of: now })` |
| `assigned_to` | Deferred to S6.3 | `hive/references/knowledge-graph-schema.md` predicate vocabulary: story or task assignment to agent or team | `query_decisions({ predicate: "assigned_to", as_of: now })` |
| `blocked_by` | Deferred to S6.3 | `hive/references/knowledge-graph-schema.md` predicate vocabulary: blocking dependency between work items | `query_decisions({ predicate: "blocked_by", as_of: now })` |
| `depends_on` | Deferred to S6.3 | `hive/references/knowledge-graph-schema.md` predicate vocabulary: soft dependency between work items | `query_decisions({ predicate: "depends_on", as_of: now })` |
| `phase_started` | Deferred to S6.3 | `hive/references/knowledge-graph-schema.md` predicate vocabulary: workflow phase began | `query_decisions({ predicate: "phase_started", as_of: now })` |
| `phase_complete` | Deferred to S6.3 | `hive/references/knowledge-graph-schema.md` predicate vocabulary: workflow phase completed successfully | `query_decisions({ predicate: "phase_complete", as_of: now })` |
| `phase_failed` | `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` | `hive/references/knowledge-graph-schema.md` predicate vocabulary; step-02c §3 query contract | `failures = query_decisions({ predicate: "phase_failed", as_of: now })` |
| `phase_blocked` | `hive/workflows/steps/meta-team-cycle/step-02c-kg-signal.md` | `hive/references/knowledge-graph-schema.md` predicate vocabulary; step-02c §3 query contract | `failures = query_decisions({ predicate: "phase_blocked", as_of: now })` |

## Deferrals

- `decided`: Deferred to S6.3 because no `skills/hive/skills/meta-optimize` consumer currently reads this predicate.
- `assigned_to`: Deferred to S6.3 because no `skills/hive/skills/meta-optimize` consumer currently reads this predicate.
- `blocked_by`: Deferred to S6.3 because no `skills/hive/skills/meta-optimize` consumer currently reads this predicate.
- `depends_on`: Deferred to S6.3 because no `skills/hive/skills/meta-optimize` consumer currently reads this predicate.
- `phase_started`: Deferred to S6.3 because no `skills/hive/skills/meta-optimize` consumer currently reads this predicate.
- `phase_complete`: Deferred to S6.3 because no `skills/hive/skills/meta-optimize` consumer currently reads this predicate.
