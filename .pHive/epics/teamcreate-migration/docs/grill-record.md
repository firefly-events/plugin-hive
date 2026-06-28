# Grill Record — teamcreate-migration

**Source draft:** `.pHive/epics/teamcreate-migration/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** absent (heuristic pass — design node received only `requirement`; no research-brief wired into this node)
**Generated:** 2026-06-28 (point-in-time adversarial pass)

## Summary

- Vocabulary mismatches: 1 finding
- Hidden assumptions: 1 finding
- Unresolved tensions: 2 findings
- Convention violations: 1 finding
- Posture mismatches: clean

## Vocabulary mismatches

- **V1** — The draft uses "swarm" and "team" as if they name distinct, well-defined scopes,
  but CONTEXT.md's glossary defines *team* (specialist team, team-lead) and never defines
  *swarm*. The PLAN-Q-006 section asserts `SendMessage` is "intra-team" while filesystem
  handoffs are "cross-swarm" — the reader must infer that a swarm is a wider unit than a team
  without that relationship ever being stated.
  - Draft location: §1 "What Are We Doing?" ("`SendMessage` is intra-team … filesystem handoffs
    are cross-swarm") and §3 (PLAN-Q-006 trust-boundary section).
  - Reference: `.pHive/CONTEXT.md` Terminology (defines *team*, no *swarm* entry);
    `hive/references/cross-swarm-handoff.md` (uses "swarm" for planning→dev→test phases).
  - Question for planner: When the new trust-boundary text lands in `cross-swarm-handoff.md`,
    should it explicitly define the team⊂swarm containment (team = ephemeral intra-session
    coordination unit; swarm = phase-level durable unit), or align to a single existing term?

## Hidden assumptions

- **H1** — The draft treats the existing cmux `surface.*` section of `agent-teams-guide.md` as
  "a working model for what the post-migration default should read like." But cmux is a
  *different dispatch mechanism* (orchestrator poll-loop spawning per story), not the
  natural-language auto-spawn model. Borrowing cmux prose as the template for the default tmux
  auto-spawn path assumes the two converge, which they may not.
  - Draft location: §2 "What I Found" ("That cmux section is a working model for what the
    post-migration default should read like") and §3 (tier B/C rewrite).
  - Why this matters: if the auto-spawn default and the cmux poll-loop differ in how
    dependencies unblock or how completion is signaled, modeling the default on cmux prose
    propagates a wrong mental model into the canonical guide.
  - Question for planner: Should the rewrite derive the default-path prose from the v2.1.178
    auto-spawn semantics directly (natural-language team description, runtime-managed
    dependencies) rather than from the cmux section, keeping cmux as a clearly-separate variant?

## Unresolved tensions

- **U1** — The draft both proposes paying down PLAN-Q-001 by "demoting the env flag from hard
  gate" (§3) and warns at **[high]** that removing the gate flips projects that relied on it
  being unset into parallel execution (§4), then leaves the disposition open (§6 Q2/Q3). The
  "fix the stale caveat" goal and the "don't silently change execution behavior" constraint are
  surfaced but not reconciled.
  - Draft location: §3 ("demote the env flag from hard gate to a no-op/compat shim"), §4 [high]
    env-flag risk, §6 Q2 and Q3.
  - Tension: cleaning up a doc-stale gate vs. preserving the only switch some users currently
    use to force sequential execution.
  - Question for planner: Is the resolution a compat no-op (flag still readable, ignored, with
    `parallel_teams` becoming the sole gate) — and should that decision be locked in the outline
    rather than left as a gate-time open question, given it is a behavior change?

- **U2** — The draft schedules tier-D test edits (rewrite `check-agent-misuse` assertions) as
  step four of §3, but §4 [high] and §6 Q1 say the hook itself may need redesign and that the
  redesign decision is a *prerequisite* to the test edits. The plan order (edit tests) and the
  dependency (decide hook fate first) are not reconciled.
  - Draft location: §3 step "Fourth, tier D — tests", §4 [high] hook risk, §6 Q1.
  - Tension: the sequence lists test edits as ordinary cleanup, but they cannot be authored
    until the open hook-redesign question is answered.
  - Question for planner: Should the outline split the hook into its own story gated on the Q1
    decision, so tier-D test edits don't get authored against an undecided contract?

## Convention violations

- **C1** — The draft edits JavaScript test files (`execute-parallel-gate.test.js`,
  `check-agent-misuse.*.test.js`) and asserts in §5 that this is "allowed maintenance, not new
  bridge code." CLAUDE.md's language policy forbids new Node/JS *outside named bridge surfaces*
  and tests are not a listed bridge; the draft's self-clearance is plausible but unconfirmed.
  - Draft location: §5 Dependencies and Constraints ("the JS test edits touch `tests/` which is
    allowed maintenance, not new bridge code. No new Node.").
  - Convention: `CLAUDE.md` → Language Policy ("New Node, JavaScript, TypeScript … files outside
    those surfaces require explicit maintainer approval").
  - Question for planner: Is *modifying assertions in existing JS test files* in-policy as
    maintenance, or does it need the same explicit maintainer approval new JS would — and should
    the outline record that ruling so the executor doesn't stall on it?

## Posture mismatches

Clean. The draft preserves atomic-skill boundaries (explicitly keeps grill and design-discussion
separate, §5), keeps the composable-substrate framing, and routes the heavier decisions to a
structured outline + gate rather than collapsing them into prose. The "Needs structured outline"
recommendation is consistent with the user-directed posture because it surfaces the open
decisions to the user at the gate rather than auto-deciding them.

## Notes

The draft is well-grounded against the codebase (file:line citations throughout) and correctly
expands the requirement's "17+ files" undercount to the real ~40-file / 88-hit blast radius.
The literal-vs-conceptual split (tier A runtime-breaking strings vs. tier C/E conceptual labels)
is the draft's strongest structural insight and should survive revision intact.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding
ends with a question for the planner; the planner revises the draft (or documents accepted
deviations) before stories are written.
