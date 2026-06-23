# H/V Plan — Hermes Orchestrator Skills

**Scale:** Medium. **Resolved open questions:** skill format = **native Hermes registry** (recon story added); scope = **all 5 skills**; review gate = **Slack notify-and-await**.

## Horizontal layers

1. **Contract / discovery** — Hermes-agent native skill format (Studio recon); `multica_*` MCP surface (exists in fork vs wrap `cli.mjs`).
2. **State + gate** — `gate_state: pre_approved` latch; `hermes_reconciler` state contract (mostly exists).
3. **Read skills** — monitor-epic, watch-cron.
4. **Advance skills** — reconcile-tick (formalize cycle-reconciler), kickoff-exec.
5. **Trigger skill** — kickoff-plan.
6. **Human-gate transport** — Slack notify-and-await (review verdict + approval/error requests).
7. **Packaging** — port canonical sources into Hermes native format on Studio; parity tests; docs.

## Source-of-truth split

plugin-hive = **canonical orchestrator contract + runbook sources + tests** (buildable/testable here). Hermes (`~/Code/hermes-agent`, Studio) = **consumer**; the native-format port + registration is execute-time work (plan-off-repo-bridge → reconcile at /execute). Each story tags `side: plugin-hive | studio`.

## Vertical slices (each leaves a working state)

**S1 — Foundation (contract known).** Studio recon: document Hermes native skill registry format + confirm/spec the `multica_*` MCP surface. Working state: we know how to author a Hermes skill + the tool ABI is pinned.
→ stories: h-01 (format recon, studio), h-02 (MCP surface, plugin-hive contract).

**S2 — Gate latch.** `gate_state: pre_approved` latch + state-contract hardening in `hermes_reconciler`. Working state: an epic can be marked human-approved-to-run, and skills can read that latch.
→ h-03 (plugin-hive).

**S3 — Read core.** monitor-epic canonical runbook over `epic-status` + `context-snapshot` + `poll`. Working state: Hermes can report an epic's status on a tick.
→ h-04 (plugin-hive source).

**S4 — Advance core.** reconcile-tick formalized from `cycle-reconciler.md`: 7-position machine + watchdog + ff-merge verify; review-terminal branch calls a pluggable surface-verdict hook (stubbed). Working state: Hermes advances an approved epic impl→review and halts at verdict.
→ h-05 (plugin-hive source).

**S5 — Human gate transport.** Slack notify-and-await surface: review verdict + approval/error requests reach a human and the tick pauses until action. Generalizes the existing `/standup --format slack` convention. Working state: reconcile-tick's halt actually reaches a human via Slack.
→ h-06 (plugin-hive contract + Slack surface).

**S6 — Triggers.** kickoff-exec (start loop over a `pre_approved` epic; refuse otherwise) + kickoff-plan (start `/plan` multica; route gates to human, never auto-advance). Working state: human says "go" on an approved epic; Hermes can also start a plan.
→ h-07 (kickoff-exec), h-08 (kickoff-plan). h-07 depends on real gate transport (h-06) + machine (h-05).

**S7 — Cron watch + packaging.** watch-cron (RemoteTrigger routines + `multica daemon status` health) + port all 5 canonical sources into Hermes native format on Studio + parity tests + README/operations-guide entries. Working state: complete lights-on loop, monitored, consumable by Hermes.
→ h-09 (watch-cron), h-10 (studio port + tests + docs).

## Dependency spine

h-01 (format) → blocks the studio port (h-10) and informs all skill authoring.
h-02 (MCP surface) → blocks h-04, h-05, h-07.
h-03 (gate latch) → blocks h-05, h-07.
h-05 (reconcile-tick) → blocks h-07.
h-06 (Slack transport) → blocks h-07 (kickoff-exec needs a real human gate to run autonomously).
h-04..h-09 → block h-10 (packaging ports the finished set).

## Deferred

- Discord transport (Slack is the chosen channel).
- Dashboard (9119) approve/reject UI — Slack notify-await covers the gate; dashboard is a later affordance.
- Epic-of-record auto-selection across many open epics — MVP uses an explicit pointer set at approval (folded into h-03 gate latch).
