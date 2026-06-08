---
name: d5-payload-contract-static-analysis-target
description: For doc-only stories, the correct static-analysis test target is the REFERENCE DOC, not a SKILL.md.
applies_to: tester
---

d-5 is a documentation-only story: the implementation writes the Handoff Payload Contract section to
`hive/references/wireframe-protocol.md`, not to any SKILL.md. The tester task initially listed
`hive/workflows/steps/ui-design/test/wireframe-handoff-bundle.test.mjs` as the target path, but the
actual AC coverage requires asserting substrings on wireframe-protocol.md — the same static-analysis
pattern used for SKILL.md tests, just against a different file type (reference doc instead of skill doc).

Non-obvious finding: when a story's `files_to_modify` list targets a reference doc rather than a skill,
place the test file under `skills/design/test/` (the design domain) NOT under
`hive/workflows/steps/ui-design/test/` (a workflow-step path that did not exist and would require new
directory scaffolding). The task description can point to a non-existent path; always check `ls` before
mkdir.

Also: the story spec may name one test file path (`wireframe-handoff-bundle.test.mjs`) while the task
overrides say to create `wireframe-handoff-payload.test.mjs`. The task instruction wins — the story YAML
is the AC source, not the file name oracle.
