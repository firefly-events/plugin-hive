<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="assets/hive-logo.svg" width="140" alt="Hive logo — pointy-top hex with adjacent cells forming">
</p>
<!-- markdownlint-enable MD033 -->

# Hive

> **Composable substrate for the agentic SDLC — user-directed, disciplined, kickoff to ship.**

A Claude Code plugin that turns your project into a coordinated swarm of AI specialists with the discipline of a real software team — planning, design, execution, code review, test. Built at [Firefly Events](https://ff.events) while shipping our own products. Open source.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.12.0-green.svg)](.claude-plugin/marketplace.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet.svg)](https://claude.ai/code)

---

## What is Hive?

Hive structures AI-assisted software development into a repeatable, team-like workflow. Instead of chatting with a single assistant, you get:

- **Specialized agents** (analyst, architect, developer, tester, reviewer, etc.) that collaborate on your behalf
- **Structured phases** from kickoff to ship with built-in quality gates
- **Persistent memory** so agents learn from past sessions and projects
- **Human-in-the-loop** checkpoints where your judgment matters most

Think of it as giving your Claude Code session the discipline and coordination of a small software team — without the overhead.

---

## Why use Hive?

If you've found that:
- AI coding assistants lose context on larger features
- You spend too much time re-explaining project details
- Testing and review feel ad-hoc or incomplete
- You want more reliable, repeatable results from AI-assisted work

...then Hive provides the scaffolding to make agentic development feel more like working with a competent team.

---

## Quick Start

**1. Prerequisites**
- Claude Code CLI v2.1+ ([install guide](https://claude.ai/code))
- Claude Code authentication: sign in normally, or use Anthropic's stored-secret flow if you want Claude Code to draw from your Anthropic subscription/API account

**2. Install**
```bash
# Inside any Claude Code session:
/plugin marketplace add firefly-events/plugin-hive
/plugin install plugin-hive@firefly-events/plugin-hive
```

**3. Initialize your project**
```bash
/hive:kickoff        # Discovers codebase & generates team configs
```

**4. Daily workflow**
```bash
/hive:standup   # Review yesterday, surface blockers
/hive:plan      # Design → horizontal scan → vertical slice → agent-ready stories
/hive:execute   # Orchestrator runs stories through dev workflow (research → implement → test → review → integrate)
/hive:review    # Structured code review (correctness, security, conventions)
/hive:ship      # Reconcile work, bump version, run release action, mark stories shipped
```

Each story produces a committed, reviewed state. The orchestrator handles coordination; you provide judgment at the planning and review gates.

---

## Commands

**Core workflow**
- `/hive:kickoff` — initialize Hive for a project
- `/hive:standup` — daily ceremony and blockers
- `/hive:triage` — capture and prioritize bugs/features
- `/hive:plan` — decompose work into agent-ready stories
- `/hive:execute` — run stories through implementation workflow
- `/hive:review` — structured code/PR review
- `/hive:test` — test swarm for coverage, execution, and bug routing
- `/hive:ship` — reconcile, bump version, run the release action, mark stories shipped
- `/hive:status` — active epics, story progress, and drift trend
- `/hive:ship` — cut a release: reconcile stories, author human-readable changelog prose (draft → operator review → write to `CHANGELOG.md`), verify version bump, run ship target. Changelog format rules live in [`hive/references/changelog-entry-format.md`](hive/references/changelog-entry-format.md).

**Design & UI**
- `/hive:brand-system` — colors, typography, spacing, visual guide
- `/hive:design` — wireframes and design handoff
- `/hive:design-system` — W3C design tokens from brand system
- `/hive:design-review` — critique designs or implementations
- `/hive:polish-audit` — motion/delight opportunities after UI audit
- `/hive:visual-qa` — compare implementation against design briefs
- `/hive:logo-exploration` — generate logo directions and contact sheets

**Project intelligence**
- `/hive:context-snapshot` — JSON snapshot of epics, stories, triage, metrics
- `/hive:metrics-check` — post-merge metric verdicts
- `/hive:why` — query decision provenance from the knowledge graph
- `/hive:register-project` — register a project for cross-project KG bootstrap
- `/hive:find-skills` — mine recurring patterns for new skills
- `/hive:write-skill` — scaffold a new skill from a brief
- `/hive:meta-optimize` — run public meta-improvement experiments

**Optional Integrations**
Hive works out of the box after `/hive:kickoff`. Add these only when you want the corresponding execution substrate:
- `/hive:multica-init` — one-time Multica execution substrate setup
- `/hive:sandbox-setup` — one-time Sandcastle/Codex sandbox auth setup
- `/hive:sandcastle-gh-init` — GitHub Actions glue for Sandcastle execution

Then opt in through `hive.config.yaml` or `HIVE_EXECUTION_MODE` when you want `/hive:execute` to use that path.

**Advanced helper**
- `/hive:grill` — adversarial design stress-test, usually invoked by `/hive:plan`

---

## Key Features

- **Multi-agent teams**: 25 specialized personas coordinate through structured workflows
- **Cross-model execution**: Route implementation to OpenAI Codex while Claude handles orchestration/review (reduces cost & bias)
- **Test swarm**: 5-agent pipeline that runs tests, files bugs, and routes fixes automatically
- **Layered memory (L0–L3)**: Persists decisions across sessions/projects via session insights, compiled wiki, knowledge graph, and optional ChromaDB semantic index
- **Extensible by design**: Add agents, skills, workflows, and teams without touching core code

---

## Inspirations

Hive stands on the shoulders of the agentic-engineering community. We borrow patterns and posture from camps that came before us:

- **[IndyDevDan](https://www.youtube.com/@indydevdan)** — agentic engineering as a *practice*; videos, principles, taste
- **[QRSPI](https://github.com/matanshavit/qrspi)** — 8-phase Claude Code workflow (Question · Research · Structure · Plan · Implement); builder workflows and real-world patterns
- **[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)** — structured multi-agent methodology and role taxonomy
- **[archon](https://github.com/coleam00/archon)** — orchestration runtime and agent-execution patterns
- **[Matt Pocock](https://www.mattpocock.com)** — atomic-skill design: composable, single-purpose, well-named units of capability
- **[Andrej Karpathy](https://karpathy.ai)** — the intellectual current of software 2.0/3.0

We don't compete with them; we synthesize, in a specific shape, on a specific surface (Claude Code), and put it in the open. Where their patterns show up in Hive, the credit travels with the claim.

---

## Where to go deeper

- **[Operations Guide](docs/operations-guide.md)**: Full detail on workflows, architecture, configuration, and advanced usage
- **[Contributing](CONTRIBUTING.md)**: How to contribute to Hive
- **[Changelog](CHANGELOG.md)**: Version history and migration notes

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for the full text.
