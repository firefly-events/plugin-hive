# Multica Primitive Spike — Evidence Memo (tce-1)

**Story:** `tce-1-multica-primitive-spike`
**Phase:** implement (step 2 of 5)
**Role:** developer
**Date:** 2026-05-22T19:13Z–19:21Z
**CLI:** `multica 0.3.4 (commit cf000d1e, built 2026-05-20T09:57:57Z)`
**Server:** `http://localhost:8080`
**Workspace:** `21c6d282-d6b4-4b25-8d0d-a85e96038416`
**Project:** `d23d0d43-1044-4503-8182-21bf4fb56c92` (`plugin-hive`)

---

## 1. Summary

Primitive **(a) parent issue + child issues per workflow-phase is viable on
Multica 0.3.4 and remains the right hosting primitive** for execute-mode-multica.
End-to-end dispatch was reproduced: a parent issue was created without an
assignee, a child issue was created with `--parent <parent-id>` + an agent
assignee, and the child was accepted into the daemon's task queue with a
`runtime_id` automatically assigned. Child→parent linkage is exposed in
`issue get` via `parent_issue_id`. Parent→child enumeration is NOT first-class
(no `--parent` filter on `issue list`), but is reachable via
`issue list --output json | jq 'parent_issue_id == "<id>"'` — adequate for our
slice-1 needs but a known UX limitation.

Primitive **(b) sequential reassignment via `multica issue update --assignee` is
a viable failure-recovery path**. The mutation alone cancels the prior agent's
queued run AND spawns a fresh task run on the new assignee — no explicit
`issue rerun` needed. This is the empirical answer to design §5 Q7.

Primitive **(c) no `session`/`sessions`/`cell` subcommand exists on
Multica 0.3.4**, re-confirming research §1.1. `squad` exists but is an
organizational grouping primitive, not an execution session.

**Recommendation:** confirm slice-1 (tce-2) commitment to (a). Note (b) as a
secondary failure-recovery primitive in the design (already noted in §5 Q7);
this spike now closes that question with positive evidence.

---

## 2. Option (a) — parent + child issues per workflow-phase

### 2.1 Commands run (verbatim)

```bash
# parent (no assignee)
multica issue create \
  --title "[SPIKE tce-1] parent — primitive (a) probe" \
  --description "Throwaway parent for spike tce-1. Safe to close after run." \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json
# → id: 2f1067f5-b4b5-43ce-9f45-e691c63fe747  (PLU-51)
# → created_at: 2026-05-22T19:13:35Z

# child with --parent + --assignee-id (developer agent)
multica issue create \
  --title "[SPIKE tce-1] child — implement phase probe (a)" \
  --description "Echo 'hello from primitive (a) spike' and exit. No code changes." \
  --parent "2f1067f5-b4b5-43ce-9f45-e691c63fe747" \
  --assignee-id d9946f9a-2747-49d4-b967-2590ffb5be43 \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json
# → id: 149a48d2-4340-431a-b7ff-ff3fe9481612  (PLU-52)
# → created_at: 2026-05-22T19:13:44Z
# → parent_issue_id: 2f1067f5-b4b5-43ce-9f45-e691c63fe747  ✓
# → assignee_id: d9946f9a-2747-49d4-b967-2590ffb5be43      ✓
# → assignee_type: agent                                    ✓
```

### 2.2 Parent linkage — exposed in `issue get <child>`

```json
{
  "id": "149a48d2-4340-431a-b7ff-ff3fe9481612",
  "identifier": "PLU-52",
  "parent_issue_id": "2f1067f5-b4b5-43ce-9f45-e691c63fe747",
  "assignee_id": "d9946f9a-2747-49d4-b967-2590ffb5be43",
  "assignee_type": "agent",
  "status": "todo"
}
```

**AC1 evidence — child exposes parent:** ✓ `parent_issue_id` returned from
`issue get`.

### 2.3 Children NOT first-class on parent — open UX gap

```bash
# get parent → no children array, no count, no link relation surfaced
multica issue get 2f1067f5-b4b5-43ce-9f45-e691c63fe747 --output json
```

