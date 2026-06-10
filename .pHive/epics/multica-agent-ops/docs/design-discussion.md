# Design Discussion — multica-agent-ops

Author: technical-writer (mao-plan-writer)
Date: 2026-06-10
Epic: multica-agent-ops

---

## 1. What Are We Doing?

The user asked two questions: (1) how do agents get access to tools like the frame0 CLI or MCP servers, and does Multica's token cache make context-mode unnecessary? (2) how do we detect stuck squads or agents before a human notices?

For tool provisioning, the good news is the plumbing already exists — `.pHive/multica/agents.yaml` has three provisioning surfaces per agent (`mcp_config`, `custom_env`, `custom_args`), and the runtime wires them correctly. The work is **defining the convention** for declaring what each agent needs, closing an undocumented gap around `--strict-mcp-config` behavior, and patching the inconsistency in `CLAUDE_PLUGIN_PATH` handling across agents.

For stuck detection, three mechanisms already cover different windows (dispatch-loop timeout, stale-parent sweep, squad-leader contract). The gap is **live detection**: task `running`, last message timestamp stale, but no timeout has fired yet. We want a watchdog that can catch this.

"Done" looks like: (a) a verification spike answers two questions — whether `mcp_config: null` + `--strict-mcp-config` means zero MCP or falls back to `~/.claude`, and whether headless `claude -p` loads plugins at all; (b) provisioning conventions are documented and the `CLAUDE_PLUGIN_PATH` split is resolved; (c) a Python watchdog script exists that reports stuck agents and can optionally cancel them.

---

## 2. What I Found

**Tool provisioning surfaces** (from `claude.go` and `agents.yaml`):

Three levers exist per agent in `agents.yaml`:
- `mcp_config`: non-null → written to temp file → `--mcp-config <path>` appended. Null → flag omitted entirely. `{}` is invalid (claude CLI rejects it). (`multica-agents-schema.md`:29, `claude.go`:43-54)
- `custom_env`: merged over the full daemon host environment via `mergeEnv(os.Environ(), extra)`. Agents inherit host `PATH`, `HOME`, etc. Last-wins for duplicate keys. (`claude.go`:508-531)
- `custom_args`: appended to claude CLI args after filtering `claudeBlockedArgs`. `--mcp-config` is in the blocked set — you cannot inject MCP config via `custom_args`. (`claude.go`:408-421, 547-577)

The critical unknown: `--strict-mcp-config` is hardcoded into every claude spawn (`claude.go`:429). When `mcp_config: null`, no `--mcp-config` flag is passed — but `--strict-mcp-config` is still there. If that means "zero MCP servers," then developer, researcher, architect, backend-developer, and frontend-developer agents run with no MCP access today. Unverified.

Additional spawn hardcodes (background for security posture readers): `--permission-mode bypassPermissions` is hardcoded in every agent spawn — all headless sessions run with bypass permissions regardless of agent role.

**CLAUDE_PLUGIN_PATH split** (`agents.yaml`:87-105):

reviewer, peer-validator, tester, tpm → explicitly set `CLAUDE_PLUGIN_PATH` in `custom_env`.
developer, researcher, architect, backend-developer, frontend-developer → nothing in `custom_env`, rely entirely on daemon host env.

No comment explains why. If the daemon process was launched without `CLAUDE_PLUGIN_PATH` in its environment, the second group loads zero plugins. This is an inconsistency, not a deliberate design choice — the research found no evidence of intent.

**Token cache vs context-mode** (no finding supports a cache):

No evidence of a Multica-side token cache that substitutes for context-mode. They solve different problems: a prompt cache reduces **cost**; context-mode prevents **raw tool output from flooding the context window** within a session. A 56 KB command dump fills the window regardless of caching. Context-mode is still relevant — but only if MCP loads in headless sessions (see the critical unknown above).

**Stuck detection machinery** (three existing legs, one gap):
- `pollTaskUntilTerminal` (`episode-sync.mjs`:127-210): 30min timeout with auto-cancel. Only covers runs where a dispatch-loop is actively waiting.
- Stale-parent sweep (`multica-sweep-stale-parents.py`): post-run backstop. Catches "all children done but parent stuck." Does not catch live hung tasks.
- Squad-leader contract (`squad-leader-terminal-contract.md`): behavioral — leader must self-flip when done. Enforced by sweep as backstop.

The gap: agent crashes mid-run or enters an infinite reasoning loop. Task is `running`, no messages are being produced. Nothing detects this until a human notices or a dispatch-loop timeout fires.

---

## 3. My Proposed Approach

**Story 1 — MCP Availability Spike** (must go first)

