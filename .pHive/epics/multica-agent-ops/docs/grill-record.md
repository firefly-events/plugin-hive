# Grill Record — multica-agent-ops

Target: `.pHive/epics/multica-agent-ops/docs/design-discussion.md` (draft, 2026-06-10)
Inputs: research-brief `inconsistency_risk_signals` (present), `.pHive/CONTEXT.md` (present)
Mode: descriptive findings only; each ends with a question for the planner.

---

## Vocabulary mismatches

**G1 — "stuck squads" vs single-agent watchdog framing.**
The original request says "detect stuck multica **squads** or agents." Story 4's
logic (§3) enumerates issues + active tasks + message staleness — a single-agent
task lens. Squad-assigned parents have different stuck semantics (leader exited,
children mid-flight, parent quiet is *normal*), which the sweep already handles
post-run via `SWEEPABLE_ASSIGNEE_TYPES`. The draft never says which assignee
types the watchdog covers or how it avoids re-classifying healthy squad parents
the sweep would call BLOCKED/ACTIVE.
*Question: does Story 4 cover `squad`-assigned parents, and if so, how does its
live classification compose with the sweep's post-run verdicts?*

## Hidden assumptions

**G2 — `--strict-mcp-config` semantics asserted from model knowledge, not repo
evidence.** §2 states the flag's meaning as fact ("use only MCP servers from
--mcp-config flags") while the research brief marks the null-interaction
unverified. The spike resolves the *interaction*, but the draft's confidence in
the *semantics* shapes Story 3's default expectation (zero-MCP). If the spike is
built as a hand-rolled `claude -p` invocation rather than a real daemon-spawned
task, its environment may diverge from production spawn conditions
(`mergeEnv`, workdir injection, `--disallowedTools`).
*Question: will the Story 1 probe run through the actual Multica dispatch path
(real task claim) rather than a simulated CLI call?*

**G3 — Story 2 wires `CLAUDE_PLUGIN_PATH` before knowing whether headless
sessions load plugins at all.** §3 calls Story 2 independent of Story 1, but its
own verification step ("confirm context-mode tool appears in MCP list") is
exactly Story 1's question. If headless `claude -p` doesn't load plugins
regardless of env, the five-agent env addition is wiring-on-faith — the same
shape the audit-only anti-pattern guard exists to catch (wire X only when
consumer Y demonstrably names X).
*Question: should the CLAUDE_PLUGIN_PATH addition move behind the spike gate,
leaving Story 2 as convention-doc-only?*

**G4 — 15-minute message-staleness default assumes agents emit messages during
long tool runs.** A 20-minute test suite or build executed via one Bash call may
produce no assistant messages while healthy. The draft picks 15 minutes with no
evidence basis. Report-only default mitigates, but `--apply` would cancel
healthy long-running tasks.
*Question: what observed message-cadence data (e.g., from existing episode
sidecars) supports the threshold, and should `--apply` require a higher
threshold than report mode?*

## Unresolved tensions

**G5 — two auto-cancellers can race.** `pollTaskUntilTerminal` auto-cancels at
its 30-min wall clock; the watchdog's `--apply` cancels at 15-min staleness. An
issue being actively polled by a dispatch driver could be cancelled out from
under it by the watchdog, making the driver report a spurious failure mode.
*Question: how does the watchdog distinguish "orphaned in_progress task" from
"task a dispatch-loop is actively waiting on" — or is cancel considered safe to
race?*

## Convention violations

**G6 — none found.** Python-stdlib watchdog, report-first `--apply` opt-in,
named-bridge boundary respected, Story 3 gated rather than wired-just-in-case —
all consistent with charter and prior feedback patterns.

## Posture mismatches

**G7 — no measurable outcome named for the epic's second half.** Prior feedback
sets the bar "detect stale teammates in minutes, not hours." The draft proposes
machinery but no number that moves (e.g., median time-to-detection for a stuck
run, false-positive rate of report mode). Story metric blocks will force this at
decomposition; deciding it now avoids a thin retrofit.
*Question: what is the target detection latency and acceptable false-positive
rate for the watchdog's report mode?*