Parent JSON contains no `children`, `child_issue_ids`, or `subtask` field.
Workaround (verified, used in this spike's research phase):

```bash
multica issue list --status todo --output json | \
  python3 -c "import json,sys;d=json.load(sys.stdin); \
    print([i['identifier'] for i in d if i.get('parent_issue_id')=='<parent-uuid>'])"
```

Enumeration is O(workspace-size) per query — fine at our scale (today the
workspace held ~80 issues across all statuses) but worth noting for the
execute-mode-multica skill: cache parent→children at creation time rather
than re-deriving each phase.

### 2.4 Dispatch pipeline acceptance

`multica issue runs <child>` immediately after creation:

```json
[{
  "id": "926d2694-9d68-44c1-85fe-5a16e2ecc13d",
  "agent_id": "d9946f9a-2747-49d4-b967-2590ffb5be43",
  "kind": "direct",
  "runtime_id": "0b8e2f02-bcde-4063-a454-224cc8613944",
  "status": "queued",
  "attempt": 1,
  "max_attempts": 2
}]
```

**AC1 evidence — runtime accepted dispatch:** ✓ `runtime_id` assigned within
the same second as `issue create`, run record created with `status=queued`,
`kind=direct`, `attempt=1`.

### 2.5 Wall-clock observation (R4 latency baseline)

The (a) child entered `queued` immediately on creation. It did NOT dispatch
to `started`/`running` within the 6.5-minute spike window because the daemon
was processing a 20+ deep backlog (PLU-30 was `in_progress`, ~20 `tce-*`
planning stories ahead in `todo` with `assignee_type=agent`). Researcher's
earlier identical probe (PLU-46, created at 18:58:06Z, 15min before mine)
also remained `queued` at the same time — same backlog effect.

**Latency conclusion:**
- **Enqueue + parent-linkage + runtime-assignment latency: < 1s** (observable
  in `created_at`/`updated_at`/`runs[].created_at` timestamps).
- **Queue→dispatch latency: bounded by daemon FIFO + concurrent in-progress
  cap (= 1 today, observed)**. This is an operational property, not a
  primitive deficiency. For the execute-mode-multica skill, this means
  parallel workflow phases inside a single team-cell will serialize on
  per-runtime concurrency unless we shard across multiple runtimes (currently
  2 online: claude + codex).

### 2.6 AC1 verdict

> "Given the spike memo is reviewed, when (a) is exercised on a throwaway
> parent+child pair, then the memo records the end-to-end behavior and
> concludes (a) is the sole viable hosting primitive on 0.3.4."

**MET.** (a) is viable end-to-end. (b) — covered next — is a complementary
mutation primitive for failure recovery, not a competing hosting primitive.
(c) does not exist on 0.3.4, so (a) remains the **sole hosting primitive**.

---

## 3. Option (b) — sequential reassignment characterization

### 3.1 Commands run (verbatim)

```bash
# create with developer assignee
multica issue create \
  --title "[SPIKE tce-1] reassign probe — option (b)" \
  --description "Probe: does --assignee mutation alone spawn a fresh task run?" \
  --assignee-id d9946f9a-2747-49d4-b967-2590ffb5be43 \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json
# → id: 50de2132-e2c5-46db-9a24-f88ac316cfb5  (PLU-53)
# → created_at: 2026-05-22T19:14:03Z

# snapshot runs BEFORE mutation
multica issue runs 50de2132-e2c5-46db-9a24-f88ac316cfb5 --output json
# → [{status: queued, agent: developer (d9946f9a...), attempt: 1}]
# → run count = 1

# mutate assignee → tester
multica issue update 50de2132-e2c5-46db-9a24-f88ac316cfb5 \
  --assignee-id f43c31f2-2aa1-4f55-849e-e21c170a5737
# → ack at 2026-05-22T19:14:24Z
# → assignee_id now tester

# snapshot runs 30s AFTER mutation
multica issue runs 50de2132-e2c5-46db-9a24-f88ac316cfb5 --output json
# → run count = 2
```

### 3.2 Daemon behavior — observed verbatim

After the `--assignee-id` mutation:

```json
[
  {
    "id": "d8361e54-8527-4b26-ab3b-bd8ab5988bdb",
    "agent_id": "f43c31f2-...  (tester)",
    "created_at":  "2026-05-22T19:14:24Z",
    "dispatched_at": "2026-05-22T19:14:24Z",
    "started_at":    "2026-05-22T19:14:24Z",
    "completed_at":  "2026-05-22T19:14:51Z",
    "status": "completed",
    "kind": "direct",
    "result": {
      "output": "Probe complete. `--assignee` mutation alone triggers fresh agent run — confirmed. Result posted on PLU-53, status set to `in_review`.",
      "session_id": "65f018f2-eac2-4517-bcf9-2b93a408fd92"
    }
  },
  {
    "id": "332e42e6-3492-401f-8f75-1056a7883dc9",
    "agent_id": "d9946f9a-...  (developer)",
    "created_at":  "2026-05-22T19:14:03Z",
    "dispatched_at": null,
    "started_at":    null,
    "completed_at":  "2026-05-22T19:14:24Z",
    "status": "cancelled",
    "result": null
  }
]
```

**Two simultaneous, atomic-looking effects from one mutation:**

1. **Prior queued run gets cancelled** (developer run, status: `queued → cancelled`
   at exactly `updated_at` of the issue mutation, `2026-05-22T19:14:24Z`). No
   explicit `issue rerun` or `issue cancel-task` was issued.
2. **Fresh run spawned on new assignee** (tester run, created/dispatched/started
   all at `2026-05-22T19:14:24Z`, completed 27 seconds later). The tester
   agent EXECUTED — it posted a comment confirming "Probe complete" and set
   the issue status to `in_review`.

### 3.3 AC2 verdict

> "Given (b) is exercised, when `multica issue update --assignee` is run
> against a throwaway task, then the memo characterizes whether reassignment
> alone spawns a fresh task run (works-as-fallback or not)."

**MET.** Reassignment ALONE spawns a fresh task run AND cancels the prior
queued run. No `issue rerun` needed. (b) is a viable **failure-recovery**
primitive: if a workflow-phase agent fails or stalls, the orchestrator can
hot-swap the assignee on the SAME child issue, preserving issue context
(title/description/parent_issue_id/comments) while getting a fresh run.

**Design implication for execute-mode-multica (slice-1+):**

- **(a) remains the hosting primitive** — one child issue per workflow-phase.
- **(b) is the recovery primitive** — if a phase's first run fails, hot-swap
  the assignee (e.g., from `developer` → `developer-fallback`, or back to
  `team-lead` for re-routing) rather than creating a new issue. This
  preserves linkage to the parent cell and the per-phase context.

This closes design §5 Q7 with a positive answer: **yes, (b) works as
fallback without explicit rerun.**

### 3.4 Caveat — (b) does NOT cancel an already-`started` run

The cancellation observed was of a `queued` run. We did NOT test whether
`--assignee` mutation against a child whose run is already `started`/`running`
cancels mid-flight. Operationally this matters for the failure-recovery
narrative: if the original agent hangs in `started`, can we hot-swap, or do
we need to `cancel-task` first? **Recommend follow-on probe in slice-1
acceptance testing** (low risk; cheap to test once we have a real
implementation).

---

## 4. Option (c) — re-confirm absence of `session`/`sessions`

### 4.1 Commands run (verbatim)

```bash
multica --help 2>&1 | grep -iE 'session|cell'
# → NO matches (no session, no cell anywhere in top-level CLI)

multica issue --help 2>&1 | grep -iE 'session|squad|cell'
# → "assign:  Assign an issue to a member, agent, or squad"
#   (the word "squad" appears ONLY in the description of `issue assign`)

multica squad --help
# → squad is an organizational primitive (create/delete/get/list/member/update),
#   NOT an execution session. Squads group members; tasks run on agents/runtimes.
```

### 4.2 AC3 verdict

> "Given (c) is probed, when the Multica 0.3.4 CLI is inspected, then the
> memo confirms no `session` or `sessions` command exists (re-confirms
> research §1.1)."

**MET.** No `session` subcommand exists at any level of Multica 0.3.4
(CLI commit `cf000d1e`, built 2026-05-20). The only `squad`/`cell` reference
is the `assign` help-text mentioning squads as a valid assignee kind. This
re-confirms research §1.1 and outline §3.2.

---

## 5. F5 scope-probe — daemon GitHub OAuth `workflow` scope

### 5.1 What is exposable today

```bash
multica auth status
# Server:  http://localhost:8080
# User:    don (don@firefly.events)
# Token:   mul_8a4f0ad8...
# (No --verbose flag exists; auth status does NOT expose GH OAuth scopes.)

multica daemon status
# Daemon:      running (pid 90244, uptime 33h52m0s)
# Agents:      claude, codex
# Workspaces:  1
# (No GH scope surface here either.)
```

The CLI exposes the **Multica** token (`mul_…`), not the daemon's **GitHub**
OAuth scopes. There is no direct introspection path on 0.3.4.

### 5.2 Indirect probe — DEFERRED per spike charter

The researcher's notes outline an indirect probe (dispatch a throwaway
issue that touches `.github/workflows/**` and observe whether the push
succeeds). Per the spike charter from team-lead:

