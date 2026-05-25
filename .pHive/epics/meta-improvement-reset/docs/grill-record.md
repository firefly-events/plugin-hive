# Grill Record — meta-improvement-reset

**Source draft:** `.pHive/epics/meta-improvement-reset/docs/design-discussion.md`
**CONTEXT.md substrate:** present (.pHive/CONTEXT.md loaded)
**inconsistency_risk_signals:** present (research brief §7)
**Generated:** 2026-05-25T00:00:00Z

## Summary

- Vocabulary mismatches: 3 findings
- Hidden assumptions: 4 findings
- Unresolved tensions: 3 findings
- Convention violations: clean
- Posture mismatches: 2 findings

## Vocabulary mismatches

- **V1** — "cycle-proposal metric block" (§1 reframe #2) shifts meaning vs. shipped step-03c terminology.
  - Draft location: §1, §3.3 ("Cycle-proposal metric blocks", "enter step-04")
  - Reference: `hive/workflows/steps/meta-team-cycle/step-03c-metric-declaration.md` — canonical name is `enriched_proposals[*].metric:`
  - Question for planner: rename §1 reframe #2 to "enriched_proposals metric gate" so reader maps directly to shipped surface, or define "cycle-proposal metric block" as the user-facing alias in §3.3?

- **V2** — "shotgun" is informal and not defined in CONTEXT.md.
  - Draft location: §1 reframe #3, §3.4, §3.5
  - Reference: `.pHive/CONTEXT.md` — vocabulary absent
  - Question for planner: define "shotgun" in CONTEXT.md (or design-discussion §1) as "monthly batch-cleanup cycle that scoops accumulated `tier: little-fix` backlog candidates into a single PR"? Without a definition, executor agents will guess.

- **V3** — "release-notes-dominant" (§1 reframe #1) overpromises what §3.1/§3.2 deliver.
  - Draft location: §1 ("release notes dominant input"), §3.2 (weights metrics=1.0 > external_research=0.9)
  - Reference: research brief §3.3 — step-03 already routes signal-first
  - Question for planner: drop "dominant" framing and use "release-notes-weighted" or "release-notes-augmented," OR raise external_research weight above metrics (e.g. 1.1) and accept the consequence? "Dominant" rhetoric doesn't match the weight choice.

## Hidden assumptions

- **H1** — §3.1 assumes Claude Code release notes will produce actionable Hive proposals.
  - Draft location: §3.1
  - Why this matters: Claude Code changelog is dominated by bug fixes and small feature additions. The researcher persona must reliably distinguish "Anthropic shipped X" from "Hive should adopt X" — this is judgment work, not mechanical extraction. If filter is weak, RN feed becomes noise that crowds out other signals.
  - Question for planner: what's the filter criterion (researcher prompt template, signal-subtype tagging, post-fetch heuristic)? Or accept that v1 may run noisy and tune via cycle-output observation?

- **H2** — §3.2 weight knob assumes step-03 ranking is a priority-score-multiplier surface.
  - Draft location: §3.2 ("weight as multiplier on its existing priority score")
  - Why this matters: research did not verify step-03's actual ranking mechanism. If step-03 uses absolute rules (precedence ordering, not scoring), a multiplier knob has no insertion point.
  - Question for planner: read `step-03-proposal.md` ranking section before story-writing; if no score surface exists, the knob proposal becomes "add scoring to step-03" — bigger surface change.

- **H3** — §3.3 escape-hatch `--metric-gate=advisory` assumes step-03c is invoked with CLI-style flags.
  - Draft location: §3.3
  - Why this matters: step-03c is a workflow step (markdown spec consumed by a runtime), not a CLI. There is no obvious flag-passing channel into a step from /meta-meta-optimize SKILL.md.
  - Question for planner: which mechanism — `hive.config.yaml → meta_optimize.metric_gate: blocking | advisory`, env var, or per-cycle invocation flag at the SKILL boundary that the step file reads? Pick before §3.3 story is written.

- **H4** — §3.4 grouping heuristic "by file proximity (same dir = same group)" assumes little-fix candidates cluster geographically.
  - Draft location: §3.4 step 2
  - Why this matters: real little-fix backlog evidence (queue-meta-meta-optimize.yaml) shows 2 candidates targeting `.pHive/meta-team/archive/2026-04-19/` — same dir, fine. But evidence is N=2. Future candidates may scatter (README typo + GUIDE.md tier fix + skill description tweak). Same-dir grouping then produces 1 candidate per group, defeating the batch.
  - Question for planner: pick concrete grouping heuristic with fallback (e.g., "by dir; ungrouped candidates land in trailing 'misc' group") or single-PR all-at-once with sections per dir?

## Unresolved tensions

- **U1** — §1 reframe #1 says "release notes dominant" but §3.2 leaves metrics weighted higher.
  - Draft location: §1 vs §3.2
  - Tension: Either RN displaces metrics (reframe wording wins → external_research weight ≥1.0) or metrics keep priority (current ranking wins → reframe wording softens). Draft hedges both ways.
  - Question for planner: which signal IS dominant when metrics and RN both have candidates in same cycle?

- **U2** — Monthly shotgun + nightly cycle target the same little-fix surface.
  - Draft location: §3.4, §4 (medium risk)
  - Tension: Nightly catches small fixes → shotgun has nothing. Shotgun catches them first → nightly cycles reject-as-out-of-scope more often. §4's mitigation (30-day touch exclusion) creates ordering dependency without specifying which runs first when both are eligible.
  - Question for planner: should nightly cycles be retuned to NOT target `tier: little-fix` candidates (delegating that surface entirely to shotgun), or accept overlap with explicit dedup rule?

- **U3** — §3.2 weight defaults ship as all-1.0 → reframe #1 only fires for plugin-hive maintainer.
  - Draft location: §3.2, §5 ("ship all 1.0")
  - Tension: Reframe #1 framed as project-wide architectural shift. But shipping baseline at all-1.0 means consumer projects see no behavior change. Effectively reframe #1 reduces to "plugin-hive's own root config gets non-default weights."
  - Question for planner: accept maintainer-only scope (and rename reframe #1 accordingly in §1), or ship non-default weights in baseline (consumers get the new behavior, breaks current PR #43 contract for external_research neutrality)?

## Convention violations

(clean — no findings)

The design's git-flow retarget (§3.6 → develop) aligns with `feedback_seek_direct_push_auth` (2026-05-21: develop is staging-trunk, only main is gated) and `feedback_meta_team_must_use_pr` (meta-team must use PR). The new skill `/meta-shotgun` under `maintainer-skills/` aligns with signed decision `meta-meta-optimize-ships: no — local-only`. Codex-for-work / Opus-for-review split is not violated — research brief §7 raised the risk; the design correctly defers backend routing to `agent_backends` map. No explicit memory contradicts §3.3's blocking gate flip.

## Posture mismatches

- **P1** — §3.3 blocking gate flip shifts authority from human/orchestrator to gate.
  - Draft location: §3.3 ("Currently non-blocking. Change: Gate failures → block proposal from entering step-04")
  - Posture reference: step-03c.md explicit phrasing — "Gate failures are reported... but are NON-blocking — the orchestrator/user decides whether to proceed with gaps or send the proposal back to step-03"
  - Question for planner: is the design consciously taking authority FROM the orchestrator/user (because empirically they always proceed-with-gaps and accept thin metrics), or should the escape hatch flag (§3.3) be the default rather than an opt-out — i.e., advisory by default, blocking via opt-in flag? The latter preserves posture; the former enforces convergence. Decide explicitly.

- **P2** — §3.4 places `/meta-shotgun` as a top-level skill; the work shape may be a workflow not a skill.
  - Draft location: §3.4 (`skills/hive/skills/meta-shotgun/SKILL.md` + `hive/workflows/meta-shotgun.workflow.yaml`)
  - Posture reference: atomic-skills principle (composable substrate, skills as entry points, workflows as composed sequences)
  - Question for planner: is `/meta-shotgun` doing genuinely atomic work (one entry, one artifact: a PR), or is it a sequence of step files (filter → group → apply → validate → commit → push) that composes existing primitives? If sequence, the workflow YAML is the carrier and the SKILL.md is thin shim. Justify keeping it as a skill vs. inlining the workflow into /meta-meta-optimize's lifecycle as a new monthly branch.

## Notes

- The design is internally coherent and well-grounded in shipped state — research brief §3 work was effective; the design appropriately defers KG signal repair out of scope and lands the develop-retarget addition cleanly.
- Two systemic patterns to watch: (1) §3 surface changes are mostly *parametric* (knobs, gate flips, schema fields) which is appropriate for a "reset" framing — but H2 risk shows one knob assumes a substrate that may not exist; (2) the design's main risk concentration is reframe #3 (greenfield skill + greenfield queue field + cadence policy), which §4 only partly addresses.
- Empirical evidence (recent ledger pattern: 0-1 changes per cycle, mostly backlog-driven) supports the diagnostic in §1 strongly. The design has a reasonable theory of change.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
