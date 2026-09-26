# Grill-Record Template

Output template for the grill skill (`skills/grill/SKILL.md`). One grill-record per invocation. Path: `.pHive/epics/{epic-id}/docs/grill-record.md` (overridable via `--output-path`).

Consumed by design-discussion (post-reclassify path: `hive/references/document-templates/design-discussion.md`) — design-discussion either revises the draft to address each finding or annotates explicitly-accepted-and-justified deviations.

## Format

```markdown
# Grill Record — {epic-id}

**Source draft:** {path to the design-discussion this grill was run against}
**CONTEXT.md substrate:** {present | absent (reduced fidelity)}
**inconsistency_risk_signals:** {present | absent (heuristic pass)}
**round_number:** {1-based integer — the current round when invoked as part of a loops.grill multi-round pass; defaults to 1 for a single/standalone invocation}
**unresolved_count:** {integer — total open findings across all five categories in THIS round's pass; 0 means this round's draft is converged}
**Generated:** {ISO 8601 timestamp}

## Summary

One sentence per category — found / clean / not applicable. Example:

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 1 finding
- Unresolved tensions: clean
- Convention violations: 1 finding
- Posture mismatches: clean

## Vocabulary mismatches

Findings where draft terminology contradicts CONTEXT.md or shifts meaning mid-document.

- **{Finding ID, e.g., V1}** — {term used in draft} contradicts {definition in CONTEXT.md or earlier-in-draft usage}.
  - Draft location: line {N} ({short quote})
  - Reference: `{CONTEXT.md path or earlier draft section}`
  - Question for planner: {what choice should the planner make to resolve?}

## Hidden assumptions

Claims made without grounding (architectural, behavioral, performance, etc.).

- **{Finding ID, e.g., H1}** — Draft assumes {assumption} without citing evidence.
  - Draft location: line {N} ({short quote})
  - Why this matters: {what breaks if the assumption is wrong}
  - Question for planner: {what evidence or fallback should the design carry?}

## Unresolved tensions

Competing requirements or constraints the draft acknowledges but does not reconcile.

- **{Finding ID, e.g., U1}** — Draft surfaces both {constraint A} and {constraint B} without resolving the conflict.
  - Draft location: lines {N1, N2}
  - Tension: {one-sentence framing}
  - Question for planner: {which side wins, or what compromise is acceptable?}

## Convention violations

Design choices that contradict project memory feedback memos or established conventions.

- **{Finding ID, e.g., C1}** — Draft proposes {choice} which contradicts {feedback memo or convention}.
  - Draft location: line {N}
  - Convention: `{path to feedback memo or convention reference}`
  - Question for planner: {explicit deviation with rationale, or align?}

## Posture mismatches

Design choices that depart from project posture (composable substrate, atomic skills, etc.) without explicit justification.

- **{Finding ID, e.g., P1}** — Draft proposes {pattern} which violates {posture statement}.
  - Draft location: line {N}
  - Posture reference: `{posture-check or recommendation source}`
  - Question for planner: {explicit posture deviation with justification, or align?}

## Notes

Optional. Anything the grill pass surfaced that doesn't fit the five categories — signal-not-finding observations, meta-observations about the draft's overall coherence, etc.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
```

## Usage notes

- **No findings is a valid result.** A category with no findings should explicitly say "clean" or "not applicable" — silence per category is acceptable, but the section header MUST be present.
- **Cite by line number.** Findings reference specific lines in the source draft. If the draft is in-memory (planner buffer), use section headers + a 1-line quote instead.
- **Question for planner.** Every finding ends with an explicit question — grill's role is to surface and prompt, not to prescribe.
- **Overwrite-on-rerun.** Re-running grill against the same epic overwrites the prior grill-record. Adversarial passes are point-in-time; only the latest is canonical.
- **`round_number` is a label on the current pass, not cross-round history.** Because each round overwrites the prior record (above), `round_number` does NOT make earlier rounds' records individually retrievable after the fact — the file at any moment only ever shows the latest round's number and findings. Its purpose is narrower: it tells the *reader of the current record* which round produced it (so /plan's Phase A2 loop log and the grill-record agree on round identity while the loop is running), and it lets /plan pass round-relative context (e.g. "this is round 2 of up to 3") into the pass itself. If a caller needs the full history across rounds, it must capture each round's record externally (e.g. copy to `.../grill-record-r{k}.md`) before the next round's grill invocation overwrites it — grill itself does not retain that history.
- **`unresolved_count` is per-round, not cumulative.** It reflects only the findings surfaced in the current pass against the current draft — not a running total across rounds.

## See also

- [`skills/grill/SKILL.md`](../../skills/grill/SKILL.md) — atomic skill that produces this artifact
- [`hive/references/document-templates/design-discussion.md`](document-templates/design-discussion.md) — downstream consumer
- `hive/agents/researcher.md` — emits `inconsistency_risk_signals` that grill uses to focus the pass
- `.pHive/CONTEXT.md` — domain substrate for the adversarial pass
