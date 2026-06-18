# Research Brief: Hive Composability + Design-Aware Planning

**Epic:** `hive-composability-design`
**Date:** 2026-04-16
**Status:** Ready for `/hive:plan` — §7 decisions locked; §8 open questions are planner inputs
**Prepared for:** Planning team — TPM, architect
**Sources:** (1) User-authored strategy draft `state/research-brief-hive-composability-design.md`; (2) Codebase research — direct file:line reads of plan skill, agent-spawn, respawn, hive.config.yaml, orchestrator persona, design-discussion/structured-outline/h-plan/v-plan skills, wireframe-protocol, memory-autonomy-foundation epic

---

## 1. Problem Statement

Plugin-hive's planning and execution ceremonies are more thorough and more persona-rich than either Superpowers or GSD, but they cost more tokens and run longer than the job sometimes warrants. The user's concern: is the current depth *overkill* for routine stories, and does every story really need the full persona sign-off cycle with long-lived teammates?

At the same time, hive's differentiated lane — **design-aware SDLC for product teams** — is under-expressed in the planning artifacts themselves. Today's design discussions, structured outlines, and (when present) PRDs are markdown-only. For a product whose selling point is brand/design/UI fluency, the planning docs should *look* design-aware, not just read design-aware.

This epic tackles both: **give users composable control over planning depth and model economy**, and **make the planning artifacts themselves visually rich** so the user can see what things look like while reading the business logic.

---

## 2. Goals

1. Introduce composability controls so users can dial planning depth from "quick" to "full ceremony" without losing guarantees at either end.
2. Introduce a respawn-per-task option for development teammates, with a memory-bridging contract so fresh teammates can build on prior implementation passes.
3. Introduce model tiering (budget / balanced / quality) with Haiku allowed for small-scope agents but disallowed for Explorer/research personas.
4. Make planning artifacts at each user-interaction touchpoint (design discussion, structured outline, PRD) visually rich — embed images, use HTML for layout, use Mermaid for slice/dependency diagrams.

---

## 3. Strategic Context (from competitor comparison)

| What competitors do better today | What hive borrows from them |
|---|---|
| GSD v1: `--skip-research`, `--skip-verify`, `--auto`, `--chain`, `/gsd-quick`, `/gsd-fast` | Per-command skip flags + a `--lite` / `--quick` planning variant |
| GSD v1: model profiles (`quality / balanced / budget / inherit`) as first-class config | Tiered model config in `hive.config.yaml` |
| GSD-2: tiered context injection (65%+ token reduction), disposable subagent per planning level | Disposable teammates for execution stories, memory-bridging contract for respawns |
| Superpowers: mandatory "fresh subagent per task" with two-stage review | Respawn-per-story option for development phase |

| What hive does better today (protect and expand) |
|---|
| Brand-system / design-system / ui-audit / visual-qa / polish-audit as first-class SDLC phases |
| Multi-persona collaboration via TeamCreate + SendMessage + named teammates |
| Ceremony richness — standup as a real ceremony, not a status dump |
| Planning holism — team composition + sign-offs + dep graphs in one shape |

The design-aware workstream is net-new and hive-differentiating; competitors have nothing here.

---

## 4. Workstreams

### Workstream A: Planning Composability

- **Design discussion gate — two-concern separation.** The design discussion is never skipped, but "never skippable" requires separating two concerns that are currently coupled: (1) doc-production (always-on — the design discussion document is always written), and (2) collaborative team review (today governed by `planning.collaborative_review` at `hive/hive.config.yaml:134-136`). Lite mode may configure team review off; doc production cannot be gated. This separation must be explicit in the plan skill and design-discussion skill.
- **Effort-driven planning depth.** Planning effort follows estimated scope. Small scope (single screen, fix, narrow change) → lite planning. Large scope (new feature, rewrite, cross-cutting) → full planning. The auto-promotion heuristic is an effort estimator, not a presence-of-UI check or a story-count threshold. Estimator signals TBD in planning phase — likely a mix of files-touched guess, new-vs-existing surface, and scope-class (fix / feature / rewrite).
- **Lite vs. full modes.** `/hive:plan --lite` runs a trimmed pass (design discussion + structured outline + minimal YAML, no engineering sign-off cycle). Full mode adds the full persona sign-off cycle and dependency-tracked story YAMLs. User can override the auto-promoted choice either direction.
- **Flag parsing is natural-language prose.** Flags (`--lite`, `--skip-sign-off`, `--skip-research`) are parsed from `$ARGUMENTS` as plain English, not a CLI parser (`skills/plan/SKILL.md:14`). Adding `--lite` is a documentation and instruction change, not parser infrastructure work.
- **Auto-skip redundant sign-offs.** When only one persona weighs in on a given sign-off, collapse to a no-op instead of re-running.
- **Quick-task escape hatch.** Equivalent to GSD's `/gsd-fast` — for trivial tasks where even lite planning is overhead. Still writes to state but skips decomposition. Design discussion still applies if any UI is touched.

