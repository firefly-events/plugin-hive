# Synthesis Prep — Hive Composability Audit

**Author:** TPM (audit-s4-synthesis team)
**Date:** 2026-05-08
**Inputs:** s1 sandcastle findings, s2 atoshell findings, s3 skills-lens (matrix / borrows-scope / sidecar-edits / posture-check), design-discussion R1–R7 + 9 decision points, cycle-state YAML.
**Purpose:** Pre-draft cross-reference of spike outputs vs design-discussion risks, to seed (a) TPM Sections 1, 3, 4 and (b) architect Sections 2, 5.

---

## 1. R1–R7 — realized vs mitigated

| # | Risk | Status after spikes | Evidence |
|---|---|---|---|
| R1 | Sandcastle inconclusive → unscoped HYBRID | **Mitigated** | s1 §3 verdict is HYBRID with explicit per-primitive decision table (22 rows, 4 explicit ADOPT lanes: now / S14-B1-design / follow-on / N-A) and §4 "ALL UNTOUCHED" CWC delta — exactly the scoped-HYBRID R1 demanded (`spikes/sandcastle/findings.md` Verdict + Section 4). |
| R2 | Atoshell maturity gap blocks honest evaluation | **Mitigated** | s2 mapped allowed-values to SKIP with two explicit reconsider triggers (bash 3.2 compat, hierarchy fork) — i.e. "would adopt if mature, won't now" framing R2 mandated (`cycle-state.s2_reconsider_triggers`). |
| R3 | Skills audit scope creep | **Mitigated** | s3 matrix held to one-line classification per skill (24 rows, surface-tagged); reshape recommendations deferred to s4 / follow-on epics (`cycle-state.s3_research_decisions` Q-include-all + Q-reclassify defer). |
| R4 | Audit blocks CWC 2026 indefinitely | **Realized but contained** | All 3 spikes shipped; A-group untouched per s1 §4. CWC 2026 A-group can resume immediately on synthesis sign-off (no waiver needed). Section 1 reflects this. |
| R5 | Spike findings disagree, get papered over | **Active** | Surface-level: s1 says "adopt selectively" (Output primitives + sandbox-in-followon); s3 posture-check says "stand independent" on most ceremonies and brand-level direction. These are not contradictions but they live at different levels — Section 1 (substrate) vs Section 2 (skills shape). The disagreement to surface is more subtle: sandcastle hooks vs Hive PreToolUse hooks (s1 #9–10) classified "different layer" rather than competitor — s4 must not paper over by silently re-using "hooks" terminology. Joint-merge gate. |
| R6 | Mattpocock author-bias | **Mitigated** | s3 posture-check §4.5 explicitly cites `project_oss_rollout_brand` — Hive's process-ownership IS the product, not incidental. Director's-chair brand vision (locked 2026-04-30) provides critique-resistant North-Star. Section 4 must cite this. |
| R7 | Audit becomes shelf-ware | **Pending** | Recommendation must end with concrete next-epic IDs + dependencies. TPM step f (next-epics) is the blocking gate — required regardless of outcome. Even "no-op + close audit" satisfies R7 if explicit. |

**Net:** R1–R3 mitigated cleanly. R4 contained (no CWC delay). R5 needs vigilance at joint-merge. R6 cited via brand. R7 outstanding — handled in step f.

---

## 2. Decision points (1–9 from design-discussion) — settled or deferred

| # | DP | Settlement |
|---|---|---|
| 1 | Audit duration | Settled. Spikes shipped within window; synthesis is the last mile. |
| 2 | Spike sequencing | Settled (parallel was chosen; all 3 done). |
| 3 | Recommendation owner | Settled — joint TPM + architect (this team). |
| 4 | Sandbox provider for spike | Settled (s1 used podman with userns:false). |
| 5 | Atoshell eval depth | Settled at CLI-only (s2 SKIP). |
| 6 | Skill catalog matrix scope | Settled (full, one-line per skill, 24 rows). |
| 7 | Audit output | **Section 1+f covers** — recommendation + concrete next-epic IDs. |
| 8 | CWC 2026 A1 fate | **Section 1 covers** — A-group untouched per s1 §4 = no-regret-work continued. |
| 9 | Confirm scale | Settled (large default held). |

DPs 7 + 8 are the live ones synthesis must close. Both fall in TPM Section 1 / step f.

---

## 3. Spike-output cross-references TPM sections will rely on

### Section 1 (CWC 2026 A-group resume)
- s1 §4 CWC delta table (S4-a1, S5-a2, S6-a3, S7-a6, S8-a4, S9-a5, S10-a8, S14-b1) → all "Untouched" except Output.object/Output.string/runtime guards adopt **inside S14/B1 design** (decision #11 + #12 in s1 primitive table marked "ADOPT in S14/B1 design").
- s1 verdict: HYBRID, but A-group gets **PROCEED-AS-DESIGNED** because the HYBRID lanes that adopt sandcastle (Output primitives, sandbox follow-on) don't alter A-group story scope — they manifest IN S14/B1 design (rubric format) and in a follow-on epic.
- Effort delta: zero on A-group. Only S14/B1 (B-group) gains an Output.object option to evaluate during design.

### Section 3 (task_tracking.adapter direction)
- s2 SKIP verdict + 2 reconsider triggers (bash 3.2 / hierarchy fork) — `cycle-state.s2_reconsider_triggers`.
- s2 surfaced **Hive has no executable task_tracking adapter ABI** — Linear/GitHub adapters are prose-runbooks (`cycle-state.s2_blockers_for_synthesis[0]`). This is a meta-decision Section 3 must surface: defer ABI definition to its own epic vs accept current prose-runbook state.
- Vendor burden updated: 30 files / ~210KB bash, not "single bash file" — original ADOPT-WHEN-MATURE bar is materially higher than framed.
- noSandbox() is interactive()-only per sandcastle 0.5.10 types — original synergy framing was wrong at API level. Section 4 must reflect.

### Section 4 (cross-tool synergy)
- s1 verdict: HYBRID with sandbox primitives explicitly ADOPT-in-follow-on-epic (`SandboxProvider`, `branchStrategy`, `createWorktree`, sandcastle hooks).
- s2 verdict: SKIP.
- Synergy logical AND: requires (a) sandcastle follow-on epic to land **and** (b) ≥1 atoshell reconsider trigger to flip. Without both → SKIP. With both → revisit.
- North-Star alignment per s3 posture-check §4.5: brand vision is "director's chair for the agentic SDLC" — process-ownership is the product. Cross-tool synergy must serve that direction, not erode it.

---

## 4. Open disagreements I anticipate with architect's Sections 2 + 5

1. **Skill catalog reshape (Section 2) lift count.** s3 posture-check §6.5 sketches 9 stories across 1–2 epics (skill-prelude extract, kickoff-gate softening, doc-template reclassify, CONTEXT.md, triage, grill, sidecar bundle, plan-skill split, UI ceremony cluster extract-config). Architect may want to compress or split. TPM view: keep the 9 as the matrix-defined unit and let next-epics group them into ≤2 epics per s3's recommendation.
2. **Borrow 1 (grill) shape.** Posture-check §5.1 is authoritative: atomic skill called from /plan Phase A2, not inline sub-phase. Architect Section 2 must respect this; if architect drifts back to sub-phase, surface as disagreement, do not paper over.
3. **North-Star statement (Section 5) phrasing on "atomic skill" adoption.** Risk: architect frames mattpocock posture as a corrective vs. as a constraint Hive opts out of by brand-level commitment (s3 §4.5). TPM view: phrase as "Hive directs by design; we adopt mattpocock's atomic shapes selectively where they don't erode direction" — not "we should be more atomic."
4. **Sandcastle hooks vs Hive PreToolUse hooks** — s1 §1 #9–10 marks them as different layer (lifecycle vs per-tool). Architect Section 2 reshape should not silently equate the two; if it does, Section 4 (synergy) needs to flag.

These go into the joint-merge "Open disagreements" subsection if not resolved by reading architect's drafts.

---

## 5. Pre-commit constraints carried forward

- Git flow: one branch per epic, one commit per story (`feedback_git_flow_per_epic`). Next-epics section (step f) must respect this when scoping epic IDs.
- PR file count: <150 for CodeRabbit (`feedback_pr_file_count_limit`). Skill-prelude extract (12 skills × ~25 lines) + reclassify (5 doc-template moves) likely fits one PR; CONTEXT.md + triage + grill should be separate.
- Codex routing per `feedback_codex_general_backend` — next-epics planning must reflect Codex on dev/test/writer/architect, Claude on review/QA. Not synthesis material but flag for execute-phase.
- README is canonical North Star (`feedback_check_readme_first`) — if architect Section 5 cites brand, must verify against `/Users/don/Documents/plugin-hive/README.md` not just memory snapshot.

---

## 6. Section verdict table I'm pre-committing to

| Section | Verdict |
|---|---|
| 1 — CWC 2026 A-group resume | **PROCEED-AS-DESIGNED** (with Output primitives + runtime guards adopted IN S14/B1 design, not by altering A-group) |
| 3 — task_tracking.adapter | **SKIP** with 2 reconsider triggers + adapter-ABI deferred to follow-on epic |
| 4 — cross-tool synergy | **SKIP-SYNERGY** (with explicit AND-gate: requires sandcastle follow-on + atoshell reconsider-trigger flip; revisit then) |

These are TPM-side commitments going into draft. Subject to revision only if architect Sections 2 or 5 produce contradicting evidence at joint-merge.
