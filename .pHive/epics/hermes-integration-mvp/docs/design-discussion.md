# Design Discussion — Hermes ↔ Hive MVP Integration

## 0. Prior Decisions (KG Pre-flight)

KG pre-flight (`/hive:why hermes orchestrator slack cron triage`) failed — `kg_why` hit a Python 3.13 / chromadb subprocess-import bug (`dictionary changed size during iteration`). Treated as zero results per skill contract. Clean slate from KG's perspective. Hotfix for `kg_why` is out of scope here — captured as a follow-on risk.

## Grill-record consumption note

Phase A2 grill produced [`grill-record.md`](./grill-record.md) with 11 findings. This revision pass addresses each:
- **V1** (orchestrator vocab collision) — picked rename `external-coordinator` for the Hermes role; updated §1 + §3 + §4. Final operator confirmation in Q5.
- **V2** (skill word shadowing) — added disambiguation in §2.
- **H1, H2, H3** (cross-machine assumptions) — sharpened in §3 + reshaped Q1 in §6 into "staleness budget" + "failure budget" sub-questions.
- **H4** (cron idempotency) — scoped Slice 2 cron to Phase 1 report-only at MVP; auto-approve is opt-in stretch.
- **U1** (cross-repo strategy) — committed to split: this epic ships Hive-side contract surface; sibling epic `hermes-bridge-mvp` lives in `~/Code/hermes-agent` for Hermes-side consumer.
- **U2** (zero-changes vs slack flag) — dropped "zero changes" claim; Slice 2 explicitly adds the `--format slack` flag as scope.
- **C1** (cross-repo branch posture) — documented in §5.
- **C2** (compressed planning bypass) — accepted + documented in §5 + cycle-state.
- **P1** (director-chair framing) — renamed vector 1 from "Hermes-as-persistent-orchestrator" to "Hermes-as-external-coordinator". §1 reframed.

## 1. What Are We Doing?

User wants to integrate Hermes (Nous-based persistent personal assistant running on Mac Studio) with Hive (this plugin) along three vectors picked as MVP from Hermes's own 7-vector design output:

1. **Hermes-as-external-coordinator** — Hermes (out-of-band, operator-scoped) carries cross-session context so operator can ask "what was I doing in plugin-hive yesterday" and get a coherent answer. Hive remains the in-session orchestrator; Hermes calls Hive over stable contracts and never executes inside a Claude Code session.
2. **Daily ceremony cron (Phase 1 report-only)** — Hermes schedules `/hive:standup` on cron, captures Phase 1 standup report, posts to Slack. Planning + execution stages stay operator-driven from a Claude Code session (no auto-approve at MVP).
3. **Triage intake via Slack** — Slack DM/channel → triage queue (via CLI; single-writer invariant preserved) → operator prioritizes via Slack reply → handoff to `/plan --from-triage`.

"Done" looks like: operator drops a bug in Slack from their phone, gets a Phase 1 standup summary in Slack each morning, and asks Hermes "what was I working on yesterday in plugin-hive?" — getting a coherent answer. Vectors 4-7 (review notifs, meta-optimize PR loop, memory bridge, Multica bridge) deferred to follow-on epics once MVP contract surface proves out.

## 2. What I Found

Hive already has more of this scaffolding than Hermes's design output implies:

