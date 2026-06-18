# Vertical Plan: Hive Composability + Design-Aware Planning

**Epic:** `hive-composability-design`
**Date:** 2026-04-17
**Inputs:** horizontal-plan.md, design-discussion.md, user-feedback-design-discussion.md, architect-memo.md, tpm-memo.md
**Classification:** Meta-infra epic → pragmatic working-state reading per §1

---

## 1. Slicing Strategy

**Epic class:** meta-infra (config + routing + skill-template + reference-contracts). Strict runtime-behavior reading fails — the epic's value is new contracts and paths, not a demoable app change. Use **pragmatic stop-ship reading**: each slice ships coherent, inspectable increments with nothing left half-wired.

**Subsystem seams (per `subsystem-seam-slicing-heuristic` memory):** the layer map has four natural subsystems:
1. **Format seam** — L2 output format, L3 templates, L9 format-contract doc, L10 telemetry, L12 sidecar gen (Workstream D)
2. **Composability seam** — L1 routing, L2 structural split, L8 orchestrator persona updates, L1 confirmation gate (Workstream A)
3. **Economy seam** — L4 model docs, L7 model_overrides/profile, L8 tier table, L9 tiering contract (Workstream C)
4. **Lifecycle seam** — L4 step 7b extension, L6 story-boundary hook, L7 lifecycle keys, L9 handoff schema, L11 carrier, L5 docs (Workstream B)

These seams are largely orthogonal in file ownership, except for a few shared-file serialization chains (documented in §2 per slice).

```
STRATEGY:
  Total horizontal items: ~27 across 12 layers
  Planned slices: 8 (+ 1 parallel support story = 9 stories total)
  First slice goal: Format contract established + one reference rendering exists (the
                    epic's own design-discussion.html sidecar); doc-token-telemetry
                    collects data from Slice 1 onward
  Final slice goal: All four workstreams live — lite planning, respawn-per-task,
                    model tiering, and rich visual outputs — with Workstream B gated
                    on memory-autonomy-foundation Phase 2 closure

  Slicing rationale:
    - Slice 1 produces the format-contract artifact (L9) + L2 format output seed +
      L12 sidecar gen. THIS epic's own design-discussion.html proves the format.
      Without this, every D-adjacent later slice re-debates format.
    - Slice 2 wires --lite end-to-end (L1 + L2 structural split). Slice 2 depends
      on Slice 1 only for the format (soft — --lite code can ship without; demo
      needs format contract).
    - Slice 3 is the model-economy quick win (C). Zero infrastructure work.
      Parallelizable with Slice 2 — different subsystem seam, different files.
    - Slices 4–5 expand D (H/V templates, structured outline, PRD sidecar).
      Follow once Slice 1 format contract is stable + telemetry has data.
    - Slices 6–8 deliver B. Gated on memory-autonomy Phase 2 YAML refresh and
      remaining merges. Three sub-layers: (6) schema+config+docs, (7) step 7b
      two-param + memory-bridging read, (8) session execute boundary hook +
      handoff writer.
    - Parallel story (Slice 1-adjacent): doc-token-telemetry (L10). Same sprint
      as Slice 1, no dependency either direction.
```

---

## 2. Vertical Slice Plan

### Slice 1 — Format Contract + Reference Render (Workstream D seed)

