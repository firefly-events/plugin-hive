---
name: quantify-impact-dont-just-label-it
description: "every performance finding must quantify or bound the impact; 'this is slow' is not a finding — 'this is O(n²) over a list that scales with user count' is a finding"
type: pattern
last_verified: 2026-04-13
ttl_days: 90
source: agent
---

Performance findings without quantified impact are not actionable. The developer must be
able to prioritize: is this a 2ms regression on a rarely-called path, or an O(n²) operation
on the critical render path? Labels alone ("this is slow", "this allocates a lot") don't
give them enough information.

Required format for a performance finding:
```
- **[category]** `path/to/file.ts:42` — [What happens] [Why it's costly] [Estimated scale]
  **Suggestion:** [Concrete fix]
```

Quantification templates by category:

**complexity:**
> O(n²) where n = number of [entities that grow]. For 1000 [entities], this is 1M iterations
> instead of 1K with a map lookup.

**allocation:**
> Creates a new [object type] on every [trigger: render / request / event]. At [N events/sec],
> this is [N] allocations/sec that GC must collect.

**io:**
> Issues [N] separate queries where 1 JOIN would suffice. At [M] records per page, this is
> [N×M] round trips instead of 1.

**caching:**
> Recomputes [expensive operation] on every call. Result is deterministic for same inputs —
> memoization would reduce calls from [N/sec] to [1 for first call].

**bundle:**
> Imports entire `[library]` ([X KB gzipped]) for `[one function]`. Tree-shakeable alternative
> would save approximately [Y KB].

**lazy-loading:**
> [Module/component] is loaded eagerly at app start. It is only needed on [route/action].
> Deferring with dynamic import would reduce initial bundle by ~[X KB].

If you cannot estimate scale, write:
> "Scale unknown — requires profiling. Flagging for measurement."

Never write just "this is a performance issue." Always bound it, even roughly.
