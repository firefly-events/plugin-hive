# Design Discussion — squad-leader-status-flip

**Epic:** squad-leader-status-flip
**Input:** triage t-001 + research-brief.md
**Date:** 2026-06-09
**Mode:** solo orchestrator run; collaborative review skipped (no team this run); grill folded inline (§5)

## §0 Prelude

- git_flow: base_branch=`develop`, branch_strategy=`per-epic` (resolved at plan time)
- PRIOR DECISIONS: none (kg_why returned zero matches)
- Note: solo run — researcher/writer personas not dispatched; orchestrator authored all docs directly per operator instruction (Codex budget constraint + Fable 5 routing change landed this session, commit 004f151).

## §1 Goal

Squad-leader parent issues must reach a terminal status when the leader's work
is done, so `multica issue list --status in_progress` reflects reality. Two
mechanisms: (a) a binding terminal protocol the leader itself executes, and
(b) a sweep tool that detects and repairs stale parents when (a) fails.

## §2 Proposed approach

Triage t-001 named three forks. Resolution:

- **Fork A (leader-side rule) — ACCEPT, but carrier changed.** t-001 assumed a
  "squad-leader brief template" file; research shows none exists (briefs are
  hand-authored). The durable carrier is **`squad.instructions`** on the Multica
  squad itself — proven injection surface (PLU-293 DOCTRINE-ACK spike). A
  repo-canonical contract doc defines the protocol; the live
  `planning-team-squad` instructions get the contract appended. Every future
  leader run inherits it regardless of who authors the brief.
- **Fork B (driver-side sweep) — ACCEPT in lite form.** Not a daemon hook into
  dispatch (deferred with the rest of the squad-doctrine layer); instead a
  standalone Python sweep script the operator (or a cron/loop) runs: find
  `in_progress` squad-assigned parents whose children are all terminal and/or
  whose last update exceeds an age threshold, report, and `--apply` flips them
  to `done`. This is also the verification instrument for Fork A's metric.
- **Fork C (upstream Multica auto-complete) — DEFER.** Out of this epic's
  scope; needs upstream PR. The contract doc records the desired upstream
  semantics so the ask is ready when we file it.

Terminal protocol (the contract, summarized):
1. Leader confirms all delegated child issues are terminal (`done` /
   `cancelled` / `in_review` accepted by parent policy).
2. Leader posts the final summary comment on its parent issue (existing
   convention, now binding).
3. Leader runs `multica issue update <own-issue-id> --status done` as its LAST
   action. The leader's own issue UUID is always present in its task context.
4. If the leader cannot complete (children stuck), it posts a BLOCKED comment
   instead and leaves status `in_progress` — stale-by-intent, visible to sweep.

## §3 Risks

- **Leader ignores instructions** (model drift, truncated context): mitigated
  by sweep (sls-3) as backstop; PLU-293 spike showed instructions are honored.
- **Self-flip races a still-running child:** protocol orders self-flip strictly
  after children-terminal check; sweep double-checks the same invariant before
  `--apply`.
- **Sweep false-positive** (flips a genuinely active parent): sweep requires
  BOTH all-children-terminal AND a minimum quiet age (default 30 min), and is
  report-first / `--apply` opt-in.
- **`squad.instructions` overwritten** by future squad reconfig: contract doc
  in repo is the source of truth; sls-2 acceptance includes re-apply procedure.

## §4 Dependencies

- Multica CLI ≥ current local version (squad update, issue update, comment list).
- Live `planning-team-squad` in workspace 21c6d282 (exists).
- Python 3 stdlib only (charter: stdlib-first; no new deps).

## §5 Grill (folded inline — solo run)

- *Vocabulary:* "terminal" for children = includes `in_review`? Members
  routinely stop at `in_review` (PLU-298 thread). Contract treats `in_review`
  as terminal-for-delegation once the leader has consumed the output —
  explicit in sls-1 doc. **Resolved.**
- *Hidden assumption:* leader knows its own issue UUID — verified: task context
  carries it (PLU-277 brief referenced "--parent <this issue uuid>").
- *Tension:* plan-mode-multica forbids squad issues while this epic
  legitimizes squad-leader runs. Out of scope to reconcile here; contract doc
  scopes itself to interactively-driven and execute-mode squad runs and does
  NOT amend plan-mode-multica. **Accepted deviation.**
- *Convention:* new script must be Python under `scripts/` (charter) — named
  `scripts/multica-sweep-stale-parents.py`.

## §6 Scale assessment

**Small.** 3 stories, ~4 files, one subsystem (Multica ops tooling + one live
config surface). Design discussion sufficient context → proceed to Phase C
(stories). No H/V, no structured outline.

## §7 Open questions (for operator at confirm gate)

1. Version bump: this adds a public-ish script + reference doc — patch or none?
2. Should the sweep also cover agent-assigned (non-squad) parents? (Default:
   yes — same invariant applies; PLU-312-style direct-agent issues flip
   correctly today, so sweep would simply find nothing.)