The probe answers TWO questions: (a) does `--strict-mcp-config` without `--mcp-config` mean zero MCP or fallback to `~/.claude` defaults? (b) does headless `claude -p` load plugins at all? The probe MUST run through the real Multica dispatch path (real task claim in a test workspace), not a hand-rolled `claude -p` CLI call — daemon spawn conditions (`mergeEnv`, workdir injection, `--disallowedTools`) must be present. A CLI micro-test is supplementary only. Also: include a source read of `execenv.InjectRuntimeConfig` in the spike scope — cheap read that eliminates a floating HIGH risk (Q2). Output: one-paragraph finding posted as an issue comment, not a code change.

**Story 2 — Provisioning Convention Doc + CLAUDE_PLUGIN_PATH fix** (runs in parallel with Story 1)

Scope is **doc + CLAUDE_PLUGIN_PATH env hygiene only**. Add `CLAUDE_PLUGIN_PATH` to `custom_env` for developer, researcher, architect, backend-developer, and frontend-developer in `agents.yaml` — mirrors what reviewer/peer-validator/tester/tpm already do. The convention doc (`hive/references/agent-tool-provisioning.md`) covers the three surfaces, the `{}` gotcha, the `--mcp-config`-blocked-in-custom_args constraint, and must explicitly call out the `reconcileSkills`-before-`reconcileAgents` ordering constraint in bootstrap. Verification: `git diff agents.yaml` showing five agents now have `CLAUDE_PLUGIN_PATH` + clean bootstrap reconcile run. The "plugin actually loads" check moves behind the Story 1 spike gate and is NOT part of Story 2's acceptance.

**Story 3 — mcp_config wiring** (created as backlog; gated on Story 1 outcome)

Created as `backlog` and promoted based on spike outcome. The description must carry the explicit binary branch: spike shows zero-MCP → add `mcp_config` stanzas to agents that need context-mode or Frame0; spike shows fallback-to-defaults → close as no-op with comment explaining why.

**Story 4 — Python watchdog for live stuck detection**

Story 4a (report-only, no gate):
- First tasks: verify message timestamp field name (Q5) and `runtime.last_seen_at` update frequency (Q3) by direct source inspection. If both fail, degrade gracefully to "running > N minutes" report-only and say so.
- Enumerate all RUNNING TASKS (via `multica task list --status running`), not in_progress issues. Squad-assigned parents with no running task fall out of scope by construction. Sweep and watchdog are disjoint layers: watchdog = live task-level; sweep = post-run issue-level. Reuse the sweep's BLOCKED-comment exclusion to avoid re-flagging annotated issues.
- Staleness signal: prefer "last activity" (tool events) over "last assistant message" if available — tool events fire during long Bash calls where no assistant message is produced.
- Threshold: 15 minutes. Output of 4a IS the missing message-cadence evidence — establishes a baseline before 4b can set a safe cancel threshold.
- Target metric: median time-to-detection ≤ 20 min (15-min threshold + ≤5-min scan cadence); false-positive rate < 10% over a trailing week. Numbers adjustable at decomposition; shape fixed now.

Story 4b (--apply mode, gated on 4a data):
- Cancel threshold: 45 minutes — strictly above the 30-min `pollTaskUntilTerminal` wall clock. This ordering eliminates the canceller race by construction: a task still being polled by a dispatch-loop will have its own cancel fire first.
- Residual risk: cancel endpoint takes no reason parameter — provenance is lossy if a watchdog cancel ever lands in a poll window. Acceptable at 45-min threshold; document it in the script.

Both sub-stories follow the stdlib-only Python pattern of `multica-sweep-stale-parents.py`.

---

## 4. What Could Go Wrong

**[HIGH]** The MCP spike could reveal that `--strict-mcp-config` without `--mcp-config` is already "use `~/.claude` defaults." If so, Story 3 becomes a no-op. Story 1 must produce a clear binary answer.

**[HIGH]** `execenv.InjectRuntimeConfig` behavior is unknown. If it writes a CLAUDE.md including context-mode routing instructions, agents may already be correctly configured. Conversely, if skills are not written to disk, skill content referenced in `agents.yaml` never reaches the agent. Folded into Story 1 spike scope for cheap resolution.

**[MEDIUM]** No empirical baseline for healthy-run message cadence. Episode message files were empty for completed runs — the 15-minute staleness threshold is an informed guess, not observed data. Story 4a's report mode exists partly to produce this baseline before --apply is enabled.

**[MEDIUM]** Persona drift on session resume. Bootstrap stores persona in the API `instructions` field; daemon writes it to disk at task claim time. If a Claude session is resumed from an existing worktree, it may run with a CLAUDE.md from a prior persona version. (`daemon.go`:2231-2238)

**[MEDIUM]** `runtime.last_seen_at` may be stale by design. If the daemon updates this only on task completion rather than heartbeat, a runtime with a long-running task shows stale `last_seen_at` even if healthy. Story 4's first task resolves update frequency before this signal is used.

**[LOW]** `CLAUDE_PLUGIN_PATH` in `custom_env` for all agents means every agent must have the same plugin root. If future agents are deployed in environments where the path differs, this breaks. Out of scope for this epic.

