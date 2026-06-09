---
name: d5-payload-contract-insert-location-and-field-naming
description: When adding a payload-contract section to wireframe-protocol.md, append after "Integration with Workflows" (last section) — not between Touchpoint 2 and the YAML section. Field-named not file-glob: /design-review reads index.yaml by named fields (brief_path, export_paths), not directory glob, which is exactly why the payload contract names 3 explicit fields instead of pointing at the topic dir.
applies_to: researcher
---

`hive/references/wireframe-protocol.md` is 99 lines with 7 named sections. "Integration with Workflows" is the final section (line 98). The payload-contract section for d-5 appends AFTER that — inserting it between "Story YAML Wireframes Section" and "Touchpoint Execution Context" would split the touchpoint context block from its touchpoints.

The "field-named not file-glob" design decision has a concrete downstream rationale: `skills/design-review/SKILL.md` step 2 reads `.pHive/design/index.yaml` via `brief_path` and `export_paths` named fields. All working artifacts (v1.png, v2.png, accessibility-constraints.md, animations-constraints.md, brief.md) co-exist in the same topic dir — a glob would silently include all of them. Named payload fields prevent ui-designer working state from leaking into the handoff bundle.
