# d-3 design-mode-multica: closeIssue ambiguity resolved conservatively

**Story:** d-3-design-mode-multica
**Date:** 2026-06-08

## Finding

When mirroring execute-mode-multica for d-3, the `closeIssue` step was an
open ambiguity: execute-mode-multica has NO closeIssue step, but
review-mode-multica (r-2) explicitly has `closeIssue` at Step 5.

The story spec says "mirror execute-mode-multica" as the primary contract
anchor. Conservative interpretation: **omit closeIssue**, matching execute-mode-multica.

The distinction matters because design sessions may produce wireframe artifacts
that the caller (`/design`) wants to inspect after terminal before closing.
A review issue has a verdict — closed naturally after verdict capture. A design
issue produces artifacts — caller may want to keep it open for inspection.

**Rule:** When story says "mirror X", default to X's behavior even when a
sibling atom (r-2) differs. Differences between atoms are intentional (different
upstream contracts); do not unify unless spec says "also do Y from Z".