### Workstream B: Teammate Lifecycle + Memory Bridging

- **Configurable lifecycle.** `hive.config.yaml` option: `teammate_lifecycle: long_running | respawn_per_task` (default varies by phase — respawn-per-story for development, long-running for design/planning).
- **Respawn-per-task is a NEW mode, not an extension.** Today respawn is context-pressure-only, scoped to TeamCreate execution (`skills/hive/skills/respawn/SKILL.md:8-12`). Per-task respawn is a new lifecycle mode that fires unconditionally on story boundaries, not on context pressure.
- **Memory-bridging contract.** When a fresh developer teammate spawns for story N+1, they must read from state/insights, state/episodes, and prior story summaries before opening any implementation file. The existing `state/respawn-summaries/{agent}-{story-id}-{N}.md` summary carrier pattern is reusable as the memory-bridging vehicle.
- **Disposable planning teammates.** Personas that participate once, emit a YAML sign-off, and go away — don't keep them in TeamCreate context after the artifact is written.

**Dependency on `memory-autonomy-foundation`:** Workstream B's memory-bridging contract requires consuming infrastructure that `memory-autonomy-foundation` Phase 1 builds. Primary integration targets by story ID: `kg-write-path`, `kg-read-path`, `chromadb-wrapper`, `chromadb-integration`, `session-end-integration`. The critical seam is `session-prompt-spec` (story S7) — the Phase 2 design artifact at `hive/references/session-system-prompt-spec.md` that governs memory-context injection into Managed Agent sessions. Workstream B stories must not be sequenced before `session-prompt-spec` is complete.

### Workstream C: Model Economy

- **Tiered model profiles.** `quality / balanced / budget` in `hive.config.yaml`, with per-persona overrides. Haiku allowed for narrow-scope agents (sign-off reviewers, classifiers, short summarizers). Sonnet floor for any persona with broad context (tpm, architect, ui-designer, researcher). Opus for architecture-level decisions.
- **Per-persona frontmatter override is already live.** The `model:` field in agent frontmatter is already read by agent-spawn step 7.1 and passed to the spawn call (`skills/hive/skills/agent-spawn/SKILL.md:149`). Examples: `hive/agents/orchestrator.md:3` (`model: opus`), `hive/agents/team-lead.md:3` (`model: opus`). The project-level `model_overrides: {}` layer exists but is empty today (`hive/hive.config.yaml:45-68`). The epic's Workstream C work is: (a) document the tiering contract, (b) define what each profile maps to in `hive.config.yaml`, (c) clarify interaction between config-level profiles and frontmatter overrides, and (d) enforce the Explorer/research Haiku guardrail. No new spawn infrastructure needed.
- **Per-invocation override.** `/hive:plan --profile budget` etc.
- **Explorer/research guardrail.** Explorer subagent_type still cannot run on Haiku; document this and enforce.

### Workstream D: Design-Aware Rich Planning Outputs

This is the hive-differentiating workstream and **fully greenfield**. There is zero precedent for HTML, Mermaid, or inline images anywhere in existing planning documents.

