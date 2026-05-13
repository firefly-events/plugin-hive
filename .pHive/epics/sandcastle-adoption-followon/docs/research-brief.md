# Research brief — sandcastle adoption follow-on

## Executive summary

This work stream evaluates a narrow Sandcastle adoption path for Hive: adopt the sandboxing primitives that close Hive's current process/container isolation gap while leaving Hive's existing backend-resolution model intact. The in-scope surface is `SandboxProvider`, `branchStrategy`, `createWorktree()`, and Sandcastle lifecycle hooks.

The adoption path is constrained by four spike-identified surprises: Codex auth mounting, macOS rootless Podman parallelism, logger key leakage, and Sandcastle issue #191 blocking the `claudeCode()` lane for Anthropic subscription users. Current evidence supports a Codex-path-only follow-on, with `claudeCode()` deferred until upstream support changes. Validation confidence is high on primitive surfaces and spike-verified mitigations, but medium on the fresh post-PR-#62 dispatch extension point and Epic C Adapter ABI composition.

## Context

Hive already has a substrate distinction, but it is internal to Hive's execution APIs. The `execution.substrate` flag introduced by CWC 2026 A-group S8 currently routes `messages` versus `sessions-cloud` and the `cloud_mode` getter on `hive/lib/session-client.js`. The Sandcastle spike frames Sandcastle as a coarser layer than this flag: Sandcastle wraps the CC CLI / Codex CLI rather than the Messages API, so it is not automatically a third `execution.substrate` value.

Hive's current isolation model is worktree-based. `hive/references/sandboxing-patterns.md` describes `git worktree add .claude/worktrees/{story-id} -b hive/{story-id}` as the recommended pattern for parallel agent work, with merge-back and `git worktree remove` at completion. The same reference explicitly leaves database, Docker daemon, ports, and caches shared; this is the isolation gap Sandcastle's `SandboxProvider` addresses. The older file-copy meta-team sandbox model in `hive/references/meta-team-sandbox.md` was retired on 2026-04-21 in favor of worktree-based isolation via `hive/references/meta-experiment-isolation.md`.

The post-PR-#62 execution graph creates a clean candidate plug-in point. `execute-dispatch/SKILL.md` owns `/execute` mode resolution, while `backend-dispatch/SKILL.md` remains responsible for provider/backend resolution. A new `execute-mode-sandcastle/SKILL.md` would sit alongside `execute-mode-session` and `execute-mode-team-cmux`, with `mode_decision` gaining a fourth value such as `sandcastle` or `team-sandcastle`. The existing `paths.gate_mode: warning | hard` knob is not a blocker: the default is `warning`, planning skills warn and proceed, and `/plan` already runs under warning mode.

## Sandcastle primitive surface

The follow-on scope comes from the Sandcastle spike HYBRID decision table in `.pHive/spikes/sandcastle/findings.md`. The adopted-or-conditional primitives are:

| Primitive | Decision | Coupling |
|---|---|---|
| `SandboxProvider` | ADOPT (follow-on), gated on §5 surprises | root of stack |
| `branchStrategy: head|merge-to-head|branch` | ADOPT IF #7 | requires `SandboxProvider` |
| `createWorktree()` + `wt.run()` | ADOPT IF #7 | implementation path for `branchStrategy: branch` |
| `createSandbox()` long-lived | CONSIDER IF #7 | warm-sandbox performance option |
| `hooks.host.*` | ADOPT IF #7 | container-lifecycle hooks, not PreToolUse replacement |
| `hooks.sandbox.*` | ADOPT IF #7 | same lifecycle layer |

Out of scope for this follow-on are primitives already adopted through S14/B1 rubric design: `Output.object()`, `Output.string()`, and runtime guards. Also out of scope are blocked or Hive-retained surfaces: `run()`, `interactive()`, `claudeCode()`, `codex()` provider, `opencode`, `pi`, `resumeSession`, session JSONL capture, `AgentStreamEvent`, `PromptArgs`, `sandcastle init`, and `transferSession`.

`SandboxProvider` is exported through factories described in `research-findings.md §2.6`:

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

The docker-style provider config includes:

```ts
{
  imageName?,
  mounts: [{ hostPath, sandboxPath, readonly? }],
  selinuxLabel?: 'z' | 'Z' | false,
  env?,
  network?
}
```

`branchStrategy` is described in `research-findings.md §2.8` and the `run()` options table:

```ts
branchStrategy: { type: 'head' | 'merge-to-head' | 'branch', branch?: string }
```

