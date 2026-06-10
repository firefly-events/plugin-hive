---
story: d-1-design-multi-persona-pipeline
epic: substrate-coverage-and-test-cleanup
date: 2026-06-08
---

# Phase A is a structural insert, NOT an extension of an existing block

When a story says "insert Phase A above existing step 3", check whether step 3 is the ONLY dispatch step (no persona-assembly phase to extend). In skills/design/SKILL.md, step 3 (lines 55-64) is the only dispatch step — there is nothing to extend, only to insert ABOVE. This means downstream steps 3-7 are byte-for-byte unchanged; Phase A is a net-new named block that sits between step 2 (brand context) and the existing step 3 (now the default-off path inside Phase A).

Non-obvious finding: the "What /design is NOT" paragraph at line 137 explicitly states "/design does not run the accessibility-specialist or animations-specialist passes itself." This becomes false when --include-constraints is on. Any structural insert that adds personas the skill previously disclaimed must audit and update the disclaimers — they are documentation invariants, not just commentary.
