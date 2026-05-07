# Changelog

All notable changes to Plugin Hive are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

## [1.2.2] - 2026-05-07

### Fixed
- **Session runtime CodeRabbit pass (PR #50 follow-up).** Resolves all
  8 inline findings filed against the memory-autonomy Phase 2 session
  execution path. Behavior unchanged for `sessions.enabled: false`
  (the default), but every fix is correctness-relevant once the
  feature is opted in.
  - `hive/lib/session-client.js` — `sendEvents()` now calls
    `client.beta.sessions.events.send()` (the actual SDK method)
    instead of the non-existent `events.create()`. Would have thrown
    `TypeError` on the first tool turn.
  - `hive/scripts/session-invoke.mjs` — extracted
    `handleRequiresAction()` and `drainStream()` helpers; the SSE
    flow now loops tool turns until a terminal `complete` is observed
    (capped at `MAX_TOOL_TURNS=16`). Previously a session with a
    nested `requires_action` was silently marked `completed` after the
    first tool round and the episode YAML was written without the
    unanswered turn.
  - `hive/lib/session-registry.js` — `acquireLock()` now PID-stamps
    the sentinel file and detects dead holders via
    `process.kill(pid, 0)`, unlinking and retrying immediately.
    Prevents a single crash from degrading the registry to permanent
    fail-open.
  - `hive/lib/session-episode-writer.js` — episode filenames include
    a 12-char sanitized `session_id` suffix
    (`<step_id>-<suffix>.yaml`); stuck-retry no longer overwrites the
    prior failed attempt's episode YAML.
  - `hive/lib/session-prompt-builder.js` — `KG_SQLITE_PATH` uses
    `os.homedir()` instead of `process.env.HOME || '~'` (Windows
    safe; no literal `~` paths).
  - `hive/lib/session-registry.js` — `upsert` insert-path pins
    `session_id` last in the spread, mirroring the update-path's
    ordering.
  - `hive/references/session-registry-schema.md` — re-aligned the
    ASCII lifecycle diagram so the `stuck` arrow visually originates
    under `active`, not `pending`.
  - `hive/references/session-resilience.md` — opening paragraph now
    references `step 6c` (matching line 8 + the References section);
    the previous `step 6b` collided with `cmux`'s 6b in main.

## [1.2.1] - 2026-05-07

### Added
- **Session-based execution path (memory-autonomy Phase 2).** New
  opt-in `/v1/sessions` runtime brings session-aware story execution
  to the `execute` skill as a top-priority mode. Ships a session
  registry at `${HIVE_STATE_DIR}/sessions/index.yaml`
  (`pending|active|completed|failed|stuck`) plus six lib modules
  (`session-client`, `session-episode-writer`, `session-prompt-builder`,
  `session-registry`, `session-sse-reader`, `session-turn-builder`),
  the `hive/scripts/session-invoke.mjs` driver, and an SSE
  stuck-detection + retry contract that replaces respawn for session
  execution. Default OFF; consumers opt in via
  `sessions.enabled: true` in `hive.config.yaml` or
  `HIVE_SESSIONS_ENABLED=1`. The existing TeamCreate path
  (step 6 / 6b cmux) is preserved unchanged.
- **`hive/references/session-registry-schema.md`** and
  **`hive/references/session-resilience.md`** — schema + resilience
  contracts for the new path.
- **`skills/hive/skills/session-registry/SKILL.md`** — bootstrap skill
  for the registry.

### Changed
- `skills/execute/SKILL.md` — adds `step 6c` session execution block;
  routes session sidecar injection through main's `appends[]` map and
  the canonical `specialist-triggers.md` catalog.
- `skills/hive/skills/respawn/SKILL.md` — callout that respawn does
  not apply under the session execution path.
- `hive/references/configuration.md` — documents the new `sessions.*`
  config block.
- `README.md` — version badge bumped to 1.2.1; ToC, revised North
  Star, and QRSPI inspiration link landed via PR #47.

### Chores
- Backfill `integrate.yaml` episode stamps for all 13
  `hive-dag-executor` stories (`hde-0` through `hde-10`).
- Meta-meta nightly cycle for 2026-05-07 (telemetry + ledger).

## [1.2.0] - 2026-05-04

### Added
- **Hive DAG executor v1 — cutover complete.** The deterministic DAG
  executor (`hive/lib/dag_executor/`) graduates from optional opt-in to
  the target runtime for workflows. 11 of 11 built-in workflows are now
  in the per-workflow graduation registry at
  `.pHive/runtime/executor-graduated-workflows.yaml`:
  `meta-team-cycle`, `code-review`, `performance-audit`, `test-swarm`,
  `development.tdd`, `development.bdd`, `development.tdd-codex`,
  `ui-design`, `design-review`, `development.classic`, `daily-ceremony`.
  Workflows opt in via
  `executor: hive-dag` + `executor_default: true` in
  `.pHive/hive.config.yaml`; default OFF posture preserved for
  consumers that don't flip the flag.
- **PR #31's metric_signal/findings conflation bug class is structurally
  retired.** AND-of-empty routing between `meta-team-cycle`'s
  `proposal` and `backlog-fallback` graduates from prose-narrated
  orchestrator judgement to mechanical YAML predicate evaluation against
  `step-02-analysis`'s declared `output_format` fields (`metric_signal`,
  `findings_count`, `external_candidates_count`).
