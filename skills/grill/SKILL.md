---
name: grill
description: Adversarial alignment — atomic skill called by /plan Phase A2 from outside. Stress-tests a draft design discussion against inconsistency-risk signals, produces a grill-record artifact for downstream consumption.
---

# Hive Grill

**Atomic skill, NOT inline /plan prose.** Grill is the borrowed adversarial-alignment surface (Borrow 1 from mattpocock posture). It is called by `/plan` Phase A2 from outside, runs a focused adversarial pass against a draft design, and emits a structured **grill-record** artifact that design-discussion consumes downstream. It does NOT take over plan; it does NOT execute; it does NOT plan; it does NOT score quality. It surfaces inconsistencies, hidden assumptions, and unresolved tensions in a draft so the planner can address them before stories are written.

**Input:** `$ARGUMENTS` is one of:

- A path to a draft design-discussion document (typically `.pHive/epics/{epic-id}/docs/design-discussion.md` or a buffer the planner is producing in-memory)
- An epic ID — grill resolves the design-discussion path automatically and reads `inconsistency_risk_signals` from the planner's research-brief if present

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading + project CONTEXT.md load (the substrate prelude step 4 added in story `a-26-context-md-skill-prelude-citation`).

CONTEXT.md is **substrate** for grill — domain literacy informs which inconsistencies are real (vocabulary mismatches, convention violations) vs. surface noise. Grill SHOULD execute against a CONTEXT-loaded session; if `.pHive/CONTEXT.md` is absent, proceed (silent-on-absence) but the adversarial pass runs with reduced fidelity.

## Output

A **grill-record** at `.pHive/epics/{epic-id}/docs/grill-record.md` (path may be overridden by `--output-path`). The grill-record format is documented in [`hive/references/grill-record-template.md`](../../hive/references/grill-record-template.md). It is the produced artifact consumed downstream by design-discussion.

The skill produces exactly one grill-record per invocation. Re-running grill against the same epic overwrites the prior record (adversarial passes are point-in-time — the latest is canonical).

## Process

1. **Load the draft.** Read the design-discussion document (path resolved from `$ARGUMENTS`). If the document does not exist or is empty, error out — grill stress-tests an existing draft, it does not author one.
2. **Load `inconsistency_risk_signals`.** If the planner's research brief is reachable (e.g., `.pHive/epics/{epic-id}/docs/research-brief.md`), read its `inconsistency_risk_signals` field (added by the researcher persona — see story `a-28-grill-plan-a2-wiring`). Use these signals to focus the adversarial pass; if absent, grill runs heuristically against the draft alone.
3. **Run the adversarial pass.** Five categories, each surfaced as a structured finding (or noted as "no findings" — silence is a valid result):
   - **Vocabulary mismatches** — terms used in the draft that contradict CONTEXT.md or shift meaning mid-document
   - **Hidden assumptions** — claims made without grounding (architectural, behavioral, performance)
   - **Unresolved tensions** — competing requirements or constraints the draft acknowledges but doesn't reconcile
   - **Convention violations** — design choices that contradict project memory feedback memos or established conventions
   - **Posture mismatches** — design choices that depart from the project's stated posture (composable substrate, atomic skills, etc.) without explicit justification
4. **Emit the grill-record.** Write to the output path using the template at `hive/references/grill-record-template.md`. The record is structured (one section per category) and links findings to specific lines in the draft when possible.
5. **Return the path.** Echo the grill-record path so `/plan` Phase A2 can locate it. Grill does NOT modify the draft and does NOT call back into plan — it produces an artifact and exits.

## What grill is NOT

- **Not a planner.** Grill does not propose alternatives, decompose stories, or sequence work. Findings only.
- **Not a quality score.** No "grade" or pass/fail verdict. The grill-record is descriptive, not gating.
- **Not a security review.** Security concerns are surfaced if vocabulary or assumption findings reveal them, but grill is not a substitute for the security specialist team.
- **Not an inline /plan section.** This skill is invoked from outside plan via the standard skill machinery. If grill ever shows up as inline prose inside `skills/plan/SKILL.md`, that's a regression — the reframed shape (per audit posture-check §5.1) is binding.

## Atomic-skill invariants

- **Top-level skill** at `skills/grill/SKILL.md` (auto-discovered).
- **Called from outside** by `/plan` Phase A2 (story `a-28-grill-plan-a2-wiring` wires the call).
- **Single artifact** — produces one grill-record per invocation; downstream consumes that artifact, not the skill's internal state.
- **CONTEXT.md substrate** — preferred but not required (silent-on-absence per skill-prelude contract).
- **Stateless across invocations** — re-running overwrites the previous grill-record; no incremental state.

## Hand-off

`/plan` Phase A2 calls grill, awaits the grill-record, then proceeds:

1. Phase A2 invokes grill with the draft design-discussion path.
2. Grill produces `.pHive/epics/{epic-id}/docs/grill-record.md`.
3. Phase A2 calls design-discussion with the grill-record path as input — design-discussion consumes findings to revise the draft (or annotate explicitly-accepted-and-justified deviations).
4. Phase A2 continues to Phase B (H/V or stories).

This skill ends at step 2. Phase A2 owns step 3 onward (story `a-28-grill-plan-a2-wiring`).

## Out of scope

- Inline plan integration — grill is OUT of plan internals by design
- Multi-pass refinement — one grill per invocation; re-run if needed
- Cross-epic grilling — each invocation targets one design-discussion artifact
- Auto-fixing findings — grill surfaces, planner resolves
- External adversarial sources (GPT-as-grill, etc.) — out of scope; this is a Hive-internal pass

## See also

- [`hive/references/grill-record-template.md`](../../hive/references/grill-record-template.md) — grill-record output template
- [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — preamble + CONTEXT.md substrate citation
- `.pHive/CONTEXT.md` — project domain glossary (substrate for the adversarial pass)
- `skills/plan/SKILL.md` Phase A2 — caller (wiring lands in story a-28-grill-plan-a2-wiring)
- `hive/agents/researcher.md` — emits `inconsistency_risk_signals` consumed by grill (wiring lands in story a-28-grill-plan-a2-wiring)
- `hive/references/document-templates/design-discussion.md` — downstream consumer of the grill-record
- `.pHive/epics/hive-composability-audit/docs/recommendation.md` §2.3 row 28 — Borrow 1 specification (atomic-skill reframe)
