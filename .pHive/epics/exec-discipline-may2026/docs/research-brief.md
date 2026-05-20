# Research Brief — meta-hive-discipline-may2026

**Date:** 2026-05-17
**Researcher:** Explore agent (read-only codebase scan)
**Validation:** Codebase-only; no external library/SDK lookup needed (all changes are internal substrate). Confidence: high.
**Source issues:** [#131](https://github.com/firefly-events/plugin-hive/issues/131), [#132](https://github.com/firefly-events/plugin-hive/issues/132), [#133](https://github.com/firefly-events/plugin-hive/issues/133), [#134](https://github.com/firefly-events/plugin-hive/issues/134)

## Scope

Four tracking issues, all meta-improvements to plugin-hive itself:

- **#131** Structured handoffs + session drift score metric
- **#132** Strict parallelization rules — default serial
- **#133** Skill-candidate detection skill
- **#134** Promote `/design` to top-level command

## Prior Decisions (from KG `/hive:why`)

- `structural-refactor-and-gate-lift` (2026-05-11) — Codex parallel dispatch race is documented (`feedback_codex_parallel_race.md`); default-serial pattern validated. **Directly relevant to #132** — the substrate already has lived experience with parallel-fan-out hazard.
- `structural-refactor-and-gate-lift` (2026-05-11) — `agent_backends` routing established 2026-05-01: researcher/developer/writer/architect on codex; reviewer/tester/peer-validator on Claude. **Influences** how new orchestrator gates (#132) and detection skill (#133) route work.
- `hive-composability-audit` (2026-05-09) — sandcastles substrate inspected; relevant to #133 as a possible signal source for skill candidates.

No prior decisions found for `drift score`, `/design top-level`, or `skill candidate detection` predicates. Clean slate for those three.

## #131 — Drift Score Metric for Session Handoffs

### Existing surface

- **Metrics registry:** `hive/lib/metrics/core.py:13-29`
  - `REQUIRED_EVENT_FIELDS`: `event_id, timestamp, run_id, metric_type, value, unit, dimensions, source`
  - `EVENT_METRIC_TYPES`: `tokens, wall_clock_ms, fix_loop_iterations, first_attempt_pass, human_escalation`
  - **Gap:** no `drift_score` type. Must register.
- **Handoff schema:** `hive/references/cross-swarm-handoff.md:11-51` — defines `source_swarm`, `target_swarm`, `status` lifecycle (`pending → consumed`). **Gap:** no `expected_scope`/`delivered_scope`/`delta_reasons[]` fields yet.
- **Cycle-state schema:** `hive/references/cycle-state-schema.md:1-120` — per-epic `.pHive/cycle-state/{epic-id}.yaml` with `decisions`, `constraints`, `escalations`. Natural home for phase-boundary handoff records.
- **Event stream:** `.pHive/metrics/events/{run_id}.jsonl` (core.py:70). One JSONL row per event. Existing `stop-*.jsonl` files already accumulate per stop-event.

### Implications

- Drift-score emit at every phase boundary (research → design-discussion → H/V → stories → execute → review).
- Score is computable from `expected_scope` (declared by upstream phase) vs `delivered_scope` (snapshot at boundary).
- Reuse existing JSONL writer (core.py) — no new emit path needed; just add metric type.
- Bucketed scoring (`none/minor/major/divergent`) is friendlier for early aggregation than 0–1 normalization; ship bucketed first.

## #132 — Strict Parallelization Rules

### Existing surface

- **Orchestrator fan-out:** `skills/execute/SKILL.md:34-38, 133, 148, 156, 158, 183` — `TeamCreate(team_config=…, workflow=…)` is the canonical parallelization point. Story-level work is always team-dispatched.
- **Parallel config:** `skills/execute/SKILL.md:229, 242` — `execute-dispatch` sub-skill resolves `parallel_teams: bool` + `terminal_mux: bool`. Defaults set in `hive.config.yaml` `execution:` block (or shipped baseline `hive/hive.config.yaml`).
- **Codex dispatch:** Codex agents routed via `agent_backends:` map. Memory `feedback_codex_parallel_race.md` records: "Agent(isolation:worktree) does NOT isolate codex:codex-rescue subagents; default to SERIAL Codex dispatch." Substrate already knows the hazard; what's missing is a contract that planning + execute honor.

### Implications

- New per-story fields in story YAML: `parallel_allowed: bool` (default `false`), `parallel_rationale: "variation"|"read-only"|"bounded-slice"`.
- Planning skill (`/plan` Phase C step 13) emits the fields per story; default omitted = serial.
- Execute skill (`/execute` dispatch) refuses parallel fan-out unless both fields present AND `parallel_rationale ∈ allowed_set`.
- Boundary-overlap lint: for `parallel_rationale: bounded-slice`, verify declared touch-sets disjoint across siblings before dispatch.

## #133 — Skill-Candidate Detection

### Existing surface

- **`write-skill`:** **NOT FOUND in repo.** Issue #133 frames it as existing. **Gap to clarify with user** — either an upstream Claude Code marketplace skill, or this issue's scope is the dual of skill creation (detection) AND skill writing. Confirm before planning.
- **Signal sources discovered:**
  - `.pHive/metrics/events/*.jsonl` — phase/run events, large volume on this repo
  - `.pHive/kg.sqlite` — KG triples with decisions/handoffs
  - Git log — commit subject/body patterns
  - `.pHive/cycle-state/{epic-id}.yaml` — recurring decision shapes per epic
- **No prior pattern-mining skill** in repo. Closest is `/meta-optimize` (analytical pass) — natural integration point for surfacing candidates.

### Implications

- Detection skill should be a meta-pass, possibly composed into `/meta-optimize` rather than standalone.
- Brownfield-maturity dependency: per maintainer guidance (#80), greenfield projects won't have signal volume. Detection skill should gate on maturity (skip-with-message on greenfield/early).
- **Possible blocker:** if `write-skill` doesn't exist anywhere, detection produces dead-end output. Must verify before planning concrete stories.

## #134 — Promote `/design` to Top-Level

### Existing surface

- **Current state:** `skills/design-review/SKILL.md:1-10` is *design-review*, not standalone *design*. Accepts `--artifact-target {design|implementation}`.
- **Inside /plan:** `skills/plan/SKILL.md:121` references the `design-discussion` document template — the writer produces a markdown doc, not a slash-callable skill. No top-level `/design` exists.
- **Top-level peer pattern:** `/plan`, `/execute`, `/review`, `/standup` all defined as `skills/{name}/SKILL.md` with `name: <lowercase>` frontmatter. Promotion path is: create `skills/design/SKILL.md` mirroring this pattern.

### Implications

- Smallest of the four. Likely 1-2 stories: extract design ceremony from `/plan` Phase B + design-review steps into a callable skill; preserve `/plan` internal invocation.
- Single-file scope mostly — `skills/design/SKILL.md` new; `skills/plan/SKILL.md` adapted to delegate (or invoke external skill in Phase B).
- Naming risk: don't collide with `design-review` or `design-system` skills already in catalog.

## Inconsistency-Risk Signals

Cross-cutting concerns across the four items:

1. **#131 + #132 both touch the orchestrator/dispatch + metrics layer.** Cycle-state schema expands for #131 (handoff drift fields) and for #132 (per-story parallel flags). Risk: divergent schema versions if planned in isolation. **Plan together in a "discipline" slice.**
2. **#133 depends on #131's metric type stability.** If drift-score lands first, the detection skill can mine it as one of the signal sources. Sequence: #131 → #133.
3. **#134 is orthogonal.** Touches `skills/` tree only; no execute/metrics/cycle-state intersection. Decouple.
4. **#132 must not break existing parallel workflows.** Research-time parallel Explore agents, parallel team reviews — these are read-only and should pass the new gate cleanly. Validation: enumerate current parallel call sites in `/plan` Phase A + `/standup` and confirm `parallel_rationale: read-only` covers them.

## Recommended Epic Grouping

**One epic, two slices.** Researcher's call:

- **Slice 1 — Execution discipline** (#131 + #132): cycle-state schema expansion + metrics-type registration + orchestrator gate. Tight coupling on shared schema; planning together avoids correction debt.
- **Slice 2 — Skill ergonomics** (#133 + #134): catalog promotion + candidate detection. Orthogonal to slice 1; #133 internally depends on #131's drift metric but only after slice 1 ships, so external sequencing handles it.

Slices run sequentially (slice 1 → slice 2) because slice 2's #133 mines slice 1's #131 output. Within each slice, stories may run in parallel only if they obey the new #132 gate (bootstrap discipline).

## Open Questions for User

1. **`write-skill` existence:** Is `write-skill` an external Claude Code marketplace skill, or do we need to add it as part of this epic? Issue #133 assumes it exists.
2. **Drift score scoring model:** Bucketed (`none/minor/major/divergent`) first, or normalized 0-1? Bucketed is easier to ship and grade; 0-1 is composable later.
3. **Brownfield gate dependency:** Should #133 (skill-candidate detection) block on #80 (`mhg-1-brownfield-maturity-metrics`) which is `hive:failed` and stale? Or replicate the gate inline?
4. **`/design` standalone scope:** Promote *just* design-discussion authoring (Phase B of /plan)? Or also bundle wireframe/UI work? Issue #134 leans minimal; need confirmation.

## Inconsistency-Risk Signals (for grill)

- **Vocabulary tension:** "Drift" is overloaded — used here for scope drift, used elsewhere in repo for memory/context drift. Need explicit disambiguation in design-discussion.
- **Hidden assumption:** #132's "proven-no-overlap" gate assumes planning emits accurate touch-sets. Today's planning often lists `files_to_modify` aspirationally. Risk: gate passes but reality diverges. Mitigation needs a verification hook.
- **Convention violation:** Top-level skill promotion (#134) is structurally simple but interacts with existing `design-review` skill — risk that user `/design` triggers the wrong one. Need disambiguation in skill descriptions.
- **Posture mismatch:** #133 framing assumes write-skill exists. If it doesn't, the entire story chain is speculative.

— End brief —