- **`daily-ceremony` plan-approval gate ships as `node_type: pause`.**
  Operator approval sentinels at
  `<runs_root>/<run_id>/pause/plan-approval.{approve,reject}` carry the
  HMAC-signed token from the `pause_suspended` telemetry event (hde-8
  anti-forgery contract). Existing `step-06-approve-plan.md` is
  preserved as the operator-facing presentation script.
- **`hive/decisions/001-executor-cutover.md`** — canonical migration
  guide for graduating custom workflows; rollout history and sunset
  path for orchestrator-narrated routing; per-workflow rollback
  primitives.
- **`hive/references/story-spec-schema.md`** — minimal schema for the
  `metadata.needs_backend` / `metadata.needs_frontend` story booleans
  consumed by `development.classic`'s YAML-level domain decomposition.

### Changed
- `hive/references/workflow-schema.md` — the existing "Executor Cutover"
  section now also documents authoring-forward defaults: declarative
  `when:` predicates, structured `output_format` blocks, and named
  outputs are recommended for new workflows. Prose-routed workflows
  remain supported under the orchestrator-narrated path
  (maintenance-mode); the path is not removed in this release.
- `hive/GUIDE.md` — adds a "Hive DAG Executor (optional, per-workflow
  opt-in)" section with the consumer opt-in shape and migration guide.
- `hive/MAIN.md` — adds a "Two Execution Paths" architecture note and
  updates the Key References table with predicate-grammar, story-spec,
  and the executor ADR.
## [1.1.4] - 2026-05-01

### Added
- **kg_signal proposal source for `/meta-optimize`.** New optional workflow
  step `step-02c-kg-signal.md` queries the L2 knowledge graph for
  `phase_failed`, `phase_blocked`, and `superseded` triples and emits
  `kg-findings.yaml` with `discovery_source: kg_signal`. Three-layer relevance
  filter: predicate vocabulary, recency window, project-tag rank penalty.
- **System-level project registry + KG bootstrap.** New
  `~/.claude/hive/projects.yaml` registry plus
  `scripts/kg-bootstrap-from-projects.js` walks registered project roots and
  seeds `~/.claude/hive/kg.sqlite` with multi-project decision history.
- **step-03 proposal merge accepts kg_signal findings.** Auto-tags untagged
  KG findings with `discovery_source: kg_signal`, dedupes against internal
  grouped findings, and ranks the merged pool.
- **KG-before-backlog routing in meta-optimize.** Precedence is now
  metrics → external research → kg_signal → backlog. Threshold blending,
  new `meta_optimize.kg_signal` config block (`enabled` / `window_days` /
  `cross_project_penalty`); `enabled: false` reverts to the legacy
  metrics → backlog flow. No-op when `kg.sqlite` is absent.
