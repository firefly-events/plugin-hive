# Plugin-Hive CONTEXT

Hive is a Claude Code plugin: an extensible multi-agent SDLC framework. Maintainers compose roster personas (researcher, developer, reviewer, etc.) into workflow-driven epics that ship through `/plan` and `/execute` skills. The North Star (post-CWC 2026) is a **composable substrate, user-directed** — not a director-chair workflow.

This file is the project's domain glossary. Schema: [`hive/references/context-md-schema.md`](../hive/references/context-md-schema.md).

## Terminology

- **Hive** — this plugin. Coordinates multi-agent SDLC work via skills, agents, workflows, and references.
- **Epic** — a top-level work unit at `.pHive/epics/{id}/epic.yaml`. Holds an ordered list of stories.
- **Story** — a workflow-tracked unit of dev work at `.pHive/epics/{id}/stories/{id}.yaml`. Has acceptance criteria, complexity, dependencies, and a methodology.
- **Wave** — a sequencing label (W0, W1, …) on stories that gates dependency ordering. Synonymous with the older term *slice*.
- **Slice** — legacy synonym for wave. CWC 2026 used "slice" throughout; new epics prefer "wave".
- **Kickoff Gate** — initialization check that skills perform before running (verifies `.pHive/project-profile.yaml` + `hive.config.yaml`). See [`hive/references/skill-prelude.md`](../hive/references/skill-prelude.md). Five read-only-shaped skill modes (status, review, test, standup, design-review implementation target) lift the gate to a warning instead of hard-blocking — see story `w1-warning-lift`.
- **Persona** — an agent identity defined at `hive/agents/{name}.md`. Roster includes researcher, developer (frontend/backend), tester, reviewer, peer-validator, architect, analyst, tpm, ui-designer, technical-writer, pair-programmer, team-lead, plus specialists.
- **Roster** — the set of personas available to spawn. Agents off the roster are forbidden — see `feedback_use_roster_agents` memo.
- **Backend** — execution backend for an agent. Either direct (Claude via auto-spawned agent teams from a natural-language prompt) or `codex` (codex-rescue subagent). In the direct path, the lead describes the team and its tasks; the Claude Code runtime materializes teammates automatically. No explicit team-creation tool call is required. Routing controlled by `agent_backends` in root `hive.config.yaml`.
- **Substrate** — a foundational layer that other things depend on. Examples: skill-prelude.md (W0 substrate for W1/W2), CONTEXT.md (substrate for Grill atomic skill).
- **Episode** — a step-completion record at `.pHive/episodes/{epic-id}/{story-id}/{step-id}.yaml`. Marks a workflow step's status.
- **Cycle state** — accumulated cross-phase decisions for an epic at `.pHive/cycle-state/{epic-id}.yaml`. Includes escalations consumed by specialist teams.
- **Specialist team** — pre-exec or post-exec team triggered by escalations (e.g., `security:plan-audit`, `performance:audit`). Defined in `hive/references/specialist-triggers.md`.
- **Swarm** — the wider, phase-level coordination unit spanning multiple teams and phases (planning → development → testing → security). A team is a strict subset of a swarm: team ⊂ swarm. Swarm artifacts are cross-session and durable because they are filesystem-persisted; intra-team coordination is session-bound and ephemeral via `SendMessage`.
- **Sidecar** — an append-placement specialist that runs alongside a story's main steps rather than as a separate phase.
- **Skill** — an auto-discovered capability at `skills/{name}/SKILL.md`. The user-invocable surface (`/plan`, `/execute`, etc.).
- **Reference** — a non-skill canonical doc at `hive/references/`. Cited by skills/agents but not directly invocable.
- **Document template** — a doc-shape spec at `hive/references/document-templates/`. Reclassified from `skills/hive/skills/` per story `w1-doc-template-reclassify`.
- **Workflow** — a YAML at `hive/workflows/*.workflow.yaml` defining ordered steps with persona, step file, and methodology dependencies.
- **Step file** — a markdown procedure at `hive/workflows/steps/{workflow}/{step}.md`. The HOW for a workflow step (the persona is the WHO).
- **Methodology** — TDD / classic / BDD. Controls phase ordering inside `/execute`. Default `classic`.
- **Outcomes loop** — iterative review-fix loop with rubric-format grading. Wraps `/review` per CWC 2026 slice s15.
- **Substrate (Messages-API)** — the default execution substrate as of CWC 2026 slice s8. Caller-side Anthropic Messages API loop. Sessions API stays as opt-in cloud adapter (`execution.substrate: sessions-cloud`).
- **Composability** — the 2.0 north star. Substrate that the user directs vs a director-chair workflow that hard-blocks. See `project_hive_2_0_milestone` memo.
- **Mattpocock posture** — atomic-skill convention adopted for Epic A. Three borrows: CONTEXT.md, Triage skill, Grill skill.
- **Triage** — atomic skill (W3 of Epic A) for brownfield bug + feature intake; 5-state queue at `.pHive/triage/queue.yaml`.
- **Grill** — atomic skill (W4 of Epic A) for adversarial alignment, called from `/plan` Phase A2.
- **Meta-team** — nightly self-improvement cycle that runs `/meta-optimize` against signals (metrics, KG, escalations). State at `.pHive/meta-team/`.

