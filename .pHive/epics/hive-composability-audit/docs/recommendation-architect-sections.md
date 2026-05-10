# Recommendation — Architect Sections (2 + 5)

**Date:** 2026-05-08
**Author:** architect (audit-s4-synthesis team)
**Scope:** Joint authorship contribution. Sections 2 (skill catalog reshape plan) and 5 (North-Star alignment statement). TPM owns Sections 1, 3, 4; merges into final `recommendation.md`.
**Inputs cited:** s3 catalog-matrix.md (24-row matrix + boilerplate cross-cutting), s3 posture-check.md (REFINE verdict, 5 lifts, dissent), s3 borrows-scope.md (3 borrows + cross-borrow interactions), s3 sidecar-edits.md (3 prompt-edits), s1 sandcastle/findings.md (HYBRID), s2 atoshell/findings.md (SKIP), design-discussion.md R5+R6.
**Constraints:** R6 mitigation = counter-precedent for stand-independent + critique-resistant items. R5 mitigation = explicit dissent surfaced. Each section ends with ONE explicit verdict.

---

## Section 2 — Skill catalog reshape plan

Numbered action list. Per-skill rows (24) follow matrix tally (3 split / 1 collapse / 3 extract config / 12 leave alone / 5 reclassify) plus the cross-cutting boilerplate reshape, the 3 borrows, and the 3 sidecar edits. Total: **31 actions**.

Each row carries: action ID · skill ID · action class · rationale (1 line, source-cited) · effort · shipping order.

**Ordering convention:** "Order" maps to the s3 borrows-scope.md §"Implication" shipping order:

```
W0 — skill-prelude.md extraction (boilerplate cross-cutting)
W1 — kickoff-gate to warning + reclassify doc-templates (depends on W0 substrate)
W2 — CONTEXT.md (Borrow 2) — substrate for Borrow 1
W3 — Triage (Borrow 3) — parallel to W2
W4 — Grill (Borrow 1, atomic skill) — depends on W2
W5 — Sidecar bundle (3 edits) — low priority
W6 — Plan-skill split + UI cluster extract config — after Phase A2 wiring stable
```

### 2.1 Per-skill matrix actions (24 rows)

