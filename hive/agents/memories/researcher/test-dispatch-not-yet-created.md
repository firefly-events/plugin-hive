---
name: test-dispatch-not-yet-created
description: When t-1b says "delegate to test-dispatch", the skill does not exist yet — it lands in t-3; t-1b only wires a Phase 0 invocation stub pointing at a not-yet-created file.
applies_to: researcher
---

`skills/hive/skills/test-dispatch/SKILL.md` is NOT present on the branch as of t-1b work.
It is created in story t-3 (t-3-test-mode-cc-workflows). The t-1b story's AC "delegate
substrate selection to test-dispatch" means: rip the inline HIVE_TEST_MODE resolver and
add a forward-looking Phase 0 invocation call referencing the not-yet-written skill path.
The invocation wires the seam; t-3 fills the contract. Confirmed via vertical-plan.md Slice 2
and structured-outline.md. See also: t-3 story spec files_to_modify.
