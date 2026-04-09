# Hive

**Multi-agent workflow orchestration for Claude Code** — plan, build, test, and review software with coordinated AI teams.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](.claude-plugin/marketplace.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet.svg)](https://claude.ai/code)

---

## Features

- **Multi-agent teams** — 20 specialized personas (analyst, architect, developer, tester, reviewer, and more) coordinate through structured workflows
- **Structured planning** — decompose requirements into dependency-tracked stories with horizontal/vertical planning for medium and large features
- **Test swarm** — 5-agent pipeline runs tests across platforms, files bugs, and routes fixes automatically
- **Layered memory system** — agents accumulate cross-project knowledge in a compiled wiki with TTL-aware staleness tracking
- **Daily ceremony** — standup → planning → execution → review cycle with quality gates and human touchpoints
- **Extensible by design** — add agents, skills, workflows, and teams without touching core code

---

## Prerequisites

- **Claude Code CLI** v2.1 or later — [install guide](https://claude.ai/code)
- **Anthropic API key** — set as `ANTHROPIC_API_KEY` in your environment

---

## Installation

```bash
claude plugin add fireflyevents/plugin-hive
```

---

## Quick Start

**1. Initialize Hive for your project**
```
/hive:kickoff
```
Hive discovers your codebase (brownfield) or sets up a new project (greenfield) and generates team configs.

**2. Start the day**
```
/hive:standup
```
Reviews yesterday's work, active blockers, and human items. Surfaces continuations.

**3. Plan a feature**
```
/hive:plan
```
Runs multi-phase planning: design discussion → horizontal scan → vertical slice plan → agent-ready stories. You review and steer at each gate.

**4. Execute the plan**
```
/hive:execute
```
Orchestrator loads your team, runs stories through the development workflow (research → implement → test → review → integrate), and commits per story.

**5. Review changes**
```
/hive:review
```
Structured code review covering correctness, security, conventions, and domain compliance. Optional Codex adversarial pass for a second-model perspective.

---

## UI Team Skills

Six dedicated skills for design work — brand identity, design tokens, UI audits, and design review ceremonies:

| Skill | Command | Purpose | Requires |
|-------|---------|---------|---------|
| **Brand System** | `/hive:brand-system` | Establish brand identity: colors (HEX/RGB/CMYK/PMS), typography, spacing. Produces `state/brand/brand-system.yaml` + visual guide PNG via Frame0. | — |
| **Design System** | `/hive:design-system` | Convert brand system into W3C Design Token JSON for frontend tooling (Tailwind, Figma, Style Dictionary). | `/hive:brand-system` first |
| **UI Audit** | `/hive:ui-audit` | Collaborative audit — accessibility specialist + animations specialist surface domain findings; ui-designer synthesizes unified report. | `/hive:kickoff` first |
| **Polish Audit** | `/hive:polish-audit` | Animation and motion opportunity pass — identifies micro-interactions, loading states, and delight improvements. | `/hive:ui-audit` first |
| **Visual QA** | `/hive:visual-qa` | Post-implementation fidelity check — compares design briefs and wireframe PNGs against the actual implementation. | `/hive:ui-design` on a story first |
| **Design Review** | `/hive:design-review` | Design review ceremony — domain critiques from accessibility and animations specialists, synthesized by ui-designer. Supports `--skip accessibility` and `--skip animations`. | `/hive:ui-design` or `/hive:brand-system` |

**Gate chain order:**
```
/hive:brand-system → /hive:design-system
/hive:kickoff → /hive:ui-audit → /hive:polish-audit
/hive:ui-design → /hive:visual-qa
/hive:ui-design or /hive:brand-system → /hive:design-review
```

---

## Architecture Overview

Hive runs as a set of Claude Code skills. The orchestrator (your main session) coordinates teams but never joins them directly.

```
/hive:plan                    /hive:execute               /hive:test
─────────────                 ─────────────               ──────────
Planning Team                 Dev Team                    Test Swarm
  analyst                       researcher                  scout
  architect         ──→          frontend-dev    ──→         architect
  tpm                            backend-dev                 worker (×N)
  ui-designer                    tester                      inspector
                                 reviewer                    sentinel
       │                              │                          │
       ▼                              ▼                          ▼
  Stories with              Implemented code,           Test results,
  H/V plans,                per-story commits,          bug tickets,
  wireframes                quality gate pass           session report
```

**Pipeline:** Planning → Development → Testing → Review → Integration

Each story produces a working, committed state. Quality gates run between phases. The orchestrator routes bugs back to the dev team and tracks circuit-breaker limits.

For full operational detail, see [docs/operations-guide.md](docs/operations-guide.md).

---

## Optional Integrations

| Integration | Purpose | Setup |
|-------------|---------|-------|
| **Frame0** | UI wireframe generation by the ui-designer agent | `frame0` CLI in PATH |
| **Codex** | Adversarial second-model code review after Claude review | `npm install -g @openai/codex && codex login` |
| **Linear** | Task tracking adapter — stories sync to Linear issues | Set `task_tracker: linear` in `hive/hive.config.yaml` |
| **GitHub Issues** | Task tracking adapter | Set `task_tracker: github` in `hive/hive.config.yaml` |
| **Jira** | Task tracking adapter | Set `task_tracker: jira` in `hive/hive.config.yaml` |

Enable integrations in `hive/hive.config.yaml`. All integrations are optional — Hive works without any of them.

---

## Extensibility

Hive is built to grow. Each component is a discrete file you can add or replace:

**Add an agent** — create a `.md` file in `.claude-plugin/agents/` with YAML frontmatter (`name`, `description`, `model`, `tools`). See `references/agent-config-schema.md`.

**Add a skill** — create a `.md` file in `.claude-plugin/skills/`. Skills are prompt templates invoked via `/hive:<skill-name>`.

**Add a workflow** — create a YAML file in `hive/workflows/` following the workflow schema. Assign it to stories via `methodology` in `hive.config.yaml`. See `references/workflow-schema.md`.

**Compose a team** — create or edit a file in `state/teams/`. Team configs define members, roles, domain restrictions, and methodology. The orchestrator loads them at execution time.

**Hive-to-hive communication** *(forward-looking)* — a cross-system collaboration protocol is in design that will allow Hive instances to share stories, hand off work, and coordinate across repositories and organizations.

---

## Contributing

Contributions are welcome. Hive uses an **issue-first model**: open an issue before submitting a pull request so the approach can be discussed and scoped.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow — branch naming, commit format, story-based development, and the review process.

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for the full text.

---

## Links

| Resource | Path |
|----------|------|
| Operations Guide | [docs/operations-guide.md](docs/operations-guide.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Code of Conduct | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
