---
name: design-dispatch-mirror-anchor-pattern
description: When creating a dispatch skill that structurally mirrors execute-dispatch, use the frontmatter comment anchor pattern and call resolveMode with the correct varName.
applies_to: developer
---

`skills/hive/skills/design-dispatch/SKILL.md` mirrors `execute-dispatch/SKILL.md` Step 0/1/1.5/2 verbatim except for two substitutions: `HIVE_DESIGN_MODE` replaces `HIVE_EXECUTE_MODE` as the resolveMode varName, and log-prefix `[design-dispatch]` replaces `[execute-dispatch]`. Add a comment in the frontmatter citing execute-dispatch as the structural mirror anchor so reviewers know drift between the two files is intentional only when propagated explicitly. The `HIVE_DESIGN_MODE` varName is already in the mode-resolver.mjs registry (line 43) — no resolver change needed.
