---
name: integration-availability
description: "agents must check tool_access in team config before using integration tools"
type: pattern
last_verified: 2026-04-08
ttl_days: 90
source: starter
---

Before using any integration tool (maestro, frame0, codex, linearis,
firecrawl, context7, posthog, firebase, mobile-mcp, obsidian), check
your `tool_access` list in the team config. Only tools listed there
were detected as available during kickoff.

Do not assume a tool exists because you know about it. If it's not in
`tool_access`, the CLI or MCP server is not configured in this environment.
Attempting to use an unavailable tool wastes time and produces confusing
error output.