## Key paths

- `hive.config.yaml` — root override layer. Maintainer-local. Sets `agent_backends`, `model_overrides`, execution settings.
- `hive/hive.config.yaml` — shipped baseline (neutral consumer-safe defaults). Fall-through source for keys missing from the root file. Per Slice 0/1, `agent_backends` does NOT fall through (consumer-pollution guard).
- `hive/agents/{name}.md` — persona definitions.
- `hive/references/` — canonical docs cited by skills/agents.
- `hive/references/skill-prelude.md` — standard skill preamble (kickoff gate + persona/config/memory loading).
- `hive/references/specialist-triggers.md` — escalation routing catalog (workflow / responds_with / placement per trigger).
- `hive/workflows/` — workflow YAMLs + step files.
- `skills/{name}/SKILL.md` — user-invocable skills (kickoff, plan, execute, standup, status, review, test, polish-audit, visual-qa, design-review, brand-system, design-system, triage, grill). Former `ui-audit` behavior is `design-review --artifact-target implementation`.
- `skills/hive/skills/` — internal sub-skills (agent-spawn, codex-invoke, meta-optimize, respawn, session-end, session-registry).
- `.pHive/` — runtime state: epics, episodes, cycle-state, planning artifacts, triage queue, brand assets, design briefs.
- `.pHive/epics/{id}/` — per-epic docs and stories.
- `.pHive/episodes/{epic-id}/{story-id}/` — per-story step records.
- `.pHive/cycle-state/{epic-id}.yaml` — per-epic cross-phase decision accumulator.
- `.pHive/triage/queue.yaml` — Triage skill 5-state queue.
- `.pHive/meta-team/` — meta-optimize cycle state, ledger, morning summary, archive.
- `~/.claude/hive/memories/{persona}/` — agent memory directory; persona-scoped insights persisted across sessions.

## Conventions

- **One branch per epic, one commit per story.** See `feedback_git_flow_per_epic`.
- **PR file count <150** to stay under CodeRabbit's review threshold. Stack via base-retargeting if needed. See `feedback_pr_file_count_limit`.
- **Codex for work, Claude for verification.** Researcher / developer(s) / technical-writer / architect spawn through Codex; reviewer / tester / peer-validator / specialists / TPM / analyst stay on Claude. See `feedback_codex_general_backend`.
- **Codex returns file lists; the orchestrator commits.** Codex sandbox cannot acquire `.git/index.lock`. See `feedback_codex_sandbox_commit_block`.
- **Serial Codex dispatch.** `Agent(isolation: worktree)` does NOT isolate codex-rescue subagents — parallel dispatch races. See `feedback_codex_parallel_race`.
- **Orchestrator must honor `agent_backends`.** Raw `Agent` spawns bypass Codex routing and can ignore the configured backend path; spawn through the agent-spawn pathway. See `feedback_orchestrator_must_honor_backend_routing`.
- **Story status YAMLs lag reality.** Trust git + disk over the `status:` field in story YAMLs. See `feedback_story_status_stale`.
- **Don't paper-over disagreements via counting.** When numbers disagree because of granularity mismatch, reconcile inline rather than flagging. See `feedback_paper_over_via_counting`.
- **Hook gotcha.** `check-agent-misuse.sh` blocks Agent prompts with `.pHive/epics/.../stories/X.yaml` + execution verbs. Reword to avoid proximity. See `feedback_execute_epic_regex_false_positive`.

## Canonical references

- [`hive/references/skill-prelude.md`](../hive/references/skill-prelude.md) — standard skill preamble
- [`hive/references/specialist-triggers.md`](../hive/references/specialist-triggers.md) — escalation routing catalog
- [`hive/references/agent-config-schema.md`](../hive/references/agent-config-schema.md) — agent persona schema
- [`hive/references/workflow-schema.md`](../hive/references/workflow-schema.md) — workflow YAML schema
- [`hive/references/methodology-routing.md`](../hive/references/methodology-routing.md) — TDD / classic / BDD selection
- [`hive/references/cycle-state-schema.md`](../hive/references/cycle-state-schema.md) — cycle-state YAML format
- [`hive/references/episode-schema.md`](../hive/references/episode-schema.md) — episode record format
- [`hive/references/document-templates/`](../hive/references/document-templates/) — design-discussion, horizontal-plan, vertical-plan, structured-outline, greenfield-discovery-brief
- [`hive/references/agent-memory-schema.md`](../hive/references/agent-memory-schema.md) — memory format + insight capture
