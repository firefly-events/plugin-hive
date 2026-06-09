---
name: design
description: Design UI screens, components, flows, or marketing surfaces — wireframe + design-review handoff. Callable standalone or atomically from /plan. Composes brand-system, wireframe-protocol, ui-designer. Not for reviewing existing designs (use /design-review) or generating design tokens (use /design-system).
---

# Hive Design

Top-level UI design skill. Produces wireframes and a design-review handoff record for a UI brief: a screen, component, flow, or marketing surface. Scope is **UI design work only** — wireframes, screen layouts, component design, marketing assets. This is NOT the in-planning design-discussion authoring pass (that lives inside `/plan` Phase B).

**Input:** `$ARGUMENTS` is a brief describing the UI work needed. Examples:

- `"design the event detail screen"` — single-screen wireframe
- `"design the onboarding flow"` — multi-screen flow
- `"design the avatar component"` — component-level work
- `"design the launch landing page"` — marketing surface

Optional flags:

- `--topic <slug>` — explicit topic slug for the output directory (default: derived from the brief)
- `--renditions N` — number of layout variants per screen (default: 1, per wireframe-protocol)
- `--from-plan` — internal marker used when /plan delegates here (skip standalone preamble noise)
- `--include-constraints` — **Phase A toggle (default OFF).** When set, runs accessibility-specialist + animations-specialist as a constraint pass BEFORE the ui-designer dispatch. Constraint notes are baked into the ui-designer prompt. See Phase A below.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard skill preamble (persona / config / memory loading).

**Kickoff gate override — standalone-usable.** `/design` is intended to be callable for ad-hoc UI exploration, mid-execution redesigns, and polish passes — **outside of `/plan` or `/execute`**. On a fresh repo without `.pHive/project-profile.yaml`, emit the warning below and proceed with sane defaults — write artifacts under `.pHive/design/<topic>/`, create directories as needed. The hard-stop in the prelude does NOT apply here.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

When invoked from `/plan` (with `--from-plan`), the planning preamble has already run; skip the warning and proceed.

## Gate Check

No blocking gate. `/design` runs standalone. Brand context (`.pHive/brand/brand-system.yaml`) is **preferred** but not required — if absent, the ui-designer applies general design heuristics and notes the gap in the brief.

## Process

### Phase 0 — Resolve dispatch mode

Invoke `skills/hive/skills/design-dispatch/SKILL.md` (the d-2 router, already shipped) **before the persona phase**. Pass the current environment, config, and argument context. The router returns `mode_decision`, `mode_reason`, `runner_path`, `runner_reason`, `field_sources`, and `gate_violations[]`.

Branch on `mode_decision`:

- **`multica`** → hand off to `skills/hive/skills/design-mode-multica/SKILL.md` (forward declaration; ships in d-3). Stop here; do not continue inline.
- **`cc-workflows`** → hand off to `skills/hive/skills/design-mode-cc-workflows/SKILL.md` (forward declaration; ships in d-4). Stop here; do not continue inline.
- **any other value** (`sessions`, `team`, `team-cmux`, `sequential`, `sandcastle`) → continue inline below. The remaining process steps execute in the current agent thread.

### 1. Parse the brief and resolve the topic slug

Parse `$ARGUMENTS` to extract:

- **Surface kind** — screen | flow | component | marketing
- **Topic slug** — kebab-case identifier derived from the brief (e.g., `event-detail-screen`, `onboarding-flow`). If `--topic` was provided, use it verbatim. Otherwise compute it from the first ~3 meaningful words in the brief.
- **Rendition count** — from `--renditions` or default 1.

The output directory is `.pHive/design/<topic>/`. Create it (and parents) before writing artifacts.

### 2. Load brand context

Read `.pHive/brand/brand-system.yaml` if present. This is the brand context the wireframes consume — colors, typography, spacing tokens. If absent, log a one-line note ("No brand-system found; running with generic design tokens. Run `/hive:brand-system` for project-specific tokens.") and continue.

See [`skills/brand-system/SKILL.md`](../brand-system/SKILL.md) for how brand-system is produced.

