# Design Discussion — Hive Composability + Substrate + Tracker Audit

**Epic ID:** hive-composability-audit
**Branch (proposed):** feat/hive-composability-audit
**Methodology (proposed):** classic
**Scale (proposed):** large
**Date:** 2026-05-08

> **Process note:** Orchestrator (Opus 4.7) authored this design-discussion directly given the audit-shape nature where strategic synthesis is the binding constraint and the orchestrator has been holding the full conversation context. Collab review gate runs as normal — TPM + architect review before user presentation per /plan skill step 4b.

---

## Goal

Audit Hive's process-owning posture against three external lenses, produce a single structural recommendation that:

1. Decides the fate of CWC 2026 Group A (Messages-API substrate) — adopt sandcastle adapter, proceed as-designed, or hybrid
2. Reshapes Hive's skill catalog along atomic-composability lines (mattpocock skills lens)
3. Determines whether atoshell is a credible local-files alternative to Linear/GitHub for `task_tracking.adapter`
4. Identifies cross-tool synergies — particularly the atoshell↔sandcastle stack as a fully-local OSS posture

The audit is a **prerequisite** to resuming CWC 2026 Group A and to scoping the deferred mattpocock atomic-skill audit. It is also a **forcing function** to answer the wider strategic question: *how much process should Hive own?*

## Why now

- CWC 2026 paused (user decision); A-group blocked pending substrate question
- Sandcastle (mattpocock, 3.9k stars, daily commits) implements adjacent primitives; `feedback_test_offtheshelf_before_rewriting` mandates spike-before-rewrite
- Atoshell ships claim of agentic-first local tracker; sandcastle currently couples to GH issues — together they form a fully-local stack aligned with `project_oss_rollout_brand`
- Mattpocock atomic-skill audit deferred since 2026-05-06 — same author, related lens; bundling consolidates strategic decision
- D-group + C-group of CWC 2026 progress in parallel session; substrate decision is the only blocker for A/B groups

## Proposed approach

### Three feasibility spikes feeding one structural recommendation

```
Spike 1: Sandcastle  ─┐
Spike 2: Atoshell    ─┼─→  Audit Synthesis  ─→  Structural Recommendation
Spike 3: Skills lens ─┘                              │
                                                     ├─→ CWC 2026 A-group fate
                                                     ├─→ Skill catalog reshape
                                                     └─→ task_tracking.adapter
```

### Spike 1 — Sandcastle (substrate)

Bounded 1-3 day evaluation. Test against Hive's actual substrate needs:

- **Parallel agent runs:** can `sandcastle.run()` + branch strategies replace TeamCreate + cmux panes for parallel persona orchestration?
- **Session capture/resume:** does sandcastle's Claude Code session JSONL capture cover what `CLAUDE_CODE_SESSION_ID` correlation (CWC 2026 S7/A6) needs?
- **Structured output:** is `Output.object()` Zod + XML wrapping a viable substrate for rubric loops (CWC 2026 S14/B1)?
- **Multi-provider:** does provider-agnostic AgentProvider interface (claudeCode / codex / opencode / pi) align with Hive's existing codex-invoke + Claude direct model-tier routing?
- **Hooks model:** how do sandcastle host/sandbox hooks compare to Hive PreToolUse/PostToolUse hooks?

Output: GO / NO-GO / HYBRID + concrete delta against CWC 2026 A-group story scope.

### Spike 2 — Atoshell (tracker)

Bounded 1 day evaluation. Test against Hive's `task_tracking.adapter` slot:

- **Adapter parity:** can atoshell's JSON-on-disk + `--json` output back the same interface Linear/GitHub adapters provide?
- **Sandcastle compatibility:** sandcastle currently couples to GH issues — can atoshell tickets feed sandcastle runs via `--import` JSON or shell shim?
- **Maturity vs. value:** 3 days old + 0 stars = pre-discovery. Is the integration cost justified when Hive could vendor the bash directly (~few hundred lines)?
- **Vendor vs. depend:** evaluate forking / vendoring atoshell vs. taking it as a dependency

Output: ADOPT / VENDOR / SKIP recommendation + integration sketch for adapter slot.

### Spike 3 — Skills composability lens

The deferred mattpocock atomic-skill audit, pulled forward + expanded with sandcastle posture:

- **Catalog matrix:** all 30+ Hive skills classified atomic vs. process-owning, duplicating vs. composing, stand-alone vs. workflow-coupled
- **Three borrows:** scope grill-before-plan step, CONTEXT.md domain glossary, triage skill
- **/goal sidecar prompt edits:** structured story state, audit-first completion, token budget
- **Sandcastle posture cross-check:** does sandcastle's "no opinions about workflow / task management / context sources" stance refute or refine Hive's process-owning approach?

Output: skill catalog matrix + reshape recommendation list (split / collapse / extract config / leave alone) + sandcastle-posture decision.

### Synthesis — structural recommendation

After all 3 spikes deliver findings, produce single `recommendation.md` covering:

