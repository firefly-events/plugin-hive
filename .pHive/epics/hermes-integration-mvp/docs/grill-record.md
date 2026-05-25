# Grill Record — hermes-integration-mvp

**Source draft:** `.pHive/epics/hermes-integration-mvp/docs/design-discussion.md`
**CONTEXT.md substrate:** present
**inconsistency_risk_signals:** present (6 signals from research-brief)
**Generated:** 2026-05-24T00:00:00Z

## Summary

- Vocabulary mismatches: 2 findings
- Hidden assumptions: 4 findings
- Unresolved tensions: 2 findings
- Convention violations: 2 findings
- Posture mismatches: 1 finding

## Vocabulary mismatches

- **V1** — "orchestrator" used for both Hive's in-session ephemeral role AND Hermes's cross-session coordinator role.
  - Draft location: §1 line "Hermes-as-persistent-orchestrator", §4 medium-risk row, §6 Q5
  - Reference: `.pHive/CONTEXT.md` Terminology — "Orchestrator" (implicit) reserved for the in-session Claude Code instance; standup.SKILL.md "Daily restart model" reinforces
  - Question for planner: pick the rename now (liaison / shepherd / coordinator / external-coordinator / driver / supervisor) and apply consistently across draft + epic title + skill names, or commit to "orchestrator" with a documented disambiguation convention. Leaving the choice in Q5 propagates ambiguity into story specs.

- **V2** — "skill" used for Hermes capability ("Hermes's skills system already does this") shadows CONTEXT.md's definition of skill as a Hive auto-discovered `SKILL.md`.
  - Draft location: §2 "Hermes claims parity with Claude Code skill model" (paraphrased); §5 external deps
  - Reference: `.pHive/CONTEXT.md` Terminology — "Skill — an auto-discovered capability at `skills/{name}/SKILL.md`"
  - Question for planner: distinguish "Hive skill" vs "Hermes skill" explicitly when both appear in the same paragraph, or use "Hermes capability" / "Hermes tool" for the foreign system. Low-severity but compounds if Slice 2/3 stories reference both.

## Hidden assumptions

- **H1** — Slice 1 assumes Hermes can read `.pHive/` directly without authentication.
  - Draft location: §3 Slice 1 ("Hermes calls this skill (or reads its output file) from Mac Studio")
  - Why this matters: cross-machine reality differs by sync protocol (Q1). If Hermes pulls via git, file is stale; via SSH, needs auth + workstation always-on; via shared FS, needs mount + coupling. The skill design changes per choice.
  - Question for planner: defer Slice 1 implementation until Q1 (sync protocol) is answered, or design context-snapshot to be transport-agnostic (file-on-disk + optional push endpoint) so any sync protocol works.

- **H2** — §6 Q1 treats "git pull, SSH, or shared filesystem" as substitutable options.
  - Draft location: §6 Q1
  - Why this matters: they have very different staleness, latency, failure modes, and operator overhead. Treating them as equivalent in the open question hides the real decision shape.
  - Question for planner: split Q1 into "what's the staleness budget?" (drives protocol choice) + "what's the failure budget?" (drives recovery design) instead of asking the operator to pick a transport blind.

- **H3** — Slice 3 assumes Mac Studio can SSH into the dev workstation.
  - Draft location: §3 Slice 3 ("Hermes-side Slack bot ... invokes /hive:triage via SSH/remote shell against the dev workstation")
  - Why this matters: workstation may sleep, may be off-network (laptop closing lid), may not have SSH enabled, may not have key configured. None of those stated as constraints.
  - Question for planner: name the assumed-reachable host explicitly (Mac Studio itself? this workstation? a third box?) and the network/auth posture, OR design Slice 3 to enqueue via a sync protocol that doesn't require live shell.

- **H4** — §4 medium claim "missing a daily run is recoverable next run" assumes standup idempotency.
  - Draft location: §4 medium-risk row on Mac Studio SPOF
  - Why this matters: Phase 1 standup is read-shaped (recoverable). Phase 2 planning + Phase 3 execution under `under_scheduler.auto_approve: true` are NOT inherently idempotent — auto-approving a planning step and then missing the execution kickoff could leave a half-spawned cycle. The recovery claim conflates standup-the-skill with standup-the-Phase-1.
  - Question for planner: scope the daily-cron run to Phase 1 + report-only at MVP (Hermes posts the report; operator clicks to approve/execute later), or accept the auto-approve risk and define a recovery procedure if a cron run dies mid-phase.

## Unresolved tensions