```
BUILDS ON: nothing
WHAT WORKS AFTER THIS STEP:
  A format-contract reference doc exists at hive/references/planning-format-contract.md
  specifying markdown-with-embedded-HTML as the canonical format, the sidecar-HTML
  generation rule, Mermaid delimiter convention, and image-source policy. The
  design-discussion skill produces one rendered reference artifact — this epic's own
  design-discussion.md WITH a sidecar design-discussion.html — so the format is
  visible and auditable. The sidecar generator (L12) is a working utility invoked
  when the skill writes.

LAYERS TOUCHED:
  L9: hive/references/planning-format-contract.md (NEW) — contract content
  L2: skills/hive/skills/design-discussion/SKILL.md — add HTML `<figure>` slots
      to output template; reference L9; NO structural split yet (that is Slice 2)
  L12: new sidecar-HTML generator — pure template substitution, invoked by L2 write
  L8: orchestrator.md cross-reference added to point at L9

NOT YET:
  - Mermaid in H/V diagrams (Slice 4)
  - Structured-outline figures (Slice 4)
  - PRD HTML vehicle (Slice 5)
  - doc_format config key (deferred)

VERIFIED BY:
  - Inspect hive/references/planning-format-contract.md — contract fields all present
  - Re-run the design-discussion skill against this epic; confirm output gains
    `<figure>` slot placeholders, markdown still readable via `cat`
  - Confirm state/epics/hive-composability-design/docs/design-discussion.html exists
    and renders in a browser
  - Grep test: grep against design-discussion.md still works (no HTML scaffolding
    wrapping the body)

COMMIT REPRESENTS: "feat(docs): establish planning format contract + sidecar HTML
                   generator; design-discussion skill emits rich reference artifact"

STORIES IN THIS SLICE:
  S1.1 — planning-format-contract.md (L9 content)
  S1.2 — design-discussion output template update (L2 format output) + sidecar gen (L12)
         (bundled because the contract must ship WITH a working reference render)
```

---

### Slice 1b (PARALLEL) — doc-token-telemetry

```
BUILDS ON: nothing — parallel to Slice 1 per Q3 resolution
WHAT WORKS AFTER THIS STEP:
  When any planning artifact is written (design-discussion, structured-outline, H/V,
  PRD), a telemetry probe appends a token-count record to state/telemetry/doc-tokens.jsonl.
  No read path yet — data-only. Format-decision revisit in Slice 4+ has data to use.

LAYERS TOUCHED:
  L10: new lib/doc-token-telemetry.* (NEW) — token counter invoked on artifact write
  L2, L3: one-line invocation addition (post-write hook) — can serialize with
          Slice 1's L2 edit if same-sprint

NOT YET:
  - Read path / telemetry dashboard (future epic)
  - Format flip based on data (Slice 4+)

VERIFIED BY:
  - Run a /hive:plan pass; confirm state/telemetry/doc-tokens.jsonl grows
  - Schema check: each line has {ts, epic_id, doc_type, format, token_count,
    char_count, bytes}

COMMIT REPRESENTS: "feat(telemetry): add doc-token-telemetry probe for planning artifact writes"

STORIES IN THIS SLICE:
  S1b.1 — doc-token-telemetry probe + invocation hooks
```

---

### Slice 2 — Lite Mode End-to-End (Workstream A core)

