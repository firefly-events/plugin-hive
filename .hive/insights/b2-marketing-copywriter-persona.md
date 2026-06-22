# Insight: b2 marketing-copywriter persona

## The dual-dispatch body constraint is the hardest part

The persona body must work verbatim as a Codex `developer_instructions` string, meaning it cannot rely on Hive-only fields for anything behavior-critical. In practice this means the tool restriction and the consumer-only guard must both appear in prose — the `tools` allowlist alone is invisible to Codex.

## Mirroring marketing-strategist (b1) deliberately

The b2 persona mirrors b1's structure exactly: same 5 CC fields, same knowledge/domain layout, same activation-protocol shape, same insight-capture section. This was intentional: the orchestrator spawns these agents in sequence and a consistent structure reduces reviewer cognitive load.

## Role boundary phrasing matters

The "Role boundary" section explicitly names the agents on either side (b1 for strategy, b3 for visuals). A future copywriter reading the persona should know exactly where their job ends without having to infer it. This also prevents the most common copywriter overreach: writing alt-text direction or image briefs that belong to ad-creative.

## domain write scope mirrors strategist

Both b1 and b2 write to `.pHive/epics/*/docs/` and `.hive/insights/`. Neither gets write access to `**`. This is intentional — campaign artifacts live in the epic's docs dir, and broad write access is inappropriate for agents that only produce markdown deliverables.

## color: cyan was the remaining unused slot

marketing-strategist took yellow, ui-designer took magenta, developer took green. Cyan was the natural remaining distinct color for a sibling marketing persona.