- **U1** — Cross-repo strategy: draft §3 implies Slice 1 needs Hermes-side consumer to be useful, but §6 Q2 + §5 cross-repo note say this epic ships Hive contracts only.
  - Draft location: §3 Slice 1 vs §5 "Hermes-side code lives in `~/Code/hermes-agent`" vs §6 Q2
  - Tension: shipping a contract surface with no consumer is a posture commitment, not an MVP. Either Hermes-side ships in this epic (then it's a cross-repo epic) or contracts ship alone (then "MVP" is a scaffolding milestone, not a working slice).
  - Question for planner: choose — (a) cross-repo epic, with sibling Hermes-side stories tracked here; (b) Hive-side scaffolding epic, MVP framed as "ready for Hermes consumer"; (c) split: this epic does (b), follow-on epic `hermes-bridge-mvp` does Hermes-side. Pick before story decomposition.

- **U2** — Slice 2 says "Hive side: zero changes required" but §7 verification + §3 Slice 2 trailer both mention a `--format slack` flag.
  - Draft location: §3 Slice 2 ("Hive side: zero changes required") vs §3 Slice 2 trailer ("add a `--format slack` flag") + §7 verification automated entry
  - Tension: "zero changes" and "add a flag" contradict. Either Slice 2 has Hive changes (and the value of zero-change is rhetorical) or the flag belongs in a follow-on slice.
  - Question for planner: commit to one — either Slice 2 includes the Slack format flag (so it has 1+ Hive changes), or Slice 2 ships with whatever standup already outputs and the flag is a stretch story (or out of scope entirely if Slack accepts current output well enough).

## Convention violations

- **C1** — Cross-repo work without explicit branch posture commitment violates `feedback_git_flow_per_epic` (one branch per epic).
  - Draft location: §5 cross-repo paragraph
  - Convention: memory `feedback_git_flow_per_epic` — "branch is feat/<epic-id>; each story is one commit on it"
  - Question for planner: confirm — this epic's branch `feat/hermes-integration-mvp` exists only on plugin-hive; any Hermes-side work goes on a Hermes-repo branch with the same name; explicitly document in epic.yaml that the "one branch per epic" convention applies per-repo for cross-repo epics?

- **C2** — Compressed planning mode bypasses `agent_backends` codex routing (researcher/writer/architect should route through codex per root config + `feedback_orchestrator_must_honor_backend_routing`).
  - Draft location: cycle-state `planning_mode.deviation_from_skill` (not draft proper, but the surrounding posture)
  - Convention: `hive.config.yaml` `agent_backends:` + `feedback_orchestrator_must_honor_backend_routing` memo (2026-05-09 user flag)
  - Question for planner: accept the deviation (planning artifacts low-volume, parallel codex race is real) and document the rule "compressed planning may bypass `agent_backends` when justified in cycle-state", OR back out and run the full ceremony with serial codex dispatches. The cycle-state note exists but the rule isn't generalized — Phase B collab review SHOULD still spawn architect + tpm via the configured backend.

## Posture mismatches

- **P1** — §1 framing "Hermes-as-persistent-orchestrator" perpetuates the director-chair framing CONTEXT.md explicitly rejects (Hive 2.0 north star is "composable substrate, user-directed").
  - Draft location: §1 vector 1 name
  - Posture reference: `.pHive/CONTEXT.md` — "The North Star (post-CWC 2026) is a **composable substrate, user-directed** — not a director-chair workflow"; `feedback_visibility_vs_trust` memo
  - Question for planner: rename vector 1 to something like "Hermes-as-external-coordinator" or "operator-shepherding context layer" that frames Hive as substrate and Hermes/operator as director, then reflect that posture in slice 1's API design (read-only snapshot, no callback registration, no "Hermes told Hive to do X" surfaces). The current "orchestrator" framing risks slipping into director-chair Hermes-side automation that bypasses operator approval.

## Notes

- Draft's §0 KG pre-flight note + cycle-state KG-broken capture are aligned. The `kg_why` Python 3.13 break is a real out-of-scope follow-on; the draft handles it correctly by treating as zero results + flagging as risk.
- Draft's §3 ordering (slice 1 → 2 → 3) puts the highest-novelty contract surface last, which is the right risk shape (validate scheduling-as-cron with existing Routines contract first, then add new triage-write surface last).
- The draft is unusually self-aware about Hermes's design output's confusion between "Hermes joins Hive" vs "Hermes calls Hive over a stable contract" — §4 medium-risk row + §6 Q4 + P1 above all circle the same posture concern. Resolving P1 + V1 in concert would clean up the bulk of the cross-system framing.
- Heuristic pass observation (not a finding): draft's verification plan §7 is thin on the cross-machine dimension — no explicit test of "what happens when Mac Studio is asleep when cron fires" or "what if workstation rolls back a commit between Hermes reads". Worth surfacing in elicitation during structured outline phase.

## Out of scope (this pass)

Grill does NOT propose solutions, score quality, gate work, or prioritize findings. Each finding ends with a question for the planner; the planner's job is to revise the draft (or document accepted deviations) before stories are written.
