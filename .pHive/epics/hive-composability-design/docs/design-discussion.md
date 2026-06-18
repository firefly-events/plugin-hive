# Design Discussion: Hive Composability + Design-Aware Planning

**Epic:** `hive-composability-design`
**Date:** 2026-04-17
**Sources:** research-brief.md, architect-memo.md, tpm-memo.md, user §7 locked decisions

---

## 0. Refresh Note (2026-06-17)

This epic was planned 2026-04-17 but never committed — it lived only in the maintainer's
primary clone working tree, blanket-ignored by `.pHive/epics/*` with no `.gitignore`
allowlist entry (same orphan failure mode as `sandcastle-gh-issue-dispatch`). It was
rescued into version control on `feat/hive-composability-design` (off `develop`) and the
scope was re-evaluated against ~2 months of shipped work. Sections 1–7 below are the
original April thinking, preserved for the audit trail. The **current** scope is:

- **Workstream D (Rich Outputs) + s1b telemetry — KEPT.** Still genuinely unbuilt:
  `hive/references/document-templates/*` are still ASCII; no HTML sidecar generator
  exists. This is the surviving core of the epic.
- **Workstream A (Composability) — RECONCILED.** `--fast` shipped in the meantime (it
  skips H/V at medium scope). Kept the design-discussion produce/review split (s2-1) and
  redefined `--lite` as a token-economy *umbrella* distinct from `--fast` (s2-2). The
  scope-class guard (former s2-3) was dropped — shipped `gate_mode` (warning|hard) plus
  large-scope routing already govern mandatory full ceremony.
- **Workstream C (Model Economy) — DROPPED.** `model_overrides` + `agent_backends` +
  the Haiku/Explorer guardrail all shipped via the routing-policy config
  (`hive.config.yaml`, orchestrator.md). Nothing left to build.
- **Workstream B (Respawn-per-task Lifecycle) — DROPPED as a feature.** The execution
  substrate moved to Multica/sandcastle, where per-story fresh-agent dispatch is native,
  so respawn-per-task is moot and the session story-boundary hook (s8-1) targeted a
  superseded path. Replaced by one documentation story (`b-1`) that records this decision
  in user-facing docs rather than dropping it silently.

Net: 20 stories → 10. `version_bump: minor`. The §6 open questions about effort
thresholds, sign-off-gate shape, and phase-scoped lifecycle config are resolved or moot
under the refreshed scope.

---

## 1. What Are We Doing?

Two complaints that reinforce each other: hive costs too many tokens for routine work, and its planning artifacts look like wall-of-text markdown when the product's whole selling point is design fluency.

Four workstreams address this:

- **A (Composability):** Add `--lite` mode, quick-task escape hatch, effort-heuristic auto-promotion. Fix the design-discussion gate so doc-production is structurally separated from the collaborative-review toggle — these are currently coupled in one skill and one config flag.
- **B (Teammate Lifecycle):** Add respawn-per-task as a NEW lifecycle mode — not an extension of context-pressure respawn. Wire a new `story-handoff` summary schema + two-parameter step 7b injection to the session infrastructure from `memory-autonomy-foundation`.
- **C (Model Economy):** Document and activate the tiering system. Infrastructure is nearly complete — frontmatter `model:` override is already live. Work is contract documentation, config population, and the Explorer/Haiku guardrail.
- **D (Rich Outputs):** Replace ASCII diagrams with Mermaid. Add HTML/image capability to planning docs. Fully greenfield — no existing format to migrate from or break. Gated on a format-contract decision that must happen *in this design discussion*, not deferred.

"Done" at minimum-viable-ship (Slices 1–3): a user runs `/hive:plan --lite` on a small feature, gets a visually rich design discussion with a rendered image slot and Mermaid slice diagrams, agents spawn at the right model tier without configuration, and the whole run costs meaningfully fewer tokens than full-ceremony planning.

---

## 2. What I Found

This epic has **two character lanes** that are easy to conflate but must stay separate:

**Lane 1 — Infrastructure changes to the plan skill itself.** These are structural rewrites: separating doc-production from team review in `skills/hive/skills/design-discussion/SKILL.md` (currently one skill does both — splitting is a breaking contract change, warrants its own story), wiring `--lite` routing at `skills/plan/SKILL.md:120-134`, defining the effort-heuristic schema, authoring the `story-handoff` summary schema, adding the two-parameter step 7b injection to `skills/hive/skills/agent-spawn/SKILL.md:188-206`.

**Lane 2 — Content conventions for how planning docs are authored.** These are prose-template changes: updating `skills/hive/skills/horizontal-plan/SKILL.md:89-109` and `skills/hive/skills/vertical-plan/SKILL.md:97-122` to emit Mermaid instead of ASCII, updating design-discussion and structured-outline output templates to include HTML image slots, establishing the sidecar-HTML pattern (markdown canonical + HTML sibling generated on write).