- **End-to-end fixture for kg-augmented-meta-signal.** New
  `tests/fixtures/kg-augmented-meta-signal/` (seed.sql + run.sh + README.md)
  proves the full path with no Node deps — uses system `sqlite3` CLI per
  the bring-your-own-enhancements philosophy. Includes LLM-mediated step-02c
  run, mental-trace through step-03 and meta-optimize routing; all 6 fixture
  ACs verified.
- **OSS rollout brand foundation.** Concept-4 logo (`assets/hive-logo.svg`,
  256/400/512/1024 PNGs and lockup variants), README hero block with
  positioning tagline, Inspirations credit block.
- **README audit for 1.1.3+ drift cleanup.** New "Memory architecture"
  section (L0–L3 tiers + KG + ChromaDB graceful degradation + session-end
  three-op orchestration), Meta Optimization "Proposal sources" rewrite,
  persona count correction, Extensibility path-prefix fixes, cmux row
  description refresh, migration callout.
- **Versioning cross-cutting concern.** New entry in
  `.pHive/cross-cutting-concerns.yaml` requires consumer-visible epics to
  bump `.claude-plugin/plugin.json` + `marketplace.json`, update the README
  badge, and add a CHANGELOG entry. Prevents silent version drift.

## [1.1.3] - 2026-04-28

### Added
- **Memory & Autonomous Execution Phase 1 — Knowledge Graph (KG) substrate ships.**
  Cross-project, time-versioned decision/lifecycle store at `~/.claude/hive/kg.sqlite`.
  Triples are subject–predicate–object with controlled predicate vocabulary
  (`decided`, `superseded`, `assigned_to`, `blocked_by`, `depends_on`, `phase_started`,
  `phase_complete`, `phase_failed`, `phase_blocked`). WAL-mode SQLite, idempotent
  bootstrap DDL, unique index on `(subject, predicate, object, source_epic)`.
  See `hive/references/knowledge-graph-schema.md`.
- `MemoryStore.query_decisions(filter)` method — point-in-time triple retrieval
  with `entity` / `predicate` / `as_of` / `include_superseded` filters. Documented
  in `hive/references/memory-store-interface.md`.
- KG write path: `kg_write()` in `hive/lib/session-end.js` persists triples at
  session-end and pre-shutdown via the canonical three-op orchestration
  (insights → kg_write → compile ‖ chromadb.index). `INSERT OR IGNORE` with
  runtime `idx_unique_triple` precondition guard.
- KG bootstrap utility: `scripts/kg-import-cycle-state.js` — one-time backfill
  from existing `.pHive/cycle-state/*.yaml`. Atomic transaction wrapping,
  ISO-normalized `valid_from`, dry-run preview, surfaced fallback YAML parse drops.
- KG read path: `agent-spawn` Step 5e injects a "Decision Context" block into
  agent prompts using two `query_decisions({entity})` calls (current_agent +
  current_epic), merged and dedup'd by `(subject, predicate, object, valid_from)`.
- **ChromaDB L3 semantic memory tier (optional).** JSON-RPC wrapper at
  `hive/lib/chromadb-wrapper.js` (`isAvailable()`, `query()`, `index()`),
  agent-namespaced docIds (`${agentName}/${slug}`), graceful degradation to
  L1+L0 when sidecar absent. Indexed at session-end Phase C in parallel with
  `compile()`.
- **Session System Prompt Specification.** Authoritative design at
  `hive/references/session-system-prompt-spec.md` defining session prompt
  composition (persona + prior knowledge + KG decision context + domain note),
  per-step story context injection, session lifecycle, completion detection,
  and cleanup. Foundation for Phase 2 Managed Agent API migration.
- Session-end orchestration skill at `skills/hive/skills/session-end/SKILL.md`
  with three-phase ordering (Phase A insights → Phase B kg_write → Phase C
  compile ‖ chromadb.index), 30-second latency monitoring, asymmetric failure
  handling (KG = surface error, ChromaDB = warn only), and `skipCompile` for
  hard-shutdown pressure.