```
BUILDS ON: Slice 1 (format contract, for user-facing demo value; not a code dependency)
WHAT WORKS AFTER THIS STEP:
  `/hive:plan --lite` on a small-scope requirement runs through a trimmed pass:
  design-discussion produce-doc fires, collaborative-review is skipped, H/V skipped,
  structured outline minimal, story decomposition simplified. `/hive:plan` without
  --lite is unchanged from pre-epic behavior. Design-discussion skill is structurally
  split into produce-doc and review-doc sub-invocations. A TUI confirmation gate
  fires after design-discussion produce-doc, with optional state-file sign-off per Q2.
  `--lite` refuses when scope is multi-epic or PRD (scope-class guard).

LAYERS TOUCHED:
  L2: structural split (breaking contract change — own story):
      - produce-doc (always fires)
      - review-doc (fires only when planning.collaborative_review: true)
      - Top-level skill name dispatches to (a) + (b) in full mode, (a) alone in lite
      - Structured SCALE ASSESSMENT scope-class hint emission
  L1: skills/plan/SKILL.md — add --lite routing row at :120-134; add scope-class
      guard that refuses --lite for multi-epic / PRD; add TUI confirmation gate
      invocation after design-discussion produce-doc; add optional state-file
      sign-off path (gate-to-state)
  L8: orchestrator.md flag table at :191-197 — add --lite, --skip-sign-off,
      --skip-research

NOT YET:
  - Effort-heuristic auto-promotion (Q1 deferred — manual flag only for now)
  - --quick escape hatch (later slice or next epic)
  - --profile dispatch (Slice 3)
  - Lifecycle config keys (Slices 6–8)

VERIFIED BY:
  - Run `/hive:plan --lite` on a small-scope requirement; confirm lite path fires,
    collaborative-review does NOT run, doc-production DOES
  - Run `/hive:plan` without flags on the same requirement; confirm full ceremony
    unchanged (collaborative-review runs, all downstream phases run)
  - Run `/hive:plan --lite` on a requirement declared as multi-epic or PRD;
    confirm refusal with clear error
  - Confirm TUI prompt fires after design-discussion produce-doc; confirm optional
    state/epics/{epic-id}/docs/design-discussion-signoff.md written when configured
  - Regression: a manual /hive:plan invocation matches pre-epic log output
    (modulo Slice 1's format changes)

COMMIT REPRESENTS: "feat(plan): --lite mode end-to-end with structural doc/review
                   split and confirmation gate"

STORIES IN THIS SLICE:
  S2.1 — design-discussion structural split (doc-production / review-doc) — foundational,
         lands first
  S2.2 — --lite routing + flag prose at skills/plan/SKILL.md (consumes S2.1)
  S2.3 — scope-class guard for --lite refusal (consumes S2.1 structured hint)
  S2.4 — confirmation gate (TUI + optional state-file sign-off) (consumes S2.1)

SERIALIZATION: S2.1 → {S2.2, S2.3, S2.4}. S2.2/S2.3/S2.4 all edit skills/plan/SKILL.md
               → serialize their merges (one at a time into main).
```

---

### Slice 3 — Model Tiering (Workstream C — parallelizable with Slice 2)

```
BUILDS ON: nothing (different subsystem seam from Slices 1–2; no shared files beyond
           orchestrator.md flag table which serializes)
WHAT WORKS AFTER THIS STEP:
  hive/hive.config.yaml model_overrides is populated per balanced/quality/budget
  profile. A top-level `model_profile: balanced` key exists. `/hive:plan --profile
  {quality|balanced|budget}` and agent-spawn reads the resolved profile. Per-persona
  frontmatter `model:` continues to override config (already live). Explorer/research
  Haiku-refusal guardrail is documented and enforced in agent-spawn validation.
  A tiering contract reference doc exists.

LAYERS TOUCHED:
  L9: hive/references/model-tiering-contract.md (NEW)
  L7: hive/hive.config.yaml — populate model_overrides; add top-level model_profile
  L4: agent-spawn step 7.1 docs — document frontmatter > config precedence;
      add Explorer/Haiku refusal check
  L1: skills/plan/SKILL.md — --profile flag prose
  L8: orchestrator.md tier table at :170-184 updated to cite L9 contract

NOT YET:
  - Any persona frontmatter changes (already live — nothing to do)
  - Automatic profile inference from epic scope (future epic)

VERIFIED BY:
  - Spawn an agent whose persona resolves to Haiku under `budget`; confirm tier used
  - Spawn a persona whose frontmatter says `model: opus` under `budget`; confirm
    frontmatter wins
  - Attempt to spawn an Explorer-type agent with Haiku tier; confirm refusal with
    clear error message
  - Confirm `hive/references/model-tiering-contract.md` reads as self-contained

COMMIT REPRESENTS: "feat(economy): activate model tiering — profile config, overrides,
                   Explorer/Haiku guardrail"

STORIES IN THIS SLICE:
  S3.1 — model-tiering-contract.md (L9)
  S3.2 — hive.config.yaml model_profile + populated model_overrides (L7)
  S3.3 — agent-spawn docs + Explorer/Haiku refusal check (L4)
  S3.4 — --profile flag + orchestrator tier-table update (L1 + L8)

PARALLELIZATION NOTE: Slice 3 runs in parallel with Slice 2 on different subsystem
  seams. L8 orchestrator.md is shared — S2.2 (flag table) and S3.4 (tier table)
  edit different sections, but one will cause merge conflicts → serialize the L8
  edits (pick one story to land L8 changes second and rebase).
```

