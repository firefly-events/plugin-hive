# Sandcastle + Atoshell — Positioning Research

**Date:** 2026-05-08
**Status:** research-only, planning paused per user request after research step
**Trigger:** evaluate two new tools alongside in-flight CWC 2026 epic + deferred mattpocock atomic-skill audit

## Tool snapshots

### sandcastle (`@ai-hero/sandcastle`)

- **Author:** mattpocock (same author as `mattpocock/skills` — the deferred audit subject)
- **Repo:** github.com/mattpocock/sandcastle
- **Maturity:** 3,932 stars, ~934 commits, MIT, TS, daily activity. Created 2026-03-17, last push 2026-05-08. Production-shaped (changesets, ADRs, multi-release week).
- **Purpose:** TypeScript library that orchestrates AI coding agents inside isolated sandboxes via `sandcastle.run()`, with branch-strategy commits merged back to host.
- **Surface:** Programmatic JS/TS lib + `sandcastle init` scaffolder. NOT a Claude Code plugin. Sits ABOVE the Claude Code CLI — wraps it, dispatches inside Docker/Podman/Vercel containers.
- **Primitives:** `run()` / `interactive()` / `createSandbox()`; `SandboxProvider` (Docker/Podman/Vercel/no-sandbox/custom); `AgentProvider` (`claudeCode`, `codex`, `opencode`, `pi`); branch strategies (`head` / `merge-to-head` / `branch`); host vs sandbox `hooks`; `Output.object()` structured output via Zod + XML tags; `completionSignal` strings; session capture/resume against Claude Code's `~/.claude/projects/.../sessions/<id>.jsonl`.
- **Claim:** Provider-agnostic, prompt-flexible orchestrator that "imposes no opinions about workflow, task management, or context sources." Lets you parallelize AFK agents and chain `implement → review` on the same branch/container.
- **Integration:** Native Claude Code CLI integration (captures session JSONLs so `claude --resume` works). Multi-provider. No MCP/plugin surface.

### atoshell (`atoshell` / `ato`)

- **Author:** GeekKingCloud
- **Repo:** github.com/GeekKingCloud/atoshell
- **Maturity:** 0 stars, 0 forks, 0 issues, GPL-3.0, Shell. Created 2026-05-05 (3 days old). Single squashed commit (`v2.0.0`, 2026-05-07). Pre-discovery.
- **Purpose:** Curl-installable, agentic-first terminal ticket tracker — local kanban over plain JSON files, no account/cloud.
- **Surface:** Bash CLI installed via `curl | bash`. Requires bash, jq, git. Standalone — not a Claude Code plugin, no MCP, no library API.
- **Primitives:** Tickets in `.atoshell/`; columns (kanban, default 3 active + done); `take next` priority/size selector; disciplines (Frontend/Backend/Database/Cloud/DevOps/Architecture/Automation/QA/Research/Core); `--as <agent>` flag; `--json` agent-friendly output; `--import` batch JSON import.
- **Claim:** "Agentic-first" — JSON-on-disk + `--json` flags + `--as <agent>` so agents author/import tickets without account/cloud setup friction.
- **Integration:** Shell + JSON files only.

## Overlap with current Hive work

### sandcastle ↔ CWC 2026 (in flight)

CWC 2026's **Group A (Substrate)** rewrites Hive's session loop using Messages API directly:
- A1 — session-spec rewrite as substrate abstraction
- A2 — Messages-API session loop module (caller-side execution)
- A3 — prior-knowledge block + two-call merge
- A6 — `CLAUDE_CODE_SESSION_ID` correlation
- A4/A5/A7 — substrate flag, dead-code gating, agent-spawn flow updates

**Sandcastle implements much of this concern directly:**
- Wraps Claude Code CLI execution inside containers
- Captures + resumes Claude Code session JSONLs (the same `~/.claude/projects/...` files A6 wants to correlate)
- Parallel agent runs with branch strategies (the parallel substrate Hive needs)
- `Output.object()` structured-output via Zod + XML tags ≈ rubric loops (Group B / S14-S15) want
- Session capture/resume mirrors Hive's pane-coordination model

**Important distinction:** sandcastle wraps **Claude Code CLI**. CWC 2026's A-group writes a **Messages API caller-side loop** (cuts CLI out entirely, see structured-outline). These are different bets:
- **Hive A-group bet:** caller-owned session loop = local-default + Sessions-API-cloud opt-in
- **Sandcastle bet:** keep the Claude Code CLI, sandbox it, run many in parallel

They are NOT drop-in replacements for each other. But sandcastle's **container + session-resume + parallel-branch** primitives could absorb part of A-group scope (specifically: parallel orchestration substrate, session capture/correlation, structured output) without the Messages-API rewrite.

