# Spike Research Notes — tce-1 Multica Primitive Spike

**Story:** `tce-1-multica-primitive-spike`
**Phase:** research (step 1 of 5)
**Role:** researcher (read-only)
**Date:** 2026-05-22
**Inputs read:** research-brief §1, audit §F5, design-discussion §5 Q7/Q8, structured-outline §4.2 + §3.2

This note plans the developer's spike work. Do NOT execute issue mutations from
this phase — every probe below is read-only or deferred to the developer.

---

## 1. CLI surface inventory (live, 2026-05-22)

Confirmed via `multica --help`, `multica issue --help`, and per-subcommand
`--help` probes against Multica CLI 0.3.4, server `http://localhost:8080`,
workspace `21c6d282-d6b4-4b25-8d0d-a85e96038416`, project
`d23d0d43-1044-4503-8182-21bf4fb56c92` (`plugin-hive`).

**Top-level (CORE):** `agent, autopilot, issue, label, project, repo, skill,
squad, workspace`. **RUNTIME:** `daemon, runtime`. **ADDITIONAL:** `attachment,
auth, config, login, setup, update, user, version`.

**No `session` / `sessions` command exists** (re-confirms research §1.1). The
substring "session" never appears as a subcommand at any level.

**`multica issue` subcommands:** `assign, cancel-task, comment, create, get,
label, list, rerun, run-messages, runs, search, status, subscriber, update`.

Key option-relevant flags:

| Flag (option) | Subcommand | Shape | Source |
|---|---|---|---|
| `--parent <id>` (a) | `issue create`, `issue update` | single string, no array | live `--help` |
| `--assignee <name>` / `--assignee-id <uuid>` (a, b) | `issue create`, `issue update` | mutually exclusive; member, agent, OR squad (fuzzy match) | live `--help` |
| `issue assign --to / --to-id / --unassign` (b alt) | `issue assign` | dedicated mutation surface for reassignment | live `--help` |
| `issue rerun <id>` (b explicit) | — | re-enqueues current assignment as a fresh task | live `--help` |
| `issue runs <issue-id>` (b observation) | — | lists execution history with optional `--full-id` | live `--help` |

**Bootstrapped agents available as assignees** (workspace `21c6d282`):

```
developer    d9946f9a-2747-49d4-b967-2590ffb5be43  claude-sonnet-4-6
tester       f43c31f2-2aa1-4f55-849e-e21c170a5737  claude-sonnet-4-6
reviewer     14a6a1ed-9243-4bdf-8a6a-4289506b43ab  claude-opus-4-7
spike-claude 0900af3f-1e20-4c9e-9046-60dbb25795a0  claude-sonnet-4-6
```

Throwaway-issue cleanup driver: every spike issue MUST have title prefix
`[SPIKE tce-1]` so `multica issue search '[SPIKE tce-1]' --include-closed`
enumerates the set.

---

## 2. Probe commands per option (developer to execute)

### Option (a) — parent issue + child issue end-to-end

Outline §4.2 calls for "parent/child end-to-end on throwaway." Confirms primitive
(a) is viable AND characterizes baseline latency (R4 mitigation).

```bash
# 1. create parent (no assignee — pure brief holder)
PARENT=$(multica issue create \
  --title "[SPIKE tce-1] parent — primitive (a) probe" \
  --description "Throwaway parent for spike; safe to close after run." \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# 2. create child assigned to developer with --parent linkage
CHILD=$(multica issue create \
  --title "[SPIKE tce-1] child — implement phase probe" \
  --description "Echo 'hello from primitive (a) spike' and exit. No code changes." \
  --parent "$PARENT" \
  --assignee-id d9946f9a-2747-49d4-b967-2590ffb5be43 \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# 3. observe parent/child link + child execution
multica issue get "$PARENT" --output json | python3 -m json.tool | head -40
multica issue get "$CHILD"  --output json | python3 -m json.tool | head -40
multica issue runs "$CHILD"
```

