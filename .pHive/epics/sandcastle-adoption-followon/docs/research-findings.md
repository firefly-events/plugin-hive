# Research findings — sandcastle adoption follow-on

Raw findings, no synthesis. Compiled by orchestrator-self after Codex researcher stall (cancelled; see SKILL §0.5 fallback in plan-routing log). Grounded reads pulled from `.pHive/spikes/sandcastle/` artifacts + post-PR-#62 skill graph + audit recommendation.

---

## Section A — Hive current substrate state

### A.1 `execution.substrate` flag

- Flag introduced by CWC 2026 A-group S8 (`s8-a4 execution.substrate flag default flip`). Per sandcastle spike §4, sandcastle is **at a coarser layer than Hive's internal substrate flag** — currently routes `messages` vs `sessions-cloud` and `cloud_mode` getter on `hive/lib/session-client.js`.
- Current values are **Hive-internal substrates** (messages / sessions-cloud). Sandcastle is NOT itself a value of `execution.substrate` — sandcastle wraps the CC CLI / codex CLI, not the Messages API.
- Sandcastle spike §4 open question (verbatim): *"If sandcastle added as 3rd substrate, flag grows 3rd value? Out of S8 scope"* — this work stream is where that answer is decided.

### A.2 Worktree-based isolation in current Hive

- Reference: `hive/references/sandboxing-patterns.md` describes git worktrees as the **recommended sandboxing pattern** for parallel agent work.
- Pattern in use: `git worktree add .claude/worktrees/{story-id} -b hive/{story-id}` → team operates inside the worktree → merge back to main on completion → `git worktree remove`.
- Claude Code native `EnterWorktree` tool exists and is used by orchestrator.
- Limitation acknowledged in the reference: *"Database/Docker state not isolated. Shared daemon, ports, caches."* — this is exactly the gap sandcastle's `SandboxProvider` fills.

### A.3 Retired meta-team sandbox model

- `hive/references/meta-team-sandbox.md` — file-copy sandboxing **retired 2026-04-21**. Demoted in favor of worktree-based isolation (`hive/references/meta-experiment-isolation.md`).
- File-copy was NOT acceptable as default for self-modifying meta-swarm experiments. Worktree-based isolation is now authoritative.

### A.4 `paths.gate_mode` knob (PR #62 baseline)

- `paths.gate_mode: warning | hard` — Epic B W6 shipped at story `a-33-plan-gate-lift-and-gate-mode-knob.yaml`.
- Audit script: `hive/scripts/gate-mode-audit.mjs`.
- Telemetry reference: `hive/references/gate-lift-telemetry.md`.
- Default is `warning`; planning skills warn+proceed. Substrate decisions in this work stream are NOT gate-mode-blocked — `/plan` already runs under `warning`.

---

## Section B — agent-spawn + dispatch post-PR-#62

PR #62 (Epic B) merged into `dev/hive-2.0` at tip `73380f3`. Sub-skill graph has been substantially restructured.

### B.1 New atomic skill graph

`skills/hive/skills/` now contains (post-merge):

- `agent-spawn/SKILL.md` — 227 lines, orchestrator-facing entry point. Procedure: 1-4 resolve persona context → 5 load memories → 6 check skills → 7 construct spawn call (7.0 resolve backend, 7.1 resolve mux + pane mode, 7.2 TeamCreate path, 7.3 cmux pane path) → 7b respawn → 8 report.
- `persona-resolve/SKILL.md` — persona file read + path resolution.
- `memory-loading/SKILL.md` — memory directory scan + frontmatter inspection.
- `backend-dispatch/SKILL.md` — atomic skill. *"Resolves which provider serves a given persona spawn and selects the dispatch surface (Messages-API substrate, tmux fallback, or codex-invoke)."* Caller owns prompt construction + respawn handling; this skill owns the **resolution + dispatch handoff** only.
- `execute-dispatch/SKILL.md` — Single dispatch point for `/execute`. Resolves `mode_decision` (sessions | team | team-cmux | sequential) and `runner_path` (hive-dag | orchestrator-narrated).
- `execute-mode-session/SKILL.md` — session-based execution mode (Messages-API path).
- `execute-mode-team-cmux/SKILL.md` — cmux-pane team execution mode.
- `planning-routing/SKILL.md` — atomic routing decision helper used by `/plan`.
- `escalation-backfill/SKILL.md` — atomic story-ID backfill.

