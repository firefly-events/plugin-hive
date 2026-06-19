# Research Brief: Hive Composability + Design-Aware Planning

**Epic:** `hive-composability-design`
**Date:** 2026-04-16
**Status:** Ready for `/hive:plan` — §7 decisions locked; §8 open questions remain
**Prepared for:** Planning team — TPM, architect, ui-designer
**Source:** Head-to-head comparison of plugin-hive against Superpowers (obra/superpowers), GSD v1 (gsd-build/get-shit-done), and GSD-2 (gsd-build/gsd-2), plus user direction captured in conversation

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

- **Design discussion is critical path.** It is never skipped in any mode. It is the one forced gate where the user confirms they are aligned with the agent team before planning proceeds. Lite mode trims engineering sign-offs; it does not trim design discussion.
- **Effort-driven planning depth.** Planning effort follows estimated scope. Small scope (single screen, fix, narrow change) → lite planning. Large scope (new feature, rewrite, cross-cutting) → full planning. The auto-promotion heuristic is an effort estimator, not a presence-of-UI check or a story-count threshold. Estimator signals TBD in planning phase — likely a mix of files-touched guess, new-vs-existing surface, and scope-class (fix / feature / rewrite).
- **Lite vs. full modes.** `/hive:plan --lite` runs a trimmed pass (design discussion + structured outline + minimal YAML, no engineering sign-off cycle). Full mode adds the full persona sign-off cycle and dependency-tracked story YAMLs. User can override the auto-promoted choice either direction.
- **Per-command skip flags.** `--skip-sign-off`, `--skip-research`. Composable. Note: no `--skip-design-discussion` — that gate is always on.
- **Auto-skip redundant sign-offs.** When only one persona weighs in on a given sign-off, collapse to a no-op instead of re-running.
- **Quick-task escape hatch.** Equivalent to GSD's `/gsd-fast` — for trivial tasks where even lite planning is overhead. Still writes to state but skips decomposition. Design discussion still applies if any UI is touched.

### Workstream B: Teammate Lifecycle + Memory Bridging

- **Configurable lifecycle.** `hive.config.yaml` option: `teammate_lifecycle: long_running | respawn_per_task` (default varies by phase — respawn-per-story for development, long-running for design/planning).
- **Memory-bridging contract for respawns.** When a fresh developer teammate spawns for story N+1, they must read from state/insights, state/episodes, and prior story summaries *before* opening any implementation file. This is the critical user constraint: respawn is not amnesia.
- **Disposable planning teammates.** Personas that participate once, emit a YAML sign-off, and go away — don't keep them in TeamCreate context after the artifact is written.

**Seam with `memory-autonomy-foundation` epic:** Workstream B's memory-bridging contract is not a parallel track. It shares the KG/state/episodes layer being built in `memory-autonomy-foundation` (Phase 1: KG schema + ChromaDB wrapper, Phase 2: session execution). Plan them as one coordinated effort — Workstream B's implementation is gated on `memory-autonomy-foundation` Phase 1 completion at minimum. The planner should surface this as a cross-epic dependency in the horizontal plan.

### Workstream C: Model Economy

- **Tiered model profiles.** `quality / balanced / budget` in `hive.config.yaml`, with per-persona overrides. Haiku allowed for narrow-scope agents (sign-off reviewers, classifiers, short summarizers). Sonnet floor for any persona with broad context (tpm, architect, ui-designer, researcher). Opus for architecture-level decisions.
- **Per-invocation override.** `/hive:plan --profile budget` etc.
- **Explorer/research guardrail.** Explorer subagent_type still cannot run on Haiku; document this and enforce.

### Workstream D: Design-Aware Rich Planning Outputs

This is the hive-differentiating workstream. At every user-interaction touchpoint, the planning artifact should *look* like a product spec, not a wall of text.

- **Design discussion doc.** Today markdown-only. Target: HTML-first output (or markdown with embedded HTML) that interleaves rendered wireframes / reference images alongside the business logic being discussed. User should see what the feature looks like while reading why it exists.
- **Structured outline.** Same treatment — visual hierarchy, rendered component sketches where relevant, the design language itself visible in the outline.
- **PRD (when present).** Full HTML vehicle, sectioned, with images and Mermaid diagrams rendering inline.
- **Horizontal/vertical slice diagrams.** Mermaid. This is the one place Mermaid is explicitly the right tool — slice dependency is structural, not visual.
- **Static is fine.** User explicitly confirmed static HTML meets the bar — the goal is visual association of functionality ↔ appearance ↔ business logic, not interactivity.