- **`skills/standup/SKILL.md`** runs `daily-ceremony.workflow.yaml` through three phases (standup → planning → execution) and **already documents an Anthropic Routines bridge** at `hive/references/routines-integration.md`. The Routines doc spells out a webhook trigger model with `under_scheduler.auto_approve: true` on the `plan-approval` pause step. Hermes is structurally a substitute for Routines here — same scheduler-as-trigger pattern, different concrete scheduler.
- **`skills/triage/SKILL.md`** ships a five-state machine (`inbox → clarified → prioritized → plan-ready → closed`) and is the **single writer** of `.pHive/triage/queue.yaml`. Hand-off path `/plan --from-triage <id>` is already wired. Triage is operator-driven by design — explicitly no auto-advance.
- **Daily restart model is intentional** — standup.SKILL.md says: "The orchestrator starts fresh each day with a 1M context window. The standup phase compresses prior state into the new session via status markers, cycle state, and task tracker — not by resuming a prior conversation." Vector 1 cannot violate this. Hermes can't BE the orchestrator inside a Claude Code session; it can only persist context outside sessions.
- **Cycle-state schema** at `.pHive/cycle-state/{epic-id}.yaml` + **episodes** at `.pHive/episodes/` already carry cross-session state. Hermes reads these, doesn't write them.
- **Config surface:** root `hive.config.yaml` resolved — `gate_mode: warning`, `task_tracking.adapter: multica`, `agent_backends` map (researcher/dev/writer/architect → codex; verifier roles → claude), `git_flow.default_pr_base: auto`.
- **Hermes-side capabilities** (from Hermes design output + memory `project_hermes_personal_assistant`): native uv tool install on Mac Studio, Codex ChatGPT OAuth backend, dashboard at 127.0.0.1:9119, **"Hermes capability" system** (Hermes's term for skills — distinct from Hive's auto-discovered `SKILL.md`; use "Hive skill" vs "Hermes capability" when both appear together), persistent memory tool, cron, Slack, file access, delegate_task.

Key prior art: Routines integration is the template. The MVP is essentially "swap Routines for Hermes" + extend the contract slightly to cover triage intake + persistent context queries.

## 3. My Proposed Approach

Three slices, each shippable independently. Bias toward thin stable contracts on the Hive side; let Hermes do the heavy lifting in its own repo.

**Slice 1: Persistent context query surface (vector 1)** — Add a new read-only skill `/hive:context-snapshot` that emits a single JSON blob summarizing: current branch, active epic(s), in-flight stories, last episode summary, open triage items, pending metric verdicts. **Transport-agnostic by design** — the skill writes to stdout (default) AND optional file at `.pHive/context-snapshot.json` (`--write` flag), so Hermes can consume via whatever cross-machine sync protocol the operator picks (git pull, SSH+exec, shared FS). The skill assumes ONLY that its caller has filesystem read access to the plugin-hive repo at invocation time — it does NOT assume Hermes runs anywhere specific. Slice 1 ships a Hive-internal scaffolding milestone; Hermes consumer ships in companion epic.

**Slice 2: Cron-driven standup with Slack delivery (vector 2)** — Honor the existing Routines bridge contract. Hermes plays the Routines role: cron fires → Hermes invokes Claude Code (or shells `/hive:standup` if Claude Code is too heavyweight under cron), captures **Phase 1 standup report only** (no auto-approve, no Phase 2/3 advance), posts to Slack. **Hive-side changes (Slice 2 scope):** (a) new `--format slack` flag on standup output (markdown-flavored, thread-aware); (b) document the operator-driven Phase 2 handoff (operator sees report in Slack, returns to Claude Code session to plan + execute — no auto-approve under cron at MVP). Auto-approve under cron remains opt-in for a follow-on slice once we trust the Hermes channel.

**Slice 3: Slack-to-triage intake bridge (vector 3)** — Hermes-side Slack bot accepts intake DMs/channel mentions, invokes `/hive:triage <description>` via the sync protocol chosen in Q1.1 (e.g., SSH+exec, git pull + remote, or local checkout). Hermes notifies operator in Slack when an entry needs prioritization, captures Slack reply, runs `/hive:triage <id> --advance clarified ...` then `--advance prioritized ...` then `--hand-off`. **Triage's single-writer invariant is preserved** because Hermes always calls the CLI, never writes `queue.yaml` directly. **Hive-side changes (Slice 3 scope):** add `--json` output flag on triage commands so Hermes's parsing is reliable; otherwise no triage skill behavior changes.

Sequence: slice 1 first (low risk, pure read, transport-agnostic), slice 2 next (validates Hermes-as-scheduler with existing Routines contract), slice 3 last (most contract surface, exercises full intake loop). Each slice leaves a working product (Hive side); each slice has a corresponding consumer story in the companion epic on `~/Code/hermes-agent`.

## 4. What Could Go Wrong

