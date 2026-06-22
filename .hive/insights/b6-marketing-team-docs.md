# b6 — Marketing Team Docs: Insights

## Consumer-gate language is the load-bearing detail

The README and operations guide both need to surface the consumer-only restriction *inline* — not just in the agent files. Users discovering the skill via the docs will not read agent frontmatter. Burying the gate there means operators accidentally trigger marketing agents on Hive-internal epics and get confusing "stop and flag" behavior with no prior warning.

**Pattern:** Any agent or skill that carries a domain-scope restriction should document that restriction at the top-level docs entry point, not only in its own config.

## visual-asset is agent-facing — omit from user Commands sections

The visual-asset skill has no `/hive:visual-asset` command. It is invoked by other agents (ad-creative, ui-designer, logo-exploration). Listing it in the Commands reference would mislead users into trying to call it directly. Correct placement: a "Shared Skills (Agent-Facing)" subsection under the Agent Roster, with explicit note that no top-level command exists.

## The three-persona team structure is the docs unit

Documenting `/marketing-campaign` alone is insufficient — users need to understand *who* runs inside it (strategist → copywriter → ad-creative pipeline) to interpret its output and route feedback. README and ops guide both surface the three personas alongside the skill entry.