### B.2 Sandcastle plug-in point

A new `execute-mode-sandcastle/SKILL.md` would sit alongside `execute-mode-session` and `execute-mode-team-cmux` as a **third dispatch mode**. The contract boundary is established at `execute-dispatch/SKILL.md`:

- `mode_decision` enum gains a 4th value: `sandcastle` (or potentially `team-sandcastle`).
- Resolution sources: env `HIVE_EXECUTION_MODE`, root config `execution.mode`, default `auto`.
- Per `execute-dispatch` invocation contract, the new mode needs `field_sources` attribution support and a `mode_reason` one-liner explaining selection.

Backend resolution stays unchanged — `backend-dispatch` keeps owning Codex vs Messages-API vs tmux. Mode resolution is orthogonal to backend resolution.

### B.3 Codex companion + persistent panes

- `codex-companion.mjs` at `/Users/don/.claude/plugins/cache/openai-codex/codex/1.0.1/scripts/`.
- Task lifecycle: `task --write` (new), `task --resume-last` (continue), `task --status`, `task --cancel`.
- Companion blocks `resume` while a prior task is in-flight. Observed in this very planning session — researcher dispatch stalled and ping-via-companion was blocked.
- Implication: long-running Codex tasks have **no orchestrator-side liveness signal**. Watchdog must be external (tail output file).

---

## Section C — sandcastle spike artifacts

Spike directory: `.pHive/spikes/sandcastle/`. Files: `findings.md` (13kB), `research-findings.md` (28kB), `harness.ts` (10kB), `acceptance-results.md`, `review-verdict.md`, `test-verdict.md`, `run.log`, `package.json`, `.gitignore`, `Dockerfile`. Library: `@ai-hero/sandcastle@0.5.10`.

### C.1 Primitives flagged ADOPT (follow-on epic = this work)

From `findings.md` HYBRID decision table:

| # | Primitive | Decision | Coupling |
|---|---|---|---|
| 7 | `SandboxProvider` | **ADOPT (follow-on)** — largest concrete value, gated on §5 surprises | root of stack |
| 8 | `branchStrategy: head\|merge-to-head\|branch` | ADOPT IF #7 | requires #7 |
| 16 | `createWorktree()` + `wt.run()` | ADOPT IF #7 | how `branchStrategy:branch` is implemented |
| 17 | `createSandbox()` long-lived | CONSIDER IF #7 | warm-sandbox perf opt, lower priority |
| 9 | `hooks.host.*` | ADOPT IF #7 | container-lifecycle hooks, NOT PreToolUse substitute |
| 10 | `hooks.sandbox.*` | ADOPT IF #7 | same layer |

