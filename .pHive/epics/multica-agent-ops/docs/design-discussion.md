# Design Discussion — multica-agent-ops

Author: technical-writer (mao-plan-writer)
Date: 2026-06-10
Epic: multica-agent-ops

---

## 1. What Are We Doing?

The user asked two questions: (1) how do agents get access to tools like the frame0 CLI or MCP servers, and does Multica's token cache make context-mode unnecessary? (2) how do we detect stuck squads or agents before a human notices?

For tool provisioning, the good news is the plumbing already exists — `.pHive/multica/agents.yaml` has three provisioning surfaces per agent (`mcp_config`, `custom_env`, `custom_args`), and the runtime wires them correctly. The work is **defining the convention** for declaring what each agent needs, closing an undocumented gap around `--strict-mcp-config` behavior, and patching the inconsistency in `CLAUDE_PLUGIN_PATH` handling across agents.

For stuck detection, three mechanisms already cover different windows (dispatch-loop timeout, stale-parent sweep, squad-leader contract). The gap is **live detection**: issue status `in_progress`, task running, last message timestamp stale, but no timeout has fired yet. We want a watchdog that can catch this.

"Done" looks like: (a) a verification spike answers whether `mcp_config: null` + `--strict-mcp-config` means zero MCP or falls back to `~/.claude`; (b) provisioning conventions are documented and the `CLAUDE_PLUGIN_PATH` split is resolved; (c) a Python watchdog script exists that reports stuck agents and can optionally cancel them.

---

## 2. What I Found

**Tool provisioning surfaces** (from `claude.go` and `agents.yaml`):

Three levers exist per agent in `agents.yaml`:
- `mcp_config`: non-null → written to temp file → `--mcp-config <path>` appended. Null → flag omitted entirely. `{}` is invalid (claude CLI rejects it). (`multica-agents-schema.md`:29, `claude.go`:43-54)
- `custom_env`: merged over the full daemon host environment via `mergeEnv(os.Environ(), extra)`. Agents inherit host `PATH`, `HOME`, etc. Last-wins for duplicate keys. (`claude.go`:508-531)
- `custom_args`: appended to claude CLI args after filtering `claudeBlockedArgs`. `--mcp-config` is in the blocked set — you cannot inject MCP config via `custom_args`. (`claude.go`:408-421, 547-577)

The critical unknown: `--strict-mcp-config` is hardcoded into every claude spawn (`claude.go`:429). Claude Code's semantics for `--strict-mcp-config` are "use only MCP servers from `--mcp-config` flags, ignoring all other config sources." When `mcp_config: null`, no `--mcp-config` flag is passed — but `--strict-mcp-config` is still there. If that means "zero MCP servers," then developer, researcher, architect, backend-developer, and frontend-developer agents run with no MCP access today. That's five of the core agents. Unverified.

**CLAUDE_PLUGIN_PATH split** (`agents.yaml`:87-105):

reviewer, peer-validator, tester, tpm → explicitly set `CLAUDE_PLUGIN_PATH` in `custom_env`.
developer, researcher, architect, backend-developer, frontend-developer → nothing in `custom_env`, rely entirely on daemon host env.

No comment explains why. If the daemon process was launched without `CLAUDE_PLUGIN_PATH` in its environment, the second group loads zero plugins. This is an inconsistency, not a deliberate design choice — the research found no evidence of intent.

**Token cache vs context-mode** (no finding supports a cache):

No evidence of a Multica-side token cache that substitutes for context-mode. More importantly, they solve different problems: a prompt cache reduces the **cost** of reusing repeated context; context-mode prevents **raw tool output from flooding the context window** within a session. A 56 KB command dump fills the window regardless of caching. Even with a perfect prompt cache, an unrouted `cat package.json | grep ...` still dumps 400 lines into context. The honest answer: context-mode is still relevant — but only if MCP loads in headless sessions (see the critical unknown above). If MCP is off, agents survive on Bash discipline alone, which is the current status quo.

**Stuck detection machinery** (three existing legs, one gap):
- `pollTaskUntilTerminal` (`episode-sync.mjs`:127-210): 30min timeout with auto-cancel. Only covers runs where a dispatch-loop is actively waiting. Sub-issues dispatched without a waiting poller are invisible to this.
- Stale-parent sweep (`multica-sweep-stale-parents.py`): post-run backstop. Catches the "all children done but parent stuck" case. Does not catch live hung tasks where the agent is still running.
- Squad-leader contract (`squad-leader-terminal-contract.md`): behavioral — leader must self-flip when done. Enforced by sweep as backstop. Covers squad-style issues, not single-agent tasks.

The gap: an agent crashes mid-run, or enters an infinite reasoning loop. Issue is `in_progress`, task is `running`, but no messages are being produced. Nothing detects this until a human notices or a dispatch-loop timeout fires (which only helps if someone was waiting).

---

## 3. My Proposed Approach

I'd structure this as three to four stories, in dependency order:

