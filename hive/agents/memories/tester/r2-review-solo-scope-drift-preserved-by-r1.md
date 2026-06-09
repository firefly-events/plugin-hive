# r-2 non-obvious finding: scope_drift_observed: null = confirmation, not absence

**Story:** r-2-review-mode-multica  
**Date:** 2026-06-08

## Finding

In review-mode-multica, the episode marker field `scope_drift_observed: null` does NOT mean
scope_drift was skipped or omitted. It means the atom **verified the emit contract** rather
than owning the call.

The pattern:
- `scope_drift` emit at `review:complete` is declared as the responsibility of the reviewer
  agent dispatched inside the Multica issue.
- r-1 (review-dispatch) owns the contract declaration.
- r-2 atom sets `scope_drift_observed: null` in the episode marker as an explicit
  confirmation that it checked the contract and deliberately does NOT duplicate the call.

## Test implication

The AC says "scope_drift emit is preserved by r-1" — the correct test is NOT to verify
that SKILL.md emits scope_drift, but to verify that SKILL.md **documents the preservation**
and that `scope_drift_observed: null` signals "confirmed, not duplicated." A tester who reads
"null" as "missing" would write a test demanding the atom own the emit — wrong.

Also: the scope_drift emit lives *inside the Multica issue* (the reviewer agent calls it),
not in the outer atom shell. This is the same pattern as other multica atoms where the
dispatched agent performs the action and the outer atom only tracks the result.
