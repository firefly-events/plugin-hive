# watch-cron — Hermes Skill Runbook

> **Inline prompt.** This runbook defines the watch-cron health-watch skill.
> Paste as context when Hermes fires a scheduled health-check tick.
> References:
> - `hive/references/orchestrator-skills/slack-notify-await.md` — alert transport (h-06 surface)
> - `hive/references/orchestrator-skills/monitor-epic.md` — epic-level reads (composable with this skill)
> - Research brief §7: meta nightly is a RemoteTrigger routine, NOT a repo workflow.
> No hermes-multica MCP tool covers health checks. Use `multica daemon status --output json` (CLI) for daemon
> health, RemoteTrigger routine inspection (`multica routine get <name> --output json`) for routines, and the
> slack-notify-await transport (HTTP webhook, `HERMES_SLACK_WEBHOOK_URL`) for alerts — none are MCP tools.

---

## 0. Purpose

watch-cron is the **health watch**. On each tick it:

1. Reads last-run status for each monitored RemoteTrigger routine.
2. Reads `multica daemon status` and classifies any down state.
3. If everything is healthy → emits nothing (quiet-on-health contract).
4. If any routine has failed, stalled, or the daemon is down → posts an alert via the Slack
   surface (h-06) and halts.

watch-cron is **read-only + alert-only**. It does not restart, re-dispatch, or mutate any state.
All writes — including gate latches — belong to reconcile-tick.

---

## 1. Monitored Targets

