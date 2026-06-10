# Insights — sls-1-terminal-contract-doc

- The "terminal for delegation" definition needs a two-sided negative: it is not
  enough to say `in_review`-with-output-consumed counts as terminal — the doc
  must also state that `in_review` WITHOUT consumption is NOT terminal,
  otherwise leaders can rationalize skipping the consume step. The positive
  list alone is ambiguous.
- Fork C (upstream auto-complete) cannot honor the `in_review`-with-output-
  consumed rule: "output consumed" is leader-local state the platform cannot
  observe. When filing the upstream issue, expect the platform to require
  `done`/`cancelled` only — the contract doc records this explicitly so the
  upstream ask doesn't silently promise unobservable semantics.
- Blocked path deliberately leaves status `in_progress` (not `blocked`):
  `blocked` would remove the parent from the sweep's `in_progress` scan set,
  defeating the stale-by-intent surfacing. Counterintuitive; worth preserving.