- **[high] Cross-machine state staleness.** Hermes (Mac Studio) reads stale repo state vs this workstation's writes. Mitigation: Slice 1 surface is transport-agnostic; staleness becomes a sync-protocol property, not a Hive-design property. Document staleness budget in Q1.1 answer.
- **[high] Triage single-writer invariant violation.** If Slack bot writes `queue.yaml` directly, corrupts state machine. Hard rule: every queue mutation goes through `/hive:triage` CLI. Capture as contract test in Slice 3.
- **[medium] Cross-machine auth surface (Slice 3 CLI invocation).** Hermes invoking `/hive:triage` cross-machine needs SSH key + workstation reachable + workstation always-on, OR git-pull-remote-cli pattern. Workstation-always-on is fragile (laptop lid closes). Mitigation: prefer enqueue-via-sync over live-CLI when workstation may be unreachable. Resolve in Q1.2.
- **[medium] "External coordinator" vocabulary still has friction.** Renamed from "orchestrator" but "coordinator" is also used loosely in Hive docs. Mitigation: lock the exact term in Q5 answer, then global-replace through epic + stories + future docs.
- **[medium] Hermes's design output assumes the persistent context replaces Hive's daily-restart compression.** It doesn't. Hive's compression-via-cycle-state is load-bearing for Claude Code's context window. Hermes adds an OUT-OF-BAND layer (operator preferences, cross-project awareness). Mitigation: write down the delta explicitly in §6 Q4 answer.
- **[medium] `kg_why` broken under Python 3.13** (recon confirmed). Audit-trail queries fail. Fix is small but out of scope here. Capture as follow-on triage entry post-merge.
- **[medium] Hermes runtime on Mac Studio adds an SPOF for cron-only behaviors.** If Mac Studio sleeps/reboots/loses network, cron jobs miss. Mitigation at MVP: Slice 2 is Phase 1 report-only — missing one daily report is recoverable next run with no execution side-effects. Slice 1 read surface is pull-driven by operator. Slice 3 intake delays a Slack-originated triage entry by up-to-cron-interval but doesn't lose it (Slack channel scrollback is source of truth until ingested).
- **[low] Plugin-hive marketplace consumers don't have Hermes.** This epic is dogfood-first. Vector 1's `/hive:context-snapshot` skill is generally useful (any external coordinator could consume it). Vectors 2/3 are operator-specific. No regression for marketplace consumers — all new code is additive.

## 5. Dependencies and Constraints

