# Grill Record — multica-plan-test-cycles

**Source draft:** `.pHive/epics/multica-plan-test-cycles/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (5 signals from research-brief.md)
**Generated:** 2026-05-28T06:40:00Z

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 2 findings
- Unresolved tensions: 3 findings (one is the draft's intentional central question)
- Convention violations: 2 findings
- Posture mismatches: 2 findings

## Vocabulary mismatches

- **V1** — "cell" is used throughout the draft as a load-bearing term but is undefined in CONTEXT.md. The glossary defines `Squad`, `Persona`, `Roster`, `Specialist team`, and `Sidecar` — not `cell`. The draft alternates between "multi-role cell," "squad-as-cell," and "cell-as-squad" (lines 17, 42, 92, 139) as if they are interchangeable.
  - Draft location: line 139 ("the salvaged cell-as-squad idea (treating a squad as a dispatchable multi-role unit)")
  - Reference: `.pHive/CONTEXT.md` § Terminology (no `cell` entry)
  - Question for planner: Is a "cell" exactly a Multica squad, a per-story *instance* of a squad, or a new concept? If it's new vocabulary, should this workstream add a CONTEXT.md glossary entry so downstream stories don't drift the meaning?

- **V2** — "done-signal" / "completion marker" vs the existing `Episode` term. The draft proposes "a doc/verdict episode marker" (lines 76, 88, 138) as if new, but `execute-mode-multica` already writes `multica-run.yaml` episode markers, and CONTEXT.md defines `Episode` as the canonical step-completion record. It is unclear whether the draft means *reuse* `multica-run.yaml` or *introduce* a new marker shape.
  - Draft location: line 76 ("artifacts committed to the epic branch + episode marker terminal status")
  - Reference: `.pHive/CONTEXT.md` § Terminology (`Episode`); `execute-mode-multica/SKILL.md` (existing `multica-run.yaml`)
  - Question for planner: Does the doc/verdict done-signal reuse the existing `multica-run.yaml` episode marker (with a new terminal-derivation rule), or define a distinct marker? Naming this prevents two marker dialects.

## Hidden assumptions

- **H1** — The draft assumes a story/task can be dispatched to a **squad** as a unit ("hand `planning-team-squad` one task," line 67; "hand the planning team to `planning-team-squad`," line 18). But the research found the only dispatch helper is `dispatchStoryToAgent` — assignment to a single **agent**, not a squad. No squad-dispatch primitive was confirmed to exist.
  - Draft location: lines 67–68 ("Add a single thin 'dispatch this cell to a squad' helper … `/plan` hands `planning-team-squad` one task")
  - Why this matters: If Multica has no "assign issue to squad" API, the entire squad-as-cell carrier (the stated reuse of #230) is unbuildable as described, and the work collapses to per-persona agent fan-out — which changes scope and the serial/parallel story.
  - Question for planner: Has anyone confirmed Multica supports assigning/enqueuing work to a *squad* (vs a single agent)? Should a spike confirming squad-dispatchability be the true first prerequisite, ahead of even the schema reconciliation?

- **H2** — The draft assumes routing `/plan` through Multica has net value, while simultaneously conceding it does not (line 128: "Planning's value-add from Multica is less obvious than execution's"). The benefit of moving a cycle that is *already working* (direct/codex spawn) onto a new substrate is asserted by the goal but never grounded.
  - Draft location: line 128 ("Planning's value-add from Multica is less obvious than execution's.")
  - Why this matters: If the plan-half's payoff is marginal, the third-spawn-path complexity (U-tension below) may not be worth it, and the workstream could narrow to test-only with far less risk.
  - Question for planner: What concrete benefit does Multica-dispatched planning deliver over today's direct/codex spawn (observability? uniform substrate? autopilot triggering?) — and is that benefit worth the new spawn path?

## Unresolved tensions

- **U1** (intentional / central) — Option A "full mirror" vs Option B "lighter seam" is framed but not resolved; the draft leans B but defers to the gate.
  - Draft location: lines 54–76
  - Tension: maximal symmetry-with-/execute (two new mode skills + generalized atom) vs minimal surface (one shared helper, bespoke seam).
  - Question for planner: Which shape, and on what decision criterion — symmetry/maintainability vs surface-area/speed?

- **U2** — Read-only-docs vs the serial-against-trunk invariant. The draft says plan docs are `read-only` so "the gate is moot" (line 70) but then says fresh-checkout/rebase-push "still has to hold for whatever each *does* write" (lines 99–101). Whether planning dispatch is bound by the integration principle is left half-resolved.
  - Draft location: lines 70, 97–101
  - Tension: "read-only ⇒ no branch coordination" vs "docs/scenario/verdict YAMLs are still writes that must rebase-push."
  - Question for planner: Are doc/verdict writes subject to the full fresh-checkout/rebase-push contract, or a relaxed variant? Pin this so the marker/poller design is correct.

- **U3** — Verdict write-location divergence (surfaced by the writer during drafting): `simulated-manual.md` writes the verdict to `.pHive/cycle-state/<epic-id>.yaml` while `test/SKILL.md §8` points at the story YAML `manual_verdict` block.
  - Draft location: lines 165–166
  - Tension: two canonical homes for one verdict; a Multica `tester` can't write to "the right place" until one is chosen.
  - Question for planner: Which is canonical — cycle-state or story YAML — and does reconciling it belong with the scenario-schema prerequisite story?

## Convention violations

- **C1** — Dispatching the planning squad as a single task collapses the **per-persona backend split** that CONTEXT.md mandates: "Codex for work, Claude for verification … TPM stays on Claude" (`feedback_codex_general_backend`). `planning-team-squad` mixes codex personas (researcher/architect/technical-writer) with a Claude persona (tpm leader). One squad-task assigned to one agent runtime cannot honor that split.
  - Draft location: lines 67–68 (squad gets "one task"); cf. line 133 (Open Q3 squad-as-cell vs roster-fanout)
  - Convention: `.pHive/CONTEXT.md` § Conventions ("Codex for work, Claude for verification"); `feedback_codex_general_backend`
  - Question for planner: If a squad runs as one task on one runtime, how is the codex/claude per-persona routing preserved — or does honoring `agent_backends` force the roster-fanout shape (one issue per persona) over squad-as-one-task?

- **C2** — `Orchestrator must honor agent_backends` (`feedback_orchestrator_must_honor_backend_routing`). Today planning-routing's codex path is what enforces this. A Multica spawn path that hands work to squad/agent UUIDs must carry the same `agent_backends` routing, or it silently bypasses the cost-saving split the convention exists to guarantee.
  - Draft location: lines 54–62 (Option A new spawn path), 67–68 (Option B helper)
  - Convention: `.pHive/CONTEXT.md` § Conventions; `feedback_orchestrator_must_honor_backend_routing`
  - Question for planner: How does the Multica seam read and apply `agent_backends` per persona, given Multica agents already carry a fixed `provider` in `agents.yaml`? Is there a double-source-of-truth risk between `agent_backends` and Multica agent `provider`?

## Posture mismatches

- **P1** — Atomic-skill posture (the Mattpocock posture in CONTEXT.md; `/execute`'s `*-mode-multica` is an atomic skill). Option B proposes "a single thin … helper that both skills call" (line 67) — a shared non-skill helper invoked from two skills, which is less atomic than the `/execute` precedent (one mode-skill owning the lifecycle).
  - Draft location: lines 65–71 (Option B)
  - Posture reference: `.pHive/CONTEXT.md` § Terminology (`Mattpocock posture`, atomic skills); `execute-mode-multica` precedent
  - Question for planner: Does the lighter-seam helper compromise the atomic-skill posture, and is that trade (less surface, shared seam) explicitly accepted — or should each cycle get its own `*-mode-multica` atomic skill for symmetry?

- **P2** — User-directed composable substrate, "not a director-chair workflow" (CONTEXT.md North Star). `/plan` has user gates (design-discussion review, structured-outline sign-off). The draft does not say where those interactive gates live once the planning team runs *inside* a Multica squad task — risking a more autonomous, less user-in-the-loop planning cycle.
  - Draft location: §1 goal (lines 9–22); §6 open questions (none address the gate placement)
  - Posture reference: `.pHive/CONTEXT.md` (North Star: composable substrate, user-directed); `project_hive_2_0_milestone`
  - Question for planner: When planning is dispatched to Multica, where do the user review/sign-off gates sit — does the orchestrator still own them locally, or does Multica-planning erode the user-directed posture?

## Notes

The draft is coherent and unusually honest about its own gaps (it self-flags squad↔roster uncertainty, the done-signal gap, and the plan-value question). The grill's value here is mostly *sharpening* the central decision: H1 (is squad-dispatch even a real primitive?) and C1 (squad-as-one-task breaks the backend split) together suggest the "squad-as-cell" framing may be more aspirational than the substrate currently supports — the gate should test that assumption before committing either Option A or B.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