| # | Action ID | Skill ID | Action class | Rationale (matrix Section reference) | Effort | Order |
|---|---|---|---|---|---|---|
| 1 | A-01 | `kickoff` | leave alone | Bootstrap entry; thin shell over `kickoff-protocol.md` (matrix §1 row 1). | n/a | n/a |
| 2 | A-02 | `standup` | leave alone | 3-phase ceremony is its purpose; splitting fragments daily flow (matrix row 2). Touched by W2 (CONTEXT.md cite via skill-prelude). | n/a (touched by W0) | W0 |
| 3 | A-03 | `status` | extract config | One read-only verb; kickoff-gate is the only coupling — gate becomes warning under W1 (matrix row 3). | part of W0/W1 | W0 → W1 |
| 4 | A-04 | `plan` | split | 734 lines / 6 phases; routing (Phase 0) + escalation backfill (steps 11/14) are separable surfaces (matrix row 4). Defer split until Phase A2 grill wiring is stable to avoid merge churn (borrows §1.4). | 2 stories | W6 |
| 5 | A-05 | `execute` | split | Three execution modes (TeamCreate / cmux / sessions) coexist; mode dispatch is its own concern (matrix row 5). | 2 stories | W6 |
| 6 | A-06 | `review` | leave alone | Single verb with workflow fallback; small enough that splitting adds churn (matrix row 6). | n/a (touched by W1 warning lift) | W1 |
| 7 | A-07 | `test` | leave alone | 9-step pipeline is the contract; thin shell over workflow YAML (matrix row 7). | n/a (touched by W1 warning lift) | W1 |
| 8 | A-08 | `brand-system` | extract config | One verb but bloated by inlined YAML/HTML schemas; schemas belong in references (matrix row 8). | 1 story | W6 |
| 9 | A-09 | `design-system` | extract config | One yaml→tokens job; W3C token spec belongs in references (matrix row 9). | 1 story | W6 |
| 10 | A-10 | `design-review` | leave alone | OR-gate + `--skip` flags already give it composability the others lack (matrix row 10). Stand-alone-usable per matrix §3.1. | n/a | n/a |
| 11 | A-11 | `ui-audit` | collapse | 3-step inlined ceremony is near-clone of design-review; differ only in artifact target (matrix row 11). Collapse merges into design-review with artifact-target flag. | 1 story | W6 |
| 12 | A-12 | `polish-audit` | leave alone | Single conceptual verb wrapped in 2-step ceremony; tight gate acceptable (matrix row 12). | n/a | n/a |
| 13 | A-13 | `visual-qa` | leave alone | Compare design-vs-impl is one verb; gate on `design/index.yaml` is correct coupling (matrix row 13). | n/a | n/a |
| 14 | A-14 | `agent-spawn` | split | 8-step procedure spans persona resolution, memory loading (L0–L3), backend dispatch — three separable concerns (matrix row 14). | 2 stories | W6 |
| 15 | A-15 | `codex-invoke` | leave alone | One job (cmux+codex pane dispatch); pre-flight bloat is correctness-bound, not shape-bound (matrix row 15). | n/a | n/a |
| 16 | A-16 | `respawn` | leave alone | Single verb (graceful rotation); valid only for TeamCreate mode is documented coupling (matrix row 16). | n/a | n/a |
| 17 | A-17 | `session-end` | leave alone | One orchestration window; thin doc contract over JS lib (matrix row 17). | n/a | n/a |
| 18 | A-18 | `session-registry` | leave alone | Single registry CRUD job; tight coupling to execute step 6c is correct (matrix row 18). | n/a | n/a |
| 19 | A-19 | `meta-optimize` | leave alone | 8-step cycle is the product; public/maintainer split is intentional (matrix row 19). | n/a | n/a |
| 20 | A-20 | `design-discussion` | reclassify | Pure document spec; belongs at `hive/references/document-templates/design-discussion.md` (matrix row 20 + §4). | part of bundled W1 | W1 |
| 21 | A-21 | `horizontal-plan` | reclassify | Pure document spec; belongs at `hive/references/document-templates/horizontal-plan.md` (matrix row 21 + §4). | part of bundled W1 | W1 |
| 22 | A-22 | `vertical-plan` | reclassify | Pure document spec; belongs at `hive/references/document-templates/vertical-plan.md` (matrix row 22 + §4). | part of bundled W1 | W1 |
| 23 | A-23 | `structured-outline` | reclassify | Pure document spec; belongs at `hive/references/document-templates/structured-outline.md` (matrix row 23 + §4). | part of bundled W1 | W1 |
| 24 | A-24 | `greenfield-discovery` | reclassify (with caveat) | Hybrid — Brief schema → `hive/references/document-templates/discovery-brief.md`; facilitation procedure stays in `analyst.md` persona prompt or thin skill stub citing template (matrix row 24 + §4.1). | 1 story | W1 |

### 2.2 Cross-cutting boilerplate action

| # | Action ID | Target | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 25 | A-25 | 12 top-level skills + new `hive/references/skill-prelude.md` | extract shared reference | ~600 lines duplicated across 12 skills (~25 lines `Before Executing Any Skill` + ~25 lines `Kickoff Gate` × 12). Replace with one citation line; net **~528 lines deleted** (matrix §2.4). Single source of truth for kickoff-gate semantics; unblocks A-03 (status warning lift) by changing one file instead of 12. | 1 story | W0 (substrate; ships first) |

### 2.3 Borrow actions

Per posture-check §5.4 borrow-shape table — Borrow 1 reframed to atomic skill (NOT inline sub-phase). This is the **binding shape** per cycle-state `s3_borrow_reframes`.