**Evidence required for the memo (per AC1):**
- `issue get $CHILD` returns a `parent_id` field equal to `$PARENT`.
- `issue runs $CHILD` shows at least one task with `provider=claude` reaching
  a terminal status (`completed` | `failed` | `cancelled`).
- Wall-clock time from `create` → terminal — capture for R4 latency baseline.

### Option (b) — sequential reassignment characterization

Source: design §5 Q7. The open question is whether `--assignee` mutation **alone**
spawns a fresh task run, or only mutates metadata (would need explicit `issue rerun`).

```bash
# 1. create a throwaway with developer
TASK=$(multica issue create \
  --title "[SPIKE tce-1] reassign probe — option (b)" \
  --description "Probe: does --assignee mutation alone spawn a fresh task run?" \
  --assignee-id d9946f9a-2747-49d4-b967-2590ffb5be43 \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# 2. snapshot run history BEFORE the reassignment
multica issue runs "$TASK" --output json | tee /tmp/spike-tce1-b-before.json

# 3. mutate assignee → tester (issue update path)
multica issue update "$TASK" \
  --assignee-id f43c31f2-2aa1-4f55-849e-e21c170a5737

# 4. wait 30s for daemon to react, then snapshot AFTER
sleep 30
multica issue runs "$TASK" --output json | tee /tmp/spike-tce1-b-after.json

# 5. diff run counts
python3 -c "import json;b=json.load(open('/tmp/spike-tce1-b-before.json'));a=json.load(open('/tmp/spike-tce1-b-after.json'));print(f'before={len(b)} after={len(a)}')"
```

**Evidence required for the memo (per AC2):**
- Whether `len(after) > len(before)` — i.e., reassignment alone spawned a new
  run (works-as-fallback) OR only mutated metadata (needs explicit `issue rerun`).
- If only metadata mutation, ALSO probe the explicit path:
  `multica issue rerun $TASK` and re-check runs.
- Record which path the daemon actually used; design §5 Q7 explicitly asks for
  "works-or-not" characterization.

Also worth comparing the dedicated mutation surface `multica issue assign --to`
against `issue update --assignee` — both exist and may differ in side effects.

### Option (c) — re-confirm absence of `session`

Source: research §1.1 + outline §3.2.

```bash
# 1. top-level grep — must show no `session*` subcommand
multica --help 2>&1 | grep -iE 'session|cell' || echo "NO session/cell subcommand at top level"

# 2. issue-level grep — should ONLY return the 'assign' description line (no session)
multica issue 2>&1 | grep -iE 'session|squad|cell'

# 3. squad surface (per research §1.4) — confirm squad ≠ session
multica squad --help 2>&1 | head -30
```

**Expected output:** `grep` returns no `session` hits at top level; the only
`squad`/`cell` reference in `multica issue` help is the words "or squad" inside
the `assign` description.

**Evidence required for the memo (per AC3):** verbatim outputs above, dated and
attributed to Multica 0.3.4.

---

## 3. Scope-probe — daemon GitHub OAuth `workflow` scope (F5 detection)