The strategy meanings are:

| Strategy | Meaning |
|---|---|
| `head` | Agent works on current HEAD inside the sandbox; no isolation between parallel runs against the same branch. |
| `merge-to-head` | Vercel default; agent works on an isolated branch and commits are merged back to head. |
| `branch` | Explicit named branch through `branch?: string`; this matches Hive's one-branch-per-story flow. |

`createWorktree()` is described in `research-findings.md §2.4`:

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

The lifecycle has two teardown points: `sandbox.close()` tears down the container only, while `wt.close()` cleans the worktree. Dirty worktrees are preserved.

The Sandcastle hooks layer is described in `research-findings.md §2.7`:

```ts
hooks: {
  host:    { onWorktreeReady?: HookCmd[]; onSandboxReady?: HookCmd[] },
  sandbox: { onSandboxReady?: HookCmd[] }
}

HostHookCmd    = { command: string; timeoutMs?: number }            // no sudo, no cwd
SandboxHookCmd = { command: string; sudo?: boolean; timeoutMs?: number }
```

Hook execution is ordered as `copyToWorktree` → `host.onWorktreeReady` sequentially → sandbox creation → `host.onSandboxReady` and `sandbox.onSandboxReady` in parallel. The default per-hook timeout is 60s. The `signal` from `run()` threads into all hooks, cancellation propagates, and non-zero exit fails setup fast. These hooks are container-lifecycle hooks only, not PreToolUse or PostToolUse equivalents; adoption is additive to Hive's per-tool hook layer.

The working spike example is `.pHive/spikes/sandcastle/harness.ts`. It used `codex("gpt-5.4", { effort: "low" })`, `podman({ imageName: "sandcastle:spike", userns: false, mounts: [{ hostPath: ".sandcastle/codex-config", sandboxPath: "/home/agent/.codex" }] })`, two parallel `run()` calls through `Promise.all`, and `branchStrategy: { type: "branch", branch: "spike/sandcastle-<name>" }`. It anchored `cwd` at the plugin-hive git root, used file logging at `.sandcastle/logs/<name>.log`, set `maxIterations: 1`, and used `idleTimeoutSeconds: 300`. `run.log:4-7` verified that two named branches reached agent invocation; the merge step was not reached because the test account had OpenAI quota set to zero.

## Gate conditions

### 1. Codex `auth.json` mount gap (§5.1)

Sandcastle's `codex()` provider does not auto-write `~/.codex/auth.json`, and Codex CLI 0.129+ ignores plain `OPENAI_API_KEY` env. The failure mode is 401.

The spike-verified workaround is in `harness.ts:119-124`:

```bash
# One-time per host:
printenv OPENAI_API_KEY | podman run -i --entrypoint codex \
  -v <host-config-dir>:/home/agent/.codex \
  sandcastle:<image> login --with-api-key
```

The resulting `<host-config-dir>` is bind-mounted into every `run()` via `podman({ mounts: [...] })`. Sandcastle also rejects env overlap between the agent provider and sandbox provider; `OPENAI_API_KEY` must be set on the sandbox provider only. Hive impact from the raw findings: adoption needs install-hook or kickoff plumbing, cross-referenced by `feedback_sandcastle_codex_auth_gap.md`.

### 2. macOS rootless Podman parallel race (§5.2)

With default `userns: keep-id`, the second concurrent `podman run -d` can fail with `crun: write to /proc/sys/net/ipv4/ping_group_range: Invalid argument`. The issue is a race on user namespace map setup.

The spike-verified workaround is in `harness.ts:118`:

```ts
podman({ userns: false, ... })
```

Hive impact from the raw findings: macOS is the dominant maintainer platform, parallel agents are central to Hive, and the adoption guide must flag this behavior. The raw findings state that Hive-shipped Podman config should default to `userns: false`.

### 3. Logger key-leak (§5.3)

The Sandcastle file logger writes the full `podman run` argv, including `-e OPENAI_API_KEY=<value>`, to `.sandcastle/logs/<name>.log`. This is a real key-leak hazard if the log directory is committed.

