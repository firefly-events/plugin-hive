# Research Brief — Hermes ↔ Hive MVP Integration

## Scope

Three vectors from Hermes's design output (2026-05-23 conversation):

1. **Hermes-as-orchestrator** — persistent orchestrator role across ephemeral Claude Code sessions
2. **Daily ceremony cron** — Hermes schedules `/hive:standup`, posts results to Slack
3. **Triage intake via Slack** — Slack DM/channel → `.pHive/triage/queue.yaml` → `/plan --from-triage`

Deferred from MVP: vectors 4 (review notifs), 5 (meta-optimize PR loop), 6 (memory bridge), 7 (Multica bridge).

## Hive-Side Surface (verified)

### Standup skill (`skills/standup/SKILL.md`)

- Runs `daily-ceremony.workflow.yaml`
- Three phases: Standup (reconstruct state) → Planning (short-list + approval) → Execution (kick off dev teams + session-end eval)
- Reads from: `.pHive/episodes/`, `.pHive/cycle-state/`, `.pHive/triage/queue.yaml`, agent memories, story `metric:` blocks
- **Already has Routines bridge documented:** `hive/references/routines-integration.md` — webhook trigger model with `under_scheduler.auto_approve: true` on `plan-approval` step
- **Daily restart model:** orchestrator starts fresh each day with 1M context; state compresses via status markers, cycle-state, task tracker (NOT conversation resume)

### Triage skill (`skills/triage/SKILL.md`)

- Five-state intake machine: `inbox → clarified → prioritized → plan-ready → closed`
- **Single writer** of `.pHive/triage/queue.yaml` (other skills read-only)
- Hand-off paths: `/plan --from-triage <id>` (substantive work) OR `--close` (rejected/duplicate)
- Operator-driven by design (no auto-advance based on time/merge events)
- Warning-only kickoff gate (works on uninitialized brownfield repos)
- Queue file does NOT currently exist locally — triage auto-creates on first `/hive:triage <description>`

### Cycle state + episodes

- Per-epic cycle state at `.pHive/cycle-state/{epic-id}.yaml`
- Episodes (status markers) at `.pHive/episodes/` carry session-end summaries
- Standup Phase 1 stitches these into the new session's mental model

### Config surface

- Root `hive.config.yaml`:
  - `paths.gate_mode: warning` (warn-and-proceed, not hard-block)
  - `task_tracking.adapter: multica` (workspace `plugin-hive`)
  - `agent_backends`: researcher/developer/writer/architect → codex; tpm/reviewer/tester → claude
  - `git_flow.default_pr_base: auto` (develop if origin/develop exists)
  - `standup.interactive_default: false` (flag-driven)

### Plugin distribution

- Plugin lives at `/Users/don/Documents/plugin-hive`
- Distributed via Claude Code marketplace (`firefly-events/plugin-hive`)
- Consumers symlink or install from marketplace

## Hermes-Side Surface (per Hermes design output + memory)

### Existing capabilities

- Persistent assistant (Nous, native uv tool install on Mac Studio)
- Codex ChatGPT OAuth backend
- Dashboard at 127.0.0.1:9119
- Skills system (claims parity with Claude Code skill model)
- Memory tool (persistent memory ≈ L1)
- Session search tool (≈ L0)
- Cron capability (built-in scheduler)
- Slack integration (DM + channel)
- File access (local filesystem)
- Delegate task tool with sequential/parallel subtasks
- GitHub workflow already proven (gh CLI for PRs)

### Runtime context

- **Hermes runs on Mac Studio** (separate machine from this dev workstation)
- Cross-machine coordination requires shared state surface (filesystem sync OR API)
- Hermes repo checked out locally at `/Users/don/Code/hermes-agent`
- Mac Studio likely accesses plugin-hive repo via filesystem (NFS/SMB/sync) OR git pull

## Constraints

- **Single writer invariant** on `queue.yaml` — only triage skill mutates; Hermes Slack intake must call triage (not write file directly)
- **Hive orchestrator is ephemeral** by design — Hermes can persist context BETWEEN sessions but cannot run inside a Claude Code session
- **Per-epic branch + PR flow** — vector 5 (meta-optimize PR loop, deferred) would need to honor this
- **`under_scheduler.auto_approve` is step-level, not global** — only `plan-approval` step has it; other gates would need YAML opt-in
- **Adapter ABI on `task_tracking.adapter`** — Hermes ↔ Multica bridge (vector 7, deferred) plugs into this same adapter surface
- **Codex parallel dispatch race** (memory `feedback_codex_parallel_race`) — Hermes-side Codex invocations need serial discipline same as Hive's