**[LOW]** `--disallowedTools AskUserQuestion` is hardcoded (`claude.go`:437). Any persona or skill referencing "ask the user for clarification via AskUserQuestion" is dead code. Worth auditing during Story 2.

---

## 5. Dependencies and Constraints

- **Story 1 → Story 3**: MCP spike result is a gate. Story 3 created as `backlog`, promoted based on outcome.
- **Story 2 is independent**: `CLAUDE_PLUGIN_PATH` fix and convention doc run in parallel with Story 1.
- **Story 4a is independent**: Watchdog enumeration and report mode can be built without resolving the MCP question. Q3 and Q5 are Story 4a's first tasks — resolved by source inspection before code is written.
- **Story 4a → Story 4b**: `--apply` mode is gated on 4a data establishing a cadence baseline.
- **Python-only for scripts**: New scripts must be Python stdlib-only, per the pattern in `multica-sweep-stale-parents.py`.
- **No new Node logic in episode-sync or story-dispatch**: Stuck detection belongs in the Python watchdog.
- **frame0 / context-mode for non-hive agents**: Scope stays focused on hive agents unless the spike reveals a broader gap.

---

## 6. Open Questions

1. **--strict-mcp-config without --mcp-config**: Zero MCP, or fallback to `~/.claude` defaults? Binary answer needed. (Story 1 spike resolves this.)

2. **Skill content in workdir**: Where does `AgentContextForEnv` render skills? Individual files under `.claude/skills/` or bundled into persona CLAUDE.md? Does not block any story.

3. **Which agents need frame0 today?**: ui-designer is the obvious candidate. If nothing in the current agent roster needs frame0, Story 3 scope narrows to context-mode only.

4. **Is the MCP spike a blocker for this epic or a follow-up?**: If the spike shows MCP is already working, the epic is mostly documentation + watchdog. If it shows zero MCP, scope expands significantly.

---

## 7. Verification Strategy

Story 1 (spike) is its own verification — output is an empirical observation, not code.

Story 2 (provisioning doc + CLAUDE_PLUGIN_PATH fix):
- `git diff agents.yaml` showing five agents now have `CLAUDE_PLUGIN_PATH` in `custom_env`
- Clean `multica-bootstrap` reconcile run (no SKILL_NOT_FOUND aborts)

Story 4 (watchdog):
- Unit tests with mocked `multica` CLI output for each classification path (STUCK, RUNNING, COMPLETED)
- End-to-end: run against a real workspace with a known-stuck issue
- Success metric: report-mode median time-to-detection ≤ 20 min; false-positive rate < 10% over a trailing week

```
VERIFICATION PLAN:
  Tools: pytest (Story 4), multica CLI (Stories 1, 2)
  Platforms: macOS/Linux (daemon environment)
  Automated: Story 4 unit tests (stuck classification logic)
  Manual: Story 1 probe run; Story 2 bootstrap reconcile
  Not verifying: load/scale behavior of the watchdog at large issue counts
```

---

## 8. Scale Assessment

**Files affected:**
- `.pHive/multica/agents.yaml` — `CLAUDE_PLUGIN_PATH` additions for 5 agents (Story 2)
- `scripts/multica-watch-stuck.py` — new file (Story 4)
- `hive/references/agent-tool-provisioning.md` — new doc (Story 2)
- Possibly `agents.yaml` again for `mcp_config` stanzas (Story 3, backlog)
- `tests/` — pytest suite for watchdog (Story 4)

**Subsystems affected:**
- agents.yaml / multica-bootstrap (provisioning)
- scripts/ (watchdog)
- multica runtime CLI (watchdog polling)
- hive/references/ (documentation)

**Migration required:** No. agents.yaml changes take effect on next bootstrap reconcile run.

**Cross-team coordination:** No. All assets live in plugin-hive.

**Unknowns:** 2 significant remaining (Q1 MCP behavior — spike needed; Q2 skill rendering location — does not block). Q2/Q3/Q5 folded into Story 1 and Story 4 first-tasks respectively.

```
SCALE ASSESSMENT:
  Files affected: ~5 (2 new, 3 modified)
  Subsystems: provisioning (agents.yaml/bootstrap), scripts, hive/references, runtime CLI
  Migration required: no
  Cross-team coordination: no
  Unknowns: 2 (Q1 MCP behavior — spike needed; Q4 skill rendering — does not block)

  RECOMMENDATION: Proceed to stories
  RATIONALE: Scope is well-bounded. Three to four stories, at most one of which expands based on
  spike outcome. Story 4 slices cleanly into report-only (4a) and apply (4b) with a data gate
  between them. The design discussion provides enough context for story decomposition.
  Recommend Small-to-Medium estimate: spike + convention doc + watchdog script, with mcp_config
  wiring as a conditional follow-on.
```