### Phase A — Persona pipeline assembly (mirrors `hive/workflows/design-review.workflow.yaml:8-81`)

**Orchestration template anchor:** Phase A mirrors the 4-step assembly+serial-dispatch shape defined in `hive/workflows/design-review.workflow.yaml:8-81` — the `accessibility-critique` step (line 8), `animations-critique` step (line 28), `design-critique` step (line 55), and `synthesis` step (line 80). Phase A reuses steps 1–3 of that proven template (no synthesis step here; ui-designer synthesizes in one pass). Anchoring on this template prevents re-invention and architectural drift between Slice B (d-1, this story) and Slice C (design-review substrate parity stories).

**Default OFF — `--include-constraints` not set:**

When invoked without `--include-constraints`, Phase A is a no-op. Proceed directly to step 3 below (single ui-designer dispatch). Legacy behavior is preserved byte-for-byte: no accessibility-specialist invocation, no animations-specialist invocation.

**Toggle ON — `--include-constraints` set:**

When invoked with `--include-constraints`, execute the constraint pass in serial order before the ui-designer dispatch:

**(a) accessibility-specialist constraint pass** (mirrors `design-review.workflow.yaml` step `accessibility-critique`, line 8):

Spawn the accessibility-specialist subagent with:

- The full `hive/agents/accessibility-specialist.md` persona
- The parsed brief (surface kind + topic + rendition count)
- The brand context (or the "no brand-system" note)
- Scope instruction: "Produce accessibility constraint notes for this design brief. Flag WCAG 2.1 AA concerns, ARIA pattern guidance, keyboard navigation implications, touch target sizing requirements, color contrast requirements from the brand palette, and semantic structure recommendations. This is a design-level advisory pass, not a code remediation audit."

Write the accessibility constraint notes to `.pHive/design/<topic>/accessibility-constraints.md`.

**(b) animations-specialist constraint pass** (mirrors `design-review.workflow.yaml` step `animations-critique`, line 28):

Spawn the animations-specialist subagent with:

- The full `hive/agents/animations-specialist.md` persona
- The parsed brief (surface kind + topic + rendition count)
- The brand context (or the "no brand-system" note)
- The accessibility constraint notes from step (a) as optional context (mirrors the `optional: true` input in the workflow template)
- Scope instruction: "Produce animation and motion constraint notes for this design brief. Recommend loading state treatments, transition quality, microinteraction patterns, and prefers-reduced-motion considerations. Reference the accessibility constraint notes to avoid compounding any identified concerns."

Write the animation constraint notes to `.pHive/design/<topic>/animations-constraints.md`.

**(c) ui-designer dispatch — ONCE, with constraints baked in:**

The ui-designer is dispatched **exactly once** regardless of whether the constraint pass ran. When the constraint pass ran (toggle ON), prepend the accessibility constraint notes and animation constraint notes as structured blocks to the ui-designer prompt before dispatch. Do NOT dispatch ui-designer a second time for synthesis — the baked-in constraints are the synthesis mechanism.

Proceed to step 3 with the assembled prompt.

**Handoff payload note (AC Subsection 3):** When toggle ON, Phase A produces two constraint artifact files (`.pHive/design/<topic>/accessibility-constraints.md` and `.pHive/design/<topic>/animations-constraints.md`) alongside the ui-designer outputs (PNG + `.f0`). The bundled wireframe-handoff payload contract — defining how PNG + `.f0` + constraint docs are packaged for downstream consumers (design-review, manual review) — is owned by **d-5** (next story). d-1 produces the constraint artifacts; d-5 defines the payload shape. When toggle OFF, constraint doc fields are absent/empty — PNG + `.f0` always ship.

### 3. Load ui-designer persona and dispatch

Read `hive/agents/ui-designer.md` in full. Spawn the ui-designer subagent with:

- The full persona
- The parsed brief (surface kind + topic + rendition count)
- The brand context (or the "no brand-system" note)
- The wireframe-protocol reference at [`hive/references/wireframe-protocol.md`](../../hive/references/wireframe-protocol.md)
- **When Phase A toggle was ON:** the accessibility constraint notes block + animations constraint notes block prepended to the prompt as structured context