- **External:** Hermes runtime (uv-installed on Mac Studio, OAuth'd to ChatGPT). Slack workspace + bot token. Cron capability proven (per memory, Hermes has built-in scheduler).
- **Internal:** Hive standup skill + triage skill (both shipped, in production). Routines integration doc as contract template. Multica workspace `plugin-hive` (for tracker writes via Phase D, not blocking).
- **Cross-repo posture:** This epic's branch `feat/hermes-integration-mvp` exists only on `firefly-events/plugin-hive`. Companion epic `hermes-bridge-mvp` (planned separately) lives on `~/Code/hermes-agent` with its own branch `feat/hive-bridge-mvp`. The "one branch per epic" convention (memory `feedback_git_flow_per_epic`) applies **per-repo for cross-repo epic families** — each repo carries one branch named for its half of the work. Documented here so reviewer doesn't flag cross-repo split as convention violation.
- **Compressed planning posture:** This planning session ran in compressed mode (orchestrator absorbs researcher + writer roles; architect + TPM would be invited in Phase B collab review only; grill runs as atomic external skill). Bypasses `agent_backends` codex routing for planning artifacts per memory `feedback_orchestrator_must_honor_backend_routing` rationale exception: "compressed planning may bypass codex routing when (a) planning artifacts are low-volume, (b) serial codex dispatch would extend planning by hours, (c) user prioritizes forward motion." Audit captured in `.pHive/cycle-state/hermes-integration-mvp.yaml`.
- **Cross-machine:** Mac Studio ↔ this workstation. Sync protocol = open question Q1.1/Q1.2.
- **Time-sensitive:** None. Vectors are evergreen integration.

## 6. Open Questions

1. **Cross-machine sync protocol (split per grill H2):**
   1.1 **Staleness budget** — what's the acceptable max age of data Hermes reads from this workstation? Seconds (real-time, → SSH/shared FS), minutes (semi-real-time, → cron-pull), or hours (daily-ish, → operator-triggered pull)? Drives transport choice.
   1.2 **Failure budget** — what should happen if the sync surface is unreachable when Hermes tries to read? Silent skip + retry next cycle, surface to operator in Slack, hard-fail the cron job? Drives recovery design.
2. **Companion epic split** — confirm option (c): this epic ships Hive-side contracts only; sibling epic `hermes-bridge-mvp` ships Hermes-side bot/cron/SDK on `~/Code/hermes-agent` independently. Each repo carries its own branch + PR. Yes/no?
3. **Slack workspace + channel naming** — which Slack workspace? Channel for daily standup posts? DM-or-channel for triage intake? (Async — doesn't block planning, but Slice 2/3 stories need to point at concrete names eventually.)
4. **Persistent context layer split** — confirm: Hermes owns operator-scoped cross-project state (preferences, "what was I doing yesterday across all projects"); Hive owns per-project per-epic state (cycle-state, episodes, story status). No overlap. Yes/no?
5. **Vocabulary lock for the Hermes role** — pick one: `external-coordinator` (current draft choice), `liaison`, `shepherd`, `supervisor`, `driver`, or keep `orchestrator` with explicit disambiguation. Drives epic + skill + story naming.
6. **`/hive:context-snapshot` defaults** — confirm: stdout by default; optional `--write` flag writes to `.pHive/context-snapshot.json`. Schema versioned via top-level `schema_version: 1` field for future compat.
7. **Triage intake authentication (Slack side)** — accept intake from anyone in the channel, or only from operator's Slack user ID? Single-user MVP → recommend latter; confirm.

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: bun test (Hive-side unit tests for context-snapshot JSON schema +
                   triage --json output snapshots),
         shellspec or bash test harness (CLI integration),
         manual Slack roundtrip (slice 2/3 E2E)
  Platforms: macOS (Mac Studio runtime + workstation dev)
  Automated:
    - /hive:context-snapshot JSON schema validates against fixture
    - /hive:context-snapshot stdout vs --write produce byte-identical content
    - Standup --format slack output matches markdown-thread-aware snapshot
    - Triage CLI emits machine-parseable output with --json flag (snapshot test)
    - Routines bridge dry-run (per existing routines-integration.md sandbox guidance)
  Manual:
    - Hermes-as-scheduler invokes /hive:standup → Phase 1 report reaches Slack channel
    - Slack intake → /hive:triage → operator approves in Slack → /plan --from-triage runs
    - Cross-machine state coherence: edit on workstation, query via Hermes on Mac Studio,
      see fresh state within Q1.1 staleness budget
    - Mac Studio asleep when cron fires: next cron run recovers; no double-post
    - Workstation rolls back a commit between Hermes reads: Hermes notices schema_version
      or stale-tip mismatch (Slice 1 design property)
  Not verifying:
    - Hermes-internal code (lives in its own repo / companion epic, has its own tests)
    - Load/scale (single-operator MVP; Slack rate limits non-issue)
    - Cross-Slack-workspace support (single workspace MVP)
    - Multi-user Slack intake (single-operator MVP per Q7)
```

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~12-18 Hive-side
    (1 new skill /hive:context-snapshot + ~2 flag additions on standup/triage
     + JSON schema doc + tests + cycle-state + epic + stories)
  Subsystems: standup, triage, new context-snapshot skill, Routines bridge doc,
              hive config docs (no config schema changes)
  Migration required: no
  Cross-team coordination: yes — cross-repo (plugin-hive ↔ hermes-agent via
              companion epic) and cross-machine
  Unknowns: 7 numbered open questions

  RECOMMENDATION: Needs structured outline
  RATIONALE: Large scope by definition — cross-system, cross-machine, cross-repo
    epic family, novel contract surface (Hermes is new external coordinator).
    H/V planning will earn its keep by separating Hive-internal layer
    (slice 1 stories) from bridge-contract layer (slice 2/3) from
    out-of-scope-Hermes-side (companion epic). Structured outline elicitation
    will close several open questions and force explicit design decisions on
    sync protocol staleness/failure budgets + vocabulary lock.
```
