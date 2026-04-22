---
name: kickoff
description: Initialize Hive for a new or existing project (brownfield discovery or greenfield planning).
---

# Hive Kickoff

Initialize Hive for a project. Detects brownfield vs greenfield automatically.

**Input:** `$ARGUMENTS` optionally describes the project or intent.

For a fresh kickoff, include the metrics opt-in question before scenario-specific work:
- Ask: `Enable metrics tracking?`
- Keep the trade-off inline and short: opting in enables metric-driven meta-optimization later; opting out keeps metrics off and future meta runs fall back to qualitative/backlog-fallback mode.
- Default to off. The user must actively choose yes.
- Persist the answer to `hive/hive.config.yaml` at `metrics.enabled` using the kickoff protocol's existing config write pattern.

**Instructions:** Read `hive/references/kickoff-protocol.md` for the full protocol. Shared resources are in `hive/`.
