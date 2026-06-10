# Re-scope Memo — Multica substrate vs Claude Code dynamic workflows

**Date:** 2026-05-29
**Trigger:** CC dynamic workflows shipped GA (2.1.154, installed locally). Re-validation of `multica-substrate-deepen` findings surfaced a premise conflict, not a line-edit. Per `feedback_scope_class_changes` this is a scope-class decision for the maintainer.
**Status:** decision-pending. No stories changed by this memo.

---

## 1. What CC now ships natively

| CC version | Capability | Maps to Multica feature |
|---|---|---|
| 2.1.154 | **Dynamic workflows** — orchestrate tens-to-hundreds of background agents; `/workflows` to view runs | Multi-agent fan-out / story dispatch |
| 2.1.139 | `claude agents` background dispatch (`--agent`, model/perm/effort flags); `/goal` cross-turn completion | Daemon-hosted background execution |
| ~2.1.13x | `/loop` recurring + cron scheduling tools (session-scoped; `CLAUDE_CODE_DISABLE_CRON`) | Autopilot time-based firing |
| 2.1.32–33 | Agent teams (`TeamCreate`/`SendMessage`); `Task(agent_type)` spawn restriction; agent `memory` scope. **Still plan-gated / `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`** | Squad coordination |
| 2.1.157 | Skills auto-load from `.claude/skills` (no marketplace); `claude plugin init` | Skill distribution to dispatched agents |

Local: CC 2.1.154. Dynamic workflows GA (no flag). Agent-teams flag NOT set.

---

## 2. Overlap drill — per substrate dimension

| Dim | Multica-deepen builds | CC native equivalent | Overlap | Multica residual value |
|---|---|---|---|---|
| Multi-agent fan-out | depth-batched story dispatch, 1 agent/role serial | dynamic workflows (tens-to-hundreds, background) | **HIGH** | persistent daemon; runs outlive any CC client; swim-lane queue |
| Background / headless | daemon-hosted, survives client | `claude agents`, `/bg`, background subagents | **MED-HIGH** | true server (multi-client, webhook-triggerable, no live CC process) |
| Scheduling / autopilots | cron + **webhook** firing | `/loop`, cron, `/goal`, RemoteTrigger | **HIGH** (time-based) | external webhook (GitHub merge → skill) with NO CC session; CC cron dies with session |
| Persona registry | agents.yaml → 22 Multica agent rows | `.claude/agents/*.md` + `--agent` (source of truth already) | **MED** | none if executor is CC — agents.yaml is a duplicate projection |
| Skills | Mode D-a export + substrate bundling + CI drift guard | skills auto-load from `.claude/skills` | **MED** | only matters if skills run in a NON-CC runtime; substrate-bundling (grill H4) exists *because* Multica is foreign runtime |
| Provider heterogeneity | agent.provider = codex/qwen | per-agent `model`/`provider` frontmatter + CCR + sandcastle Qwen routing | **LOW** | Multica's real moat — IF codex-provider works. **S0.1 still UNCONFIRMED** |

---

## 3. What survives / what's subsumed

**Survives (Multica still earns keep):**
- Always-on server decoupled from any CC client/host — true headless, multi-client.
- External webhook triggers (e.g. GitHub merge → autopilot) with no live CC session.
- Heterogeneous per-agent runtimes — **conditional on S0.1 codex-provider confirmation**.
- Durable cross-session issue/story queue + state.

**Subsumed by CC `/workflows` + `--agent` + local skills:**
- In-session multi-agent fan-out for one epic execution.
- Persona dispatch (no agents.yaml projection needed).
- Time-based scheduling inside a working session.
- Skill availability to dispatched agents.

---

## 4. Swing factor

**S0.1 (codex-provider on Multica) is the hinge.** If Multica runs heterogeneous runtimes natively → dimension 6 is a genuine moat, Multica keeps strategic weight. If only `claude` provider works → Multica's biggest differentiator collapses to "headless webhook queue," and CC `/workflows` subsumes most of the rest. S0.1 is still open (research-brief §risk-1, design-discussion §S0.1). **Resolve S0.1 before committing further build.**

---

## 5. Decision options (maintainer's call)

- **A — Narrow to moat.** Keep Multica only for (i) always-on webhook autopilots, (ii) heterogeneous-provider execution. Drop agents.yaml projection, Mode D-a skill-export, squad schema. Let CC `/workflows` + `--agent` + local skills handle in-session multi-agent. Large scope cut.
- **B — Continue as planned.** Full alternative substrate; bet server-grade headless + provider heterogeneity outvalue native CC workflows. Risk: building a parallel orchestrator CC now ships natively.
- **C — Pivot executor, Multica as queue/trigger front-end.** `/workflows` orchestrates execution; Multica becomes durable issue queue + external-trigger that *kicks off* CC workflows. Best-of-both; needs a `/workflows` invocation seam.
- **D — Pause + spike `/workflows` first** (per `feedback_test_offtheshelf_before_rewriting`). Bounded: run one hive epic via `/workflows`, compare cost/fidelity/visibility to a Multica round-trip. Then choose A/B/C with data.

**Recommended sequence:** D → resolve S0.1 → then A or C. B only if both D and S0.1 come back strongly pro-Multica.

---

## 6. Findings unaffected by this memo (still hold)

- pilot-roundtrip-validation PARTIAL PASS — Multica server GET omits `content_hash`/`visibility`; W4.4 still blocked on warm-path fix.
- integration-principle — holds for Multica-only (1 agent/role); rule 5 breaks only if CC `/workflows` becomes the executor (Option C).
- squad / autopilot schema docs — substrate-internal; valid as written.

*Authored direct (interactive re-validation session), epic multica-substrate-deepen. Not yet maintainer-reviewed.*
