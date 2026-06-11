---
name: design-review-cc-workflows-marker-dialect
description: Use completion_kind doc-verdict in cc-workflows-run.yaml for design-review atoms, not story-verdict.
applies_to: developer
---

When mirroring a Multica design-review atom into cc-workflows substrate, the episode marker
keeps `completion_kind: doc-verdict` — same as dr-2. The marker filename is
`cc-workflows-run.yaml` (not `multica-run.yaml`), but the completion dialect is shared:
`artifacts_committed` gates on required steps C+D outputs being present, and
`terminal_by_dialect = artifacts_committed && episode_terminal`. Do not use `story-verdict`
(that is the test-mode dialect) or omit `completion_kind` entirely.