---

### Slice 4 — Rich H/V + Structured Outline (Workstream D expansion)

```
BUILDS ON: Slice 1 (format contract) + Slice 1b (telemetry data available)
WHAT WORKS AFTER THIS STEP:
  horizontal-plan and vertical-plan skill templates emit Mermaid diagrams instead of
  ASCII when invoked. Structured-outline Part 6 dep map is Mermaid; Part 3 supports
  HTML `<figure>` slots for wireframe thumbnails. Sidecar HTML is generated for
  these artifacts when written. Telemetry data from Slice 1b informs Decision #3
  flip-or-stay evaluation at end of slice; default remains markdown-embedded-HTML.

LAYERS TOUCHED:
  L3: horizontal-plan/SKILL.md:89-109 — Mermaid replaces ASCII
  L3: vertical-plan/SKILL.md:97-122 — Mermaid replaces ASCII
  L3: structured-outline/SKILL.md — Part 6 Mermaid; Part 3 optional figures
  L12: sidecar generator now invoked by H/V and structured-outline writes
  L9: planning-format-contract.md updated to reflect H/V + outline figure/Mermaid usage

NOT YET:
  - PRD HTML vehicle (Slice 5)
  - Existing in-repo H/V docs stay as ASCII (no regeneration)

VERIFIED BY:
  - Re-run /hive:plan on a small epic; confirm horizontal-plan.md and vertical-plan.md
    outputs carry Mermaid fenced blocks, not ASCII art
  - Confirm sidecar .html files exist for these outputs and render in browser
  - Grep test: grep for pattern in H/V plans still works (Mermaid is fenced markdown)
  - Telemetry review: state/telemetry/doc-tokens.jsonl has data from Slice 1b; evaluate
    markdown-embedded vs. HTML-primary cost (output-only; no code change required if
    markdown-embedded wins, which is the pre-commitment)

COMMIT REPRESENTS: "feat(docs): Mermaid diagrams in H/V + structured outline, figures
                   in outline Part 3; sidecar HTML expanded"

STORIES IN THIS SLICE:
  S4.1 — horizontal-plan + vertical-plan Mermaid templates (L3)
  S4.2 — structured-outline Mermaid + figure slots (L3)
  S4.3 — sidecar-gen invocation expansion (L12) + format-contract doc update (L9)
```

---

### Slice 5 — PRD HTML Vehicle (Workstream D completion)

```
BUILDS ON: Slice 4 (Mermaid + figure conventions established)
WHAT WORKS AFTER THIS STEP:
  When a PRD is produced (only for epics classified as PRD-territory per scope class),
  it emits a full HTML vehicle — sectioned document with inline Mermaid and figures.
  Sidecar markdown is generated from the HTML for grep-compat (inverse direction from
  other planning docs — this is the only doc where HTML is canonical).

LAYERS TOUCHED:
  L3: prd skill (confirm existence or create) — HTML-primary output
  L12: sidecar-gen — inverse-direction variant (HTML → markdown)
  L9: planning-format-contract.md updated for PRD exception

NOT YET:
  - Interactive HTML (out of scope per §6 constraint)

VERIFIED BY:
  - Produce a PRD on a large-scope epic; confirm HTML output renders correctly
  - Confirm `.md` sidecar is readable in terminal and greppable
  - Telemetry: confirm HTML-primary cost measured; compare vs. markdown-embedded

COMMIT REPRESENTS: "feat(docs): PRD HTML vehicle + inverse-direction sidecar"

STORIES IN THIS SLICE:
  S5.1 — PRD HTML output template + inverse-direction sidecar generator
```