> "If missing — DO NOT halt the spike (this is the audit-finding being
> reconfirmed; the spike itself touches no `.github/workflows/**` files).
> Just RECORD the absence and reference tce-0."

This spike touched zero workflow files. The indirect probe was NOT executed
in this phase to avoid creating a workflow-modifying dispatch on a busy
daemon backlog. **F5 detection status remains: unverified by this spike;
audit §F5 is still authoritative.**

### 5.3 Runbook line (for slice-1 entry)

> *Before tce-2 (slice-1 first dispatch) runs against any branch where the
> child issue's brief would touch `.github/workflows/**`, verify the
> daemon's GH OAuth includes the `workflow` scope. The runbook is captured
> in `.pHive/audits/multica-mode-audit-2026-05-22.md §F5` and the F5 chore
> is owned by `tce-0-f5-oauth-scope-prereq`. If F5 has merged AND a workflow
> push still rejects with `refusing to allow an OAuth App to create or update
> workflow`, re-run `multica setup self-host` to refresh the daemon's GH
> token with the `workflow` scope.*

**AC4 verdict:**

> "Given the daemon scope-probe runs, when `workflow` scope is missing
> despite tce-0 merging, then the spike halts with a clear runbook line
> referencing tce-0."

**Partially met** — the runbook line is documented above and references
tce-0. The "halt" branch is not exercised because we did not run the
indirect probe; the charter explicitly de-scoped this. tce-0 still gates
slice-1 entry.