- **Current state is ASCII-only.** All planning docs are pure markdown. Slice diagrams are ASCII art: layer map at `skills/hive/skills/horizontal-plan/SKILL.md:89-109`, overlay at `skills/hive/skills/vertical-plan/SKILL.md:97-122`. The structured outline dependency map (Part 6) is a text code block. No `![img]()`, no `<img>`, no Mermaid, no HTML in any planning artifact today.
- **Image embedding has no precedent.** The only image path convention in the codebase is `hive/references/wireframe-protocol.md:22-26` — PNG paths stored as YAML field values for user presentation, not embedded inline in docs. Inline image embedding in planning documents is net-new design.
- **Design discussion doc target.** Markdown-with-embedded-HTML (default per Decision #3) that interleaves wireframes/reference images alongside business logic. User sees what the feature looks like while reading why it exists.
- **Structured outline target.** Same treatment — visual hierarchy, rendered component sketches where relevant.
- **PRD (when present) target.** Full HTML vehicle, sectioned, with images and Mermaid diagrams rendering inline.
- **H/V slice diagrams target.** Mermaid replaces ASCII art. This is the one place Mermaid is explicitly the right tool — slice dependency is structural, not visual.
- **Terminal-degradation is an open design question.** HTML-primary artifacts must degrade gracefully in terminal viewers. No solution exists today; this is a design-discussion question, not a resolved decision.
- **Static is confirmed.** User explicitly confirmed static HTML meets the bar — the goal is visual association of functionality ↔ appearance ↔ business logic, not interactivity.

The design discussion must treat Workstream D as greenfield design — there is no existing format to migrate from.

---

## 5. Constraints

- **Protect the design-aware lane.** Composability work must not water down the design phases (brand-system, design-system, ui-audit, visual-qa, polish-audit, design-review). Those stay full-fidelity; lite mode applies to planning for standard engineering epics.
- **Memory continuity across respawn.** Non-negotiable. A fresh development teammate that cannot see prior implementation-pass memory is a regression, not a feature.
- **Backwards-compatible defaults.** Existing workflows keep working; all new controls are opt-in via flags or config.
- **Token discipline is a means, not an end.** The goal is to make lightweight paths *available*, not to make everything lightweight.

---

## 6. Out of Scope (this epic)

- Multica integration or cross-hive orchestration — separate future exploration.
- Interactive HTML artifacts (React components, live playgrounds) — static HTML only for v1.
- Memory & Autonomous Execution foundation (KG, ChromaDB, Managed Agents sessions) — tracked in `project_memory_autonomy_foundation.md`; this epic builds on what is in place but does not own its delivery.

---

## 7. Decisions Resolved with User

1. **Design discussion is never skipped.** It is the critical-path user confirmation gate — the one forced sync point where the user confirms alignment with the agent team before planning proceeds. Lite mode trims sign-offs, not design discussion.
2. **Auto-promotion heuristic is estimated effort.** Small scope (one screen, a fix, narrow change) → lite planning. Larger scope (new feature, rewrite, cross-cutting work) → full planning. Effort estimator signals to be worked out during `/hive:plan` — probably files-touched guess + new-vs-existing-surface + scope-class (fix / feature / rewrite).
3. **HTML-primary vs. markdown-with-embedded-HTML — deferred.** Both achieve equal richness; choose whichever costs fewer tokens once we can measure. Default placeholder: markdown-with-embedded-HTML, revisit after measurement.
4. **Respawn memory-bridging is integrated with the Memory & Autonomous Execution foundation**, not a parallel track. They share the KG/state/episodes layer; plan them as one coordinated effort, not two things with a seam.
5. **Per-persona model overrides use both config and frontmatter.** `hive.config.yaml` sets the default profile; agent frontmatter overrides per persona. Research confirms this is already partially implemented — frontmatter `model:` is live today. Epic scope is documentation + config-layer clarification, not new infrastructure.

---

## 8. Open Questions (planner inputs for design discussion)

These are unresolved inputs the planner must address. They block implementation scoping.

1. **Effort-estimator thresholds.** Decision #2 names the approach but not the specific signals and measurable thresholds. The design discussion must define what "large scope" means in concrete terms (e.g., files-touched count, new-vs-existing surface ratio, scope-class taxonomy) before the auto-promotion heuristic can be specified.
2. **Forced user confirmation gate shape.** After design discussion doc-production completes, what is the user-facing mechanism — TUI prompt, required sign-off artifact, or both? This determines the implementation surface of the always-on gate and the design-discussion skill's output contract.
3. **Workstream D format specifics.** Which combination of Mermaid, HTML, and image generation (Frame0, placeholder, user-supplied) applies to each artifact type? The codebase has zero precedent; the design discussion must establish the format contract for each document type before implementation can begin.
4. **`session-prompt-spec` existence.** The researcher could not verify whether `hive/references/session-system-prompt-spec.md` exists yet (story S7 is planned, not confirmed complete). The planner must verify before sequencing any Workstream B stories.

---

## 9. Codebase Evidence by Workstream

All citations verified by direct file read. High confidence.

### Workstream A — Plan Skill Hook Surface

- **Plan skill path:** `skills/plan/SKILL.md` — `skills/hive/skills/plan/SKILL.md` does NOT exist.
- **Flag parsing:** Natural-language `$ARGUMENTS` at `skills/plan/SKILL.md:14`. No CLI parser; adding `--lite` is a docs/instruction change.
- **Existing flags:** `--fast` (`skills/plan/SKILL.md:16-23, 127-129`), `--validate` (`skills/plan/SKILL.md:16-23, ~L101-102`), `--gate-hv` (`skills/plan/SKILL.md:148-151`). Flag table mirrored at `hive/agents/orchestrator.md:191-197`.
- **Single insertion point for `--lite` and effort-heuristic:** `skills/plan/SKILL.md:120-134` — post-step-5 routing announcement block. Scale today is inferred from `SCALE ASSESSMENT` output of `skills/hive/skills/design-discussion/SKILL.md:97-110`. New effort-heuristic lives here or in the scale-assessment output parser.
- **Design-discussion gate location:** `skills/plan/SKILL.md:108-114`. Team review toggled by `planning.collaborative_review` at `hive/hive.config.yaml:134-136`. Doc-production is always-on but currently not structurally separated from the review toggle — this separation is implementation work.

### Workstream B — Agent Lifecycle + Memory Bridging

- **Respawn today:** Context-pressure-only, scoped to TeamCreate execution (`skills/hive/skills/respawn/SKILL.md:8-12`). Per-task mode is a new lifecycle, not an extension.
- **Respawn summary carrier:** `state/respawn-summaries/{agent}-{story-id}-{N}.md` — reusable as memory-bridging vehicle.
- **Agent-spawn step 7b injection point:** `skills/hive/skills/agent-spawn/SKILL.md:188-206` — `respawn_summary_path` injection for continuation context. Per-task mode always populates this; context-pressure mode populates it only when triggered.
- **memory-autonomy-foundation story IDs to consume:** `kg-write-path`, `kg-read-path` (step 5e KG injection in agent-spawn), `chromadb-wrapper` (`isAvailable()`), `chromadb-integration` (step 5c-L3 semantic rerank + upsert), `session-end-integration` (3-op session close), `session-prompt-spec` (S7, `hive/references/session-system-prompt-spec.md` — existence unverified).

### Workstream C — Model Economy

- **`model_tiers` config:** `hive/hive.config.yaml:45-68` — opus/sonnet/haiku tier lists + `model_overrides: {}` (empty project-layer today).
- **Tier resolution table:** `hive/agents/orchestrator.md:170-184`.
- **Frontmatter `model:` already live:** `hive/agents/orchestrator.md:3` (opus), `hive/agents/team-lead.md:3` (opus). Read by agent-spawn `skills/hive/skills/agent-spawn/SKILL.md:149` and passed to spawn call. No new infrastructure needed.
- **Epic scope:** Document the tiering contract, populate `model_overrides` per profile, clarify config-vs-frontmatter precedence, enforce Explorer/Haiku guardrail.

### Workstream D — Design-Aware Rich Planning Outputs

- **Current format — all skills:** Pure markdown. `skills/hive/skills/design-discussion/SKILL.md:114`, `skills/hive/skills/structured-outline/SKILL.md:254`.
- **Current diagrams:** ASCII art only. `skills/hive/skills/horizontal-plan/SKILL.md:89-109` (layer map), `skills/hive/skills/vertical-plan/SKILL.md:97-122` (overlay). Structured outline Part 6 dep map is a text code block.
- **Image embedding:** Zero precedent. Only image path convention: `hive/references/wireframe-protocol.md:22-26` — PNG paths as YAML field values, not embedded. No `![img]()` or `<img>` anywhere in planning docs.
- **No Mermaid anywhere in planning artifacts.** Confirmed by direct read of all four planning skill output sections. Net-new territory — no format to migrate from or break.
- **Sampled real documents:** `state/epics/ui-team-skills/docs/design-discussion.md:1-120`, `state/epics/memory-autonomy-foundation/docs/structured-outline.md:1-120` — both pure markdown, confirm no HTML or images.

---

## 10. Cross-Epic Seam: `memory-autonomy-foundation`

Workstream B has a direct dependency on `memory-autonomy-foundation`. The dependency is read-only from this epic's perspective:

- **Dependency direction:** This epic's memory-bridging contract READS from infrastructure that `memory-autonomy-foundation` WRITES. No circular dependency.
- **Minimum gate:** Workstream B stories require `memory-autonomy-foundation` Phase 1 stories (`kg-write-path`, `kg-read-path`, `chromadb-wrapper`, `chromadb-integration`, `session-end-integration`) to be complete or co-scheduled. The `session-prompt-spec` (S7) is the additional Phase 2 gate for Managed Agent session memory injection.
- **No blocker for Workstreams A, C, D.** The lite/full mode system, model tiering, and rich HTML artifacts are all independent of the KG/ChromaDB layer.
- **Planner action:** Surface Workstream B's `session-prompt-spec` dependency as a named cross-epic dependency in the horizontal plan's Cross-Layer Dependencies section.

---

## 11. Suggested Slicing Hint (for planner)

Vertical slice candidate for first milestone: **one epic, one planning run, lite mode end-to-end, with a visually rich design discussion (including the forced user confirmation gate) and structured outline.** That proves Workstream A (lite path + gate) + Workstream D (rich outputs) together on a single thread before Workstream B (respawn lifecycle + memory bridging, gated on `memory-autonomy-foundation` Phase 1 + S7) and Workstream C (model tiering) land.

**Epic classification:** Runtime-behavior epic — the user can demonstrate lite planning running end-to-end. MVP-spine pattern applies: thin Slice 1 wires the full lite-mode path, even if only Workstreams A and D contribute. Structural-readiness slicing is not the right default here.

**Workstream D greenfield note:** Because there is zero format precedent, the design discussion must establish the format contract (Mermaid vs HTML vs image generation approach per artifact type) before any Workstream D story can be written. Sequence the design discussion as a blocker for all Workstream D story YAML authoring.