---

### Slice 6 — Workstream B Foundation (schema + config + docs)

```
BUILDS ON: memory-autonomy Phase 2 YAML refresh (bookkeeping, one-shot) —
           confirm all memory-autonomy stories referenced as depends_on actually merged
           per git log; update story YAML statuses from git
WHAT WORKS AFTER THIS STEP:
  A story-handoff schema reference doc exists. hive.config.yaml gains
  planning.teammate_lifecycle: long_running and execution.teammate_lifecycle:
  respawn_per_task phase-keyed defaults. Respawn skill docs explicitly cross-reference
  the new story-handoff path and clarify when each carrier type is used. No lifecycle
  behavior has changed yet — this slice is pure contracts + docs.

LAYERS TOUCHED:
  L9: hive/references/story-handoff-schema.md (NEW)
  L7: hive.config.yaml — add planning.teammate_lifecycle, execution.teammate_lifecycle
  L5: skills/hive/skills/respawn/SKILL.md — docs update cross-referencing story-handoff
  L11: carrier dir convention documented (no code — file naming convention only)

NOT YET:
  - step 7b two-param (Slice 7)
  - Session execute boundary hook (Slice 8)
  - Any lifecycle behavior change — defaults match current behavior

VERIFIED BY:
  - Inspect story-handoff-schema.md — all fields present per architect-memo §1c
  - Confirm hive.config.yaml YAML parses; confirm defaults match current behavior
  - Confirm no existing agent behavior changes (phase-keyed defaults = status quo)

COMMIT REPRESENTS: "feat(lifecycle): introduce story-handoff schema, phase-keyed lifecycle
                   config keys, respawn-docs cross-ref"

STORIES IN THIS SLICE:
  S6.0 — (bookkeeping) refresh memory-autonomy-foundation story YAML statuses from git
  S6.1 — story-handoff-schema.md (L9)
  S6.2 — hive.config.yaml lifecycle keys (L7)
  S6.3 — respawn skill docs cross-reference update (L5)

SERIALIZATION: S6.0 lands first as a bookkeeping PR. S6.1/S6.2/S6.3 can land in any
               order after.
```

---

### Slice 7 — Agent-Spawn Step 7b Two-Param + Memory Bridging (Workstream B)

```
BUILDS ON: Slice 6 (schema exists, config keys exist)
WHAT WORKS AFTER THIS STEP:
  agent-spawn step 7b accepts both respawn_summary_path and handoff_summary_path.
  Preamble text differs per mode. Existing callers using respawn_summary_path only
  see identical behavior (backwards-compat). When handoff_summary_path is set,
  spawn prompt instructs the agent to read the handoff summary, insights pointers,
  and episode pointers BEFORE opening implementation files — the memory-bridging
  read contract. No session execute caller sets handoff_summary_path yet — Slice 8
  wires that.

LAYERS TOUCHED:
  L4: agent-spawn/SKILL.md:188-206 — extend step 7b to accept both parameters;
      different preamble text per mode
  L4: agent-spawn docs — memory-bridging prose (read handoff, insights, episodes first)

NOT YET:
  - Session execute boundary hook setting handoff_summary_path (Slice 8)
  - Any live per-task respawn behavior — step 7b is ready but unfired

VERIFIED BY:
  - Call agent-spawn with only respawn_summary_path; confirm prompt uses
    context-pressure preamble (unchanged from today)
  - Call agent-spawn with only handoff_summary_path (test fixture); confirm prompt
    uses story-handoff preamble with the memory-bridging instruction block
  - Call agent-spawn with both set; confirm error

COMMIT REPRESENTS: "feat(spawn): step 7b two-parameter path — handoff_summary_path with
                   memory-bridging read contract"

STORIES IN THIS SLICE:
  S7.1 — agent-spawn step 7b two-param extension + preamble logic + memory-bridging prose
```

---

