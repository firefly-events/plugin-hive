# Insight: chs-4 — 2.11.0 Exemplar Rewrite

## What was non-obvious

**The most common conformance failure was missing outcome-sentence leads, not PR notation.**
Five of seven bullets failed the "leads with a human-readable outcome sentence" rule (§2). The PR notation issue (only one bullet had `minor bump owner;` mixed into the PR suffix) was the visible problem, but the structural issue — bullets opening with noun phrases or passive participle lists — was the real gap.

The entry was detailed and accurate; it failed on *shape*, not *substance*.

## Minimum-change approach worked

The fix pattern was: prepend an outcome clause with an em-dash separator, then keep the original technical list verbatim. Example:

Before: `5-tier mode-resolver helper, canonical 6×3 dispatch-parity matrix, ...`
After: `every workflow mode now has complete dispatch coverage across both runtimes — 5-tier mode-resolver helper, ...`

This preserved all facts and PR numbers while satisfying "first clause understandable without opening any PR."

## Gotcha: "strong" entries can still fail the spec

The original entry had a real tagline, all PR refs, and dense factual bullets — it *looked* conformant. The bullet-shape rule (outcome sentence first) is easy to miss on entries that otherwise read as thorough. Future authoring agents should lint the *first clause* of each bullet explicitly, not just check for PR presence.

## Format feedback for chs-1

No format-spec revision needed. The spec as written correctly captures all the rules that produced violations here. The degraded-source markers (§4) were not in play — this was a live release entry, not an in-progress draft. The spec's §5 quality criteria (especially criterion 2 "prose per change") would have caught these if applied mechanically.