The spike-verified mitigation is a stdout/stderr redaction wrapper plus `.gitignore` coverage of `.sandcastle/`, cited as `harness.ts:30-40`. The raw findings state this is not optional: adoption needs an upstream fix or wrapper before it ships. The default Hive `.gitignore` template needs `.sandcastle/`, and the wrapper must redact `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and any `*_TOKEN` or `*_KEY` patterns.

### 4. Sandcastle issue #191 (§5.4)

The `claudeCode()` provider requires an API key, and Pro/Max subscription auth is unimplemented upstream. As of the 2026-05-08 spike, issue #191 remained open with no fix timeline.

The raw findings mark this as load-bearing because Hive's OSS user base is predominantly on Anthropic subscriptions. The scoping consequence in the findings is Codex-path-only for this work stream. The `claudeCode()` lane is deferred until #191 lands upstream, and stories must not depend on session JSONL capture tied to #14, #15, and #22.

Secondary caveats from the raw findings:

| Caveat | Status |
|---|---|
| `cwd` must equal the git root | Spike anchored at plugin-hive repo root. |
| Dockerfile GID collision risk | Recorded in `acceptance-results.md` §3-6. |
| `daytona.ts` provider undocumented | README gap. |
| `resumeSession` incompatible with `maxIterations > 1` | Recorded in Sandcastle ADR-0011. |

## Synergy with Adapter ABI

Epic C is represented by `.pHive/epics/task-tracking-adapter-abi/`, with `epic.yaml` and `docs/`. The reference `hive/references/task-tracking-adapter.md` describes the full lifecycle ABI, including operations such as `createEpicParent` and `createStoryIssue`. Branch naming convention is part of that ABI spec.

The audit recommendation §4 describes the composition semantics:

| Composition point | Semantics |
|---|---|
| Branch naming | Derived from adapter-issued story IDs via `branchStrategy: { type: "branch", branch: <adapter-issued-id> }`. |
| Status sync | On `session-end`, call adapter ABI operations such as `updateStoryStatus`. |
| Sandbox lifecycle | Open issue → create worktree → sandbox start → on completion close worktree and sync status. |

The raw findings state that synergy is architecturally available once this work stream lands. No further synergy-specific design is required because composition is mechanical if Epic C registers the adapter under the hierarchy-agnostic ABI, this work stream registers the Sandcastle substrate path, and `branchStrategy.branch` is derived from `adapter.issueStoryId()` at story dispatch time.

The ordering consideration is open but not blocking in the raw findings. Epic C currently has `epic.yaml` only and no stories. If Epic C ships after this work stream, sandbox branch naming defaults to local story IDs from the story YAML `id` field and rewires to adapter IDs when Epic C lands.

## Validation status + confidence levels

The spike artifact set is `.pHive/spikes/sandcastle/`: `findings.md`, `research-findings.md`, `harness.ts`, `acceptance-results.md`, `review-verdict.md`, `test-verdict.md`, `run.log`, `package.json`, `.gitignore`, and `Dockerfile`. The tested library was `@ai-hero/sandcastle@0.5.10`.

Validation from `test-verdict.md`:

| # | Criterion | Verdict |
|---|---|---|
| 1 | sandcastle 0.x via npm + Podman SandboxProvider | PASS |
| 2 | 2+ parallel agents, branch-strategy merge | PARTIAL-PASS (parallelism confirmed; merge unreached) |
| 3 | Session capture + `claude --resume` | N/A (codex path; #191 blocks claudeCode path) |
| 4 | `Output.object()` Zod rubric | INFERRED-PASS (source-inspected; live emission untested) |
| 5 | Hooks model documented | PASS |
| 6 | GO/NO-GO/HYBRID | DELIVERED (HYBRID) |
| 7 | HYBRID criteria | DELIVERED |

Additional validation notes:

| Area | Status |
|---|---|
| context7 | Not invoked during fallback synthesis because the researcher Codex dispatch stalled before its context7 step. |
| Primitive surfaces | Source-inspected in pre-existing spike `research-findings.md` via `node_modules/@ai-hero/sandcastle/`. |
| Codex CLI 0.129+ auth model | Captured in `feedback_sandcastle_codex_auth_gap.md`. |
| Podman rootless `userns` flag | Captured in the working `harness.ts` example. |
| Gaps requiring web research | None blocking. Optional context7 confirmation of Sandcastle 0.6.x changelog if one appears during implementation. |

Confidence levels from the raw findings:

| Topic | Confidence | Basis |
|---|---|---|
| Primitive surfaces | High | Source-inspected in the spike. |
| §5 mitigations | High | Workarounds were spike-verified. |
| Dispatch-graph extension point | Medium | Post-PR-#62 skill graph is fresh and paper-inspected here. |
| Epic C ABI shape | Medium | `epic.yaml` exists and reference exists, but no full SKILL/stories yet. |

## Open questions

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
