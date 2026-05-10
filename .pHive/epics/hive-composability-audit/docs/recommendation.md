# Hive Composability Audit — Recommendation

**Epic:** `hive-composability-audit`
**Audit date:** 2026-05-08
**Revised:** 2026-05-08 (post-user-review — folds in 2.0 milestone, adapter ABI promotion, North-Star reframe to composable-substrate, D4 Position A fold-in, bash trigger invalidation, ABI hierarchy-agnostic decision)
**Authors:** TPM + architect (joint, audit-s4-synthesis team) + user course-correction
**Status:** Final — gate-keeping artifact per design-discussion R7
**Sign-off required from:** user, before A-group / skill-catalog / tracker work resumes

**Inputs:**
- s1 sandcastle (`spikes/sandcastle/findings.md`) — HYBRID
- s2 atoshell (`spikes/atoshell/findings.md`) — SKIP (atoshell-the-tool); ABI question reopened post-review
- s3 skills-lens (`spikes/skills-lens/{catalog-matrix,borrows-scope,sidecar-edits,posture-check}.md`) — REFINE
- design-discussion R1–R7 + 9 decision points
- cycle-state YAML
- User course-correction 2026-05-08: 2.0 milestone framing, adapter ABI promotion, bash-trigger invalidation, North-Star reframe, D4 Position A fold-in

---

## Section 1 — CWC 2026 A-group resume strategy

**Verdict: PROCEED-AS-DESIGNED.**

Sandcastle adoption (Output.object, Output.string, runtime guards) lands **inside the S14/B1 rubric design**, not by altering A-group story scope. A-group resumes immediately on synthesis sign-off with zero scope delta and zero effort delta on stories S4–S10.

### Justification

s1's per-primitive decision table classified 4 distinct adoption lanes (`spikes/sandcastle/findings.md` §3 verdict + per-primitive table):

