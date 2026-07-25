---
name: observe
description: Non-blocking, constructive, suggestion-only implementation-time advisor procedure. Authoritative procedure bound to hive/agents/pair-programmer.md; never emits a gate verdict and never gates the work it advised on.
---

# Hive Observe

**Authoritative advisor procedure, NOT inline persona prose.** This skill is bound to `hive/agents/pair-programmer.md`'s `skills:` frontmatter entry and governs how implementation-time advice runs once that binding is resolved and loaded — see `hive/lib/skill_binding.py::resolve_skill_binding`. It owns the advisor-only output contract: constructive, concise, suggestion-only advice with no `change_verdict`, no gate artifact, no blocking instruction, and no code modification. It does NOT own any trust-gate verdict. `skills/review/SKILL.md`'s `passed | needs_optimization | needs_revision` gate is unchanged and untouched by this skill — see "What this skill is NOT".

**Input:** `$ARGUMENTS` contains the implementation-sidecar context already gathered at the invocation seam: the story spec, the research brief, and the developer's proposed approach or in-progress implementation — the same context `skills/execute/references/sequential-execution.md`'s implementation-sidecar invocation already assembles before spawning the advisor.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

If the kickoff checks pass, proceed silently.

## Process

1. **Load the implementation context.** Read the story spec, the research brief, and the developer's proposed approach or current implementation state from `$ARGUMENTS`. Do not read files outside what the caller supplied — this skill has no independent exploration mandate.
2. **Evaluate the approach.** Validate soundness, challenge assumptions the developer is taking for granted, surface simpler alternatives or existing utilities, and anticipate edge cases and failure modes. When the approach is sound, say so briefly.
3. **Produce advisor-only output.** Emit constructive, concise, suggestion-only advice in the shape below. Never emit a verdict, a gate artifact, a blocking instruction, or a code change — this skill advises; it does not decide and does not implement.

   ```markdown
   ## Observe Advice

   **Assessment:** {endorse | concern}

   {1-3 paragraphs: lead sentence with the core assessment, supporting rationale or alternative, and — if anything is actionable — a recommendation for the developer to accept or decline.}
   ```

