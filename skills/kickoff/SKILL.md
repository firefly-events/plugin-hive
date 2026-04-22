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

For a brownfield re-kickoff where `hive/hive.config.yaml` already has `metrics.enabled` set:
- Read and show the existing `metrics.enabled` value before asking anything.
- Ask whether the user wants to change that existing value, using change-prompt wording rather than the fresh opt-in question.
- If the user keeps the existing value, preserve it exactly and do not write `hive/hive.config.yaml`.
- If the user explicitly changes it, write only the new value to `metrics.enabled` using the kickoff protocol's existing config write pattern.

**Instructions:** Read `hive/references/kickoff-protocol.md` for the full protocol. Shared resources are in `hive/`.