| # | Action ID | Borrow | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 26 | A-26 | Borrow 2 — `.pHive/CONTEXT.md` | new artifact + skill-prelude citation | Domain-language single-file glossary. Mattpocock-aligned, low blast radius, unblocks Borrow 1 substrate (borrows §2.5). 3 stories: schema + starter template, kickoff bootstrap (brownfield + greenfield), skill-prelude.md citation. | 3 stories | W2 (after W0; before W4) |
| 27 | A-27 | Borrow 3 — `skills/triage/SKILL.md` | new top-level skill + `.pHive/triage/queue.yaml` | Brownfield bug + feature intake; 5-state machine; warning-only kickoff-gate; hand-offs to `/plan --from-triage` and standup Phase 1 (borrows §3.1–3.6). 4 stories: skill author + queue schema, plan input parser, standup queue surfacing, optional adapter write-back. Posture: atomic at surface, process-owning internally — coherent (posture-check §5.3). | 4 stories | W3 (parallel to W2) |
| 28 | A-28 | Borrow 1 — `skills/grill/SKILL.md` (atomic skill, NOT inline Phase A2 section) | new top-level atomic skill + `/plan` Phase A2 wiring | **Reframed shape** per posture-check §5.1: atomic skill called by `/plan` Phase A2 from outside; resolves writer's posture-vulnerability flag. 2 stories: grill skill + grill-record template, plan A2 wiring + researcher `inconsistency_risk_signals` field + design-discussion consumption (borrows §1.4). | 2 stories | W4 (after W2 CONTEXT.md and after W6 plan-split lands or settles) |

### 2.4 Sidecar action (one bundle)

| # | Action ID | Edits bundled | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 29 | A-29 | `update_goal`-style structured story state — 5 files / ~55 lines (sidecar-edits.md Edit 1: episode-schema, developer.md, tester.md, reviewer.md, execute SKILL.md) | prompt-tuning bundled-PR | Addresses `feedback_story_status_stale` directly; deprecates free-write `status:` field, derives from `status_transitions:` array. ~55 lines. | part of bundled-PR | W5 |
| 30 | A-30 | Audit-first completion — 3 files / ~28 lines (sidecar-edits.md Edit 2: tester.md, reviewer.md, peer-validator.md) | prompt-tuning bundled-PR | Verdict-gating on explicit AC walk + citation re-read; addresses `feedback_writer_revision_verification` and `feedback_internally_inconsistent_story_specs`. ~28 lines. | part of bundled-PR | W5 |
| 31 | A-31 | Token budget over iteration count — 4–8 files / ~30 lines (sidecar-edits.md Edit 3: hive.config.yaml `circuit_breakers`, methodology workflows, methodology-routing.md, execute SKILL.md) | config-key + advisory cap | Token-capture substrate already shipped; adds `max_tokens_per_step\|fix_loop\|story` advisory caps. Fail-open semantics if token data missing. ~30 lines. **Recommendation per sidecar §"Bundled-PR scope":** if PR review wants split, peel Edit 3 off — it depends on substrate freshness and tunes empirical defaults. | part of bundled-PR (or separable) | W5 |

### 2.5 Shipping wave summary

| Wave | Actions | Story count | Cumulative effort | Net code delta |
|---|---|---|---|---|
| W0 | A-25 (boilerplate extraction) | 1 | 1 | **−528 lines** |
| W1 | A-03, A-06, A-07 warning lift + A-20…A-24 reclassify | 1 (warning) + 1 (reclassify bundle) | 3 | ~−400 lines (5 files moved + 1 caveat skill stub) |
| W2 | A-26 CONTEXT.md (3 stories) | 3 | 6 | ~+150 lines (schema + starter + bootstrap) |
| W3 | A-27 Triage (4 stories, parallel to W2) | 4 | 10 | ~+400 lines (skill + queue.yaml + integrations) |
| W4 | A-28 Grill atomic skill (2 stories) | 2 | 12 | ~+200 lines (skill + Phase A2 wiring + researcher field) |
| W5 | A-29 + A-30 + A-31 sidecar bundle | 1 (bundled-PR) | 13 | ~+113 lines |
| W6 | A-04, A-05, A-08, A-09, A-11, A-14 split / collapse / extract config | 8–9 | 22 | ~−300 lines (extract config) + structural splits |