**Story 1 — MCP Availability Spike** (must go first)

A short probe task that runs a claude headless session with `--strict-mcp-config` but no `--mcp-config` and attempts to call an MCP tool. The result answers Q1 definitively. This is a blocker for Story 3 (wiring mcp_config for agents) — we don't want to add mcp_config to every agent if the current setup already works. The story should output a one-paragraph finding posted as an issue comment, not a code change.

**Story 2 — Provisioning Convention Doc + CLAUDE_PLUGIN_PATH fix** (can run in parallel with Story 1)

Add `CLAUDE_PLUGIN_PATH` to `custom_env` for developer, researcher, architect, backend-developer, and frontend-developer in `agents.yaml`. This mirrors what reviewer/peer-validator/tester/tpm already do. Run `multica-bootstrap` reconcile to apply. Also write `hive/references/agent-tool-provisioning.md` documenting the three surfaces, when to use each, the `{}` gotcha, and the `--mcp-config`-blocked-in-custom_args constraint.

**Story 3 — mcp_config wiring** (gated on Story 1 outcome)

If the spike shows `mcp_config: null` = zero MCP: add `mcp_config` stanzas to agents that need context-mode or Frame0. Right now, frame0 likely only matters for ui-designer (no active UI work in hive itself — consumer projects handle this). context-mode matters for all agents if they run tool-heavy workflows. Shape TBD based on spike output — this story may be very small or unnecessary.

**Story 4 — Python watchdog for live stuck detection**

A new script `scripts/multica-watch-stuck.py`, following the stdlib-only Python pattern of `multica-sweep-stale-parents.py`. Logic:
1. List all `in_progress` issues via `multica issue list --status in_progress --output json`
2. For each, check active task via `multica issue get {id}` + task status
3. Fetch latest message timestamp via task messages endpoint (Q5 — field name needs verification)
4. If task `running` + last message > N minutes → flag as STUCK
5. Report to stdout by default; `--apply` posts a comment and cancels the task
6. Also check `multica runtime list --output json` for runtime `last_seen_at` as a secondary signal (after verifying freshness, Q3)

Default threshold: 15 minutes for message staleness. Default: report-only. This mirrors the --apply opt-in pattern in the sweep script.

---

## 4. What Could Go Wrong

