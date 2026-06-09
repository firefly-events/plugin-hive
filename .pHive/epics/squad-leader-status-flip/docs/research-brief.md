# Research Brief — squad-leader-status-flip

**Epic:** squad-leader-status-flip
**Source:** triage t-001 (`.pHive/triage/queue.yaml`), priority p2 / severity moderate
**Date:** 2026-06-09
**Mode:** solo orchestrator run (operator-directed; no persona dispatch — Codex token budget constraint)

## Problem statement

Multica squad-leader orchestration issues stay stuck in `in_progress` after the
leader's run terminates. Observed 2026-06-09 on the multica-plugin-ui planning
chain: 6 issues showed `in_progress`, only PLU-312 was actually live. The five
stale parents (PLU-277, 298, 302, 305, 308) all had: leader's "Delegated"
comment posted, all child issues terminal, downstream phase issues already
created, and the phase doc committed — yet parent status never flipped.
Operator's `multica issue list --status in_progress` view is misleading as a
result. The five were manually flipped to `done` on 2026-06-09.

## Codebase findings

1. **No squad-leader brief template exists in the repo.** The stale parents'
   briefs were hand-authored in interactive orchestrator sessions, not
   skill-generated. `grep -rn 'issue update.*--status'` across `skills/` and
   `hive/` returns zero hits — no skill or reference instructs any agent to
   self-flip issue status.

2. **`plan-mode-multica` deliberately avoids squad issues.**
   `skills/hive/skills/plan-mode-multica/SKILL.md:14-15` — "The carrier is
   per-persona fan-out, not squad assignment: the S1 spike showed Multica squad
   tasks run leader-only"; line 332: "never assign one squad issue." So the
   skill-driven planning path never creates the parent issues that go stale.
   (Note: the leader-only spike verdict is DISPUTED — PLU-293 proved squads DO
   fan out when the leader has delegation instructions; see
   `feedback_squad_spike_leader_underinstructed`.)

3. **`execute-mode-multica` HAS a squad mode** (`execution.multica.squad`,
   SKILL.md:50) where "Multica's squad leader agent delegates phases to
   members" — same stale-parent exposure exists there when squad mode is used.

4. **`squad.instructions` is a working injection surface.** The PLU-293 spike
   (project_squad_doctrine_layer) proved the squad leader reads and honors
   `squad.instructions` content (leader echoed a DOCTRINE-ACK marker that lived
   only there). This is the natural carrier for a terminal-protocol rule that
   binds every leader run regardless of how the brief was authored.

5. **Dispatch lib surface.** `hive/lib/multica-story-dispatch/index.mjs:386`
   exports `dispatchStoryToSquad(...)` — PUT assignment only; no completion
   sweep exists anywhere. No code path flips a parent issue on
   children-terminal.

6. **Multica CLI supports the fix primitives.** `multica issue update <id>
   --status done` works (verified during cleanup); `multica issue comment list
   <id>` exposes the summary-comment check; `multica issue list --status
   in_progress --output json` gives the sweep input. `multica squad update`
   exists for instructions edits.

## Prior decisions (KG)

`python3 -m hive.lib.kg_why "multica squad leader issue status flip"` — no
matching decisions. Clean slate.

## Validation note

No third-party library surface involved (Multica CLI + repo-local Python).
context7 not consulted — confidence high, codebase-only research sufficient.

## inconsistency_risk_signals

- `plan-mode-multica` doctrine ("never squad issues") contradicts live practice
  (squad-leader chains run interactively) AND the disputed spike verdict. A fix
  that touches that skill risks re-litigating the per-persona carrier decision
  — keep the terminal contract OUT of plan-mode-multica.
- t-001 id collision: a prior triage iteration used t-001 for the
  insight-capture gap (feedback_multica_skips_insight_capture). Distinct gap;
  cross-link, don't merge.
- Charter language policy: any new sweep tooling must be Python
  (stdlib-first), not Node — `multica-story-dispatch` is a named bridge but new
  business logic belongs in Python.
