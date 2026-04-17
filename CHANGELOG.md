# Changelog

All notable changes to Plugin Hive are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

### Added
- Per-agent spawn backend axis (`agent_backends` in `hive.config.yaml`) — PoC
  routing of roster personas through OpenAI Codex in a side-by-side cmux pane
  via the new `codex-invoke` skill. Default (unset) remains `claude` and uses
  TeamCreate unchanged.
- TDD cross-model workflow (`development.tdd-codex.workflow.yaml`) — Claude
  writes tests, Codex implements in a persistent cmux pane, Claude reviews
  with a fix loop on the same pane before shutdown.

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

[Unreleased]: https://github.com/firefly-events/plugin-hive/compare/v1.0.0...HEAD
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