**[HIGH]** The MCP spike could reveal that `--strict-mcp-config` without `--mcp-config` is already "use `~/.claude` defaults." If so, agents with `mcp_config: null` already have context-mode (if the daemon's env carries `CLAUDE_PLUGIN_PATH`). Story 3 becomes a no-op. We need to design Story 1 to produce a clear binary answer.

**[HIGH]** `execenv.InjectRuntimeConfig` behavior is unknown (Q2, Q4). If it writes a CLAUDE.md that includes the context-mode routing instructions, agents may already be correctly configured despite appearances. Conversely, if skills are NOT written to disk, the skill content referenced in agents.yaml never reaches the agent. The execenv package was not in the read scope — this is a gap.

**[MEDIUM]** Persona drift on session resume. Bootstrap stores persona in the API `instructions` field; daemon writes it to disk at task claim time. If a Claude session is resumed from an existing worktree, it may run with a CLAUDE.md written from a prior persona version. Changes to `persona_ref` content require a new task claim to take effect. (`daemon.go`:2231-2238)

**[MEDIUM]** The watchdog depends on a message timestamp API (Q5) that wasn't verified. If `GET /api/tasks/{id}/messages` doesn't expose per-message timestamps, or the field name differs, the stuck-detection heuristic degrades to "task running > N minutes" which catches long-running tasks, not just stuck ones.

**[MEDIUM]** `runtime.last_seen_at` may be stale by design. If the daemon updates this only on task completion (not heartbeat), a runtime with a long-running task will show a stale `last_seen_at` even if healthy. Using this as a liveness signal without verifying update frequency (Q3) would produce false positives.

**[LOW]** `CLAUDE_PLUGIN_PATH` in `custom_env` for all agents means every agent must have the same plugin root. If future agents are deployed in environments where the path differs, this breaks. A relative path or env-var reference would be more robust — but that's out of scope for this epic.

**[LOW]** `--disallowedTools AskUserQuestion` is hardcoded (`claude.go`:437). Any persona or skill that references "ask the user for clarification via AskUserQuestion" is dead code. Worth auditing during Story 2 to avoid confusing agents.

---

## 5. Dependencies and Constraints

- **Story 1 → Story 3**: MCP spike result is a gate. Story 3 should be created as `backlog` and promoted based on spike outcome.
- **Story 2 is independent**: `CLAUDE_PLUGIN_PATH` fix and convention doc can run in parallel with Story 1.
- **Story 4 is independent**: Watchdog can be built without resolving the MCP question. It depends only on the `multica` CLI being available, which is already true in the sweep pattern.
- **Q3 (last_seen_at freshness)** should be answered before Story 4 is implemented — if unreliable, watchdog must not depend on it as a primary signal.
- **Python-only for scripts**: `multica-story-dispatch` (Node) is a named bridge. New scripts must be Python stdlib-only, per the pattern in `multica-sweep-stale-parents.py`.
- **No new Node logic in episode-sync or story-dispatch**: Stuck detection belongs in the Python watchdog, not in the dispatch-loop code.
- **frame0 / context-mode for non-hive agents**: ui-designer and Frame0 are primarily a concern for consumer projects, not hive itself. Scope should stay focused on hive agents unless the spike reveals a broader gap.

---

## 6. Open Questions

1. **--strict-mcp-config without --mcp-config**: Zero MCP, or fallback to `~/.claude` defaults? Binary answer needed. (Story 1 spike resolves this.)

2. **execenv.InjectRuntimeConfig contents**: What does it write to the workdir? CLAUDE.md? AGENTS.md? Are skill files written individually? This affects whether skills declared in `agents.yaml` actually reach the agent.

3. **runtime.last_seen_at update frequency**: Heartbeat or per-task-event? Determines whether it's a valid liveness signal for the watchdog.

4. **Skill content in workdir**: Where does `AgentContextForEnv` render skills? Individual files under `.claude/skills/` or bundled into persona CLAUDE.md?

5. **Message timestamp field**: What field name does `GET /api/tasks/{id}/messages` return for per-message timestamps? Watchdog Story 4 depends on this.

6. **Which agents need frame0 today?**: ui-designer is the obvious candidate, but hive itself has no active UI work. Does anything in the current agent roster need frame0? If not, Story 3 scope may be "context-mode for tool-heavy agents only."

7. **Is the MCP spike a blocker for this epic or a follow-up?**: If the spike shows MCP is already working, the epic is mostly documentation + watchdog. If it shows zero MCP, scope expands significantly.

---

## 7. Verification Strategy

Story 1 (spike) is its own verification — the output is an empirical observation, not code.

Story 2 (provisioning doc + CLAUDE_PLUGIN_PATH fix) should be verified by:
- `git diff agents.yaml` showing the five agents now have `CLAUDE_PLUGIN_PATH` in `custom_env`
- Running `multica-bootstrap` reconcile dry-run or full run; confirm no SKILL_NOT_FOUND aborts
- Manual check: trigger a researcher or developer agent task and confirm plugin load (e.g., context-mode tool appears in MCP list)

Story 4 (watchdog) should be verified by TDD, mirroring `multica-sweep-stale-parents.py`:
- Unit tests with mocked `multica` CLI output for each classification path (STUCK, RUNNING, COMPLETED)
- End-to-end: run against a real workspace with a known-stuck issue (or simulate via a long-running test task)

```
VERIFICATION PLAN:
  Tools: pytest (Story 4), multica CLI (Stories 1, 2)
  Platforms: macOS/Linux (daemon environment)
  Automated: Story 4 unit tests (stuck classification logic)
  Manual: Story 1 probe run; Story 2 bootstrap reconcile + agent task spot-check
  Not verifying: load/scale behavior of the watchdog at large issue counts (out of scope)
```

---

## 8. Scale Assessment

**Files affected:**
- `.pHive/multica/agents.yaml` — `CLAUDE_PLUGIN_PATH` additions for 5 agents (Story 2)
- `scripts/multica-watch-stuck.py` — new file (Story 4)
- `hive/references/agent-tool-provisioning.md` — new doc (Story 2)
- Possibly `agents.yaml` again for `mcp_config` stanzas (Story 3, gated)
- `tests/` — pytest suite for watchdog (Story 4)

**Subsystems affected:**
- agents.yaml / multica-bootstrap (provisioning)
- scripts/ (watchdog)
- multica runtime CLI (watchdog polling)
- hive/references/ (documentation)

**Migration required:** No. agents.yaml changes take effect on next bootstrap reconcile run.

**Cross-team coordination:** No. All assets live in plugin-hive.

**Unknowns:** 3 significant (Q1 MCP behavior, Q2 execenv contents, Q3 last_seen_at frequency). Q1 is a blocker for scoping Story 3. Q2 is a risk that could invalidate Story 2 assumptions. Q3 shapes Story 4 design.

```
SCALE ASSESSMENT:
  Files affected: ~5 (2 new, 3 modified)
  Subsystems: provisioning (agents.yaml/bootstrap), scripts, hive/references, runtime CLI
  Migration required: no
  Cross-team coordination: no
  Unknowns: 3 (Q1 MCP behavior — spike needed; Q2 execenv — read needed; Q3 last_seen_at — check needed)

  RECOMMENDATION: Proceed to stories
  RATIONALE: Scope is well-bounded. Three to four stories, at most one of which expands based on spike
  outcome. The design discussion provides enough context for story decomposition. A structured
  outline would add overhead without clarifying anything — the unknowns are empirical (need a probe),
  not structural (need more design work). Recommend Small-to-Medium estimate: spike + convention doc
  + watchdog script, with mcp_config wiring as a conditional follow-on.
```
