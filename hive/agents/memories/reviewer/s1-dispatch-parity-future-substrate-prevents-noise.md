# Future-substrate footer prevents matrix churn — pattern for forward-extensible governance docs

When a governance doc summarizes "what's wired today" (here: dispatch-parity.md), the most common drift driver is a new substrate landing and forcing every row to re-author. The Slice-6 footer pattern keeps mainline rows stable by demoting unfinished substrates into a placeholder block:

- Primary table holds only fully-shipped substrate columns. Cells are constrained to 3 values: relative path, `inline`, or `N/A — reasoning`.
- A separate "Future substrate" table holds in-flight substrates with `not-shipped — <reason>` markers. New substrates land here first; promotion to the primary table happens only when the full row (all 6 orchestrators) ships.
- The CI checker (verify-dispatch-parity.mjs) scopes its regex to `skills/hive/skills/*-mode-*/SKILL.md` and validates EVERY match, including ones inside `not-shipped` reason text — so even forward-looking references (e.g., `execute-mode-sandcastle/SKILL.md` cited as an Epic D candidate) must already exist on disk and be tracked. This caught what would otherwise be a stale "we'll wire it later" reference: if the file doesn't exist, CI fails the moment you cite the path.

Net effect: the matrix doc costs ~zero maintenance until a substrate fully ships, and "soft" forward references can't lie because the checker treats every path the same.
