# Research Brief — Multica Substrate-Deepen Epic

**Epic id:** `multica-substrate-deepen`
**Base branch:** `develop`
**Branch strategy:** per-epic
**Produced:** 2026-05-26

## Goal in one sentence

Expand plugin-hive's Multica integration from task-tracking-only + single-developer dispatch to a substrate-first model that uses Multica's full primitive set — multi-persona agents, squads, autopilots, and the native skills layer — while eliminating the inner-session `/codex:rescue` indirection by routing creator personas directly to codex-backed Multica agents.

## Current state (verified, not assumed)

### Adapter (`hive/adapters/multica/index.ts`, 445 lines, ABI 1.0.0)

ABI methods supported (4):
- `capabilities`
- `createStory({title, body, labels, parent_issue_id})` — POST `/api/issues`
- `updateStory({id, status})` — PUT `/api/issues/{uuid}?workspace_id={uuid}`
- `getStory(tracker_id)` — GET via identifier→UUID resolve, with in-memory cache
- `addComment` — POST `/api/issues/{uuid}/comments`

Helpers (non-ABI): `moveOutOfBacklogIfNeeded`, `ensureIssueBriefMatches`, `pollTaskUntilTerminal`, `writeMulticaRunEpisode`.

### Bootstrap (`hive/lib/multica-bootstrap/`)

Module surface: `checkHealth`, `ensureCli`, `ensureAuth`, `ensureWorkspace`, `ensureDaemon`, `reconcileAgents`. `reconcileAgents` reads `.pHive/multica/agents.yaml`, resolves runtime IDs, loads persona instructions, and applies diff-only create/patch.

### Dispatch (`hive/lib/multica-story-dispatch/index.mjs`)

- `serializeStoryBrief(story, {codexInstruction})` — when `codexInstruction: true`, brief embeds a `## Use /codex:rescue` section that instructs the inner Claude Code session inside the Multica task to invoke `/codex:rescue` for implementation (index.mjs:140-150).
- Triggered when `hive_config.agent_backends.developer === 'codex'` from `skills/hive/skills/execute-mode-multica/SKILL.md` Step 1.

### Bootstrap config (`.pHive/multica/agents.yaml`)

3 personas only: `developer`, `tester`, `reviewer`. All `provider: claude`; reviewer on `claude-opus-4-7`, others on `claude-sonnet-4-6`. All carry `persona_ref` + `custom_env.CLAUDE_PLUGIN_PATH`. `skills: []` on every entry.

### Plugin-hive persona inventory (25 in `hive/agents/`)

`developer`, `tester`, `reviewer` (bootstrapped) + 22 unused: `accessibility-specialist`, `analyst`, `animations-specialist`, `architect`, `backend-developer`, `frontend-developer`, `idiomatic-reviewer`, `orchestrator`, `pair-programmer`, `peer-validator`, `performance-reviewer`, `researcher`, `security-reviewer`, `team-lead`, `technical-writer`, `test-architect`, `test-inspector`, `test-scout`, `test-sentinel`, `test-worker`, `tpm`, `ui-designer`.

## Multica CLI surface (confirmed via `multica --help` traversal)

| Domain | Subcommands |
|---|---|
| `agent` | archive, avatar, create, get, list, restore, skills, tasks, update |
| `squad` | activity (leader evaluation), create, delete, get, list, member, update |
| `autopilot` | create (`--mode create_issue\|run_only`, `--agent` required), trigger-add (schedule / webhook), trigger-update, trigger-rotate-url, trigger-delete, runs, get, update, delete |
| `skill` | create, delete, files, get, import (clawhub.ai / skills.sh / github.com), list, update |
| `runtime` / `daemon` | local agent runtime control |

Provider/model field on `agent create` accepts `provider/model` format (e.g. `openai/gpt-4o`, `claude-sonnet-4-6`). **Confirmation that codex is acceptable at agent.provider is open** — only `claude` is empirically used in `.pHive/multica/agents.yaml` today. Researcher could not confirm codex enum from CLI help text; spike source inspection needed.

## Multica primitive model (from `~/Code/spikes/multica/docs/product-overview.md` + `agent-quick-create-plan.md`)

- **Workspace** — top-level tenancy boundary. One per project.
- **Issue** — tracker primitive; created by users or by `multica issue create` (called from inside agent tasks via quick-create flow).
- **Agent** — first-class principal. `{name, runtime_id, model, instructions, max_concurrent_tasks, visibility, skills}`. Skills attach M:N via `agent_skill` table.
- **Squad** — group of agents with one leader; squad leader can call `squad activity` to record an evaluation on an issue (governance primitive).
- **Autopilot** — scheduled or webhook-triggered automation. `create_issue` mode files new issues on a cadence; `run_only` mode runs an agent task without filing.
- **Skill** — native primitive. Backed by `skill` (SKILL.md content) + `skill_file` (attachments) + `agent_skill` (M:N). Daemon materializes per-task to `workDir/.claude/skills/` (or `.cursor/skills/`, or `$CODEX_HOME/skills/`) before runtime starts, then `RemoveAll` on task end. Postgres is source of truth.