The ui-designer produces renditions per the wireframe-protocol — `.f0` files (or text/ASCII fallback if Frame0 CLI is absent), PNG exports when live mode is available, and a structured design brief covering layout, components, interactions, and accessibility notes.

### 4. Run wireframe-protocol touchpoints

Apply the two touchpoints from [`hive/references/wireframe-protocol.md`](../../hive/references/wireframe-protocol.md) — Touchpoint 1 (rendition selection via `AskUserQuestion`) and Touchpoint 2 (brief sign-off). These are blocking touchpoints; `/design` halts until the user responds.

**Standalone vs delegated:** Both invocation paths run the touchpoints identically. The user-facing prompts do not change based on `--from-plan`. The only difference is what happens after the touchpoints — see step 6.

### 5. Write wireframe artifacts

After the user approves a rendition and signs off the brief, write:

```
.pHive/design/<topic>/
  v1.png             # rendition 1 (and additional v2.png, v3.png if produced)
  wireframe.f0       # Frame0 project file (or wireframe.txt for ASCII fallback)
  brief.md           # structured design brief — layout, components, interactions, accessibility
  selected.txt       # one line: the selected rendition index (e.g., "1")
  # When --include-constraints was set:
  accessibility-constraints.md  # accessibility constraint notes from specialist pass
  animations-constraints.md     # animation constraint notes from specialist pass
```

If the topic already exists from a prior run, the new artifacts overwrite the prior ones (latest wins). The full path layout is design-review-compatible — see step 6.

### 6. Emit the design-review handoff record

Update (or create) `.pHive/design/index.yaml` to register this design with the downstream `/design-review` skill. Append (or in-place update when `<topic>` already has an entry) one entry under `briefs[]`:

```yaml
updated_at: "{ISO 8601 timestamp}"
briefs:
  - topic: "<topic>"
    surface_kind: "screen | flow | component | marketing"
    brief_path: ".pHive/design/<topic>/brief.md"
    wireframe_path: ".pHive/design/<topic>/wireframe.f0"
    export_paths:
      - ".pHive/design/<topic>/v1.png"
    selected_rendition: 1
    source: "standalone | plan-delegated"
    created_at: "{ISO 8601 timestamp}"
    # When --include-constraints was set:
    constraints_bundle_path: ".pHive/design/<topic>/constraints.md"
    constraint_doc_path: ".pHive/design/<topic>/accessibility-constraints.md"
    animations_constraint_doc_path: ".pHive/design/<topic>/animations-constraints.md"
    # When --include-constraints was NOT set, omit constraints_bundle_path, constraint_doc_path, and animations_constraint_doc_path
```

This shape is what `/design-review` expects (see [`skills/design-review/SKILL.md`](../design-review/SKILL.md) "Collect artifacts" — it reads `.pHive/design/index.yaml` `brief_path` and `export_paths`). When delegated from `/plan`, also include a `linked_story` field if a story ID is in scope; otherwise the entry is topic-keyed and self-contained.

### 7. Report output

Print a concise summary and the suggested next step:

```
DESIGN COMPLETE: <topic>

Artifacts:
  Wireframes:   .pHive/design/<topic>/v1.png (selected)
  Brief:        .pHive/design/<topic>/brief.md
  Handoff:      .pHive/design/index.yaml (entry: <topic>)
  # When --include-constraints:
  Constraints:  .pHive/design/<topic>/accessibility-constraints.md
                .pHive/design/<topic>/animations-constraints.md

Renditions produced: <N>
Surface kind:        <screen | flow | component | marketing>
Constraint pass:     <on (accessibility + animations specialists) | off (legacy)>

Next: Run /hive:design-review to critique the wireframes and brief.
```

When invoked from `/plan` (`--from-plan`), suppress the "Next" line — the planner controls the next step.

## Standalone vs /plan-delegated invocation

`/design` supports two invocation modes; both produce identical artifacts.

**Standalone.** Invoked directly by the operator outside any planning context (`/hive:design "design the event detail screen"`). No prior planning state is required — no epic, no story, no cycle state. The skill resolves the topic from the brief, runs the touchpoints, and emits the handoff record. This is the canonical entry point for ad-hoc UI exploration, mid-execution redesigns, and polish passes.