1. **Adopt now / in S14-B1 design:** `Output.object()` (#11), `Output.string()` (#12), runtime guards.
2. **Adopt in follow-on epic:** `SandboxProvider` (#7), `branchStrategy` (#8), `createWorktree` (#16), sandcastle hooks (#9, #10).
3. **Retain Hive:** `run()`, `interactive()`, `codex()` — Hive's TeamCreate + cmux + codex-companion are richer (persona + memory + skills).
4. **N/A — blocked or no backend:** `claudeCode()` (issue #191), `opencode()`, `pi()`, `resumeSession`, JSONL capture.

Lane 1 (the only "adopt now" lane) operates **inside** S14/B1 — the rubric format design — not by modifying any A-group story (S4–S10). s1 §4 CWC 2026 delta confirms this row-by-row:

| CWC story | Sandcastle delta | Effort delta |
|---|---|---|
| S4 / a1 — session-spec rewrite as Messages-API substrate | Untouched (sandcastle wraps CC CLI, not Messages API) | None |
| S5 / a2 — messages-session.js loop module | Untouched (no Messages-API surface in sandcastle) | None |
| S6 / a3 — prior_knowledge_block | Untouched (no memory/KG injection concept) | None |
| S7 / a6 — cc_session_id correlation | Untouched (sandcastle's JSONL capture is separate; Hive registry still owns correlation) | None |
| S8 / a4 — execution.substrate flag flip | Untouched (Hive-internal substrates; sandcastle is coarser layer) | None |
| S9 / a5 — cloud-mode dead-code gating + fixture rot guard | Untouched (internal Sessions-API) | None |
| S10 / a7 — agent-spawn flow + check-agent-misuse hook relax | Untouched as A-group scope (agent-spawn flow + hook semantics remain Hive-owned) | None |
| S14 / b1 — rubric / structured-output design | **Adopt Output.object as design option** (Standard Schema + XML tag scan) | Within design effort; not an A-group line item |

### Per-story impact

- **Replaced:** none.
- **Partially-replaced:** none in A-group. S14/B1 (B-group) gains `Output.object` as a design option to evaluate during its design phase.
- **Untouched:** S4, S5, S6, S7, S8, S9, S10 (all of A-group).
- **Superseded:** none.

### Effort delta

Zero on A-group. S14/B1 design effort gains a new option (Output.object as rubric substrate) to weigh against existing alternatives — net effort change is "evaluate one more option during design," bounded and absorbed in B-group story estimation.

### Open questions (defer past sign-off)

1. If the sandcastle follow-on epic lands and adds `SandboxProvider` as a 3rd `execution.substrate`, S8's flag may grow a 3rd value. Out of A-group scope; flagged for follow-on planning.
2. Sandcastle session-JSONL capture coexisting with Hive's `~/.claude/projects/...` namespace if S7 ever wants to reuse that capture path. Speculation only; no S7 change today.

---

## Section 2 — Skill catalog reshape plan

**Verdict: REFINE-DEEPER — adopt 36 actions across 7 shipping waves, decomposable into 2 in-flight epics + Adapter ABI epic (Epic C) running parallel.**

(Original audit shipped 31 actions / 2 epics; user course-correction 2026-05-08 added 5 gate-lift actions A-32–A-36 via D4 Position A fold-in. See §2.6.)

Net catalog delta is reduction (~528-line preamble deletion + 5 doc-template reclassifications + ui-audit collapse) plus three additive borrows in posture-coherent shape (CONTEXT.md atomic, Triage process-owning at skill scope, Grill atomic with `/plan` wiring from outside) plus gate-lift mechanism via `paths.gate_mode` config knob. Wave ordering encodes the borrows-scope.md §"Implication" dependency chain (W0 substrate → W2 CONTEXT.md → W4 Grill).

**Ordering convention:**

```
W0 — skill-prelude.md extraction (boilerplate cross-cutting)
W1 — kickoff-gate to warning + reclassify doc-templates (depends on W0 substrate)
W2 — CONTEXT.md (Borrow 2) — substrate for Borrow 1
W3 — Triage (Borrow 3) — parallel to W2
W4 — Grill (Borrow 1, atomic skill) — depends on W2
W5 — Sidecar bundle (3 edits) — low priority
W6 — Plan-skill split + UI cluster extract config + gate-lift via gate_mode knob — after Phase A2 wiring stable
```

### 2.1 Per-skill matrix actions (24 rows)

| # | Action ID | Skill ID | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 1 | A-01 | `kickoff` | leave alone | Bootstrap entry; thin shell over `kickoff-protocol.md` (matrix §1 row 1). | n/a | n/a |
| 2 | A-02 | `standup` | leave alone | 3-phase ceremony is its purpose (matrix row 2). Touched by W2 CONTEXT.md cite via skill-prelude. | n/a | W0 |
| 3 | A-03 | `status` | extract config | One read-only verb; kickoff-gate is the only coupling — gate becomes warning under W1 (matrix row 3). | part of W0/W1 | W0 → W1 |
| 4 | A-04 | `plan` | split | 734 lines / 6 phases; routing (Phase 0) + escalation backfill (steps 11/14) are separable surfaces (matrix row 4). Defer split until Phase A2 grill wiring is stable (borrows §1.4). | 2 stories | W6 |
| 5 | A-05 | `execute` | split | Three execution modes coexist; mode dispatch is its own concern (matrix row 5). | 2 stories | W6 |
| 6 | A-06 | `review` | leave alone | Single verb with workflow fallback; small enough that splitting adds churn (matrix row 6). Touched by W1 warning lift. | n/a | W1 |
| 7 | A-07 | `test` | leave alone | 9-step pipeline is the contract; thin shell over workflow YAML (matrix row 7). Touched by W1 warning lift. | n/a | W1 |
| 8 | A-08 | `brand-system` | extract config | One verb but bloated by inlined YAML/HTML schemas; schemas belong in references (matrix row 8). | 1 story | W6 |
| 9 | A-09 | `design-system` | extract config | One yaml→tokens job; W3C token spec belongs in references (matrix row 9). | 1 story | W6 |
| 10 | A-10 | `design-review` | leave alone | OR-gate + `--skip` flags already give it composability the others lack (matrix row 10). | n/a | n/a |
| 11 | A-11 | `ui-audit` | collapse | 3-step inlined ceremony is near-clone of design-review; differ only in artifact target (matrix row 11). Collapse merges into design-review with artifact-target flag. | 1 story | W6 |
| 12 | A-12 | `polish-audit` | leave alone | Single conceptual verb wrapped in 2-step ceremony; tight gate acceptable (matrix row 12). | n/a | n/a |
| 13 | A-13 | `visual-qa` | leave alone | Compare design-vs-impl is one verb; gate on `design/index.yaml` is correct coupling (matrix row 13). | n/a | n/a |
| 14 | A-14 | `agent-spawn` | split | 8-step procedure spans persona resolution, memory loading (L0–L3), backend dispatch — three separable concerns (matrix row 14). | 2 stories | W6 |
| 15 | A-15 | `codex-invoke` | leave alone | One job; pre-flight bloat is correctness-bound, not shape-bound (matrix row 15). | n/a | n/a |
| 16 | A-16 | `respawn` | leave alone | Single verb; valid only for TeamCreate mode is documented coupling (matrix row 16). | n/a | n/a |
| 17 | A-17 | `session-end` | leave alone | One orchestration window; thin doc contract over JS lib (matrix row 17). | n/a | n/a |
| 18 | A-18 | `session-registry` | leave alone | Single registry CRUD job; tight coupling to execute step 6c is correct (matrix row 18). | n/a | n/a |
| 19 | A-19 | `meta-optimize` | leave alone | 8-step cycle is the product; public/maintainer split is intentional (matrix row 19). | n/a | n/a |
| 20 | A-20 | `design-discussion` | reclassify | Pure document spec; belongs at `hive/references/document-templates/design-discussion.md` (matrix row 20 + §4). | bundled W1 | W1 |
| 21 | A-21 | `horizontal-plan` | reclassify | Pure document spec (matrix row 21 + §4). | bundled W1 | W1 |
| 22 | A-22 | `vertical-plan` | reclassify | Pure document spec (matrix row 22 + §4). | bundled W1 | W1 |
| 23 | A-23 | `structured-outline` | reclassify | Pure document spec (matrix row 23 + §4). | bundled W1 | W1 |
| 24 | A-24 | `greenfield-discovery` | reclassify (caveat) | Hybrid — Brief schema → references/document-templates/; facilitation procedure stays in `analyst.md` or thin skill stub (matrix row 24 + §4.1). | 1 story | W1 |

### 2.2 Cross-cutting boilerplate action

| # | Action ID | Target | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 25 | A-25 | 12 top-level skills + new `hive/references/skill-prelude.md` | extract shared reference | ~600 lines duplicated across 12 skills (~25 lines `Before Executing Any Skill` + ~25 lines `Kickoff Gate` × 12). Replace with one citation line; net **~528 lines deleted** (matrix §2.4). Single source of truth. | 1 story | W0 (substrate; ships first) |

### 2.3 Borrow actions

Per posture-check §5.4 borrow-shape table — Borrow 1 is the **binding atomic shape** per cycle-state `s3_borrow_reframes`.

| # | Action ID | Borrow | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 26 | A-26 | Borrow 2 — `.pHive/CONTEXT.md` | new artifact + skill-prelude citation | Domain-language single-file glossary. Mattpocock-aligned, low blast radius, unblocks Borrow 1 substrate (borrows §2.5). 3 stories: schema + starter, kickoff bootstrap, skill-prelude citation. | 3 stories | W2 |
| 27 | A-27 | Borrow 3 — `skills/triage/SKILL.md` | new top-level skill + `.pHive/triage/queue.yaml` | Brownfield bug + feature intake; 5-state machine; warning-only gate; hand-offs to `/plan --from-triage` and standup Phase 1 (borrows §3.1–3.6). 4 stories. | 4 stories | W3 |
| 28 | A-28 | Borrow 1 — `skills/grill/SKILL.md` (atomic skill, NOT inline Phase A2 section) | new top-level atomic skill + `/plan` Phase A2 wiring | **Atomic shape per posture-check §5.1.** Resolves writer's posture-vulnerability flag. 2 stories: grill skill + grill-record template, plan A2 wiring + researcher `inconsistency_risk_signals` field + design-discussion consumption (borrows §1.4). | 2 stories | W4 |

### 2.4 Sidecar action (one bundle)

| # | Action ID | Edits bundled | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 29 | A-29 | `update_goal`-style structured story state — 5 files / ~55 lines (sidecar Edit 1) | prompt-tuning bundled-PR | Addresses `feedback_story_status_stale`; deprecates free-write `status:`, derives from `status_transitions:`. | bundled-PR | W5 |
| 30 | A-30 | Audit-first completion — 3 files / ~28 lines (sidecar Edit 2) | prompt-tuning bundled-PR | Verdict-gating on explicit AC walk + citation re-read; addresses `feedback_writer_revision_verification` and `feedback_internally_inconsistent_story_specs`. | bundled-PR | W5 |
| 31 | A-31 | Token budget over iteration count — 4–8 files / ~30 lines (sidecar Edit 3) | config-key + advisory cap | Adds `max_tokens_per_step\|fix_loop\|story` advisory caps. Fail-open if token data missing. Peelable per sidecar §"Bundled-PR scope". | bundled-PR (separable) | W5 |

### 2.6 Gate-lift actions (added 2026-05-08, D4 Position A fold-in)

Per user course-correction 2026-05-08, lift `/plan` + `/execute` hard-gates to warnings with sane defaults. Ships behind `paths.gate_mode: warning|hard` config knob defaulting to `warning` for 2.0. Folded into **Epic B / W6** (same files touched by structural splits — cheaper now than later).

| # | Action ID | Skill ID / Target | Action class | Rationale | Effort | Order |
|---|---|---|---|---|---|---|
| 32 | A-32 | `plan` — methodology auto-detect | gate-lift / config-key | Detect methodology from repo signals (tests present → tdd; gherkin → bdd; else → classic). `--methodology=` flag overrides. Warn if no `hive.config.yaml`. | 1 story | W6 |
| 33 | A-33 | `plan` — gate lift + `gate_mode` knob | gate-lift / config-key | Lift hard-gate to warning under `paths.gate_mode: warning` (default for 2.0). `hard` mode preserves original behavior for users who opt in. | 1 story | W6 |
| 34 | A-34 | `execute` — backend auto-resolve | gate-lift / config-key | Resolve agent backend via env > `hive.config.yaml` > prompt. Warn if no config. | 1 story | W6 |
| 35 | A-35 | `execute` — epic-create-on-the-fly + gate lift | gate-lift / config-key | Lift hard-gate; if no `.pHive/epics/` exist, scaffold ad-hoc. `gate_mode: hard` preserves original. | 1 story | W6 |
| 36 | A-36 | Post-run audit check (telemetry) | new check | Emit warning if defaults produced nonsensical state (e.g., picked tdd on JS-only repo with no tests; routed to wrong-LLM at high cost). Telemetry signal for `gate_mode` default-flip decision. | 1 story | W6 |

### 2.7 Shipping wave summary (updated 2026-05-08)

| Wave | Actions | Story count | Cumulative | Net code delta |
|---|---|---|---|---|
| W0 | A-25 (boilerplate extraction) | 1 | 1 | **−528 lines** |
| W1 | A-03/A-06/A-07 warning lift + A-20…A-24 reclassify | 1 + 1 | 3 | ~−400 lines |
| W2 | A-26 CONTEXT.md (3 stories) | 3 | 6 | ~+150 lines |
| W3 | A-27 Triage (4 stories, parallel to W2) | 4 | 10 | ~+400 lines |
| W4 | A-28 Grill atomic skill (2 stories) | 2 | 12 | ~+200 lines |
| W5 | A-29 + A-30 + A-31 sidecar bundle | 1 (bundled-PR) | 13 | ~+113 lines |
| W6 | A-04, A-05, A-08, A-09, A-11, A-14 + A-32…A-36 (gate-lift) | 13–14 | 27 | ~−300 lines + structural splits + ~+200 lines gate-lift |

**Total: ~27 stories across 7 waves → 2 in-flight epics + Adapter ABI epic (Epic C, parallel)** (see Section 7 — Next epics).

---

## Section 3 — `task_tracking.adapter` direction

**Verdict: SKIP-ATOSHELL / BUILD-ABI-NOW.** Atoshell-the-tool is rejected on its own structural merits (s2 blockers stand). The **adapter ABI is promoted from deferred follow-on to in-flight epic** (Epic C) per user course-correction 2026-05-08. Backlog-and-run direction makes adapter pluggability foundational, not optional.

### Justification — atoshell SKIP stands

s2 verdict was SKIP per spec's allowed values (`spikes/atoshell/findings.md` verdict; cycle-state `s2_verdict: SKIP`). Two structural blockers remain after user review:

1. **Atoshell scope is 30 files / ~210KB production bash**, not the "single bash file" framing in the original spike spec. Vendor-fork burden is materially higher than originally estimated.
2. **`noSandbox()` is `interactive()`-only per sandcastle 0.5.10 types** — original synergy test framing (atoshell-as-tracker behind sandcastle's noSandbox) was incorrect at the API level.

The original third blocker — *"Hive has no executable adapter ABI"* — is **no longer a blocker on atoshell**; it becomes Epic C's scope. Atoshell stays SKIP because of #1 + #2 above.

### Reconsider triggers (updated post-review)

- **Trigger A — bash 3.2 compatibility: INVALIDATED.** Per user course-correction 2026-05-08, macOS bash upgrade (`brew install bash` + declare bash 4+ requirement) is trivial and not a real adoption blocker. Trigger A is **flipped by fiat** at the Hive level; atoshell upstream behavior on this point is moot. Hive declares bash 4+ as runtime requirement.
- **Trigger B — hierarchy fork: FLIPPED VIA ABI DESIGN.** Per user course-correction 2026-05-08, the adapter ABI is being designed **hierarchy-agnostic** — adapters declare flat or hierarchical capability; ABI accommodates both. Atoshell's flat IDs are no longer structurally incompatible; they are one valid declaration under the ABI.

Both triggers flipped. Atoshell-the-tool still SKIP per the structural blockers above (vendor-fork burden, API-level synergy correction). The triggers no longer gate the *adapter substrate* (now Epic C); they only gated the *atoshell adoption* (still SKIP).

### Adapter ABI — promoted to in-flight Epic C

Per user course-correction 2026-05-08:

- **ABI epic moves to in-flight.** Was Epic E (deferred); now Epic C (parallel to A/B, no blocker). See Section 7.
- **Backlog-and-run as direction.** Hive's product trajectory includes "set up a backlog, let agents run." That requires executable tracker calls, not prose runbooks. ABI is foundational substrate, not optional.
- **Hierarchy-agnostic design.** Adapters declare capability (flat vs hierarchical); ABI carries both. Linear (hierarchical via parent issue references), GitHub (mixed — issues flat, projects hierarchical), atoshell-if-ever (flat) all fit one ABI.
- **Form factor — open question for Epic C kickoff.** TS interface vs MCP server vs CLI contract are all viable. Epic C's first story is form-factor selection.
- **Migration path.** Linear + GitHub prose runbooks become Epic C's first two adapter implementations, validating the ABI against real systems.

### Cross-section impact

This section's verdict change has downstream effects:

- **Section 4 (cross-tool synergy):** Both reconsider triggers flipped. AND-gate (b) opens. Verdict changes from SKIP-SYNERGY to CONDITIONAL-ON-SANDCASTLE-FOLLOWON. See Section 4.
- **Section 7 (next epics):** Epic E (atoshell reconsider) survives but with narrower scope — atoshell becomes one candidate adapter under Epic C ABI, not a synergy gate. Epic letter renumbering applies (ABI=C, sandcastle=D, atoshell=E, UI=F).

### Open questions (defer past Epic C kickoff, not past audit sign-off)

1. Form-factor selection — TS vs MCP vs CLI. First Epic C story.
2. Linear adapter migration scope — does it touch ongoing project work? Audit at Epic C kickoff.

---

## Section 4 — Cross-tool synergy decisions (sandcastle ↔ adapter ecosystem)

**Verdict: CONDITIONAL-ON-SANDCASTLE-FOLLOWON.** Atoshell-side blockers (Section 3 triggers A and B) **both flipped post-review**. Sandcastle-side gate (a) remains the only structural barrier. Once Epic D (sandcastle follow-on) lands, synergy reopens — but synergy reframes from "two co-equal stacks" to "Hive composes sandcastle substrate + adapter ABI under user direction."

### Justification — what changed post-review

The originally-imagined synergy was: atoshell as task-tracker behind sandcastle's `noSandbox()`, branch naming integration via sandcastle `branchStrategy:branch` keyed off atoshell IDs, status sync on completion. Original audit demonstrated this was **doubly-blocked today**. Post-user-review the picture shifts:

1. **Sandcastle side (s1, HYBRID):** UNCHANGED. The primitives that would carry the synergy — `SandboxProvider` (#7), `branchStrategy` (#8), `createWorktree` (#16), sandcastle hooks (#9, #10) — remain "adopt in follow-on epic" per s1's per-primitive table, gated on s1 §5 surprises being mitigated (rootless podman race, file-logger key leak, issue #191 subscription auth). **Gate (a) still closed.**
2. **Atoshell side (s2, SKIP):** STILL SKIP-as-tool — vendor-fork burden + API-level correction stand. But the **two reconsider triggers no longer gate the adapter substrate** (Section 3 update): trigger A invalidated by bash-upgrade fiat, trigger B flipped by hierarchy-agnostic ABI design. **Atoshell-side gate (b) flipped — but via ABI design, not via atoshell adoption.**
3. **API-level correction:** `noSandbox()` is `interactive()`-only per sandcastle 0.5.10 types. The original synergy framing was incorrect at the API level. **Unchanged.** Synergy must be redesigned around correct sandcastle primitives once Epic D is in scope.

### Updated AND-gate (revisit conditions)

Synergy is revisited if **and only if**:

- **(a) Sandcastle follow-on epic (Epic D) has landed** — `SandboxProvider` + `branchStrategy` + `createWorktree` are shipped in Hive, with s1 §5 surprises mitigated.

This is now a **single-condition gate**, not AND-gate. Gate (b) is structurally satisfied by Epic C (Adapter ABI) — sandcastle composes with whatever adapter is registered behind the ABI.

### What synergy looks like post-Epic-C and post-Epic-D

- **Adapter substrate (Epic C):** ABI is hierarchy-agnostic, supports any tracker registering an adapter — Linear, GitHub, atoshell-if-revisited, custom in-house systems.
- **Substrate substrate (Epic D):** sandcastle's `SandboxProvider` + `branchStrategy` + `createWorktree` give Hive container/worktree-based isolation as one execution substrate among many.
- **Synergy:** branch naming derived from adapter-issued story IDs via `branchStrategy`; status sync on `session-end` calls adapter ABI; sandbox lifecycle follows story lifecycle.

Synergy is now **architecturally available** once Epic D lands. No Section 4-only decision required — composition is mechanical given Epic C ABI + Epic D substrate.

### North-Star alignment — REFRAMED

Per user course-correction 2026-05-08, the brand reframes from *"director's chair"* (Hive directs swarms) to *"composable substrate, user-directed"* (user directs Hive; Hive provides composable atoms + workflow primitives). See §5.5.

Under the reframe:

- **Sandcastle and adapter ABI are NOT misaligned with brand.** They are exactly what a composable substrate looks like — isolated execution + pluggable trackers. User directs *which* substrate, *which* tracker.
- **FULLY-LOCAL-STACK-ADOPT framing dissolves.** There is no "co-equal stack" question because Hive is no longer claiming to BE the orchestrator — the user is. Hive composes substrate primitives at user direction.
- **Section 4 verdict simplifies.** Once Epic D lands, synergy is a configuration option the user can opt into, not an architectural commitment Hive makes.

Section 4 verdict therefore — **CONDITIONAL-ON-EPIC-D**. Mechanical, no further synergy-specific decision required.

---

## Section 5 — North-Star alignment statement

**Verdict: REFINE-DEEPER (per user reframe 2026-05-08).**

Original audit shipped REFINE around mattpocock-aligned lifts while preserving "Hive directs swarms" brand. User course-correction 2026-05-08 reframed the North Star itself: **Hive is to be directed, not the director.** Hive provides composable substrate (atomic skills + workflow primitives + memory + adapter ABI + sandbox substrate) under **user direction**. Composability is co-equal differentiator with discipline.

This is REFINE-DEEPER not SHIFT — Hive retains workflow primitives, ceremonies, memory stack, cross-LLM verification. But it walks back **further** toward atomic posture than original §6.2 lifts assumed. D4 Position A wins (see §5.4). Two §5.1 stand-independent items survive cleanly; one is honestly suspect under the reframe and surfaced rather than papered over.

### 5.1 Stand-independent items — re-evaluated under reframe

These Hive design decisions are evaluated against the new "composable substrate, user-directed" North Star.

1. **Cross-LLM verification gate (Codex creates / Opus reviews).** **SURVIVES.** Bias-removal decision is orthogonal to posture either way — atomic skills under user direction still benefit from cross-LLM verification when invoked. **Counter-precedent:** `feedback_codex_general_backend` (2026-05-01) — explicit user policy: *"the point of the multi-agent system is bias removal — different LLMs verify each other."* Memory cites two prior overshoots before settling on the line; not a posture artifact (posture-check §2.1).
2. **Memory L0–L3 stack (cycle-state, feedback memos, project memos, KG, ChromaDB).** **SUSPECT UNDER REFRAME — surfaced honestly.** Under "Hive directs," a baked-in memory stack is defensible as part of Hive's process-ownership. Under "user directs Hive, Hive is composable substrate," a non-optional memory stack the user must accept is **anti-substrate** — a library you `npm install` shouldn't impose its own memory architecture on your project. The mattpocock CONTEXT.md borrow (W2) is the minimum-viable form; the deeper L0–L3 stack should likely become **opt-in / configurable** rather than posture-load-bearing. **Action:** flag for follow-on review; not folded into Epic A or B; surfaced in Section 6 — Open Disagreements as a tracked item rather than papered-over defense. `project_memory_autonomy_foundation` documents the existing substrate; the substrate stays, but its **defaults** and **load-bearing posture** are reframe-vulnerable.
3. **Spike-before-rewrite policy as governance, not posture.** **SURVIVES.** Resource-allocation policy independently sound regardless of process-shape choice. Under user-directed framing it survives even more cleanly — governance is exactly the kind of disciplined-substrate Hive should provide. **Counter-precedent (TWO consecutive verdicts, opposite directions):** s1 sandcastle HYBRID adopted Output primitives; s2 atoshell SKIP rejected on structural grounds. Two applications of the same policy, two honest verdicts (posture-check §2.3, §4.4).

### 5.2 Critique-resistant via internal precedent (R6 mitigation)

These survive the mattpocock critique because internal precedent demonstrates the alternative was *tried, considered, or rejected with documented evidence*.

4. **Process-owning posture as deliberate choice — `project_archon_feasibility_spike` NO-GO (2026-04-29).** Hive explicitly tested adopting an off-the-shelf process-owning framework, returned NO-GO, and the active follow-on (`hive-dag-executor` epic, 11 stories) is **building the deterministic process layer inside Hive** (posture-check §4.1).
5. **s2 atoshell SKIP as posture coherence.** Atoshell pitched as atomic-shaped task tracker. Spike returned SKIP after 3 structural blockers. **Counter-precedent:** demonstrates Hive will *reject* a tool that *matches* its posture if the structural fit is wrong. Posture is not the gate; structural fit is (atoshell findings.md §6.1; posture-check §4.2).
6. **s1 sandcastle HYBRID as posture honesty.** Sandcastle is mattpocock's container substrate. Spike adopted 3 atomic-shape primitives; deferred 5 to follow-on; retained Hive substrate for everything else. **Counter-precedent:** Hive applied mattpocock's *own substrate* and returned partial adoption based on per-primitive structural fit, not whole-framework posture (sandcastle findings §6 HYBRID per-primitive table; posture-check §4.3). **Strongest single piece of evidence Hive can cite.**
7. **No-team-lead-intermediary fix as cross-LLM-gate enforcement.** When ceremony+gate combination produced a real failure mode, the fix preserved the gate AND preserved the ceremony — it removed the bad intermediary. A pure mattpocock-posture fix would have been "remove the team altogether"; that's not what shipped. `feedback_no_team_lead_intermediary` (2026-05-01) (posture-check §4.6).

### 5.3 Author-bias-vulnerable items (acknowledged honestly per R5)

8. **Kickoff-gate hard-blocks on 12 skills.** Lift to warning. Section 2 actions A-25 + A-03/A-06/A-07/A-21–24 ship in W0 + W1.
9. **Process-owning workflows (development.classic / tdd / bdd; meta-team-cycle).** Theoretical vulnerability — decompose into orchestrator-glue + atomic skills. Cost: **high.** Defended in practice by §5.2 items 4 + 7 (posture-check §3.2).
10. **Plan ceremony at 6 phases (734 lines).** Section 2 action A-04 ships split in W6, gated on Phase A2 wiring stability.
11. **24-skill catalog size vs mattpocock's ~5–8 atoms.** Section 2 ships 5 reclassify (W1) + 1 collapse (ui-audit, W6) + 3 split (W6) + 3 extract config (W6).
12. **Plan's adversarial-alignment phase as ceremony rather than atom.** Section 2 action A-28 ships Grill as **atomic skill** (NOT inline Phase A2 section) per posture-check §5.1 reframe.

### 5.4 Explicit dissent — items where Hive plausibly LOSES to mattpocock posture (R5 mitigation)

**D1. Plan skill at 734 lines is too big.** Even after kickoff-gate lift and boilerplate extraction, plan remains the highest-blast-radius skill. Architect agrees with split-harder posture: Section 2 action A-04 is the response (posture-check §6.4 item 1).

**D2. UI ceremony cluster repeats `spawn ui-designer with embedded prompt` 5+ times.** Mattpocock posture would say: collapse the 5 into 1 ceremony skill OR atomicize the ui-designer prompt. Section 2 actions A-08/A-09/A-11 (W6) cover 3 of 5; deeper extract-config-the-prompts question is open. **Partially-addressed dissent.** See Section 7 — Next epics for the unaddressed remainder.

**D3. Boilerplate sprawl (~600 lines duplicated).** Pure inertia, nothing to defend. Section 2 action A-25 (W0) resolves entirely.

**D4. Stand-alone usability ratio (4 of 24 skills usable without framework boot). RESOLVED — POSITION A WINS.** Per user course-correction 2026-05-08, Hive's North Star reframes from "director" to "composable substrate, user-directed." A composable substrate that hard-blocks on its own initialization ritual is anti-substrate. Original audit shipped Position B (keep `/plan` + `/execute` hard-gated for methodology routing + agent-backend resolution); user signed off Position A — lift to warning + sane defaults. Mitigation against silent miscoordination: ship behind `paths.gate_mode: warning|hard` config knob, default `warning` for 2.0; telemetry-validate over one release cycle; flip default to `hard` if miscoordination shows up at scale.

**Folded into Epic B as 5 additional actions (A-32 through A-36):** methodology auto-detect for `/plan`, gate lift to warning, backend auto-resolve for `/execute`, epic-create-on-the-fly path, post-run audit check for nonsensical-defaults. See Section 2.6 (added) and Section 7 Epic B revised scope.

### 5.5 North-Star statement — REFRAMED

`project_oss_rollout_brand` (locked 2026-04-30) had defined the brand as *"a director's chair for the agentic SDLC — disciplined swarms, kickoff to ship."* Per user course-correction 2026-05-08, the brand reframes:

> **Hive is to be directed.** Hive provides composable substrate — atomic skills, workflow primitives, memory architecture, adapter ABI, sandbox substrate — under user (or external orchestrator) direction. Discipline + composability are co-equal differentiators.

This is **REFINE-DEEPER**, not SHIFT. Three threads under the reframe:

1. **Composability and discipline are co-equal.** Mattpocock posture *"we don't impose"* is closer to right than original audit acknowledged. Hive's differentiator is **disciplined composable substrate** — the discipline (cross-LLM verification gate, governance policies, structured memory, audited workflows) is preserved; the impositions (kickoff-gate paternalism, hard-coded methodology routing, embedded knowledge in massive skill files) are walked back. REFINE-DEEPER removes the impositions while preserving the discipline.
2. **Direction is the user's, not Hive's.** *How* Hive provides substrate is open to author-bias correction — Section 2's 36-action plan is precisely that correction. *That* the user directs is the brand-level commitment. This is the inverse of original §5.5: original shipped "Hive directs, user accepts"; reframe ships "user directs, Hive composes."
3. **REFINE-DEEPER is materially distinguishable from RETAIN and SHIFT.** RETAIN leaves D1–D4 unaddressed and the reframe unincorporated. SHIFT abandons stand-independent items §5.1 #1 and #3 (cross-LLM gate, spike-before-rewrite). REFINE-DEEPER keeps the discipline, walks back the impositions, surfaces the §5.1 #2 memory question honestly, and commits to D4 Position A.

**Open architecturally under reframe:** the §5.1 #2 memory-stack question. CONTEXT.md (Borrow 2, W2) is the minimum-viable form. The deeper L0–L3 stack's load-bearing posture is suspect under "user-directed substrate" framing. Surfaced in Section 6 — Open Disagreements as a tracked item, **not** folded into Epic A or B. Likely a follow-on epic question for after 2.0 ships.

**The North-Star reframe stands.** Under it, REFINE-DEEPER is the coherent operationalization. The brand-system + project_oss_rollout_brand memo will need a corresponding update post-audit-sign-off; that update is its own work item (see Section 7 — brand-system update).

---

## Section 6 — Open disagreements

R5 mitigation: surfaced, NOT papered over. Each item carries both positions; tiebreak marker indicates who decides.

### D4 — RESOLVED 2026-05-08

User signed off Position A (lift `/plan` + `/execute` hard-gates to warnings + sane defaults), with `paths.gate_mode: warning|hard` config knob defaulting to `warning` for 2.0 and `hard` available for users who want to re-tighten. **Folded into Epic B as actions A-32–A-36.** No longer open.

### NEW — Memory L0–L3 stack load-bearing posture (§5.1 #2)

Surfaced post-reframe (2026-05-08). NOT folded into Epic A or B; tracked as follow-on question.

**Both positions stated:**

- **Position A (substrate-coherent under reframe):** Memory L0–L3 stack should be opt-in / configurable. CONTEXT.md (Borrow 2) is the minimum-viable form a composable substrate should impose. Cycle-state, KG, ChromaDB, structured memos should all be **available** but not **load-bearing** — user-directed Hive must work without them when user opts out. Defaults should be minimal; full memory stack should be `--memory=full` or equivalent opt-in.
- **Position B (status-quo defense):** Memory stack is a foundational substrate; cross-conversation continuity is real value; user-direction doesn't preclude shared memory architecture. Optionalizing memory could fragment the experience and create configurability sprawl.

**Tiebreak marker:** `user-decision-post-2.0`. Audit recommends shipping current memory stack unchanged in 2.0; reopen as follow-on epic if reframe coherence demands resolution. Risk of leaving open: brand-promise gap if "composable substrate" markets a non-optional memory architecture.

### Other reconciled disagreements (TPM ↔ architect)

**Resolved by counting different things — not a real disagreement.**

- **Story-count:** TPM synthesis-prep cited "9 stories ≤ 2 epics" (posture-check §6.5 sketch). Architect counted ~22 stories across 22 actions × matrix granularity + 2 epics. Reconciliation: posture-check's 9-story sketch was the *posture-check author's* lift outline; Section 2's full-matrix breakdown is the operationalization. Post-2026-05-08 user fold-in adds 5 gate-lift stories → **~27 stories across 2 in-flight epics + Epic C ABI** (parallel). Architect's count is binding.
- **Borrow 1 Grill shape:** Both authors agree — atomic skill called from `/plan` Phase A2, per posture-check §5.1 binding shape. A-28 reflects this.
- **North-Star phrasing:** Original §5.5 framed mattpocock posture as a market Hive opts out of via "we direct" brand commitment. **Superseded 2026-05-08:** user reframe is "Hive is to be directed" — composable substrate, user-directed. §5.5 rewritten; §6 §5.1 #2 memory-stack item now tracks the reframe-coherence question that the original framing closed prematurely.
- **Sandcastle hooks ≠ Hive PreToolUse:** Verified. A-25 (boilerplate extraction) operates on Hive's `Before Executing Any Skill` + `Kickoff Gate` text — there is no sandcastle-hooks reuse and no terminology equation. s1 §1 #9–10 classification ("different layer") is preserved by Section 2 not touching the hooks topic.

---

## Section 7 — Next epics

R7 mitigation: this section is REQUIRED non-empty regardless of recommendation outcome. Audit MUST end with concrete next-epic IDs + dependencies.

### 2.0 Milestone (declared 2026-05-08)

Per user course-correction 2026-05-08, this body of work + CWC 2026 + adapter ABI = the **2.0 release cut-line**. Major version bump justified by:
- Brand pivot (director-chair → composable-substrate, user-directed)
- Catalog reshape (24 skills → 19, with 2 new atomic borrows + structural splits)
- CWC 2026 Messages-API substrate (S4–S10)
- Adapter ABI introduced (foundational for backlog-and-run direction)
- D4 Position A — `gate_mode` knob lifts hard-gates by default

**2.0 ships when:** CWC 2026 A-group (S4–S10) + Epic A + Epic B + Epic C (Adapter ABI) all merged. Conditional epics (D/E/F) are post-2.0 follow-ons.

### Required epics (in-flight)

**Epic A — `catalog-hygiene-and-borrows`** (~13 stories)
- **Scope:** W0 boilerplate extraction (A-25), W1 kickoff-gate warning lift + doc-template reclassify (A-03, A-06, A-07, A-20–24), W2 CONTEXT.md (A-26, 3 stories), W3 Triage (A-27, 4 stories), W4 Grill atomic skill + plan A2 wiring (A-28, 2 stories), W5 sidecar bundle (A-29 + A-30 + A-31, 1 bundled-PR).
- **Dependencies:** None blocking — can start on synthesis sign-off.
- **Sequencing within epic:** W0 → W1 (need skill-prelude.md substrate) → W2 (parallel W3) → W4 (after W2) → W5 (independent, low priority).
- **Branch:** `feat/catalog-hygiene-and-borrows` per `feedback_git_flow_per_epic`.
- **PR strategy:** ≥4 PRs (W0+W1 together, W2+W3 separately, W4 separate, W5 separate) to stay <150 files per `feedback_pr_file_count_limit`.

**Epic B — `structural-refactor-and-gate-lift`** (~14 stories — grew from 9 with D4 Position A fold-in)
- **Scope:** W6 plan-skill split (A-04, 2 stories), execute split (A-05, 2 stories), agent-spawn split (A-14, 2 stories), brand-system extract config (A-08, 1 story), design-system extract config (A-09, 1 story), ui-audit collapse (A-11, 1 story), **plus D4 Position A fold-in (A-32–A-36, 5 stories)**: `/plan` methodology auto-detect + gate lift + `gate_mode` knob, `/execute` backend auto-resolve + epic-create-on-the-fly + gate lift, post-run audit telemetry check.
- **Dependencies:** **Blocked by Epic A W4** (Grill atomic skill must land first; plan-split would otherwise force merge churn against in-flight Phase A2 wiring per borrows §1.4).
- **Branch:** `feat/structural-refactor-and-gate-lift`.
- **`gate_mode` shipping note:** default `warning` for 2.0, telemetry-validate over one release cycle, flip default to `hard` if miscoordination at scale; users always have explicit `paths.gate_mode: hard` opt-in.

**Epic C — `task-tracking-adapter-abi`** (~5–7 stories, scope TBD) — **PROMOTED IN-FLIGHT 2026-05-08**
- **Scope:** define executable ABI for `task_tracking.adapter` (form factor TBD: TS interface vs MCP server vs CLI contract — first story is form-factor selection); ABI is **hierarchy-agnostic** (adapters declare flat or hierarchical capability); migrate Linear and GitHub from prose-runbooks to executable adapters as ABI validation.
- **Dependencies:** None blocking — independent of Epic A/B. Parallel-able with both.
- **Why in-flight (was deferred):** user course-correction 2026-05-08 — backlog-and-run direction makes adapter ABI foundational, not optional.
- **Branch:** `feat/task-tracking-adapter-abi`.
- **2.0 inclusion:** required for 2.0.

### Conditional / follow-on epics (post-2.0)

**Epic D — `sandcastle-adoption-followon`** (~6–8 stories, scope TBD) — *was Epic C*
- **Scope:** `SandboxProvider`, `branchStrategy`, `createWorktree`, sandcastle hooks integration. Builds the substrate that unlocks Section 4 cross-tool synergy.
- **Dependencies / gates:** s1 §5 surprises mitigated (rootless podman parallel race fixed, file-logger key-leak resolved upstream or via wrapper, issue #191 subscription-auth blocker addressed). NOT blocked by Epic A/B/C.
- **Trigger:** explicit user decision to invest in container-based substrate.

**Epic E — `atoshell-reconsider`** (≤2 stories if user reopens) — *was Epic D*
- **Scope:** re-evaluate atoshell as candidate adapter under Epic C ABI (now possible via hierarchy-agnostic design + bash-upgrade-by-fiat). Atoshell still SKIP per Section 3 vendor-fork burden + API-correction blockers; this epic exists only if user explicitly reopens.
- **Dependencies / gates:** Epic C ABI shipped; user explicit reopen.
- **Trigger:** none currently. Listed for completeness.

**Epic F — `ui-cluster-extract-config-deeper`** (≤4 stories) — **D2 partial-resolution follow-on** (unchanged letter)
- **Scope:** extract ui-designer prompts to `references/ui-prompts/`; reduce brand-system / design-system / polish-audit / visual-qa to thin invocations. Resolves D2 dissent fully.
- **Dependencies / gates:** Epic B W6 must land first (existing extract-config work for 3 of 5 cluster members is the substrate).
- **Trigger:** post-Epic-B review confirms thin-invocation pattern is working.

**Epic G — `memory-stack-optionalize`** (scope TBD) — **§5.1 #2 reframe-coherence follow-on**
- **Scope:** evaluate making L0–L3 memory stack opt-in / configurable rather than load-bearing. CONTEXT.md (W2) is minimum-viable; deeper KG, ChromaDB, structured memos move to opt-in via `--memory=` or equivalent. Resolves §5.1 #2 honestly-surfaced suspect-item.
- **Dependencies / gates:** post-2.0; brand-promise gap from "composable substrate" + non-optional memory architecture is the trigger.
- **Trigger:** user decision post-2.0 review.

**Epic H — `brand-system-2.0-update`** (≤3 stories)
- **Scope:** update `project_oss_rollout_brand` memo + brand-system YAML + brand-guide HTML to reflect "Hive is to be directed" reframe. Deprecate "director's chair" framing; introduce "composable substrate, user-directed" framing.
- **Dependencies / gates:** Epic A + B + C signed off + content-stable; brand update follows the artifact reality, not precedes it.
- **Trigger:** automatic on 2.0 merge.

### Dependency chain (updated 2026-05-08)

```
                      ┌──→ Epic F (UI cluster deep) [post-2.0]
Epic A ──→ Epic B ────┤
   (catalog        (structural+gate-lift)
   hygiene+              │
   borrows)              │
                         └──→ Epic H (brand 2.0 update)
                                      ↑
Epic C (Adapter ABI)  ────────────────┘
   (parallel; required for 2.0)


Epic D (sandcastle follow-on)  ────→  Section 4 synergy mechanically composes
                                       once D + C both in place

Epic E (atoshell reconsider)  ────→  evaluated under C ABI if user reopens

Epic G (memory-stack optionalize)  ────→ post-2.0 reframe coherence
```

**2.0 cut-line:** CWC 2026 A-group + Epic A + Epic B + Epic C all merged.
**Post-2.0 follow-ons:** Epic D, Epic F, Epic G, Epic H. Epic E only if user reopens atoshell question.

### Even "no-op + close audit" satisfies R7

If user signs off on Sections 1, 3, 4 but defers Sections 2 + 5 indefinitely: Epic A is the **minimum viable next-epic** (W0 boilerplate extraction alone is 1 story / −528 lines / measurable unblock for everything else). Closing audit without queueing at least Epic A would leave Section 2's REFINE verdict shelf-ware and violate R7.

---

## Validation

- **R1 mitigated:** s1 HYBRID with explicit per-primitive decision table (4 lanes, 22 rows) + zero-effort A-group delta.
- **R2 mitigated:** s2 mapped to SKIP-ATOSHELL with structural blockers preserved; ABI question reopened post-review and promoted to in-flight Epic C.
- **R3 mitigated:** s3 matrix held to one-line classification per skill (24 rows); 36 actions + 7 waves + 3 in-flight epics is the operationalization, not scope creep.
- **R4 contained:** A-group untouched per s1 §4. CWC 2026 A-group resumes immediately on synthesis sign-off; no waiver invoked.
- **R5 mitigated:** Section 6 surfaces D4 (now resolved Position A) and §5.1 #2 memory-stack as new tracked open disagreement post-reframe. Story-count, Borrow 1 shape, North-Star phrasing, sandcastle-hooks reconciled (not papered over — verified per item).
- **R6 mitigated:** §5.1 + §5.2 cite counter-precedent per item; §5.1 #2 honestly surfaced as suspect under reframe rather than papered over.
- **R7 mitigated:** Section 7 enumerates 8 next-epics (3 in-flight, 5 follow-on) with concrete IDs, scopes, and dependency chain + 2.0 milestone cut-line.
- **All 5 sections + Open disagreements + Next epics = 7 top-level chunks.**
- **Verdicts (post-review 2026-05-08):** S1 PROCEED-AS-DESIGNED, S2 REFINE-DEEPER, S3 SKIP-ATOSHELL / BUILD-ABI-NOW, S4 CONDITIONAL-ON-EPIC-D, S5 REFINE-DEEPER (reframe). All within audit-allowed verdict spirit; "DEEPER" / "BUILD-ABI-NOW" suffixes reflect post-review fold-ins.
- **Course-corrections from 2026-05-08 user review:** 2.0 milestone declared, adapter ABI promoted to in-flight, bash trigger A invalidated, ABI hierarchy-agnostic flips trigger B, North-Star reframed to composable-substrate-user-directed, D4 Position A folded into Epic B via `gate_mode` knob, §5.1 #2 memory-stack surfaced as new open question.
- **Sources:** spike findings cited file:section throughout. Memory citations: `project_oss_rollout_brand`, `feedback_codex_general_backend`, `project_memory_autonomy_foundation`, `feedback_test_offtheshelf_before_rewriting`, `project_archon_feasibility_spike`, `feedback_no_team_lead_intermediary`, `feedback_git_flow_per_epic`, `feedback_pr_file_count_limit`, `feedback_story_status_stale`, `feedback_writer_revision_verification`, `feedback_internally_inconsistent_story_specs`.