- Pre-shutdown protocol updated to share the canonical session-end orchestration
  via `runSessionEnd({ skipCompile: true })`.

### Changed
- Memory tier table in `memory-store-interface.md`: L3 row replaces the Qdrant
  placeholder with the actual ChromaDB JSON-RPC wrapper that ships in this release.
- `DecisionFilter.subject?` renamed to `DecisionFilter.entity?` to match the
  canonical SQL placeholder and accurately describe the cross-column matching
  behaviour (`subject = :entity OR object = :entity`).

### Fixed
- `session-end.js`: replaced `process.env.HOME` with `os.homedir()` so paths
  resolve in containerized / sanitized environments.
- `session-end.js`: agent-name and slug input validation (kebab-case regex +
  resolved-path containment) guards ChromaDB indexing against directory
  traversal via crafted inputs.
- `session-end.js` `kgWrite()`: `db.close()` is now guaranteed via try/finally
  even when `sqlite3()` open or `prepare()` setup throws.
- `chromadb-wrapper.js`: `query()` checks HTTP status before parsing the body
  (rejecting 4xx/5xx error payloads); `index()` drains the response body for
  keep-alive cleanliness; dropped unused `metadatas` from `query()` include list.
- `kg-import-cycle-state.js`: real-mode imports now wrap the entire backfill
  in `db.transaction()` for atomicity; fallback YAML parse drops are surfaced
  rather than silently swallowed; dry-run summary renamed to "Would process"
  to remove the optimistic claim that all parsed triples would insert.
- Markdown lint: collapsed multi-space blockquote continuations and removed
  spaces inside code spans across the KG/memory-autonomy stack.

## [1.1.2] - 2026-04-23

### Added
- **Public `/meta-optimize` skill ships (MVS milestone).** New consumer-facing
  skill that proposes and runs improvement experiments against a user project,
  with PR-only promotion (no direct main mutation), human-edit-only backlog
  fallback at `.pHive/meta-team/queue-meta-optimize.yaml`, and unknown-metric-
  dimension tolerance. See `skills/hive/skills/meta-optimize/SKILL.md` and
  `hive/references/meta-optimize-contract.md`.
- `PrPromotionAdapter` in `hive/lib/meta-experiment/` — concrete PR-artifact
  adapter alongside the maintainer `DirectCommitAdapter`. Close records
  carry explicit `pr_ref` + `pr_state` evidence.
- MVS acceptance proof at `.pHive/audits/mvs-proof/` (canonical + `latest.yaml`
  pointer), 10-item integrity checklist. Regeneration gated behind
  `HIVE_WRITE_MVS_PROOF=1` (see `hive/references/meta-optimize-maintainer.md`).
- `paths.state_dir` config setting (default: `.pHive`) — override to keep
  legacy `state/` or pick any directory name.
- Migration script: `scripts/migrate-state-to-pHive.sh` — renames `state/`
  to `.pHive/` while preserving git history and updating `.gitignore`.
- Kickoff Step 0: detects legacy `state/` directories on existing projects
  and offers in-place migration (or opt-in to keep using `state/`).

### Changed
- **Default state directory renamed `state/` → `.pHive/`.** Hidden by default
  (like `.git/` or `.claude/`). Configurable via `paths.state_dir` in
  `hive.config.yaml` if you prefer a different name.
- All skills and references updated to use `.pHive/` as the default storage
  location for epics, episodes, cycle state, sessions, memories, etc.
- Kickoff gate in every skill now proceeds silently when checks pass — no
  user-visible announcement. The gate still surfaces actionable guidance
  when a check fails.

### Migration
Existing projects with a `state/` directory should migrate. Two supported paths:

1. **Auto-migrate** (recommended): re-run `/hive:kickoff`, choose `yes` at
   the migration prompt.
2. **Manual migrate**: `bash scripts/migrate-state-to-pHive.sh` from your
   project root.

