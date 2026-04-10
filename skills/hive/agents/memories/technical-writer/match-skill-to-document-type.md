---
name: match-skill-to-document-type
description: "each document type has a dedicated skill — always load the right skill before writing; wrong skill produces wrong structure"
type: pattern
last_verified: 2026-04-10
ttl_days: 90
source: agent
---

Before producing any document, identify the document type and load the corresponding skill.
Using the wrong skill (or no skill) produces a document with the wrong structure that the
next agent can't use.

Document type → skill mapping:

| Document | Skill | Use-when |
|----------|-------|----------|
| Design discussion | `skills/hive/skills/design-discussion/SKILL.md` | Planning phase, design choices need discussion |
| Structured outline | `skills/hive/skills/structured-outline/SKILL.md` | Large-scope planning, multi-epic breakdown |
| Horizontal plan | `skills/hive/skills/horizontal-plan/SKILL.md` | Mapping system layers before slicing vertically |
| Vertical plan | `skills/hive/skills/vertical-plan/SKILL.md` | Defining delivery slices from the horizontal map |
| Research brief | No dedicated skill yet — use agent-memory-schema structure | Raw findings → structured summary |

If the required skill file doesn't exist at the specified path: produce the document using
the structure from this memory's table (best-effort), note in the output that the skill
was unavailable, and flag it for the orchestrator.

Do NOT invent a new document structure. If nothing maps, use the research brief format:
sections for Files, Patterns, Constraints, Risks, and Reuse Opportunities.
