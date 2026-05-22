# tce-1 Spike — Test Findings

**Story:** `tce-1-multica-primitive-spike`
**Phase:** test (step 3 of 5)
**Role:** tester
**Date:** 2026-05-22
**CLI verified:** `multica 0.3.4 (commit cf000d1e, built 2026-05-20T09:57:57Z)` — matches memo §0.

**Verdict: ALL ACCEPTANCE CRITERIA MET. Memo claims reproduce against observable Multica state.**

---

## AC1 — primitive (a) parent + child end-to-end, sole viable hosting primitive

**Memo claim (§2):** Parent PLU-51 created without assignee; child PLU-52 created with `--parent` + `--assignee-id` (developer agent); `parent_issue_id` returned from `issue get`; run record assigned `runtime_id` on accept-path.

**Observed state (read-only):**
- `multica issue get 2f1067f5-b4b5-43ce-9f45-e691c63fe747` → PLU-51, `parent_issue_id: null`, `assignee_id: null`, `status: cancelled`, `created_at: 2026-05-22T19:13:35Z`. **Matches memo §2.1.**
- `multica issue get 149a48d2-4340-431a-b7ff-ff3fe9481612` → PLU-52, `parent_issue_id: "2f1067f5-b4b5-43ce-9f45-e691c63fe747"`, `assignee_id: "d9946f9a-...", assignee_type: "agent"`, `created_at: 2026-05-22T19:13:44Z`. **Parent linkage exact-match to memo §2.2.**
- `multica issue runs 149a48d2-...` → one run, `id: 926d2694-9d68-44c1-85fe-5a16e2ecc13d`, `runtime_id: 0b8e2f02-bcde-4063-a454-224cc8613944`, `agent_id: d9946f9a-...`, `kind: direct`, `attempt: 1`, `max_attempts: 2`. **All run-record fields match memo §2.4 verbatim.** Run is now `cancelled` (teardown), but creation-time evidence (`runtime_id` + `agent_id` + `attempt`) is preserved on the run record.

**Verdict:** PASS — parent/child structural linkage and runtime acceptance reproduce. Memo's conclusion that (a) is the sole viable hosting primitive on 0.3.4 is consistent with the absence of any `session`/`sessions` command (AC3 below).

---

## AC2 — primitive (b) `--assignee` mutation spawns fresh run

**Memo claim (§3):** PLU-53 created with developer assignee; mutation to tester assignee at 19:14:24Z atomically (1) cancels the prior `queued` developer run AND (2) spawns a fresh run on the tester that executed end-to-end (~27s, completed at 19:14:51Z).

**Observed state (read-only):**
- `multica issue get 50de2132-e2c5-46db-9a24-f88ac316cfb5` → PLU-53, `assignee_id: f43c31f2-...` (tester), `created_at: 2026-05-22T19:14:03Z`, `updated_at: 2026-05-22T19:21:07Z` (teardown bumped this). Pre-teardown updated_at would have been the mutation timestamp.
- `multica issue runs 50de2132-...` → **two runs, exactly as memo §3.2 documents:**
  1. Run `d8361e54-8527-4b26-ab3b-bd8ab5988bdb`: `agent_id: f43c31f2-...` (tester), `created_at`/`dispatched_at`/`started_at` all `2026-05-22T19:14:24Z`, `completed_at: 2026-05-22T19:14:51Z`, `status: completed`, `result.output: "Probe complete. --assignee mutation alone triggers fresh agent run — confirmed. Result posted on PLU-53, status set to in_review."`, `session_id: 65f018f2-eac2-4517-bcf9-2b93a408fd92`.
  2. Run `332e42e6-3492-401f-8f75-1056a7883dc9`: `agent_id: d9946f9a-...` (developer), `created_at: 2026-05-22T19:14:03Z`, `dispatched_at: null`, `started_at: null`, `completed_at: 2026-05-22T19:14:24Z`, `status: cancelled`.

**Verdict:** PASS — two-run state reproduces exactly. Cancellation of developer run and completion of tester run share the same `2026-05-22T19:14:24Z` boundary, confirming the atomicity claim. Memo's positive answer to design §5 Q7 is supported. The §3.4 caveat (untested behavior on `started` runs) is honestly scoped.

