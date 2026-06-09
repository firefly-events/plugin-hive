---
name: review-dispatch-scope-drift-contract
description: When adding a dispatch Phase 0 to a skill that owns a sanctioned scope_drift emit site, codify the emit preservation as an explicit contract in the dispatch SKILL.md, not just in the parent skill.
applies_to: developer
---

`skills/review/SKILL.md` Step 6 is one of exactly 3 sanctioned `emit_scope_drift` call sites (`plan:phase-c`, `execute:story`, `review:complete`). When a dispatch router (e.g. `review-dispatch/SKILL.md`) routes to downstream mode atoms (`review-mode-multica`, `review-mode-cc-workflows`), those atoms are NOT automatically bound by the parent skill's prose — they may omit the emit without noticing. Add an explicit "scope_drift Emit Contract" section to the dispatch SKILL.md requiring downstream atoms to preserve the emit, citing the 3-site policy and the exact `extra_dimensions` shape. This is a forward-declaration safety net that prevents the next developer from silently dropping the emit when implementing `review-mode-*` atoms.
