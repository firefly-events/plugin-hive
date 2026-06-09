# d-1: Phase A is INSERT-ABOVE, not a structural replacement

**Story:** d-1-design-multi-persona-pipeline
**Date:** 2026-06-08

## Finding

When a story spec says "insert Phase A above existing step 3", the correct implementation is to
add a **new named section** (with its own `### Phase A — ...` heading) that sits between step 2
and the existing step 3. The existing step 3 content is **preserved unchanged** as the terminal
dispatch site — it receives different inputs depending on the Phase A path (default-off: original
inputs; toggle-on: original inputs + prepended constraints).

This is structurally different from:
- Replacing step 3 content with Phase A content (wrong — loses the dispatch step)
- Nesting step 3 inside Phase A as a sub-bullet (wrong — breaks the numbered step convention)
- Moving step 3 to become step 4 and calling Phase A "step 3" (wrong — renumbers existing AC references)

## Non-obvious detail

The numbered steps (1, 2, 3, ...) are the **canonical positions** referenced by ACs and test specs.
Phase A gets a **letter prefix** (`Phase A`) specifically to live _between_ numbered steps without
renumbering them. Phase 0 gets a **zero prefix** to live _before_ step 1 without displacing the step numbering.

This naming convention is load-bearing — AC references to "step 3 (lines 55-64)" in the story spec
mean the ui-designer dispatch step, which remains step 3 even after the Phase A insert.

## Reuse

Apply the same pattern for any future "Phase X insert" stories: use a lettered/numbered phase heading
that sits between existing numbered steps, preserve downstream step numbers and content intact.