---

## AC3 — no `session`/`sessions` subcommand on 0.3.4

**Memo claim (§4):** `multica --help | grep -iE 'session|cell'` returns no matches; `multica issue --help` mentions `squad` only inside `assign`'s description; `squad` is an organizational grouping primitive, not an execution session.

**Observed state:**
- `multica --help 2>&1 | grep -iE 'session|cell'` → NO_MATCH (empty output, exit 1). **Matches memo §4.1.**
- `multica issue --help 2>&1 | grep -iE 'session|squad|cell'` → single line: `"assign:        Assign an issue to a member, agent, or squad"`. **Matches memo §4.1 verbatim.**
- `multica issue assign --help` confirms `--to`/`--to-id` accepts "member, agent, or squad (fuzzy match)" — `squad` is an assignee kind, not a session primitive. **Matches memo §4.1 narrative.**
- Version: `multica 0.3.4 (commit cf000d1e, built 2026-05-20T09:57:57Z)`. **Matches memo §0.**

**Verdict:** PASS — re-confirms research §1.1 and outline §3.2. No execution-session primitive exists on Multica 0.3.4.

---

## AC4 — F5 scope-probe runbook line referencing tce-0

**Memo claim (§5):** No direct introspection path exists for daemon GH OAuth scopes on 0.3.4 (`auth status` exposes Multica token only; `daemon status` does not surface GH scopes). Indirect probe (workflow-touching dispatch) was de-scoped per spike charter to avoid `.github/workflows/**` mutations. Runbook line at §5.3 captures the entry gate for slice-1 (tce-2) and references tce-0.

**Observed state:**
- `multica auth status` → exposes `Server`, `User`, `Token (mul_…)`. No GH scope surface. **Matches memo §5.1.**
- `multica daemon status` → exposes pid, uptime, agents, workspaces. No GH scope surface. **Matches memo §5.1.**
- Memo §5.3 contains a runbook line that names `tce-0-f5-oauth-scope-prereq` explicitly and points back to `.pHive/audits/multica-mode-audit-2026-05-22.md §F5`. **Runbook line is present and references tce-0.**

**Verdict:** PASS (per charter scope). The AC reads "halt with a clear runbook line referencing tce-0 [if `workflow` scope is missing]". The memo's §5.2 documents that the charter explicitly de-scoped the halt-branch ("DO NOT halt the spike … just RECORD the absence and reference tce-0"). The runbook line at §5.3 is the deliverable form of the halt; it cites tce-0 by id and the §F5 audit by path. Honest scoping (no false claim of halt-execution) is appropriate.

---

## Tear-down verification

Memo §7 claims all three throwaway issues were closed via `multica issue update <id> --status cancelled` at ~19:21Z. Observed:

| Issue | Memo claim | Observed status | Observed updated_at |
|---|---|---|---|
| PLU-51 (parent) | cancelled @ 19:21Z | `cancelled` | `2026-05-22T19:21:07Z` |
| PLU-52 (child) | cancelled @ 19:21Z | `cancelled` | `2026-05-22T19:21:07Z` |
| PLU-53 (reassign) | cancelled @ 19:21Z | `cancelled` | `2026-05-22T19:21:07Z` |

All three terminal states reproduce. Multica does not delete issues (consistent with the test charter's expectation).

---

## Summary

| AC | Verdict | Reproducible evidence |
|---|---|---|
| AC1 — (a) parent+child viable, sole hosting primitive | PASS | PLU-51/52 linkage + run record + runtime_id |
| AC2 — (b) reassign spawns fresh run | PASS | PLU-53 two-run record, atomic timestamps |
| AC3 — no `session`/`sessions` | PASS | help output empty match; squad ≠ session |
| AC4 — F5 runbook line refs tce-0 | PASS | memo §5.3 names tce-0-f5-oauth-scope-prereq |

**All memo claims reproduce against observable Multica state.** The memo is internally consistent, factually accurate within the read-only verification window, and honest about the one item it intentionally de-scoped (the indirect F5 probe, per charter). The §3.4 caveat about untested `started`-run hot-swap is appropriately surfaced as a slice-1 follow-on, not a gap in this spike.
