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
- Clearly label the opt-out consequence: `Consequence of opting out: metrics stay off. Meta work will use qualitative/backlog mode, and future metric-driven optimization features won't be available.`
- State the companion future-facing clause: `Opting in is what would unlock metric-driven behavior for those future skills.`
- Default to off. The user must actively choose yes.
- Persist the answer to `hive/hive.config.yaml` at `metrics.enabled` using the kickoff protocol's existing config write pattern.

For every kickoff, make sure the project has a concrete ship target:
- Ask: `What does shipping mean for this project?`
- Offer the allowed kinds: `app-store`, `vercel`, `github-release`, `npm`, `custom`.
- Persist the answer to `.pHive/project-profile.yaml` under `ship_target.kind`, with optional `ship_target.notes`.
- If the user chooses `custom`, require a non-empty shell command and persist it to `ship_target.command`; if no command is provided, re-prompt until one is provided or the user chooses a non-custom kind.
- A `ship_target` block is **valid** when `kind` is one of the allowed values AND, when `kind: custom`, `command` is a non-empty, non-whitespace string. (Deeper command sanitization / injection safety is out of scope here — it is the `/ship` executor's responsibility, which dry-runs and confirms the resolved action before running it. This skill performs only the basic non-empty check and re-prompts.)
- On re-kickoff, if `.pHive/project-profile.yaml` already has a valid `ship_target` block, show it and ask whether to keep or change it. If it is missing, add only that block without clobbering other profile fields.
- For Hive itself, use `github-release` because this repo ships through GitHub releases.

For a brownfield re-kickoff where `hive/hive.config.yaml` already has `metrics.enabled` set:
- Read and show the existing `metrics.enabled` value before asking anything.
- Ask whether the user wants to change that existing value, using change-prompt wording rather than the fresh opt-in question.
- If the user keeps the existing value, preserve it exactly and do not write `hive/hive.config.yaml`.
- If the user explicitly changes it, write only the new value to `metrics.enabled` using the kickoff protocol's existing config write pattern.

**Instructions:** Read `hive/references/kickoff-protocol.md` for the full protocol. Shared resources are in `hive/`.