## Patterns to Reuse

- **Routines integration model** (`routines-integration.md`) — webhook + sandbox dry-run + capability skip on absence — directly applicable to Hermes-as-scheduler. Hermes IS Routines for this MVP.
- **Triage hand-off contract** (`/plan --from-triage <id>`) — Hermes Slack approval triggers this same CLI path
- **Cycle-state schema** — Hermes can READ cycle-state files to know where Hive left off; cannot write (writer invariant per-skill)
- **Episode status markers** — Hermes's read surface for "what happened in last session"
- **Agent memory directories** at `~/.claude/hive/memories/{agent}/` — Hermes can read for "what did agent X learn"

## Risks

| Severity | Risk | Evidence | Mitigation |
|---|---|---|---|
| **High** | Cross-machine filesystem coherence — Hermes (Mac Studio) acting on stale repo state vs this workstation's writes | Two physical hosts, no documented sync protocol | Define sync convention (git push/pull discipline OR shared volume); document in epic |
| **High** | Slack ↔ triage write coupling violates single-writer invariant if Hermes writes queue.yaml directly | Triage skill spec | Hermes Slack bot MUST call `/hive:triage` CLI, never write file |
| **Med** | Persistent orchestrator state model unclear — what does Hermes "remember" vs what does Hive's daily-restart-via-cycle-state already cover | Daily restart model in standup.SKILL.md is intentional design | Define delta: Hermes carries operator preferences + cross-project context; Hive carries per-project per-epic state |
| **Med** | `kg_why` pre-flight broken under Python 3.13 (chromadb subprocess import) | Recon ran kg_why, got `dictionary changed size during iteration` | Add follow-on story or hotfix outside this epic |
| **Med** | Triage queue currently does not exist on plugin-hive repo — Vector 3 needs queue init in dogfood path | `ls .pHive/triage/queue.yaml` → NO_QUEUE | Hermes Slack intake triggers triage skill which auto-creates queue |
| **Low** | Hermes skill model drift from Claude Code skill model — protocols incompatible | Hermes claims parity but two systems evolve independently | Treat Hermes side as black box — Hive exposes stable CLI/file contracts only |

## Validation Note

- **Checked:** Hive's standup/triage/cycle-state surface + Routines integration doc + hive.config.yaml resolved state
- **Source:** codebase-only (context7 + web not consulted — Hermes isn't a documented library, it's a custom assistant; Hive surface is internal)
- **Confidence:** high on Hive side; **medium** on Hermes side (relying on Hermes's own design output as source-of-truth for its capabilities)
- **Gaps:** Mac Studio ↔ workstation filesystem topology unknown; Hermes config schema not inspected

## Inconsistency Risk Signals (for grill skill)

- **Vocabulary mismatch:** "orchestrator" means different things on each side — Hive's orchestrator is per-session ephemeral; Hermes's "orchestrator" is persistent. Need a third term for the bridge layer or explicit disambiguation.
- **Hidden assumption:** Hermes design output assumes Hermes "could own the orchestrator role across projects and sessions" — but Hive's orchestrator runs INSIDE Claude Code, which Hermes is NOT. Hermes can be an out-of-band coordinator, not the orchestrator itself.
- **Hidden assumption:** "Hermes could index Hive's agent memories" — agent memories at `~/.claude/hive/memories/` are PER-USER, not per-project; if Hermes runs on Mac Studio under a different user account, paths differ
- **Unresolved tension:** Vector 3 says "Hermes auto-hand-off to /hive:plan when prioritized" — but triage explicitly states "operator-driven by design (no auto-advance)". Slack approval is the operator action — fine — but the design output's phrasing suggests automation triage forbids.
- **Convention violation:** If Hermes writes directly to `queue.yaml`, breaks triage single-writer invariant. Must call CLI.
- **Posture mismatch:** Hermes design output frames this as "Hermes becomes Hive's permanent layer." Reality: Hermes is an EXTERNAL coordinator that talks to Hive via stable contracts. Posture should be "two systems, narrow stable interface" not "merged stack."