### Slice 8 — Session Execute Story-Boundary Hook + Handoff Writer (Workstream B)

```
BUILDS ON: Slice 6 + Slice 7 + memory-autonomy Phase 2 remaining stories merged
WHAT WORKS AFTER THIS STEP:
  When execution.teammate_lifecycle: respawn_per_task (now a live path), session
  execute writes a story-handoff summary at story N completion and spawns the fresh
  teammate for story N+1 with handoff_summary_path set. When lifecycle is
  long_running (default for planning phase), no change. Users can opt-in to
  per-task respawn on development phases via config.

LAYERS TOUCHED:
  L6: skills/hive/skills/execute/SKILL.md — story-boundary hook; reads lifecycle config
  L6: handoff writer block — reads story-N agent insights/episode pointers,
      conforms to L9 story-handoff-schema
  L4: agent-spawn caller (in execute) passes handoff_summary_path when lifecycle is
      respawn_per_task

NOT YET:
  - Auto-lifecycle selection per epic scope (future)
  - planning-phase per-task respawn (default stays long_running)

VERIFIED BY:
  - Run /hive:execute on an epic with execution.teammate_lifecycle: respawn_per_task
    on a 2+ story epic; confirm story N writes handoff summary; confirm story N+1
    agent preamble acknowledges handoff and reads insights/episodes before files
  - Run same epic with execution.teammate_lifecycle: long_running; confirm no
    handoff written; confirm same agent persists across stories
  - Regression: existing epics without lifecycle config behave as today

COMMIT REPRESENTS: "feat(execute): story-boundary respawn-per-task hook with handoff
                   summary writer and agent-spawn wiring"

STORIES IN THIS SLICE:
  S8.1 — execute story-boundary hook + handoff writer + agent-spawn caller update
```

---

## 3. Overlay Diagram

```
VERTICAL SLICE OVERLAY — pragmatic working-state reading per slice
───────────────────────────────────────────────────────────────────────────────────────────

                 │ Slice 1    │ Slice 1b  │ Slice 2    │ Slice 3    │ Slice 4    │ Slice 5 │ Slice 6  │ Slice 7  │ Slice 8  │
                 │ (D seed)   │ (telem.)  │ (A lite)   │ (C tier)   │ (D H/V)    │ (D PRD) │ (B base) │ (B 7b)   │ (B hook) │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L1 Plan Orch     │            │           │ --lite     │ --profile  │            │         │          │          │          │
                 │            │           │ scope-guard│            │            │         │          │          │          │
                 │            │           │ conf-gate  │            │            │         │          │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L2 Design-Disc   │ format out │ write hook│ SPLIT      │            │            │         │          │          │          │
                 │ `<figure>` │           │ scope hint │            │            │         │          │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L3 Templates     │            │ write hook│            │            │ Mermaid H/V│         │          │          │          │
                 │            │           │            │            │ Outline fig│         │          │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L4 Agent-Spawn   │            │           │            │ model docs │            │         │          │ 7b 2-pm  │ caller   │
                 │            │           │            │ Haiku chk  │            │         │          │ bridging │ update   │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L5 Respawn       │            │           │            │            │            │         │ docs xref│          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L6 Execute       │            │           │            │            │            │         │          │          │ boundary │
                 │            │           │            │            │            │         │          │          │ hook+wrt │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L7 Config        │            │           │            │ model_*    │            │         │ lifecycle│          │          │
                 │            │           │            │ profile    │            │         │ keys     │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L8 Orchestrator  │ xref L9    │           │ flag table │ tier table │            │         │          │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L9 Ref Docs      │ format     │           │            │ tiering    │ format upd │ PRD upd │ handoff  │          │          │
                 │ contract   │           │            │ contract   │            │         │ schema   │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L10 Telemetry    │            │ probe NEW │            │            │ data used  │ data used│          │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L11 Carrier Dir  │            │           │            │            │            │         │ 2nd conv │          │          │
─────────────────┼────────────┼───────────┼────────────┼────────────┼────────────┼─────────┼──────────┼──────────┼──────────┤
L12 Sidecar Gen  │ NEW        │           │            │            │ expanded   │ inverse │          │          │          │
                 │ (md→html)  │           │            │            │ H/V+outl   │ dir     │          │          │          │
───────────────────────────────────────────────────────────────────────────────────────────

Each column is a commit-worthy, coherent increment (pragmatic stop-ship reading).
Slices 1, 1b, 3 are parallelizable with each other.
Slice 2 depends on Slice 1 only for demo value (format contract).
Slices 4, 5 build on Slice 1 + 1b sequentially.
Slices 6, 7, 8 serialize (B foundation → B step 7b → B execute hook) and gate externally.
```