## The friction-note-6 blocker (definitive)

**Diagnosis:** server-side gap, not adapter-side.

- `createStory` payload sends `labels` array → Multica POST `/api/issues` accepts it (issue.go handler in spike confirms).
- GET `/api/issues/{id}` response does not reliably include the `labels` field — adapter treats missing as empty and does NOT error.
- Implication: `hive:ready` / `hive:blocked-by:*` / `hive:epic:*` namespace cannot be relied on for inbound queries (`gh issue list --label hive:ready` equivalent). This blocks any squad/autopilot wiring that reads labels to gate dispatch.

**Resolution paths:**
1. Patch Multica server to return labels on GET (upstream PR — out of plugin-hive scope unless spike is forkable).
2. Adapter-side workaround: encode labels in issue description / body metadata block; adapter parses on read.
3. Use Multica's native equivalent (project / squad membership / autopilot triggers) instead of labels for the same intents.

Path 3 is most aligned with substrate-first direction — squads + autopilots replace `hive:ready` semantics natively.

## Reference docs cited

- `hive/adapters/multica/index.ts` — adapter implementation
- `hive/adapters/multica/friction-notes.md` — 7 ABI items, item 6 = labels
- `hive/lib/multica-bootstrap/README.md` — provisioning surface
- `hive/lib/multica-story-dispatch/index.mjs` — `serializeStoryBrief` codex-instruction injection (lines 140-150)
- `hive/references/multica-agents-schema.md` — agents.yaml shape contract
- `skills/hive/skills/execute-mode-multica/SKILL.md` — current single-developer dispatch contract
- `.pHive/multica/agents.yaml` — current 3-persona bootstrap
- `~/Code/spikes/multica/docs/product-overview.md` — Multica feature surface (Chinese; translated above)
- `~/Code/spikes/multica/docs/agent-quick-create-plan.md` — skill data model (sections 2.2-2.5)

## Constraints carried in from caller

- Local-first: Multica spike server, no cloud dep
- Honor 2026-05-01 codex-general-backend routing policy (creators on codex, verifiers on claude)
- One branch per epic, one commit per story (`feedback_git_flow_per_epic`)
- Test feasibility before rewriting (`feedback_test_offtheshelf_before_rewriting`)
- Delivery via /execute skill (`feedback_must_use_execute_skill`)

## Inconsistency-risk signals (for /grill)

1. **Codex-provider claim is unconfirmed.** Brief assumes Multica `agent.provider` accepts codex. CLI help text neither confirms nor denies. If only `claude` is supported, Phase A pivots to a different mechanism (per-task env injection, runtime-level codex registration).
2. **Labels gap blocks squad-leader routing.** If autopilots / squad-activity gating depends on label state for "is this issue dispatchable," and labels don't round-trip, Phase B (squads) is upstream-blocked. Choice between patching server, adapter workaround, or skipping label-based gating entirely is not yet resolved.
3. **Skill import via github URL — privacy & auth.** Plugin-hive skills currently live in this repo. Importing them as Multica skills via `skill import https://github.com/...` would publish them to the spike workspace's `skill` table. Cleanup story or visibility=private flag needed.
4. **2026-05-01 codex-routing policy vs Multica daemon execution.** Today, codex routing happens via `/codex:rescue` invoked by a Claude Code session inside the Multica task. If we shift to native codex-provider Multica agents, the rescue dance disappears — but only if codex provider is actually supported. Need a Phase A spike, not assumption.
5. **22 unused personas in mode-of-use blindness.** Listing all 25 personas in agents.yaml is cheap; verifying any of the 22 are actually useful when dispatched standalone (vs as subagents under a team-lead in the Claude Code harness) is the real cost. Some personas (orchestrator, team-lead, pair-programmer, peer-validator) only make sense in a multi-agent harness — porting them naively to Multica's one-agent-per-task model is a category error.

## Validation note

- context7 query for "Multica SDK" / "Multica API" — no public registry hit (Multica is a spike-stage product). Falling back to spike source as ground truth.
- Web research not escalated — Multica is private/local; public docs would not exist.
- Confidence: **medium-high** for plugin-hive state (direct file reads, verified); **medium** for Multica primitives (translated from Chinese docs; spike source not fully audited); **low-medium** for codex-provider support claim (unconfirmed).