**Total:** ~22 stories across 6 waves, decomposable into **2 epics**:
- **Epic A — Catalog hygiene + borrows** (W0–W5; ~13 stories): boilerplate, kickoff-gate softening, doc-template reclassify, 3 borrows, sidecar bundle.
- **Epic B — Structural refactor** (W6; ~9 stories): plan/execute/agent-spawn splits, brand-system + design-system + ui-audit extract config + collapse.

### 2.6 Section 2 verdict

**REFINE — adopt 31 actions across 6 shipping waves, decomposable into 2 epics.** Net catalog delta is reduction (~528-line preamble deletion + 5 doc-template reclassifications + ui-audit collapse) plus three additive borrows in posture-coherent shape (CONTEXT.md atomic, Triage process-owning at skill scope, Grill atomic with `/plan` wiring from outside). Wave ordering encodes the borrows-scope.md §"Implication" dependency chain (W0 substrate → W2 CONTEXT.md → W4 Grill).

---

## Section 5 — North-Star alignment statement

### 5.1 Verdict

# **REFINE** (specific lifts)

Not RETAIN (no change — papers over §3 author-bias dissent), not SHIFT (wholesale adoption — abandons §4.5 brand commitment). REFINE with the 5 lifts enumerated by posture-check.md §6.2 and concretized as Section 2's 31-action plan.

### 5.2 Stand-independent items (R6 mitigation: counter-precedent cited per item)

These Hive design decisions are defensible without invoking the mattpocock critique at all — orthogonal concerns. Each carries a documented internal precedent that proves the decision is principled, not posture-defense.

1. **Cross-LLM verification gate (Codex creates / Opus reviews).** Bias-removal decision, not process-shape decision. Mattpocock posture has nothing to say about *who runs which atom*. **Counter-precedent:** `feedback_codex_general_backend` (2026-05-01) — explicit user policy: *"the point of the multi-agent system is bias removal — different LLMs verify each other."* Memory cites two prior overshoots (all-Codex, then research+dev-only) before settling on the line; not a posture artifact (posture-check §2.1).

2. **Memory L0–L3 stack (cycle-state, feedback memos, project memos, KG, ChromaDB).** Different problem space than mattpocock CONTEXT.md (one static file). **Counter-precedent:** `project_memory_autonomy_foundation` documents the substrate; researcher findings §3.4 confirms boilerplate "Before Executing Any Skill" loads orchestrator memories; agent-spawn skill (407 lines) loads memories at L0/L1/L2/L3. CONTEXT.md (Borrow 2) is one file in a system, not a substitute for the system (posture-check §2.2).

3. **Spike-before-rewrite policy as governance, not posture.** Resource-allocation policy independently sound regardless of process-shape choice. **Counter-precedent (TWO consecutive verdicts, opposite directions):** s1 sandcastle HYBRID (2026-05-08) adopted `Output.object`+`Output.string`+runtime guards; s2 atoshell SKIP (2026-05-08) rejected on structural grounds. Two applications of the same policy, two honest verdicts — `feedback_test_offtheshelf_before_rewriting` (2026-04-29) is the meta-policy; this very audit is its third instance (posture-check §2.3, §4.4).

### 5.3 Critique-resistant via internal precedent (R6 mitigation: cited counter-precedent, NOT theoretical defense)

These Hive design decisions survive the mattpocock critique because internal precedent demonstrates the alternative was *tried, considered, or rejected with documented evidence*.