Open implementation questions (pending planner resolution):
- Markdown + embedded HTML blocks, or HTML as the primary vehicle with markdown fallback?
- Where do inline images come from at planning time — generated (Frame0/other), placeholder, or user-supplied during design discussion?
- How do terminal viewers degrade gracefully when the artifact is HTML-primary?

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
- Memory & Autonomous Execution foundation (KG, ChromaDB, Managed Agents sessions) — tracked in `project_memory_autonomy_foundation.md`; this epic builds on whatever is in place but does not depend on its completion.

---

## 7. Decisions Resolved with User

1. **Design discussion is never skipped.** It is the critical-path user confirmation gate — the one forced sync point where the user confirms alignment with the agent team before planning proceeds. Lite mode trims sign-offs, not design discussion.
2. **Auto-promotion heuristic is estimated effort.** Small scope (one screen, a fix, narrow change) → lite planning. Larger scope (new feature, rewrite, cross-cutting work) → full planning. Effort estimator signals to be worked out during `/hive:plan` — probably files-touched guess + new-vs-existing-surface + scope-class (fix / feature / rewrite).
3. **HTML-primary vs. markdown-with-embedded-HTML — deferred.** Both achieve equal richness; choose whichever costs fewer tokens once we can measure. Default placeholder: markdown-with-embedded-HTML, revisit after measurement.
4. **Respawn memory-bridging is integrated with the Memory & Autonomous Execution foundation**, not a parallel track. They share the KG/state/episodes layer; plan them as one coordinated effort, not two things with a seam.
5. **Per-persona model overrides use both config and frontmatter.** `hive.config.yaml` sets the default profile; agent frontmatter overrides per persona. Doable as stated.

---

## 8. Open Questions Still Pending

These are unresolved inputs the planner needs to address in the design discussion:

1. **Effort-estimator thresholds.** Decision #2 named the approach (estimated effort), not the specific signals and thresholds. The planner needs to define: what constitutes "large scope" in measurable terms before the auto-promotion heuristic can be implemented.
2. **Forced user confirmation gate shape.** After design discussion completes, what is the user-facing confirmation mechanism — TUI prompt, required sign-off artifact, or both? This affects Workstream A's implementation surface and the design discussion skill's output contract.

---

## 9. Cross-Epic Seam: `memory-autonomy-foundation`

Workstream B (Teammate Lifecycle + Memory Bridging) has a direct dependency on `memory-autonomy-foundation`:

- **Shared layer:** KG schema, ChromaDB wrapper, state/episodes write paths (memory-autonomy-foundation Phase 1)
- **Dependency direction:** This epic's memory-bridging contract READS from infrastructure that memory-autonomy-foundation WRITES. No circular dependency.
- **Scheduling implication:** Workstream B stories should not be sequenced until memory-autonomy-foundation Phase 1 is complete or co-scheduled. The planner should surface this as a named cross-epic dependency in the horizontal plan's Cross-Layer Dependencies section.
- **No blocker for Workstreams A, C, D.** The lite/full mode system, model tiering, and rich HTML artifacts are all independent of the KG/ChromaDB layer.

---

## 10. Suggested Slicing Hint (for planner)

Vertical slice candidate for first milestone: **one epic, one planning run, lite mode end-to-end, with a visually rich design discussion (including the forced user confirmation gate) and structured outline.** That proves Workstream A (lite path + gate) + Workstream D (rich outputs) together on a single thread before Workstream B (respawn lifecycle + memory bridging — coordinated with `memory-autonomy-foundation`) and Workstream C (model tiering) land.

Epic classification for slice strategy: this is a **runtime-behavior epic** (user can demonstrate lite planning running end-to-end), so the MVP-spine pattern applies — thin Slice 1 that wires the full lite-mode path, even if only one workstream contributes. Structural-readiness slicing is not the right default here.
