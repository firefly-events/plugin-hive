# Insights: b3 Ad Creative Persona Authoring

## Dual-runtime body constraint is the hardest part

The dual-dispatch contract (grounding doc §3) means the persona body must work verbatim as both a Claude Code system prompt AND as Codex `developer_instructions`. The practical consequence: every behavior-critical instruction must live in the body prose, not just in Hive-only frontmatter fields (`knowledge`, `domain`, `skills`). Tool restriction, consumer-scope guard, and render-delegation rules all had to be stated in body prose even though they're also expressed in frontmatter.

## skills[] vs required_tools[] distinction matters for b7 delegation

`required_tools` is for MCP/CLI tools the persona itself invokes directly. `skills` is for Hive-orchestrated skill invocations. The visual-asset render delegation belongs in `skills`, not `required_tools`, because the persona does not call b7 directly — the orchestrator routes to it. Marking it `optional: true` is correct since b7 doesn't exist yet in v1; the skill path is a forward declaration.

## ui-designer boundary placement

The boundary note in ui-designer.md needed to go at the top of the "Marketing and advertising materials" section, not at the bottom, so it's encountered before the platform spec table. An agent reading top-to-bottom would otherwise internalize the section as "I own all marketing assets" before hitting any qualifier.

## ad-creative must not produce copy

The persona must be firm that it receives copy as input (from b2) and does not produce it. Otherwise ad-creative and marketing-copywriter will overlap when an image-gen prompt needs headline text embedded — the agent needs to treat the copy it receives as a given, not generate alternatives.