4. **Process-owning posture as deliberate choice — `project_archon_feasibility_spike` NO-GO (2026-04-29).** Hive explicitly tested adopting an off-the-shelf process-owning framework (Archon's YAML DAG layer), spiked it bounded per `feedback_test_offtheshelf_before_rewriting`, and returned NO-GO. Reason was upstream blocker (Archon issue #1378, P1 open), but the active follow-on (`hive-dag-executor` epic, 11 stories) is **building the deterministic process layer inside Hive**, not lifting to atomic-glue. Counter-precedent for "Hive considered alternatives to building its own process layer" — partial resistance only; full resistance requires §5.3 item 5 below (posture-check §4.1).

5. **s2 atoshell SKIP as posture coherence.** Atoshell pitched as atomic-shaped task tracker (10 verbs + 9 modifier flags). Spike returned SKIP after 3 structural blockers (bash 3.2 incompat, hierarchy gap, vendor scope 1500–2500 LOC). Verdict explicitly distinguished SKIP from ADOPT-WHEN-MATURE: structural decisions, not maturity. **Counter-precedent:** demonstrates Hive will *reject* a tool that *matches* its posture if the structural fit is wrong. Posture is not the gate; structural fit is (atoshell findings.md §6.1; posture-check §4.2).

6. **s1 sandcastle HYBRID as posture honesty.** Sandcastle is mattpocock's container substrate (same author as the skills critique). Spike adopted 3 primitives (`Output.object`, `Output.string`, runtime guards) into S14/B1 design; deferred 5 primitives (SandboxProvider, branchStrategy, worktrees, sandcastle hooks) to follow-on epic; retained Hive substrate (TeamCreate, cmux, agent-spawn, codex routing) for everything else. **Counter-precedent:** Hive applied mattpocock's *own substrate* and returned partial adoption based on per-primitive structural fit, not whole-framework posture. The 3 adopted primitives are atomic-shape; the 6 retained Hive primitives are process-owning shape — both fit their respective problems (sandcastle findings.md §6 HYBRID per-primitive table; posture-check §4.3). **Strongest single piece of evidence Hive can cite.**

7. **No-team-lead-intermediary fix as cross-LLM-gate enforcement.** When ceremony+gate combination produced a real failure mode (kg-s1 spawned a team-lead persona that lacked the `Agent` tool, fell back to self-implementing on Claude/Opus, bypassed cross-LLM verification gate), the fix preserved the gate AND preserved the ceremony — it removed the bad intermediary. **Counter-precedent:** a pure mattpocock-posture fix would have been "remove the team altogether and use atomic skill calls"; that's not what shipped. `feedback_no_team_lead_intermediary` (2026-05-01) documents the actual fix shape (posture-check §4.6).

### 5.4 Author-bias-vulnerable items (acknowledged honestly per design-discussion R5)

These Hive design decisions WOULD genuinely change under mattpocock posture. Listed per posture-check §3 with cost.

8. **Kickoff-gate hard-blocks on 12 skills.** Lift to warning. Cost: low-medium (matrix §2 substrate already proposes the extraction). Section 2 action A-25 (boilerplate extraction) + A-03/A-06/A-07/A-21–24 (warning lift) ship this in W0 + W1.

9. **Process-owning workflows (development.classic / tdd / bdd; meta-team-cycle).** Theoretical vulnerability — decompose into orchestrator-glue + atomic skills. Cost: **high.** This is the load-bearing structural commitment. Defended in practice by §5.3 items 4 + 7 + 5.5 below (posture-check §3.2).

10. **Plan ceremony at 6 phases (734 lines).** Already flagged for split (matrix recommendation). Section 2 action A-04 ships split in W6, gated on Phase A2 wiring stability.

11. **24-skill catalog size vs mattpocock's ~5–8 atoms.** Section 2 ships 5 reclassify (W1) + 1 collapse (W6 ui-audit) + 3 split (W6) + 3 extract config (W6); reduces effective surface materially without abandoning entry-point skills.

12. **Plan's adversarial-alignment phase as ceremony rather than atom.** Section 2 action A-28 ships Grill as **atomic skill** (NOT inline Phase A2 section) per posture-check §5.1 reframe.

### 5.5 Explicit dissent — items where Hive plausibly LOSES to mattpocock posture (R5 mitigation: surfaced, not buried)

The deferred audit memo's framing (*"useful tension worth auditing"*) demanded honest engagement, not posture defense. These items are architect-honest places where mattpocock plausibly wins. Surfaced explicitly here, NOT buried in Section 5.4.

**D1. Plan skill at 734 lines is too big.** Even after kickoff-gate lift and boilerplate extraction, plan remains the highest-blast-radius skill. Matrix recommends split. Mattpocock posture says split harder. Architect agrees with both: split into atomic pieces (Phase 0 routing → agent-spawn, escalation backfill extracted, methodology dispatch extracted) is a real improvement; the 734-line single skill is partly inertia, not design. Section 2 action A-04 is the response (posture-check §6.4 item 1).

**D2. UI ceremony cluster repeats `spawn ui-designer with embedded prompt` 5+ times.** Brand-system, design-system, ui-audit, polish-audit, visual-qa, design-review repeat the same shape. Researcher §3.2 + matrix §3 flagged. Mattpocock posture would say: collapse the 5 into 1 ceremony skill with sub-modes OR atomicize the ui-designer prompt as the real shared primitive. Architect leans toward the second (extract ui-designer prompts to `references/ui-prompts/`, reduce each skill to a thin invocation). Section 2 actions A-08/A-09/A-11 (W6) cover 3 of the 5; the deeper extract-config-the-prompts question is open. Section 5 acknowledges this as **partially-addressed dissent** (posture-check §6.4 item 2).

**D3. Boilerplate sprawl (~600 lines duplicated).** Pure inertia, nothing to defend. Section 2 action A-25 (W0) resolves entirely. Mattpocock-posture-faithful by construction (posture-check §6.4 item 3).

**D4. Stand-alone usability ratio (4 of 24 skills usable without framework boot).** Sharpest mattpocock-posture critique landing on Hive. Section 2 action A-25 + W1 warning-lift addresses the worst (status, review, standup, ui-audit, test go to warning). The deeper unresolved question — should `plan` and `execute` *also* lift their hard gates with sane defaults? — is partly unaddressed by Section 2's plan. Architect recommendation: **defer to s4 synthesis discussion.** The gates exist for a real reason (methodology routing needs config, agent backend resolution needs config), but a "use defaults + warn" path may exist if synthesis wants it. **This is the single item where Hive plausibly does NOT meet mattpocock posture even after all 31 Section 2 actions land** (posture-check §6.4 item 4).

### 5.6 North-Star statement — does it stand under REFINE?

`project_oss_rollout_brand` (locked 2026-04-30) defines the brand: *"A director's chair for the agentic SDLC — disciplined swarms, kickoff to ship."* The product trajectory is **prompter → director → reviewer**. Hive is not a small toolbox; it is a directing chair for an agentic SDLC.

**Does this stand under REFINE?**

Yes — and REFINE is the ONLY verdict that preserves it. The case rests on three threads:

1. **Process-ownership IS the product.** Removing the workflows + ceremonies + 12-skill kickoff-gated catalog removes the differentiator from atomic toolkits. Mattpocock's posture is *"we don't impose"*; Hive's is *"we direct."* Different products, different markets. Counter-precedent: `project_oss_rollout_brand` brand-level commitment, not skill-level choice (posture-check §4.5).

2. **Direction is not paternalism.** *How* Hive directs (hard-block vs warn, 6 phases vs 4 vs 1 grill, 12 kickoff-gated skills vs 4) is open to author-bias correction — Section 2 is precisely that correction. *That* Hive directs is settled brand-level. The 31 actions in Section 2 refine the *how* without abandoning the *that*.

3. **REFINE is materially distinguishable from RETAIN and SHIFT.** RETAIN (no change) leaves D1–D4 dissent unaddressed; SHIFT (wholesale adoption) abandons stand-independent items §5.2.1–3 *and* critique-resistant items §5.3.4–7. REFINE keeps the brand commitment + addresses the dissent. Verdict survives R5 (dissent surfaced) and R6 (counter-precedent cited per item).

**The North-Star claim stands.** With one architect-honest caveat surfaced in §5.5 D4: the deeper plan/execute hard-gate question is partly unaddressed even after Section 2; if s4 synthesis wants to push REFINE further toward atomic posture, that's the single highest-leverage door left ajar. Defer to synthesis.

### 5.7 Section 5 verdict

# **REFINE (specific lifts)**

Backing: §5.2 (3 stand-independent items, all counter-precedent-cited per R6) + §5.3 (4 critique-resistant items, all counter-precedent-cited per R6) + §5.4 (5 author-bias-vulnerable items, honestly enumerated) + §5.5 (4 explicit dissent items per R5 mitigation) + §5.6 (North-Star alignment statement preserved by REFINE, abandoned by SHIFT, papered over by RETAIN). Section 2's 31 actions across 6 shipping waves are the concrete materialization of this verdict.

---

## Validation note

- **R6 mitigation:** every "stand independent" claim in §5.2 cites a feedback memo or shipped behavior (`feedback_codex_general_backend`, `project_memory_autonomy_foundation`, `feedback_test_offtheshelf_before_rewriting`); every "critique-resistant" claim in §5.3 cites a project memo or spike findings doc (`project_archon_feasibility_spike`, atoshell findings §6.1, sandcastle findings §6, `feedback_no_team_lead_intermediary`).
- **R5 mitigation:** §5.5 enumerates 4 dissent items where Hive plausibly LOSES; D4 marked as architect-acknowledged-unresolved.
- **Verdict statements:** Section 2 verdict in §2.6, Section 5 verdict in §5.7. Both explicit. Both from allowed values (REFINE).
- **Line count:** ~440 lines (target: <500).
- **Sources cited:** s3 catalog-matrix.md (rows 1–24, §2, §3, §4), s3 posture-check.md (§2, §3, §4, §5, §6), s3 borrows-scope.md (§1.1 reframe pointer, §2.5, §3.6, §"Implication"), s3 sidecar-edits.md (Edits 1–3 + Bundled-PR scope), s1 sandcastle/findings.md (§6 HYBRID per-primitive table), s2 atoshell/findings.md (§6.1 SKIP reasoning), design-discussion.md (R5 + R6 rows), 4 feedback memos, 4 project memos.

## Open questions for next-epics step (TPM merges into Section 4)

1. **D4 unresolved — plan/execute hard-gate question.** Should plan and execute *also* lift to warning with defaults, or stay hard-gated? Section 2 keeps them hard-gated (matrix §3.4 mid-point #4). Mattpocock posture would push further. **Decision deferred to s4 synthesis discussion.**
2. **D2 partially-addressed — UI cluster `extract config`.** Section 2 covers 3 of 5 (brand-system, design-system, ui-audit-collapsed). The deeper "extract ui-designer prompts to references/ui-prompts/ and atomicize" question is open. **Recommended deferred follow-on epic.**
3. **A-28 Grill ↔ A-04 plan-split sequencing.** Borrows §1.4 recommends landing Grill AFTER plan-split to avoid merge churn; Section 2.5 places W4 Grill before W6 plan-split. **Resolution: ship Grill atomic skill first (W4), wire into existing plan Phase A2 location, defer plan-split to W6 once Phase A2 wiring is empirically stable.** Document this in Epic A vs Epic B boundary.
4. **Borrow 1 ADR location** (borrows §1.5 Q1.3) — `.pHive/epics/{epic-id}/decisions/` epic-scoped vs `docs/adr/` repo-global. **Recommend epic-scoped** (consistent with current Hive layout); flag for s4 explicit confirmation.
5. **Borrow 2 schema rigor** (borrows §2.6 Q2.1) — free-form markdown vs structured YAML-frontmatter. **Recommend structured YAML-frontmatter** (aids automation; structured CONTEXT.md is *more* useful for KG L2 ingest); minor mattpocock-posture deviation but high Hive-fit.
6. **Edit 3 token-budget bundling** — sidecar §"Bundled-PR scope" recommends peeling off if PR review wants split. **Recommend bundled in W5; split only if review feedback demands it.**

## Cross-references for downstream steps

- **For TPM joint-merge:** Section 2 (31-action plan) compose into Section 4 next-epics decomposition. §5.5 dissent items D1–D4 are direct inputs to TPM Section 3 (impact + risks). §5.7 REFINE verdict is the binding North-Star claim Section 1 must restate.
- **For next-epics step:** Section 2.5 wave summary → 2 epics (Epic A catalog hygiene + borrows, Epic B structural refactor). Story counts: Epic A ~13 stories, Epic B ~9 stories. Total ~22 stories across both.