Source: audit §F5 + outline §4.2 ("if `workflow` missing despite F5 chore, halts
with runbook line per R5").

**No CLI exposes the daemon's GH OAuth scopes directly.** `multica auth status`
shows only the Multica CLI token (`mul_…`). `multica daemon status` shows pid /
uptime / runtimes, not scopes. The only reliable probe is **indirect**: try a
push that requires the `workflow` scope and observe the daemon log + push
exit-code.

```bash
# Indirect probe — dispatch a throwaway issue whose brief touches
# .github/workflows/** and check whether the push succeeds.
TASK=$(multica issue create \
  --title "[SPIKE tce-1] scope probe — touch .github/workflows" \
  --description "Add a single comment line to .github/workflows/codeql.yml,
commit, push. Do NOT modify any logic. If push fails with workflow-scope
error, the daemon GH OAuth is missing 'workflow' scope (per audit F5)." \
  --assignee-id d9946f9a-2747-49d4-b967-2590ffb5be43 \
  --project d23d0d43-1044-4503-8182-21bf4fb56c92 \
  --output json | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# Watch the daemon log while it runs
multica daemon logs --follow 2>&1 | grep -iE 'push|workflow|scope|denied|rejected' &

# Wait for terminal, then inspect runs + messages
sleep 180
multica issue get "$TASK" --output json | python3 -m json.tool
multica issue run-messages "$TASK" 2>&1 | grep -iE 'workflow|scope|denied|rejected' | head -20
```

**Expected outputs:**

- **PASS (workflow scope present):** push succeeds, branch lands on
  `firefly-events/plugin-hive`. No `workflow`-scope error in daemon log.
- **FAIL (workflow scope absent, slice-0 halt condition):** push rejected
  with `refusing to allow an OAuth App to create or update workflow` (or
  similar). Daemon log lines mention `workflow` scope. **In this case the
  spike halts with the runbook line:** *"F5 chore tce-0 either has not
  merged OR did not refresh the daemon GH OAuth — see
  .pHive/audits/multica-mode-audit-2026-05-22.md §F5; re-run `multica
  setup self-host` with `workflow` scope, then resume."*

Per design §5 Q11 (open), the actual re-auth surface (whether `multica setup
self-host` refreshes GH OAuth or whether a separate `multica auth refresh`
exists) is itself unresolved — researcher must NOT presume the runbook fix
works; record the halt condition truthfully.

---

## 4. Tear-down checklist (developer runs at end of spike)

All spike-created issues MUST be closed and labeled so cleanup is one query.

```bash
# Enumerate every spike-created issue
multica issue search '[SPIKE tce-1]' --include-closed --output json \
  | python3 -c 'import json,sys; [print(i["id"], i["title"]) for i in json.load(sys.stdin)]'

# For each ID returned, cancel any in-flight task and close
for ID in <paste-IDs-here>; do
  multica issue cancel-task "$ID" 2>/dev/null || true
  multica issue status "$ID" cancelled
done
```

Verification (per AC1/AC2/AC3 evidence): after teardown, `multica issue search
'[SPIKE tce-1]' --include-closed` enumerates ONLY closed/cancelled issues. None
linger in `in_progress` or `queued`.

---

## 5. Open caveats for the developer

1. **Scope-probe is destructive on a passing config.** If `workflow` scope IS
   present, the throwaway push from §3 will land a no-op commit on
   `firefly-events/plugin-hive`. Use a clearly-named throwaway branch
   (e.g., `spike/tce-1-scope-probe`) and revert immediately.
2. **Option (b) probe is racy.** `sleep 30` is a heuristic — adjust if daemon
   load delays task pickup. Prefer polling `issue runs` until `len()` stops
   changing for 2 consecutive polls.
3. **Memo writes to a DIFFERENT path than these notes.** Per outline §4.2 +
   story spec, the developer writes
   `.pHive/epics/team-cell-execution-mode/research/primitive-spike.md`. These
   notes are the PLAN; that memo is the EVIDENCE.
4. **Skip developer execution if R5 halts the spike.** If §3 returns FAIL, the
   developer writes the halt evidence into the memo and exits without running
   §2's option (a)/(b) probes — those exercises depend on a working dispatch.

---

## 6. Source citations

- Research brief §1.1 (no `session` command) — research-brief.md L19
- Research brief §1.2 (`--parent` flag) — research-brief.md L26-28
- Research brief §1.3 (option b unconfirmed) — research-brief.md L34-36
- Audit §F5 (workflow scope absent) — multica-mode-audit-2026-05-22.md L87-95
- Design §5 Q7 (reassign-rerun question) — design-discussion.md L133
- Design §5 Q8 (squad parallel/serial) — design-discussion.md L134
- Outline §4.2 Slice 0 — structured-outline.md L233-255
- Outline §3.2 primitive verdict — structured-outline.md L134-155
- `feedback_test_offtheshelf_before_rewriting` — MEMORY.md (spike-before-commit mandate)