---

## 4. Deferred Items

```
DEFERRED (not in any slice):

Workstream A:
  - Effort-heuristic auto-promotion (--lite inferred from scope signals)
    RATIONALE: Q1 unresolved — thresholds undefined, scale-assessment structured
               vs. prose schema is itself a breaking change. Manual --lite flag
               ships first; auto-promotion is a follow-on story when signals are
               specified.
  - /hive:plan --quick escape hatch
    RATIONALE: Deferred to validate /hive:plan --lite first. --quick is a degenerate
               case of --lite with further skip flags; ship the core lite path before
               layering another mode.
  - Runtime sign-off collapse ("auto-skip when only one persona weighs in")
    RATIONALE: Per architect memo §3, this belongs in execute at runtime, not in
               plan. Separate story in a future execute-focused epic.

Workstream D:
  - planning.doc_format config key (markdown-embedded vs. HTML-primary)
    RATIONALE: Only needed if telemetry data (Slice 1b) shows HTML-primary meaningfully
               beats markdown-embedded. Per user feedback Q4, markdown-embedded is
               the confirmed default; no flip planned unless data overwhelmingly shifts.
  - Regenerating existing in-repo H/V docs with Mermaid
    RATIONALE: Existing memory-autonomy-foundation/docs/vertical-plan.md etc.
               stay as ASCII unless authors choose to regenerate. No data migration.
  - Interactive HTML (React components, live playgrounds)
    RATIONALE: Explicit §6 out-of-scope constraint.

Workstream B:
  - Auto-lifecycle selection per epic scope
    RATIONALE: Config-driven is a cleaner initial surface; auto-selection is a later
               refinement once lifecycle modes are battle-tested.
  - planning-phase per-task respawn (default stays long_running)
    RATIONALE: Planning phase is collaborative, respawn-per-task would kill context
               continuity within a design discussion. Ship execution-phase per-task
               first; planning-phase is opt-in config only.
  - Removing legacy respawn summary schema
    RATIONALE: Context-pressure respawn continues to exist and use the existing
               schema per architect memo §1b. Two schemas coexist indefinitely.

Telemetry:
  - Read path / dashboard for state/telemetry/doc-tokens.jsonl
    RATIONALE: Data collection is independent of consumption. Analysis / tooling
               is a future epic.
```

---

## 5. Risk by Slice