| Target | Kind | Stale-after |
|--------|------|-------------|
| `meta-nightly` | RemoteTrigger routine | 26 h (fires nightly; 2 h grace) |
| `autonomous-standup-loop` | RemoteTrigger routine | 26 h (fires nightly; PR #211) |
| `multica daemon` | Studio process | — (binary: up or down) |

**Critical caveat — meta-nightly is a RemoteTrigger routine, not a repo workflow.**
Its last-run data is visible via `multica_routine_status`, not via GitHub Actions or
`gh run list`. When checking it, confirm the routine read open PRs against `develop`
(that is the expected runtime behavior; a routine that ran but targeted the wrong branch
counts as a soft failure — flag it).

**Stale threshold:** if `last_run_at` is null (never ran) or older than the stale-after
window, treat the routine as stalled and alert.

---

## 2. When to Fire

| Trigger | Condition |
|---------|-----------|
| Scheduled cron | Any time the watch-cron job fires (typically every 1–4 h) |
| Manual operator request | Human asks for a health snapshot |
| **Never** | As a response to a reconcile-tick event — watch-cron is a sibling job, not a nested call |

watch-cron has **no gate_state check**. It runs regardless of `gate_state` or whether any
epic is in flight.

---

## 3. Step-by-Step

```
watch-cron(now):

  // Step 1 — read routine statuses (non-blocking; read-only)
  routine_results = []
  for target in MONITORED_ROUTINES:
      result = multica_routine_status(target.name)
      // Returns: { name, last_run_at, last_run_outcome, last_run_error, currently_running }
      routine_results.push({ target, result })

  // Step 2 — evaluate each routine
  routine_alerts = []
  for { target, result } in routine_results:
      status = classifyRoutine(target, result, now)   // see §4
      if status.alert:
          routine_alerts.push(status)

  // Step 3 — read daemon status
  daemon = multica_daemon_status()
  // Returns: { running, pid, uptime_seconds, keychain_accessible, session_type }
  daemon_status = classifyDaemon(daemon)              // see §5

  // Step 4 — quiet-on-health: if nothing is alertable, exit silently
  if routine_alerts.length == 0 AND daemon_status.alert == false:
      return { healthy: true }   // no Slack post, no write

  // Step 5 — build and post alert
  message = buildAlertMessage(routine_alerts, daemon_status, now)
  multica_slack_notify(message)

  // Step 6 — exit (no write, no gate_state mutation)
  return { healthy: false, alerts_posted: routine_alerts.length + (daemon_status.alert ? 1 : 0) }
```

**No `multica_write_state` calls. No dispatch. No file mutations. Read-only + notify only.**

---

## 4. Routine Classification

```
function classifyRoutine(target, result, now):

  // Never ran
  if result.last_run_at is null:
      return { alert: true, kind: "NEVER_RAN", name: target.name }

  // Currently running — not stale yet; suppress alert
  if result.currently_running:
      return { alert: false }

  // Stale check
  age_seconds = parseISO(now) - parseISO(result.last_run_at)
  if age_seconds > target.stale_after_seconds:
      return { alert: true, kind: "STALLED", name: target.name,
               last_run_at: result.last_run_at, age_seconds: age_seconds }

  // Last run failed
  if result.last_run_outcome != "success":
      return { alert: true, kind: "FAILED", name: target.name,
               last_run_at: result.last_run_at, error: result.last_run_error }

  return { alert: false }
```

**meta-nightly branch-target check:** if `result.branch_target` is available and is not
`develop`, append `soft_failure: "wrong_branch"` to the classification even if outcome was
`"success"`. Surface this as a WARNING in the alert (not a hard failure).

---

## 5. Daemon Classification

```
function classifyDaemon(daemon):

  if daemon.running:
      return { alert: false, up: true }

  // Daemon is not running — classify the cause where determinable
  cause = "UNKNOWN"

  if daemon.session_type != "Aqua" OR daemon.session_type is null:
      // No GUI Aqua session → Keychain is inaccessible by design
      cause = "SESSION_LOST"   // "daemon down" = session/Keychain lost, not crash

  else if daemon.keychain_accessible == false:
      // Aqua session exists but Keychain denied → locked/expired credentials
      cause = "KEYCHAIN_DENIED"

  else:
      // Aqua session present, Keychain accessible, but process not running → crash
      cause = "PROCESS_CRASHED"

  return { alert: true, up: false, cause: cause }
```

### Why this distinction matters

The Studio daemon requires a **GUI Aqua session** to access macOS Keychain credentials.
When the machine is headless (e.g. after a sleep/wake cycle or SSH-only login), the daemon
will not start — **this is expected, not a crash**. Alerting "process crashed" in that case
creates false urgency. The `cause` field in the alert lets the operator know whether they
need to:
- `SESSION_LOST` / `KEYCHAIN_DENIED` → open the Studio GUI (no restart needed; daemon will
  self-recover once the session is established).
- `PROCESS_CRASHED` → investigate logs and manually restart.

---

## 6. Alert Message Format

```
## Hermes Health Alert — <UTC_DATE>

### Routine Status

<For each alert in routine_alerts:>
- **<NAME>** — <KIND>
  - Last run: <last_run_at or "never">
  - Age: <age_seconds>s (threshold: <stale_after_seconds>s)
  - Error: <error or "—">
  - [WARN] Branch target: <branch_target> (expected: develop)   ← only if soft_failure

<If no routine alerts:>
- All routines healthy ✓

### Daemon Status

<If daemon up:>
- Daemon: UP (pid <pid>, uptime <uptime_seconds>s)

<If daemon down:>
- Daemon: DOWN — cause: **<CAUSE>**
  <If SESSION_LOST:>
  Action required: open Studio GUI to restore the Aqua session and Keychain access.
  The daemon will not auto-start without it. This is NOT a crash.
  <If KEYCHAIN_DENIED:>
  Action required: unlock or re-authorize Keychain credentials in the Studio GUI.
  <If PROCESS_CRASHED:>
  Action required: check Studio daemon logs and restart manually.
  <If UNKNOWN:>
  Unable to determine cause. Check Studio daemon logs.

### No Action Taken

watch-cron is read-only. No restarts or state changes were made.
```

Follow `standup-slack-format.md` conventions: no ANSI escape codes, `##`/`###` headings,
`-` lists, code blocks for any tabular or structured data.

---

## 7. Quiet-on-Health Contract

If every routine passed classification and the daemon is up, watch-cron **posts nothing**.
No "all clear" Slack message. No state write. Silence is the health signal.

Rationale: a recurring "all healthy" notification degrades into noise and trains operators
to dismiss alerts. Only deviations from healthy state deserve attention.

---

## 8. Invariants — Never Violated

| Invariant | Mechanism |
|-----------|-----------|
| **No restarts** | watch-cron calls no start/stop/dispatch tools |
| **No state writes** | No `multica_write_state` calls; gate_state untouched |
| **No auto-retry** | Failed Slack post → tick exits with error; no retry loop |
| **Quiet when healthy** | Alert path only fires when `routine_alerts.length > 0 OR daemon_status.alert` |
| **Daemon cause required** | `classifyDaemon` always sets `cause`; UNKNOWN is the explicit fallback, not silence |

---

## 9. Stale Thresholds Reference

| Routine | `stale_after_seconds` | Rationale |
|---------|----------------------|-----------|
| `meta-nightly` | `93600` (26 h) | Nightly cadence + 2 h grace for late starts |
| `autonomous-standup-loop` | `93600` (26 h) | Same cadence (PR #211); grace matches meta-nightly |

Adjust these values in the cron job configuration if cadence changes. watch-cron reads them
from `MONITORED_ROUTINES` — do not hardcode inside `classifyRoutine`.

---

## 10. MCP Tool Reference

| Tool | Args | Notes |
|------|------|-------|
| `multica_routine_status` | `routine_name` | Returns last-run metadata for a RemoteTrigger routine. If absent, use `multica routine get <name> --output json` via shell. |
| `multica_daemon_status` | _(none)_ | Returns daemon health including session_type and keychain_accessible fields. If absent, use `multica daemon status --output json` via shell. |
| `multica_slack_notify` | `message` ({ text: string }) | Studio fork Slack integration; reads webhook from `HERMES_SLACK_WEBHOOK_URL`. Post only on failure; never on healthy state. |

If MCP wrappers are absent, fall back to the `multica` CLI equivalents via shell and parse
the JSON output. The logic in §§3–6 is identical; only the call site changes.

---

## 11. Integration with Hermes Cron Schedule

watch-cron is a **sibling** of reconcile-tick, not a nested call inside it. Run them on
separate cron schedules or as independent cron entries in the same job:

```
// Pseudo-cron entry (runs every 2 hours)
0 */2 * * *   hermes-cron watch-cron --now <ISO8601_UTC>
```

The `--now` timestamp must come from the **cron run environment** (e.g. the shell `date -u +%Y-%m-%dT%H:%M:%SZ` at invocation time). Do NOT use `Date.now()` inside the runbook — Hermes has no clock access.

If watch-cron is bundled into the same cron tick as reconcile-tick, run watch-cron **first**
(as a pre-tick health gate). A daemon-down finding from watch-cron should cause the tick to
surface the alert and exit before reconcile-tick attempts any dispatch.
