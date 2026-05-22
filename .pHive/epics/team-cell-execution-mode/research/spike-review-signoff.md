# tce-1 Spike — Review Sign-Off

**Story:** `tce-1-multica-primitive-spike`
**Phase:** review (step 4 of 5)
**Role:** reviewer
**Date:** 2026-05-22
**Verdict: SIGN OFF. No replan of slice-1 required.**

---

## 1. Memo recommends confirming option (a) for slice-1 commitment — PASS

Memo §1 (Summary) and §6.1 (Recommendation) both explicitly confirm "slice-1
(tce-2) commitment to primitive (a)" as the hosting primitive. The
recommendation does not flip the slice-1 commitment; it reinforces it with
positive evidence (§2.4 — end-to-end dispatch reproduced, `parent_issue_id`
linkage observed in `issue get`, `runtime_id` assigned within the same second
as creation). Memo §6 final line: "No replan of slice-1 is warranted on the
spike evidence." Aligns with design §2.1 and hv-plan §2 Slice 1 (bootstrap
routing on (a)).

## 2. Memo characterizes (b) reassignment for failure recovery — PASS

Memo §3 dedicates a full section to characterizing (b) with verbatim
commands, an observed two-run state, and the daemon's atomic behavior
(prior `queued` run cancelled at the mutation timestamp; fresh run spawned
on the new assignee, end-to-end completion in ~27s). Memo §3.3 frames (b)
as the **failure-recovery** primitive — not a competing hosting primitive —
which is consistent with design §5 Q7's framing of "fallback path."
Recommendation §6.2 proposes updating design §5 Q7 with the positive
empirical answer.

## 3. Memo confirms (c) absence — PASS

Memo §4 reproduces the inspection (`multica --help | grep -iE 'session|cell'`
returns no matches; `multica issue --help` mentions `squad` only as an
assignee kind, not an execution primitive). Memo §4.2 verdict: "No `session`
subcommand exists at any level of Multica 0.3.4 (CLI commit `cf000d1e`)."
This re-confirms research §1.1 and outline §3.2 directly.

## 4. F5 scope-probe runbook line references tce-0 — PASS

Memo §5.3 contains a clear runbook line that names
`tce-0-f5-oauth-scope-prereq` by id and references
`.pHive/audits/multica-mode-audit-2026-05-22.md §F5` by path. The runbook
also gives the operator the exact remediation
(`multica setup self-host` to refresh the GH token with `workflow` scope).
Even though the spike charter de-scoped the halt-branch (because the spike
itself touched no `.github/workflows/**` files), the runbook line is the
deliverable form of the halt for any future-reader entering slice-1, and
it correctly cites tce-0 as the gate. AC4 is honestly scoped: the memo
does NOT falsely claim to have executed the halt-branch.

## 5. Evidence claims are testable + reproducible — PASS

Tester (`spike-test-findings.md`) independently re-ran read-only queries
against the same three throwaway issues (PLU-51/52/53) and reproduced every
claim in the memo: parent linkage, run records, runtime_id, two-run state on
PLU-53 with atomic timestamps at `2026-05-22T19:14:24Z`, help-output empty
matches for session/cell, tear-down statuses at `2026-05-22T19:21:07Z`.
Tester verdict: "All memo claims reproduce against observable Multica state."
Cross-checks out clean.

## 6. Cost note gives slice-4 planners enough info on (a)'s round-trip overhead — PASS

Memo §8 (Cost note) breaks down end-to-end latency by stage with concrete
wall-clock observations: per-issue dispatch overhead is `< 1s` for every
primitive operation (create-parent, create-child-with-linkage, runtime
assignment, reassign mutation). The (a)-child `queued → dispatched`
transition was bounded by daemon FIFO concurrency (cap = 1 observed) and
not reached in the spike window — but memo correctly attributes this to an
**operational** constraint (queue depth + per-runtime concurrency) rather
than a **primitive** deficiency. The implication for slice-4 planners is
spelled out: "parallel workflow phases inside a single team-cell will
serialize on per-runtime concurrency unless we shard across multiple
runtimes (currently 2 online: claude + codex)." This is exactly the
shape of cost information slice-4 (migration + flag flip) needs to size
realistic dispatch parallelism.

## 7. Vocabulary anchors against design §10 — PASS (with one acceptable verbatim)

Checked the three §10 inconsistency anchors:

- **`team-cell-composer`** — not used in the memo. The renamed term
  (`cell-roster-resolver` per V1) does not appear either, which is fine for
  a primitive spike (no naming surface yet).
- **`session` for cell shell** — the memo's `session` usages are all in
  context of *disconfirming* a Multica primitive (§1, §4), and one
  contextual "this session" (line 400, referring to the spike session, not
  the cell shell). No conflation with the cell-shell concept.
- **bare `phase`** — the memo uses `workflow-phase` at the load-bearing
  positions (§2 title, §2.6 verdict, §3.3 design implication, §6.1
  recommendation). Bare `phase` appears in contextual narrative
  ("research phase", "integrate phase") where it unambiguously refers to
  story-step phases. No misleading conflation between cell-internal phases
  and plan-skill Phase A/B/C/D.

One acceptable verbatim: `"session_id": "65f018f2-..."` in the daemon's
run-record JSON output (§3.2). That's verbatim daemon output, not memo
vocabulary; leave as-is.

## Minor honest scoping (NOT a sign-off blocker)

The §3.4 caveat ("(b) does NOT cancel an already-`started` run — untested")
is appropriately surfaced as a slice-1 acceptance follow-on, not as a gap
in this spike. The §5.2 "indirect probe DEFERRED per spike charter" is
honest about the charter-de-scoped item rather than overclaiming coverage.
Both are correct scoping choices.

---

## Final sign-off

The memo's recommendation **does NOT flip slice-1 commitment** to
primitive (a); it confirms it with positive end-to-end evidence and
adds (b) as the failure-recovery primitive per design §5 Q7. All six
checklist items above pass. Tester's verdict cross-checks out.

**Sign off: APPROVED. Slice-1 (tce-2) is cleared to proceed on primitive (a),
contingent on the tce-0 F5 prerequisite per §5.3.**