> **Note:** `paths.state_dir` is documented in the config schema but not yet
> wired into runtime path resolution in every skill. If you cannot migrate
> immediately, a symlink (`ln -s state .pHive`) is a safe stopgap. Full
> config-driven path resolution is tracked as follow-up work.

### Known follow-up
Wiring `paths.state_dir` end-to-end requires a single path resolver that
every skill, workflow step, agent domain spec, and hook reads from. Right
now those references hardcode `.pHive/` directly. This is deliberate scope
for this PR (rename + migration tooling + config surface); resolver wiring
will be a dedicated follow-up so the path changes stay reviewable. Until
that lands, any override of `paths.state_dir` other than the default
`.pHive` is best-effort — use the symlink stopgap if you need a different
layout today.

## [1.1.1] - 2026-04-18

cmux v2 API as native team execution backend.

### Added
- cmux team execution path (execute step 6b) — orchestrator manages parallel
  stories in cmux panes via v2 JSON-RPC API instead of TeamCreate
- `execution.interactive_panes` config toggle — controls whether cmux-spawned
  agents (Claude and Codex) launch in interactive or one-shot mode
- v2 API annotations in agent-spawn skill (surface.split, surface.send_text,
  surface.read_text, surface.health, surface.close)
- Completion marker convention (`[STORY-COMPLETE:{story-id}]`) for poll-based
  story completion detection
- Failure propagation for blocked dependents in cmux execution path
- Mode-dependent steps 8/9 in agent-spawn (team vs standalone pane lifecycle)

## [1.1.0] - 2026-04-17

External model integration: cross-model execution with OpenAI Codex.

### Added
- Per-agent spawn backend axis (`agent_backends` in `hive.config.yaml`) —
  route roster personas through OpenAI Codex in side-by-side cmux panes
  via the new `codex-invoke` skill. Default (unset) remains `claude`.
- TDD cross-model workflow (`development.tdd-codex.workflow.yaml`) — Claude
  writes tests, Codex implements in a persistent cmux pane, Claude reviews
  with a fix loop on the same pane before shutdown.
- Terminal multiplexer config (`execution.terminal_mux`) — tmux, cmux, or auto
- Persistent pane mode for multi-turn Codex workflows with idle timeout safety net
- Adapter prefix for persona reuse across models without forking
- Supported Codex personas: backend-developer, reviewer, technical-writer,
  architect, tpm

## [1.0.0] - 2026-04-09

First public OSS release under Apache 2.0.

### Added
- Apache 2.0 license
- Contributor documentation suite (CONTRIBUTING.md, CHANGELOG.md)
- GitHub issue and pull request templates with issue-first contributor model
- Ops guide for installation, configuration, and day-to-day operation
- Reference doc scrub replacing internal Firefly examples with generic ones
- Repository cleanup removing internal artifacts and fixing `.gitignore`
- Aligned `plugin.json` and `marketplace.json` to v1.0.0

---

## [0.9.0] - 2026-04-08

Autonomous meta-team for nightly self-optimization.

### Added
- Meta Team infrastructure: state schema and run ledger (`meta-team s1`)
- Optimization charter (`program.md` equivalent) defining meta-team goals (`s2`)
- Baseline cycle: boot, analyze Hive internals, close (`s3`)
- Sandbox pipeline: worktree isolation, destructiveness enforcement, promotion, rollback (`s4`)
- Full nightly cycle: 5-agent pipeline, 8 phases, `CronCreate` scheduling (`s5`)
- External research loop: web scanning with time budgets and source attribution (`s6`)
- Memory-driven targeting: pattern detection across Hive memory ecosystem (`s7`)
- Subjective evaluation UX: morning summary, `/meta-team review`, `/status` integration (`s8`)
- 5 specialist agent personas: UI, Performance, Security

---

## [0.8.0] - 2026-04-08

Extended onboarding flow with greenfield discovery and deeper brownfield analysis.