1. CWC 2026 A-group resume strategy (rewrite around sandcastle / proceed as-designed / hybrid)
2. Skill catalog reshape plan (numbered actions per skill)
3. `task_tracking.adapter` direction (atoshell / Linear / GitHub / multi-adapter)
4. Cross-tool synergy decisions (sandcastle-atoshell stack adoption / partial / skip)
5. North-Star alignment statement (process-owning vs. composable; impact on `project_oss_rollout_brand`)

Recommendation document is the **gate-keeping artifact** — no further A-group / skill-catalog / tracker work proceeds until this document is signed off by user.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Sandcastle spike inconclusive (partial fit) → "hybrid" recommendation that is harder to scope than either pure path | High | Define HYBRID upfront with explicit decision criteria: which Hive primitives sandcastle replaces, which Hive keeps; require scoped story-list as part of HYBRID call |
| R2 | Atoshell maturity gap blocks honest evaluation (3 days old, 0 stars) | Medium | Treat Spike 2 as "would we adopt if mature?" — output specifies ADOPT-WHEN-MATURE / VENDOR-NOW / SKIP |
| R3 | Skills audit scope creep (30+ skills × catalog matrix × reshape recommendations) | High | Cap matrix scope to one-line classification per skill; defer per-skill reshape to follow-on epics |
| R4 | Audit blocks CWC 2026 substrate indefinitely | Medium | Hard cap: audit ships in 5-7 working days; D-group + C-group progress in parallel; if audit slips, A-group resumes with `feedback_test_offtheshelf_before_rewriting` waiver documented |
| R5 | Spike findings disagree (sandcastle says "adopt", skills lens says "stay process-owning") | Medium | Synthesis owner (TPM + architect) must surface disagreement explicitly in recommendation, not paper over |
| R6 | Mattpocock author personal-brand bias — both sandcastle and skills come from same author; structural recommendation may over-index on his opinions | Medium | Synthesis must include dissent: which Hive design decisions stand independent of mattpocock posture; cite countervailing precedent (Archon NO-GO, internal feedback memos) |
| R7 | Recommendation never gets implemented — audit becomes shelf-ware | High | Recommendation document MUST end with concrete next-epic story IDs + dependencies; user sign-off blocks until this section is non-empty |

## Dependencies

- **External:** sandcastle 0.x (npm `@ai-hero/sandcastle`), atoshell v2.0.0 (curl install)
- **Internal:** mattpocock atomic-skill audit deferred file at `.pHive/meta-team/deferred/2026-05-06-mattpocock-atomic-skill-audit.md` (consumed as input to Spike 3)
- **CWC 2026 epic:** A-group + B-group remain paused until recommendation signed; D + C-group progress unblocked
- **Hive infra:** Docker or Podman for sandcastle sandbox spike (`SandboxProvider`); cmux not required for spike (sandcastle is host-side)

## Open questions

1. Hard cap on audit duration — 5 working days, 7, or other?
2. Spike sequencing — parallel (3 streams), serial (sandcastle → atoshell → skills), or staggered (sandcastle starts day 1, others day 2-3)?
3. Recommendation owner — TPM solo, architect solo, or joint (with disagreement protocol)?
4. Sandcastle spike provider — Docker (most common), Podman (if Docker absent), or `noSandbox` (fastest, less realistic)?
5. Atoshell evaluation — pure CLI test, or wire it up to the actual `task_tracking.adapter` interface as a working spike?
6. Skill catalog matrix — full 30+ skill audit upfront, or sampled (10 representative skills) with full audit deferred?
7. Does this audit produce stories for execution, or is the output purely a recommendation document with stories filed in follow-on epics?
8. CWC 2026 A1 (session-spec rewrite) — keep as no-regret work during audit, or pause along with rest of A-group?

## Scale assessment

**Recommendation: LARGE.**

Justification:
- Multi-system: substrate layer + tracker adapter + skill catalog
- Long-horizon: 5-7 working days minimum across 3 spikes + synthesis
- High-stakes: output gates CWC 2026 A-group + future skill-catalog work + task-tracking adoption
- Strategic: structural recommendation will be referenced for months; warrants H/V planning + structured outline elicitation

Large scale runs full Phase B2 (H/V planning) + Phase B3 (structured outline with elicitation) before story decomposition.

---

## Decision points for user

Numbered for easy reference:

1. **Audit duration cap** — pick a number (5 / 7 / 10 working days), or "no cap"
2. **Spike sequencing** — parallel / serial / staggered
3. **Recommendation owner** — TPM / architect / joint
4. **Sandcastle sandbox provider** for spike — docker / podman / noSandbox
5. **Atoshell eval depth** — CLI-only / working adapter wire-up
6. **Skill catalog matrix** — full / sampled
7. **Audit output** — pure recommendation doc / recommendation + stories for follow-on
8. **CWC 2026 A1 fate during audit** — pause / no-regret-work continues
9. **Confirm scale** — large (default) / medium (smaller scope) / other framing
