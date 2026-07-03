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

For every kickoff, populate project classification fields in `.pHive/project-profile.yaml`:

- Ask: `What type of project is this?` Allowed values: `framework`, `consumer-app`, `service`.
- A `project_type` value is **valid** only when it is exactly one of `framework`, `consumer-app`, or `service`. If the user supplies anything else, re-prompt with the allowed values until one is chosen; do not persist an out-of-set value.
- Ask: `Does this project have a UI?` (yes/no). Persist as `has_ui: true/false`.
- Persist both fields to `.pHive/project-profile.yaml`.
- On re-kickoff, if these fields already exist show them and ask whether to keep or change.

**Absent-field contract:** When `has_ui` is missing from a profile it is treated as *unknown* — a conservative default. Skills that gate on `project_gate: requires_ui` must not crash; they should apply a tech-stack heuristic fallback (e.g. check `tech_stack` for `react`, `vue`, `svelte`, etc.) or leave the slot empty rather than erroring. The field is optional in the file; the absence is meaningful and documented.

`project_type` supports future gates beyond UI (e.g. `project_gate: requires_service`). Current valid values:
- `framework` — a library/plugin/tool consumed by other projects (no end-user UI)
- `consumer-app` — a product with a user-facing interface
- `service` — a backend service / API with no direct UI

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

**LSP suggestion (brownfield only):** After Phase 3 resolves `tech_stack` and writes
`.pHive/project-profile.yaml`, check `hive/references/lsp-suggestions.md` for any
applicable LSP suggestions. Read the resolved `tech_stack` from the profile (the
tolerant reader handles both flat-list and nested `languages[]` shapes). If the
detected languages include a confirmed plugin that is not already enabled in
`~/.claude/settings.json`, emit the one-line suggestion from the reference doc. This
step is **non-blocking and text-only** — the `LSP` tool is never invoked and Hive
behavior is byte-identical whether or not the plugin is enabled. Suppress the
suggestion when: the plugin is already enabled, no confirmed plugin exists for the
detected language, or the kickoff is greenfield (no existing tech_stack to read).
Full invariants and suppress-when rules: `hive/references/lsp-suggestions.md` →
§Invariants (single source — do not restate here).

**Discovery Questions (brownfield and greenfield):** After Phase 3 (and after the LSP
suggestion step for brownfield), run the Discovery Questions step to capture a
`north_star` block in `.pHive/project-profile.yaml`. This step runs for both brownfield
and greenfield. Every question is individually skippable — kickoff MUST NOT hard-fail.

See `hive/references/kickoff-protocol.md` Phase 3b for the full protocol: adaptive skip
rules (do not re-ask what current-state discovery already answered), the 4 core
questions (audience, scale, goal, pain points) plus 2 optional follow-ups
(success, avoid), persistence rules (`unknown` for skipped core fields), the north-star
summary and suggested-next-steps output, and the shared `tech_stack` tolerant reader
(flat-list and nested shapes) used by both this step and the LSP suggestion step.