Lane 1 requires careful sequencing and backwards-compatibility attention. Lane 2 is cheap and largely reversible. Conflating them inflates risk estimates for the wrong stories.

**On model tiering (Workstream C):** `hive/hive.config.yaml:45-68` already has `model_tiers` lists and an empty `model_overrides: {}`. Agent frontmatter `model:` is read at `skills/hive/skills/agent-spawn/SKILL.md:149` and passed to the spawn call today. Orchestrator is `model: opus` (`hive/agents/orchestrator.md:3`), team-lead is `model: opus` (`hive/agents/team-lead.md:3`). The tier resolution table exists at `hive/agents/orchestrator.md:170-184`. This workstream is mostly documentation + config population — no spawn infrastructure changes.

**On Workstream B's real critical path:** Memory-autonomy story YAMLs read `status: pending` but git log shows S7 (`session-prompt-spec`), S9 (`story-execution-migration`), `kg-import`, `session-registry`, `session-runtime-bridge`, `session-resilience`, `specialist-trigger-migration` all already merged. The YAMLs are stale. B's actual hard prerequisites — S7 + S9 + `kg-write-path` + `kg-read-path` — are either merged or nearly there. ChromaDB and `session-end-integration` can be parallel-developed. The blocking picture is much tighter than the research brief implies.

**On the respawn summary reuse question:** The existing schema at `skills/hive/skills/respawn/SKILL.md:74-113` was designed for context-pressure handoff — same agent, same step, mid-flight. It has no cross-story slot, no structured insights pointer, no decision-context handoff field. Per-task respawn crosses story boundaries (story N → story N+1). **Do not reuse this schema.** Define a separate `story-handoff` summary with a new filename convention (`{agent}-handoff-{to-story-id}.md`) in the same `state/respawn-summaries/` directory, with explicit fields for insights pointers and prior-story observations.

**On the step 7b injection point:** `agent-spawn/SKILL.md:188-206` takes a single `respawn_summary_path` parameter. Per-task respawn needs a different preamble ("you are starting a new story with prior context" vs "you are continuing the same step"). Use two parameters — `respawn_summary_path` (context-pressure, unchanged) + `handoff_summary_path` (per-task story handoff). Same carrier directory, different semantics, backwards-compatible.

---

## 3. My Proposed Approach

The TPM's revised slice ordering is correct. Adopt it:

**Slice 1 — Format contract (D seed):** Decide the design-discussion document format now (not deferred). Update `skills/hive/skills/design-discussion/SKILL.md` output template only — not structured outline, not PRD. Produce one rendered reference design-discussion artifact (this epic's own) as the proof. This epic's own design discussion *is* the reference render. Format decision (forcing Decision #3): **markdown-with-embedded-HTML, sidecar HTML generated from it** — see §4 for reasoning. The `doc-token-telemetry` story also targets Slice 1 as a parallel story so measurement data exists when the format decision is revisited.

**Slice 2 — Lite mode end-to-end (A core):** Wire `--lite` routing row at `skills/plan/SKILL.md:120-134`. Add orchestrator routing table entry at `hive/agents/orchestrator.md:191-197`. Add `--skip-sign-off`, `--skip-research` prose instructions (flag parsing is natural-language at `skills/plan/SKILL.md:14` — no parser work). The doc-production / collaborative-review separation in `design-discussion/SKILL.md` is a distinct story that must land here — it's a precondition for the "design discussion is never skippable" invariant to be structurally enforced, not just documented. Auto-promotion defers: `--lite` ships as a manual flag first; effort-heuristic auto-promotion follows once thresholds are defined and the output-contract question is resolved.

**Slice 3 — Model tiering (C, parallelizable with 2):** Document tiering contract, populate `model_overrides` per budget/balanced/quality profile, clarify config-vs-frontmatter precedence, add Explorer/Haiku guardrail. No infrastructure changes.

**Slices 4–5 — D expansion:** Structured outline rich format (Mermaid H/V diagrams, HTML image slots validated by telemetry data). PRD HTML vehicle. Sequence after Slice 1 format contract is validated.

**Slices 6+ — Workstream B (gated):** Respawn-per-task lifecycle config key (phase-scoped, following `planning.collaborative_review` pattern at `hive/hive.config.yaml:134-136`). New `story-handoff` schema. Two-parameter step 7b injection. Memory-bridging read contract. Must sequence after memory-autonomy-foundation Phase 2 remaining stories merge. Refresh memory-autonomy story YAML statuses from git before writing any B story YAMLs.

**Format contract I'm establishing here (Workstream D, Slice 1):**
- Design discussion doc: markdown canonical + `<figure>` HTML image slots for wireframes/placeholders + `.html` sidecar generated from it. Follows `state/brand/brand-guide.html` precedent — the only in-repo HTML artifact pattern.
- H/V slice diagrams: Mermaid replaces ASCII — prose template change in the skill, no data migration, existing docs stay as-is.
- Image source at planning time: labeled `<figure>` placeholder (with `state/wireframes/{epic-id}/{story-id}/` path if Frame0 ran, otherwise descriptive alt text). No new image generation infra.
- Measurement: `doc-token-telemetry` story runs parallel to Slice 1. If measurement shows HTML-primary beats markdown-embedded by a meaningful margin, flip in Slice 4+. Pre-measurement default is markdown-embedded.

---

## 4. What Could Go Wrong

**Design-discussion doc-production / review separation is a bigger refactor than it reads. [high]** Today `design-discussion/SKILL.md` produces the doc *and* runs the collaborative review in one skill invocation. Splitting is a breaking contract change — anything calling the skill today assumes both happen. This warrants its own story with an explicit backwards-compatibility plan. Do not bundle into the `--lite` routing story.

**Effort-heuristic thresholds are undefined and easy to miscalibrate. [high]** `SCALE ASSESSMENT` at `design-discussion/SKILL.md:97-110` emits qualitative prose, not structured signals. Auto-promoting large scope to lite mode on a bad threshold silently under-plans. Lite ships as manual `--lite` flag first. Auto-promotion defers until thresholds are defined and the structured-vs-prose schema question is resolved (structured schema is a breaking change for the design-discussion output contract).

**The sidecar HTML generation step needs explicit scoping. [medium]** Markdown-with-embedded-HTML is the canonical artifact; the sidecar `.html` needs to be generated from it. Nothing in hive today generates HTML sidecars programmatically for skill outputs. The plan skill or design-discussion skill needs a new generation step. Scope this explicitly in the Slice 1 story — it is not implied by choosing markdown-embedded-HTML as the format.

**Stale memory-autonomy YAMLs will corrupt the Workstream B dep-graph. [medium]** Story YAMLs say `pending` but seven stories are already merged. If B story YAMLs are authored against stale statuses, the dependency graph looks circular or incorrectly gated. Add a one-shot bookkeeping task to the plan — refresh memory-autonomy story statuses from git before writing any B YAML.

**Mermaid rendering environment. [medium]** Mermaid renders in GitHub markdown and viewers. If planning docs are read primarily in raw terminal output, Mermaid degrades to a fenced code block — visible but not visual. This is better than unreadable raw HTML scaffolding, but still not the intended experience. Confirm the primary consumption environment before committing to Mermaid-only for H/V diagrams.

**Phase-scoped lifecycle config shape is unresolved. [medium]** `hive.config.yaml` has no phase-scoped config keys today. The existing pattern is `planning.collaborative_review` at `:134-136` — a nested phase key. Workstream B needs to decide: parallel keys (`planning.teammate_lifecycle`, `execution.teammate_lifecycle`) or a single top-level key with phase overrides. Parallel keys match existing config shape and are the right default, but must be decided before B stories are authored.

**Sign-off collapse belongs in execute, not plan. [low]** "Auto-skip redundant sign-offs when only one persona weighs in" requires knowing at plan time who will weigh in — not available without early persona resolution. Collapse at runtime in execute instead: cheaper, safer, no plan-time change.

---

## 5. Dependencies and Constraints

**Cross-epic — Workstream B gating (from architect-memo.md + tpm-memo.md):**
- Hard prereqs: `session-prompt-spec` (S7, `hive/references/session-system-prompt-spec.md`, 11.5KB, confirmed 2026-04-14), `story-execution-migration` (S9), `kg-write-path`, `kg-read-path` — all appear merged per git log
- Soft prereqs (can author, can't merge): `chromadb-wrapper`, `chromadb-integration`, `session-end-integration`
- Action required: refresh memory-autonomy YAML statuses from git before writing B story YAMLs; cite confirmed-merged stories as `depends_on` for dep-graph honesty

**Internal sequencing constraints:**
- Format contract (Slice 1) is a soft prereq for lite mode's user-facing milestone (Slice 2) — `--lite` can ship as a code change without it, but the demo loses its selling point
- Doc-production / review separation story must land in or before Slice 2 — structural precondition for "never skippable" invariant
- `doc-token-telemetry` is a Slice 1 parallel story; its data gates the Slice 4+ format-decision revisit

**Backwards compatibility:** All new flags are natural-language prose additions — no parser work. All new config keys are opt-in. Existing runs without new flags behave identically to today. The two-parameter step 7b change must not break existing context-pressure respawn callers.

---

## 6. Open Questions

**Q1. Effort-estimator thresholds — what are they?**
`SCALE ASSESSMENT` emits prose today. Before auto-promotion can be implemented: (a) define measurable thresholds for "large scope," and (b) decide prose-parsing vs. structured schema for scale-assessment output. Structured schema is a breaking change for the design-discussion output contract. This blocks auto-promotion story authoring, not the manual `--lite` story.

**Q2. User confirmation gate shape after design discussion.**
Forced confirmation mechanism after doc-production completes: TUI prompt, required sign-off artifact written to state, or both? Determines the plan skill's output contract and what "design discussion complete" means structurally.

**Q3. Should `doc-token-telemetry` be a Slice 1 prerequisite or parallel story?**
If parallel, Slice 1 ships without measurement data and Decision #3 cannot be validated until telemetry lands. If prerequisite, Slice 1 is gated. Parallel (same sprint, not a blocker) seems right — confirm.

**Q4. Is markdown-embedded-HTML + sidecar pattern acceptable as Slice 1 default?**
This design discussion treats it as the strong default (terminal degradation asymmetry, brand-system precedent). If the user has a different preference or uses a viewer where HTML-primary works well, that changes the Slice 1 format contract.

**Q5. Phase-scoped lifecycle config shape for Workstream B.**
`planning.teammate_lifecycle` + `execution.teammate_lifecycle` (following existing `planning.collaborative_review` pattern) or a single top-level key with phase overrides? Must be decided before B story YAMLs can be scoped.

---

## 7. Verification Strategy

Plugin-hive has no automated test suite. Verification is manual, behavioral, and inspection-based.

```
VERIFICATION PLAN:
  Tools: manual /hive:plan invocations, file inspection,
         token count via doc-token-telemetry (Slice 1 parallel)
  Platforms: macOS terminal (primary hive environment)
  Automated: none — hive has no test suite; doc-token-telemetry provides
             passive measurement when artifacts are written
  Manual:
    Slice 1: inspect design-discussion.md for HTML image slots; open sidecar
             .html to verify rendering; cat test confirms markdown readable in terminal
    Slice 2: run /hive:plan --lite on small-scope epic; confirm lite path fires;
             run without --lite; confirm full ceremony unchanged; confirm
             doc-production fires in both modes, team review only in full mode
    Slice 3: spawn agent that should use Haiku; verify tier resolution; verify
             Explorer subagent_type rejects Haiku
    Slices 6+: confirm respawn-per-task fires on story boundary not context
               pressure; confirm story N+1 reads handoff summary before files
    Regression: existing plan run without new flags identical to pre-epic behavior
  Not verifying:
    Token cost comparisons until doc-token-telemetry lands (Slice 1 parallel)
    Workstream B until memory-autonomy Phase 2 remaining stories confirmed merged
    Mermaid visual rendering in non-terminal viewers (out of scope for v1)
```

---

## 8. Scale Assessment

Large scope by every measure.

**Structural changes (Lane 1):** `skills/plan/SKILL.md`, `skills/hive/skills/design-discussion/SKILL.md` (breaking contract change), `skills/hive/skills/agent-spawn/SKILL.md`, new story-handoff schema, `hive/hive.config.yaml`, `hive/agents/orchestrator.md`, new reference docs for format contract and tiering contract.

**Content conventions (Lane 2):** `skills/hive/skills/horizontal-plan/SKILL.md`, `skills/hive/skills/vertical-plan/SKILL.md`, `skills/hive/skills/structured-outline/SKILL.md` (Slice 4), new `doc-token-telemetry` story.

```
SCALE ASSESSMENT:
  Files affected: ~15-22
  Subsystems: plan skill, agent-spawn/respawn lifecycle, model tier config,
              planning doc templates, session execution path (B)
  Migration required: no data migration; doc-production/review split is a
                      breaking skill contract change (own story required)
  Cross-team coordination: yes — Workstream B gated on memory-autonomy Phase 2
  Unknowns: 5 open questions; Q1 blocks auto-promotion story authoring;
            Q2 blocks gate implementation; HTML sidecar generation step
            not yet scoped

  RECOMMENDATION: Needs structured outline
  RATIONALE: Four workstreams across two character lanes, ~15-22 files,
  one cross-epic dependency gate, a breaking skill-contract change (doc/review
  split), a greenfield format territory requiring a format-contract artifact
  as Slice 1 output, a new story-handoff schema, a new doc-token-telemetry
  story, and a 6-slice execution sequence. The TPM's revised ordering needs
  a horizontal layer map and cross-layer dependency analysis before story
  YAMLs can be written without collision.
```