### Added
- Greenfield discovery skill: 7-step flow for deep product brainstorming
- Greenfield adaptation of existing brownfield capabilities
- Extended onboarding report, team config generation, and starter memory creation
- Cross-cutting concern auto-generation (Phase 2b-iv)
- Developer discovery elicitation (Phase 2b-ii)
- Linter detection, pre-commit hook scanning, snippet extraction, test-first signals (Phase 2b-iii)
- Data contracts for extended onboarding (schema foundations)
- Kickoff gate enforced at all user-invocable Hive commands

---

## [0.7.0] - 2026-04-06

Memory redesign: federated agent memory with TTL, provenance, and wiki compilation.

### Added
- `MemoryStore` interface and `MemoryBundle` federation format
- TTL, staleness detection, and provenance fields on agent memory schema
- Wiki compilation step in session-end workflow with compilation guide
- Wiki-first retrieval in agent-spawn and staged insight recovery
- Starter memories and onboarding guide for memory federation
- Mermaid standardized for dependency diagrams across all docs

---

## [0.6.0] - 2026-04-05

Planning flow improvements: TeamCreate gates, self-contained stories, agent respawn.

### Added
- `TeamCreate` team assembly and collaborative review gates in planning phase
- Self-contained story specs with inline snippets and methodology-aware steps
- Agent respawn skill for context-aware lifecycle management
- Pre-shutdown readiness protocol across all persona files
- Orchestrator pre-shutdown insight extraction
- Stop hook registration and interrupt detection

---

## [0.5.0] - 2026-04-02

Agent infrastructure v2: config schema, memory architecture, planning, and portability.

### Added
- Agent config schema reference (`hive/references/agent-config-schema.md`)
- Workflow schema reference (`hive/references/workflow-schema.md`)
- Team config schema reference (`hive/references/team-config-schema.md`)
- Configurable model tiers in `hive.config.yaml`
- Portable plugin structure with `${CLAUDE_PLUGIN_ROOT}` path resolution

---

## [0.4.0] - 2026-03-28

Step file architecture: BMAD-style step files across all workflows.

### Added
- BMAD-style step files for all core Hive workflows
- Step files for UI designer workflow
- `step-file-schema.md` reference document
- Per-project cross-cutting concerns system (`state/cross-cutting-concerns.yaml`)
- Retro findings from first and second Shindig runs addressed (circuit breakers, tool hierarchy fixes)
- `TeamCreate` enforced over `Agent` tool for parallel team execution

---

## [0.3.0] - 2026-03-26

Test swarm, kickoff command, and error handling.

### Added
- `/test` command: full test swarm (context gathering, test authoring, execution, bug triage, reporting)
- `/kickoff` command for project initialization (brownfield discovery)
- Circuit breakers: time-based, attempt-based, and progress-based halt conditions
- Comprehensive error handling playbook
- Reviewer must-be-different-agent rule (no self-review)

---

## [0.2.0] - 2026-03-26

Plugin distribution and configurable task tracking.

### Added
- `plugin.json` manifest for Claude Code plugin installation
- `marketplace.json` for plugin discovery
- Full Linear board integration (optional)
- Configurable task tracking: local mode as default, Linear as opt-in
- Final review and push gates in daily ceremony

---

## [0.1.0] - 2026-03-25

Initial release: core workflow orchestration for Claude Code.

### Added
- Core SDLC workflow: plan, execute, standup, review
- Multi-agent team orchestration with role-based personas (orchestrator, team lead, developer, researcher, reviewer, tester)
- `MAIN.md` orchestrator entry point
- Daily ceremony skill (`/standup`)
- Task tracking via Hive-native local state

---

[Unreleased]: https://github.com/firefly-events/plugin-hive/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/firefly-events/plugin-hive/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v1.0.0
[0.9.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.9.0
[0.8.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.8.0
[0.7.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.7.0
[0.6.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.6.0
[0.5.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.5.0
[0.4.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.4.0
[0.3.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.3.0
[0.2.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.2.0
[0.1.0]: https://github.com/firefly-events/plugin-hive/releases/tag/v0.1.0
