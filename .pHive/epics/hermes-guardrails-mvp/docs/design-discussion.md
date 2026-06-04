# hermes-guardrails-mvp — design discussion

**Author:** orchestrator (solo-planner, accelerated)
**Date:** 2026-06-03
**Scope:** small-medium (4 stories, single-layer, additive)
**Methodology:** classic

## Goal

Hive-side contract surface so an LLM-agent on-call surface (Hermes today, Claude Code long-running session / OpenCode later) can safely kick off Hive workflows over Slack/Discord without explicit command syntax. The agent (LLM) interprets natural-language chat and routes to Hive commands; this epic gives Hive the four contract surfaces the agent needs to be safe, auditable, and async-friendly.

## Proposed approach

Four atomic, vendor-neutral surfaces under `hive/` + `.pHive/triggers/`. Each is consumable by ANY agent backend without binding to Hermes.

### S1 — Destructive-command catalog
- `hive/references/destructive-commands.yaml` — single source of truth: per Hive command, `{name, destructive: bool, confirm_required: bool, summary}`.
- `hive/lib/destructive-commands.mjs` — loader returning `{getCommand(name), isDestructive(name), listDestructive(), listReadOnly()}`.
- Read-only commands (auto-fire): `/hive:status`, `/hive:standup`, `/hive:triage list`, `/hive:context-snapshot`.
- Mutating commands (confirm required): `/hive:plan`, `/hive:execute`, `/hive:test`, `/hive:design`, `/hive:review`, `/hive:multica-init`, `/hive:metrics-check`, `/hive:polish-audit`, `/hive:visual-qa`, `/hive:logo-exploration`.
- Adding a new Hive skill = one YAML entry, no policy drift across adapters.

### S2 — Run-status event stream
- `hive/lib/run-status-stream.mjs` — append-only JSONL emitter writing `.pHive/triggers/runs/<run-id>.jsonl`.
- One event per terminal phase boundary: `run_started`, `story_dispatched`, `story_completed`, `run_completed`.
- Shim around the existing episode-marker write — every episode marker write ALSO appends one event to the run JSONL.
- Consumers (agent surfaces) tail the file via `tail -f` semantics to edit their Slack message as the run progresses.
- Reuses episode-marker schema fields; does NOT invent a new event vocabulary.

### S3 — Action log surface
- `hive/references/action-log-schema.md` — schema doc: `{timestamp, transport, channel, user, raw_message, resolved_command, executed, run_id, verdict}`.
- `hive/lib/action-log.mjs` — `appendAction(entry)` validates against the schema then appends to `.pHive/triggers/actions.jsonl`.
- `skills/hive/skills/action-log-append/SKILL.md` — atomic skill the agent calls per chat-message → resolved-command pair.
- Feeds `/meta-optimize` learning of agent intent-mapping drift.

### S4 — Pending-confirm registry
- `hive/lib/pending-confirm.mjs` — `register({command, args, expires_at, thread_ref})` writes `.pHive/triggers/pending/<id>.yaml`; `resolve({id, verdict})` consumes entry; `expire()` sweeps expired entries.
- `skills/hive/skills/pending-confirm-resolve/SKILL.md` — atomic skill the agent calls to resolve fire/cancel based on reaction.
- File-on-disk state so the agent can crash + a follow-up tick recovers.

## Substrate composition (no new adapter layer)

- The agent backend (Hermes / Claude Code session / OpenCode) is the consumer. It calls the four surfaces above directly via skill invocation, file read, or library import.
- We do NOT invent a `trigger-dispatch` adapter parallel to `task-tracking-dispatch`. The surfaces are vendor-neutral *by virtue of having no vendor-specific code paths* — same pattern used by `hive/references/episode-schema.md`, which any executor reads.
- Hermes-side prompt/policy and Slack-bot streaming-edit pattern are **OUT of scope** for this epic; they ship on the Hermes repo and consume the surfaces above.

## Risks

- **Risk 1:** Agent backend invents arbitrary commands not in the catalog. *Mitigation:* the catalog is the contract — agent prompt says "only invoke commands in the catalog"; out-of-catalog requests surface to user as "unknown command".
- **Risk 2:** Run-status event stream double-writes when episode markers are revised. *Mitigation:* idempotency key per event (`<run_id>:<story_id>:<phase>`); append-only with dedup on read.
- **Risk 3:** Pending-confirm registry leaks expired entries. *Mitigation:* `expire()` sweep runs at every `resolve()` call; cap entries with TTL hard-stop in YAML.
- **Risk 4:** Action log grows unbounded. *Mitigation:* JSONL is cheap; rotate weekly via separate housekeeping skill (deferred).

## Dependencies

- `hive/references/episode-schema.md` (existing) — S2 reuses its event shape
- `hive/references/skill-prelude.md` (existing) — atomic skills compose with prelude pattern
- `hive/lib/task-tracking-dispatch/` (existing) — pattern reference for shape, NOT a parallel adapter

## Open questions

1. Does the run-status stream live at `.pHive/triggers/runs/<run-id>.jsonl` or at `${HIVE_STATE_DIR}/triggers/runs/<run-id>.jsonl`? (recommend the second — respects `paths.state_dir` per Slice 1 resolver contract.)
2. Should `expires_at` in the pending-confirm registry default to 5 min or 30 min? (recommend 5 min; long-running confirmation is a UX failure of the agent surface, not Hive's job to accommodate.)
3. Schema doc as the contract for S3 — should we also ship a JSON Schema file for programmatic validation? (defer to Hermes follow-up planning; markdown schema is sufficient for MVP.)

## Scale assessment

**Medium.** 4 stories, 4 cross-stack surfaces (data file, library, skill, references), additive (no behavior change to existing /execute pipeline). H/V planning not strictly required because the slices are independent and disjoint; skipping H/V with `--fast` is reasonable. Will proceed directly to Phase C decomposition.

## Validation goal

This epic is the FIRST real (non-smoke) cc-workflows substrate test. Each story runs full classic workflow (preflight → research → implement → test → review → integrate). Substrate findings will surface against real test material instead of trivial appends.