```
RISK PER SLICE:
  Slice 1 (D seed):          MEDIUM — greenfield format territory, sidecar gen
                                      is a new utility. Mitigation: format-contract
                                      artifact is the Slice 1 output itself —
                                      reviewable before it propagates.
  Slice 1b (telemetry):      LOW    — additive, data-only, no existing consumers.
                                      Risk is library choice (tokenizer package)
                                      but fallback to heuristic char-count is
                                      trivial.
  Slice 2 (A lite):          HIGH   — L2 structural split is a breaking contract
                                      change. Every caller of design-discussion
                                      today assumes it produces doc + runs review.
                                      Splitting surfaces hidden coupling. Backwards-
                                      compat strategy (skill name dispatches to
                                      (a)+(b) in full mode) mitigates, but regression
                                      window is real. Verify all callers before
                                      landing.
  Slice 3 (C tier):          LOW    — documentation + config population. The
                                      Haiku refusal check is the only logic add,
                                      and it's a prose validation step in
                                      agent-spawn.
  Slice 4 (D H/V):           MEDIUM — Mermaid adoption is a prose-template change,
                                      but downstream consumption environments may
                                      not all render Mermaid (e.g., plain text
                                      terminal viewer). Mitigation: Mermaid
                                      fenced-code degrades to a readable text block.
  Slice 5 (D PRD):           MEDIUM — PRD may not exist as a distinct skill today;
                                      verify before authoring. Inverse-direction
                                      sidecar (html → md) is conceptually tricky.
  Slice 6 (B foundation):    LOW    — pure contracts + config; no behavior change.
                                      Only risk is the bookkeeping S6.0 (YAML refresh)
                                      surfacing more drift than expected.
  Slice 7 (B step 7b):       MEDIUM — agent-spawn is a heavily-used code path.
                                      Two-param extension must not break the many
                                      existing callers. Verify every Agent/
                                      TeamCreate call site.
  Slice 8 (B execute hook):  HIGH   — Session execute path was itself recently
                                      migrated (967a1d4). Adding a story-boundary
                                      hook on top of still-stabilizing infrastructure
                                      risks compounding instability. Mitigation:
                                      gate on memory-autonomy Phase 2 remaining
                                      stories merging AND stabilizing before
                                      Slice 8 starts.
```

---

## 6. Moldability Notes

**Can be reordered:**
- Slice 3 is order-independent from Slices 1, 1b, 2, 4, 5. Move earlier if the
  team wants a quick win; move later if model-tiering is lower priority than
  composability/rich-outputs.
- Slice 1b can land before, during, or after Slice 1. It is pure parallel.
- Slices 4 and 5 can swap order (H/V vs. PRD) depending on which doc type has
  higher real-world priority.

**Can be dropped if scope shrinks:**
- Slice 5 (PRD HTML vehicle) — PRDs are produced only for PRD-territory epics;
  the epic class-guard in Slice 2 already refuses --lite for these. PRD rich
  rendering is a nice-to-have, not foundational.
- Slices 6–8 (Workstream B) as a unit — this is the heaviest workstream and
  the one most gated on external dependencies. If the epic must ship in a
  compressed window, B can split off as a follow-on epic. Slices 1 + 1b + 2 + 3
  deliver the composability + model-economy + design-awareness MVP without B.

**New slices that may be needed:**
- A "retrofit existing planning docs to Mermaid" slice if the team decides
  backfill is valuable. Not planned now.
- An "effort-heuristic auto-promotion" slice after Q1 thresholds are defined
  and scale-assessment schema decision is made. Not part of this epic.
- A "telemetry read path" slice after enough data has accumulated to design
  a dashboard. Not part of this epic.

**What later slices may teach earlier ones:**
- Slice 1b telemetry data may show markdown-embedded-HTML is significantly
  worse than HTML-primary on some axis. If so, Slice 4 adds an optional
  `planning.doc_format: html_primary` config key rather than flipping the
  default — preserves backwards-compat for users already consuming
  markdown-embedded output.
- Slice 2 L2 structural split may surface undocumented callers; fix-forward
  as Slice 2.5 if needed, rather than blocking the whole epic.
- Slice 7 step 7b extension may reveal additional agent-spawn callers that
  need updating; each is a small fix-forward story, not a plan-level issue.

**Structural invariants that do NOT mold:**
- Slice 1 format contract must land before any D expansion (Slices 4, 5).
- Slice 2 L2 structural split must land with or before the --lite routing story.
- Slice 6 must precede Slices 7 and 8 (schema → consumers).
- Slice 8 gates on memory-autonomy Phase 2 completion (external).
- The design-discussion gate is never skippable — lite mode trims review,
  not produce-doc (enforced structurally in Slice 2 L2 split).