4. **Reject gate authority at the source.** This skill's output MUST NOT contain a verdict field such as `change_verdict`, a machine verdict such as `needs_optimization` or `needs_revision`, a gate artifact (e.g. a `review.yaml`-shaped structure), or a pipeline-control instruction. Ordinary evidence remains valid English: “tests passed”, “use the approved dependency”, and “the parser rejected malformed input” do not claim gate authority. A payload that does claim or imply a gate decision is invalid and must be rejected by the caller's contract validation rather than passed downstream as advice.
5. **Emit the skill-owned invocation marker.** Wherever the calling seam records step outputs (the implementation-sidecar seam in `skills/execute/references/sequential-execution.md`, or the DAG `AgentHandler`'s `config.skill_binding` opt-in), the marker is `skill_invoked: skills/observe/SKILL.md` — durable evidence that this skill, not residual persona prose, governed the run. A caller that spawns `hive/agents/pair-programmer.md` without resolving and loading this binding has an inert binding, not working advisor output; a frontmatter `skills:` entry without invocation is rejected as inert.
6. **Stop — do not gate.** This skill's Process ends here. It does not evaluate the work it advised on, does not compute or emit a gate verdict, and does not write a gate artifact. The agent instance that produced this advice MUST be a distinct instance from whichever agent instance later serves as the reviewer gate on the same work — an agent that advised never reviews (self-review is out of bounds regardless of composition).

## What this skill is NOT

- **Not the reviewer gate.** `skills/review/SKILL.md` remains the sole procedure that computes `change_verdict` and owns the fail-closed `passed | needs_optimization | needs_revision` gate. This skill never emits that vocabulary and never substitutes for it.
- **Not a dual-mode skill.** Observe is one responsibility — advisor-only. It does not switch into a gating mode under any input, argument, or configuration. Advisor and gate stay two composed responsibilities (D2), never one skill wearing two hats.
- **Not blocking.** Observe output never halts, gates, or conditions step advancement. The implementation-sidecar seam that invokes this skill treats its output as advisory input only, never as a pass/fail signal.
- **Not code modification.** This skill produces advice text only. It never writes, patches, or proposes a diff against implementation files.
- **Not self-review.** An agent instance that ran this skill as advisor on a piece of work never serves as the reviewer gate on that same work, regardless of how the two steps are composed or scheduled.
- **Not the pair-programmer persona.** `hive/agents/pair-programmer.md` supplies identity, tone, and posture. This skill is the procedure; the persona is not a substitute procedure and must not be spawned in its place without loading this file.

## Atomic-skill invariants

- **Top-level skill** at `skills/observe/SKILL.md` (auto-discovered), within the 800-line skill-size cap.
- **Single binding target** — bound exclusively to `hive/agents/pair-programmer.md` via that persona's `skills:` frontmatter entry.
- **Advisor-only output** — no `change_verdict`, no gate artifact, no blocking instruction, no code modification. A fixture that claims or implies a gate verdict is rejected by contract validation.
- **Distinct-instance composition** — the advisor invocation and the later reviewer invocation are separate agent instances with distinct instance IDs; the existing reviewer trust gate (`skills/review/SKILL.md`) is unchanged and is the sole gate.
- **Fail-closed** — a missing binding or unreadable skill file raises `SkillBindingError` at the calling seam; there is no persona-only fallback, and a frontmatter binding declaration without an actual invocation is inert, not advice.
- **Stateless across invocations** — each observe run produces one Observe Advice block; no incremental state carried between runs.

## Hand-off

1. A caller (the implementation-sidecar seam in `skills/execute/references/sequential-execution.md`) resolves `hive.lib.skill_binding.resolve_skill_binding("hive/agents/pair-programmer.md", "<matching use-when trigger>")` for the observe binding, as a distinct agent instance from the step's developer and from the later reviewer.
2. This skill's Process governs the run and produces the Observe Advice block plus the `skill_invoked` marker.
3. The caller attaches the advice to the implement step's output as advisory-only context. The developer decides whether to act on it; nothing about advancing the step depends on the advice's content.
4. When the story later reaches its review step, `skills/review/SKILL.md` runs unchanged, on a distinct reviewer agent instance, and is the sole owner of the gate verdict. This skill ends at step 2 — it does not participate in review and is never consulted for the verdict.

## Out of scope

- Computing or emitting `change_verdict`, or producing any gate artifact — that stays `skills/review/SKILL.md`'s exclusive remit.
- Serving as, or influencing the selection of, the reviewer instance for work this skill advised on.
- A dual advisor/gate mode, a new verdict vocabulary, or a provenance heuristic that infers trust from advisor involvement — D2 forecloses all three.
- Code modification, diff proposals, or file writes — advice text only.
- Catalog `skill:` dispatch or trigger-ID-specific routing — routing stays on `placement` + `responds_with.type`.

## See also

- [`hive/agents/pair-programmer.md`](../../hive/agents/pair-programmer.md) — bound persona (identity, tone, posture)
- [`skills/review/SKILL.md`](../review/SKILL.md) — unchanged, sole owner of the gate verdict; distinct instance from this skill's advisor
- [`skills/execute/references/sequential-execution.md`](../execute/references/sequential-execution.md) — implementation-sidecar invocation seam that resolves this binding
- [`hive/lib/skill_binding.py`](../../hive/lib/skill_binding.py) — the shared match-resolve-load-invoke resolver
- [`hive/references/quality-gates.md`](../../hive/references/quality-gates.md) — absolute no-self-review rule this skill's distinct-instance invariant enforces
- [`skills/write-skill/template.md`](../write-skill/template.md) — canonical full SKILL.md format this file follows