Not in scope (already adopted in S14/B1 rubric design, separate path): `Output.object()` (#11), `Output.string()` (#12), runtime guards (#21).

Not in scope (blocked or retain Hive): `run()`, `interactive()`, `claudeCode()`, `codex()` provider, `opencode`, `pi`, `resumeSession`, session JSONL capture, `AgentStreamEvent`, `PromptArgs`, `sandcastle init`, `transferSession`.

### C.2 `SandboxProvider` API surface

From `research-findings.md §2.6`:

```ts
// Exported from src/SandboxProvider.ts
createBindMountSandboxProvider(config)  // docker/podman style
createIsolatedSandboxProvider(config)   // vercel-style microVMs (copy-in/copy-out)

// Built-in factories under src/sandboxes/:
docker()      // bind-mount, SELinux label support, default branchStrategy=head
podman()      // bind-mount, SELinux label support, default branchStrategy=head
vercel()      // isolated microVM via @vercel/sandbox, default branchStrategy=merge-to-head
noSandbox()   // interactive-only
daytona.ts    // undocumented in README [gap]
```

Per-provider config (docker example):
```ts
{
  imageName?,
  mounts: [{ hostPath, sandboxPath, readonly? }],
  selinuxLabel?: 'z' | 'Z' | false,
  env?,
  network?
}
```

### C.3 `branchStrategy` API surface

From `research-findings.md §2.8` and `run()` options table:

```ts
branchStrategy: { type: 'head' | 'merge-to-head' | 'branch', branch?: string }
```

- `head` — agent works on current HEAD inside sandbox (no isolation between parallel runs against same branch — caller risk).
- `merge-to-head` — vercel default; agent works on isolated branch, commits merged back to head.
- `branch` — explicit named branch via `branch?: string`; what Hive needs for "one branch per story" git flow.

### C.4 `createWorktree()` API surface

From `research-findings.md §2.4`:

```ts
(options: CreateWorktreeOptions) => Promise<Worktree>

interface Worktree {
  branch: string                        // resolved branch name
  run(opts: WorktreeRunOptions)         // sandbox required
  interactive(opts: WorktreeInteractiveOptions)  // defaults to noSandbox()
  createSandbox(opts: WorktreeCreateSandboxOptions)  // split-ownership lifecycle
  close()                               // preserves dirty worktree; removes if clean
  [Symbol.asyncDispose]
}
```

Lifecycle nuance: `sandbox.close()` tears down container only; `wt.close()` cleans worktree. Two-phase teardown.

### C.5 Sandcastle hooks layer

From `research-findings.md §2.7`:

```ts
hooks: {
  host:    { onWorktreeReady?: HookCmd[]; onSandboxReady?: HookCmd[] },
  sandbox: { onSandboxReady?: HookCmd[] }
}

HostHookCmd    = { command: string; timeoutMs?: number }            // no sudo, no cwd
SandboxHookCmd = { command: string; sudo?: boolean; timeoutMs?: number }
```

- Default per-hook timeout: 60s.
- Ordering: `copyToWorktree` → `host.onWorktreeReady` (sequential) → sandbox created → `host.onSandboxReady` + `sandbox.onSandboxReady` (parallel).
- `signal` from `run()` threads into all hooks (cancellation propagates).
- Exit code ≠ 0 → setup fails fast.
- **NOT PreToolUse / PostToolUse equivalents.** Container-lifecycle hooks only. Different abstraction layer from Hive's per-tool hooks. Adoption is **additive**, not replacement.

### C.6 Working integration example

`.pHive/spikes/sandcastle/harness.ts` — working spike using:
- Agent: `codex("gpt-5.4", { effort: "low" })`
- Sandbox: `podman({ imageName: "sandcastle:spike", userns: false, mounts: [{ hostPath: ".sandcastle/codex-config", sandboxPath: "/home/agent/.codex" }] })`
- 2 parallel `run()` via `Promise.all`, each on `branchStrategy: { type: "branch", branch: "spike/sandcastle-<name>" }`
- `cwd: repoRoot` anchored at plugin-hive root (sandcastle requires cwd = git root)
- Logging: `{ type: "file", path: ".sandcastle/logs/<name>.log" }`
- `maxIterations: 1`, `idleTimeoutSeconds: 300`

Verified in `run.log:4-7`: two named branches reached agent invocation. Merge step never reached due to OpenAI quota=0 on the test account — partial-pass.

### C.7 Verification status (from `test-verdict.md`)

| # | Criterion | Verdict |
|---|---|---|
| 1 | sandcastle 0.x via npm + Podman SandboxProvider | PASS |
| 2 | 2+ parallel agents, branch-strategy merge | PARTIAL-PASS (parallelism confirmed; merge unreached) |
| 3 | Session capture + `claude --resume` | N/A (codex path; #191 blocks claudeCode path) |
| 4 | `Output.object()` Zod rubric | INFERRED-PASS (source-inspected; live emission untested) |
| 5 | Hooks model documented | PASS |
| 6 | GO/NO-GO/HYBRID | DELIVERED (HYBRID) |
| 7 | HYBRID criteria | DELIVERED |

---

## Section D — §5.1 surprise mitigations (gate conditions)

Per `findings.md §5` four adoption-cost gaps. Each is a **gate condition** for this work stream.

### D.1 Codex `auth.json` mount gap (§5.1)

**Issue:** sandcastle's `codex()` provider does NOT auto-write `~/.codex/auth.json`. Codex CLI 0.129+ ignores plain `OPENAI_API_KEY` env. 401 results.

**Workaround (spike-verified, `harness.ts:119-124`):**
```bash
# One-time per host:
printenv OPENAI_API_KEY | podman run -i --entrypoint codex \
  -v <host-config-dir>:/home/agent/.codex \
  sandcastle:<image> login --with-api-key
```
Then bind-mount `<host-config-dir>` into every `run()` via `podman({ mounts: [...] })`.

**Additional caveat:** sandcastle rejects env-overlap between agent provider and sandbox provider. `OPENAI_API_KEY` must be set on **sandbox provider only**, not both.

**Hive impact:** any adoption needs install-hook / kickoff plumbing. Cross-reference: `feedback_sandcastle_codex_auth_gap.md`.

### D.2 macOS rootless Podman parallel race (§5.2)

**Issue:** `userns: keep-id` (default) → second concurrent `podman run -d` hits `crun: write to /proc/sys/net/ipv4/ping_group_range: Invalid argument`. Race on userns map setup.

**Workaround (spike-verified, `harness.ts:118`):**
```ts
podman({ userns: false, ... })
```

**Hive impact:** macOS is dominant maintainer platform; parallel agents are Hive's core value prop. Adoption guide MUST flag. Default `userns: false` for Hive-shipped Podman config.

### D.3 Logger key-leak (§5.3)

**Issue:** sandcastle file logger writes full `podman run` argv (including `-e OPENAI_API_KEY=<value>`) to `.sandcastle/logs/<name>.log`. Real key-leak hazard if committed.

**Workaround (spike-verified, `harness.ts:30-40`):** stdout/stderr redaction wrapper + `.gitignore` of `.sandcastle/` paths.

**Hive impact:** not optional. Needs upstream fix OR wrapper before adoption ships. Default Hive `.gitignore` template needs the `.sandcastle/` entry. Wrapper must redact `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, any `*_TOKEN`/`*_KEY` patterns.

### D.4 Sandcastle issue #191 (§5.4)

**Issue:** `claudeCode()` provider requires API key. Pro/Max subscription auth unimplemented upstream.

**Status (as of 2026-05-08 spike):** still open. No fix timeline.

**Hive impact (load-bearing):** Hive's OSS user base is predominantly on Anthropic subscriptions. `claudeCode()` provider locked out for that base. **Scoping decision:** this work stream ships **Codex-path-only**. The `claudeCode()` lane is deferred until #191 lands upstream. Stories must not depend on session JSONL capture (tied to #14, #15, #22 — all blocked).

### D.5 Secondary caveats

- Sandcastle requires `cwd` = git root. Spike anchors at plugin-hive repo root.
- Dockerfile GID collision risk (per `acceptance-results.md` §3-6).
- `daytona.ts` provider undocumented in README [gap].
- `resumeSession` incompatible with `maxIterations > 1` (per sandcastle ADR-0011).

---

## Section E — Adapter ABI synergy (Epic C lookahead)

### E.1 Adapter ABI epic state

- Directory: `.pHive/epics/task-tracking-adapter-abi/`. Has `epic.yaml` + `docs/`.
- Reference: `hive/references/task-tracking-adapter.md` — describes full lifecycle ABI.
- Adapter operations include `createEpicParent`, `createStoryIssue`, etc. **Branch naming convention** is part of the ABI spec.

### E.2 Synergy semantics

Per audit recommendation §4 (post-Epic-C, post-Epic-D synergy):

- **Branch naming derived from adapter-issued story IDs** via sandcastle's `branchStrategy: { type: "branch", branch: <adapter-issued-id> }`.
- **Status sync on `session-end`** calls the adapter ABI (`updateStoryStatus`, etc).
- **Sandbox lifecycle follows story lifecycle** — open issue → create worktree → sandbox start → on completion close worktree + sync status.

### E.3 Composition contract

Synergy is **architecturally available once this work stream lands**. No further synergy-specific design required — composition is mechanical given:
- Epic C registers adapter under hierarchy-agnostic ABI.
- This work stream registers `SandboxProvider` + `branchStrategy` + `createWorktree` under a new substrate path.
- `branchStrategy.branch` is derived from `adapter.issueStoryId()` at story dispatch time.

### E.4 Open gating consideration

Epic C currently has `epic.yaml` only (no stories yet). If Epic C ships AFTER this work stream, sandbox branch naming defaults to local-IDs (story-yaml `id` field) and rewires to adapter IDs when Epic C lands. Order-independent.

---

## Section F — Validation notes

- **context7 status:** not invoked during this fallback synthesis (researcher Codex dispatch stalled before its context7 step). Pre-existing spike research-findings.md already inspected sandcastle 0.5.10 source via `node_modules/@ai-hero/sandcastle/`. Codex CLI 0.129+ auth model captured in `feedback_sandcastle_codex_auth_gap.md`. Podman rootless `userns` flag captured in `harness.ts` working example.
- **Confidence:** high on primitive surfaces (source-inspected in spike), high on §5 mitigations (spike-verified workarounds), medium on dispatch-graph extension point (post-PR-#62 skill graph is fresh, only paper-inspected here), medium on Epic C ABI shape (epic.yaml only; reference exists but not full SKILL).
- **Gaps requiring web research:** none blocking. Optional context7 confirmation of sandcastle 0.6.x changelog if one drops mid-implementation.

---

## Open questions for design phase

1. **`execution.mode` enum value:** new mode name = `sandcastle` vs `team-sandcastle` vs `sandbox` (provider-neutral). Recommendation default: `sandcastle` to match upstream library name; revisit if/when alternative providers land (e.g., daytona, vercel).
2. **Default `SandboxProvider`:** docker vs podman as Hive default. Podman is rootless-by-default (better on macOS); docker is more widely installed. Recommendation: podman default, docker as opt-in.
3. **Auth.json plumbing surface:** new `/hive:kickoff` step? new dedicated `/hive:sandbox-setup` skill? new install hook? Trade-off: kickoff steps grow vs new entry-point sprawl.
4. **Logger wrapper location:** in-Hive wrapper vs upstream patch + pin to fixed version. Trade-off: control vs maintenance burden.
5. **Hook integration semantics:** `host.onWorktreeReady` is a clean place to inject `copyToWorktree` + Hive-side memory loading; `sandbox.onSandboxReady` is the right place for `codex auth.json` mount verification. Are Hive hook YAML templates worth shipping, or per-story prose?
6. **claudeCode lane defer-marker:** explicit story to track issue #191 watch (close-when-upstream-lands)? Or just a project memory + audit-script gate?
7. **Backward-compat path:** existing `execute-mode-team-cmux` users see no change. Existing `execute-mode-session` users see no change. New mode = pure opt-in via config. Is there any *force-on* migration? Recommendation: no — opt-in only.
8. **Adapter ABI ordering:** if Epic C unmerged when this work ships, do we wire `branchStrategy.branch` to local story-yaml IDs first, then rewire? Or block this work stream on Epic C? Recommendation: independent — local IDs are sufficient for substrate validation.
9. **`createSandbox()` long-lived warm pool:** in-scope or split as later optimization story? Sandcastle decision table marks it CONSIDER IF #7 (low priority). Recommendation: split — ship cold-start first, add warm-pool as separate story or follow-on.
10. **Scope of hooks adoption:** full hook YAML spec (host + sandbox, all 3 hook points) or minimal (just `host.onWorktreeReady` for `copyToWorktree`)? Recommendation: minimal first, expand by demand.
11. **Sidecar bundle (per audit Epic A W5):** does the sandcastle substrate need to consume/produce sidecar bundle artifacts? Open question for design.
12. **2.0-vs-post-2.0 placement:** audit §7 lists this as Epic D, post-2.0. User invoked planning now — does this fold INTO 2.0, or land after? Recommendation default: post-2.0 (audit position) unless user signals otherwise.