**/plan-delegated.** Invoked atomically by `/plan` during its UI-detection path (see `skills/plan/SKILL.md` Phase C step 16). The planner passes the brief plus `--from-plan` and (optionally) a story ID. `/design` runs the same process — the only differences are the suppressed preamble noise and the `source: plan-delegated` field on the handoff record. Inline UI-detection prose inside `/plan` is a regression — `/plan` delegates here via an external Skill call, it does not duplicate the wireframe ceremony.

## What /design is NOT

- **Not a design-discussion authoring pass.** `/plan` Phase B's internal `design-discussion` document is a planning artifact, not a wireframe ceremony. `/design` is strictly UI design work.
- **Not a design-review.** Critique is downstream — `/design` hands off to `/design-review` via the index.yaml entry. The Phase A `--include-constraints` toggle is the **only** multi-persona surface in `/design`; it runs accessibility-specialist and animations-specialist as a *constraint pass* (design advisors for the brief), not as a critique of existing wireframes. Default behavior (toggle OFF) is unchanged: `/design` does not run specialists. Toggle ON is the composable-substrate escape hatch for operator-directed constraint injection.
- **Not a brand-system establishment.** Brand identity is established by `/hive:brand-system`. `/design` consumes that output; it does not produce it.
- **Not an implementation step.** `/design` produces wireframes and briefs; developers implement against the brief during execution.

## Atomic-skill invariants

- **Top-level skill** at `skills/design/SKILL.md` (auto-discovered).
- **Callable standalone** — no prior planning state required. The kickoff gate is warn-only.
- **Called from `/plan`** via an atomic external Skill call (not inline prose). The wiring lives in `skills/plan/SKILL.md` Phase C step 16.
- **Single handoff artifact** — produces an entry in `.pHive/design/index.yaml` per topic; downstream skills consume that file, not the skill's internal state.
- **Re-running overwrites** — invoking `/design` against an existing topic replaces the prior artifacts and updates the index entry in place.
- **Phase 0 (dispatch resolution)** — `design-dispatch` is invoked before the persona phase on every `/design` call. Resolves substrate (multica → forward; cc-workflows → forward; other → continue inline). This is a mandatory first step; no persona dispatch occurs without it.
- **Phase A (persona pipeline, toggle gated)** — when `--include-constraints` is set, runs accessibility-specialist + animations-specialist as a serial constraint pass before the single ui-designer dispatch. Default OFF: no specialists invoked, single ui-designer dispatch, legacy behavior preserved. Phase A mirrors `hive/workflows/design-review.workflow.yaml:8-81` as the orchestration template.

## See also

- [`hive/references/wireframe-protocol.md`](../../hive/references/wireframe-protocol.md) — wireframe touchpoints and approval flow
- [`hive/agents/ui-designer.md`](../../hive/agents/ui-designer.md) — persona this skill dispatches to
- [`hive/agents/accessibility-specialist.md`](../../hive/agents/accessibility-specialist.md) — persona dispatched when `--include-constraints` is set (Phase A toggle ON)
- [`hive/agents/animations-specialist.md`](../../hive/agents/animations-specialist.md) — persona dispatched when `--include-constraints` is set (Phase A toggle ON)
- [`skills/brand-system/SKILL.md`](../brand-system/SKILL.md) — brand context consumed by wireframes
- [`skills/design-review/SKILL.md`](../design-review/SKILL.md) — downstream critique skill; consumes `.pHive/design/index.yaml`
- [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — standard preamble + warn-only gate posture
- `skills/plan/SKILL.md` Phase C step 16 — caller (UI-detection path delegates here)
- [`skills/hive/skills/design-dispatch/SKILL.md`](../hive/skills/design-dispatch/SKILL.md) — Phase 0 dispatch router (d-2, already shipped)
- [`hive/workflows/design-review.workflow.yaml`](../../hive/workflows/design-review.workflow.yaml) — Phase A orchestration template anchor (lines 8-81)
