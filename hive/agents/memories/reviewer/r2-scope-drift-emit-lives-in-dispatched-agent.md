# r-2: scope_drift emit lives inside the dispatched reviewer, not in the atom shell

## Non-obvious finding

review-mode-multica/SKILL.md has two apparently-contradictory passages about
scope_drift:

- Step 1 (line ~153): the issue brief INSTRUCTS the dispatched reviewer agent
  to "emit scope_drift at review:complete per the r-1 contract obligation".
- Step 4 marker (line ~248) and the marker field table: the atom sets
  `scope_drift_observed: null` and the contract section explicitly says
  "atom does NOT duplicate the emit".

These are not contradictory once you recognize there are two layers:

1. The OUTER atom shell (this skill's code) — does NOT emit. It only annotates
   the marker.
2. The INNER dispatched reviewer agent runtime (running inside the Multica
   issue) — DOES emit, because r-1's contract requires that any downstream
   `review-mode-*` atom preserve the inline-path emit at `review:complete`.

The `scope_drift_observed: null` value is therefore a deliberate "I checked
the contract and confirmed I am not the emitter" signal, not a missing field.

## Why a reviewer should care

A future reviewer who greps for `emit_scope_drift` in this atom and finds
nothing might (wrongly) flag it as breaking the r-1 contract. The correct
behavior IS to have no shell-level emit; the emit is brief-text directing
the dispatched persona. This is one of exactly 3 sanctioned emit sites in the
codebase (the other two: plan:phase-c and execute:story).

## Mirror to test-mode-multica

test-mode-multica does not carry this dual-layer scope_drift contract because
/test has no scope_drift emit obligation. The reviewer should expect this
asymmetry between test-mode-multica and review-mode-multica even though their
single-run/single-agent shapes otherwise match exactly.