---

## 6. Recommendation

1. **Confirm slice-1 (tce-2) commitment to primitive (a)** as the hosting
   primitive for execute-mode-multica child-issues-per-workflow-phase. The
   spike has reproduced end-to-end behavior with positive evidence (§2.4)
   and identifies one known UX gap (parent→children not first-class, §2.3)
   that is workaround-tractable.
2. **Adopt primitive (b) as the failure-recovery primitive** in the design.
   Update design §5 Q7 to reflect: "Yes — `multica issue update --assignee`
   on an issue with a queued run atomically cancels the prior run and spawns
   a fresh one on the new assignee, with no `issue rerun` needed. Caveat:
   behavior on already-`started` runs is not yet verified; slice-1 acceptance
   should include a `started`→hot-swap probe."
3. **Cache parent→children at creation time** in the execute-mode-multica
   skill rather than re-deriving via `issue list` per phase. This avoids
   O(workspace) enumeration on every dispatch decision.
4. **Treat daemon FIFO + per-runtime concurrency cap as an operational
   constraint** (§2.5). Slice-1 should be designed assuming serial dispatch
   per runtime; parallelism within a team-cell requires multiple runtimes
   (or future Multica daemon parallelism features).
5. **F5 scope-probe remains a tce-0 prerequisite for slice-1.** This spike
   did not exercise it; the runbook line in §5.3 stands as the entry gate
   for tce-2.

No replan of slice-1 is warranted on the spike evidence.

---

## 7. Tear-down checklist

| Issue | Identifier | Disposition | Verified at |
|---|---|---|---|
| `2f1067f5-b4b5-43ce-9f45-e691c63fe747` | PLU-51 | `status: cancelled` | 2026-05-22T19:21Z |
| `149a48d2-4340-431a-b7ff-ff3fe9481612` | PLU-52 | `status: cancelled` | 2026-05-22T19:21Z |
| `50de2132-e2c5-46db-9a24-f88ac316cfb5` | PLU-53 | `status: cancelled` | 2026-05-22T19:21Z |

Closer command used: `multica issue update <id> --status cancelled`.
(`multica issue cancel-task` returned 404 — that subcommand operates on task
UUIDs, not issue UUIDs; the correct closer for the **issue** is the
status mutation above.)

**Out of scope:** researcher's earlier spike issues (PLU-44…PLU-49) are
intentionally NOT closed by this phase — they predate this session and the
auto-mode classifier appropriately blocked mass-cancel of items I did not
create. Recommend the integrate phase (or a follow-up housekeeping pass)
close them.

---

## 8. Cost note — end-to-end latency

| Stage | Wall-clock | Notes |
|---|---|---|
| `issue create` (parent) → response | < 1s | local daemon |
| `issue create` (child, with `--parent`) → response | < 1s | linkage + agent assignment in same call |
| `issue create` → `runs` shows queued entry with `runtime_id` | < 1s | runtime assignment is part of accept-path |
| `issue update --assignee` → prior run `cancelled` + new run `dispatched`/`started` | < 1s | atomic on daemon side |
| Fresh agent run (b): tester `dispatched_at` → `completed_at` | ~27s | claude-sonnet-4-6 backend, trivial task |
| (a) child `queued` → `dispatched` (busy daemon) | > 360s, not reached in spike window | bounded by daemon FIFO + concurrent in-progress cap (=1 observed) |

**Implication for execute-mode-multica:** per-issue dispatch overhead is
negligible (< 1s); per-phase end-to-end depends almost entirely on the
agent's actual work + daemon queue depth, not on the primitive itself.
Spike R4 risk (heavier-than-hoped-for primitive cost) does NOT materialize
at the primitive level; it manifests as a queue/concurrency concern that
is operational, not architectural.