### sandcastle ↔ mattpocock atomic-skill audit (deferred)

- **Same author.** Mattpocock writes the prevailing public POV on agent infra right now (61.5k stars on `skills`, 3.9k on `sandcastle`).
- **Different layer.** `mattpocock/skills` = atomic Markdown skills; `sandcastle` = orchestration substrate. No shared primitives in either README.
- **Audit relevance:** if Hive does the deferred composability audit, sandcastle's "no opinions about workflow / task management / context sources" stance is the same critique mattpocock leveled at GSD/BMAD/Spec-Kit (the basis of the deferred audit). Worth bundling as the *same* meta-question: "does Hive own too much process?"

### atoshell ↔ Hive

- atoshell tickets ≈ `.pHive/epics/*/stories/*.yaml` — both are local file-based work units.
- atoshell has NO epic/story hierarchy, agent roster, skill/hook system, workflow engine.
- Disciplines list partially mirrors Hive specialist roles.
- **Maturity gap blocks adoption:** 0 stars + 3 days old + single commit = pre-discovery. No production signal. Watch only.

### atoshell ↔ sandcastle

Disjoint concerns. atoshell = ticket tracker; sandcastle = sandboxed agent execution.

## Relevant Hive policy memory

- **`feedback_test_offtheshelf_before_rewriting`** — "rebuild subset of X inside hive triggers 'did we spike X first?'; bounded plug-and-play spike before rewrite." **Directly applicable** to CWC 2026 Group A: A-group rebuilds session-loop primitives that sandcastle has already implemented at scale.
- **`project_archon_feasibility_spike`** — precedent: NO-GO 2026-04-29, Archon feasibility spike was scoped before adoption. Same playbook applies to sandcastle.
- **`project_mattpocock_atomic_skill_audit`** — DEFERRED, awaits `/meta-optimize` cycle scoping. Sandcastle came from same author — could bundle.

## Three positioning options

### Option 1 — Continue CWC 2026 as-planned, log sandcastle for future eval

- CWC 2026 stays on track. Substrate (A-group) ships as designed.
- Sandcastle filed under "tools to evaluate later," like atoshell.
- **Risk:** ships A-group code that may be made redundant by sandcastle adoption six weeks from now. Violates `feedback_test_offtheshelf_before_rewriting`.
- **Cost:** zero short-term, high rework risk.

### Option 2 — Pause CWC 2026 Group A, run a bounded sandcastle feasibility spike

- Continue Groups D (posture), C (triggers), B (quality loops, but B14-B15 partially depend on A2 — may need partial pause).
- Spike sandcastle for 1-3 days against Hive's parallel-substrate need: can `sandcastle.run()` + branch strategies + session capture replace TeamCreate-via-cmux + agent-spawn + session correlation?
- **If GO:** rewrite A-group as "adopt sandcastle as substrate adapter," cut Messages-API-loop scope. Net story count likely shrinks.
- **If NO-GO:** resume A-group as planned, document why (Archon-feasibility-spike playbook).
- **Cost:** 1-3 day pause on A/B groups; D and C-front continue.

### Option 3 — Bundle sandcastle eval with mattpocock atomic-skill audit cycle

- Trigger the deferred mattpocock audit now (instead of waiting for next `/meta-optimize` cycle).
- Audit scope expands from "skill catalog composability" to "Hive's process-owning posture vs mattpocock's full agent-infra stack" — covering both `mattpocock/skills` and `sandcastle`.
- Output: structural recommendation that informs CWC 2026 A-group AND skill catalog audit AND any future framework decisions.
- **Cost:** higher upfront (bigger audit), but produces single coherent answer to "how much process should Hive own?"

## Recommendation surface (orchestrator's read, not a decision)

Memory says spike-before-rewrite. CWC 2026 Group A is the rewrite. Sandcastle is the off-the-shelf candidate. **Option 2** (bounded spike) is the policy-compliant default. **Option 3** is bigger-deal but answers a wider question — fits `feedback_scope_class_changes` (audit + spike = new program of work).

User decides. Atoshell is not in scope of this decision (too immature).

## Open questions for the user

1. Which option (1 / 2 / 3, or different framing)?
2. If Option 2: scope the spike against which substrate need first — parallel-pane replacement, session-resume, or rubric-style structured output?
3. If Option 3: defer all of CWC 2026 Group A pending audit, or keep A1 (spec rewrite) as no-regret work?
4. Sandcastle's Claude-Code-CLI-wrapping bet vs A-group's Messages-API-caller-loop bet — does the user have a prior on which substrate wins long-term?
