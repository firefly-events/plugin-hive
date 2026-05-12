# Design Discussion — Sandcastle Adoption Follow-on

**Epic ID:** `sandcastle-adoption-followon`  
**Branch (proposed):** `feat/sandcastle-adoption-followon`  
**Methodology (proposed):** classic  
**Scale (proposed):** medium-large  
**Date:** 2026-05-12

---

## Goal

The goal is to adopt the deferred Sandcastle primitives as a composable sandbox substrate for Hive runtime execution: `SandboxProvider`, `branchStrategy`, `createWorktree()`, and Sandcastle lifecycle hooks. The research brief frames this narrowly: close Hive's process/container isolation gap while leaving the existing backend-resolution model intact (`research-brief.md:5-7`).

The important reframe is that Sandcastle is not Hive's current `execution.substrate` flag growing another internal value. That flag routes `messages` versus `sessions-cloud`; Sandcastle wraps the CC CLI / Codex CLI at a coarser execution layer (`research-brief.md:11-15`, `research-findings.md:9-13`). I think this should become an execution mode, not a backend and not a Messages-API substrate.

Why this is worth doing: Hive's current isolation is worktree-based, and the documented gap is shared database, Docker daemon, ports, and caches (`research-brief.md:13`, `research-findings.md:15-20`). Sandcastle's `SandboxProvider` gives us a container boundary around the already-familiar one-branch-per-story pattern. The audit synergy is branch naming from story IDs, status sync on session end, and lifecycle order of issue -> worktree -> sandbox -> close/sync (`research-brief.md:160-168`, `research-findings.md:264-277`).

Default placement should remain post-2.0. The brief calls out audit §7 placing this as Epic D / post-2.0, with the user invocation treated as planning now rather than a signal to pull it into 2.0 (`research-brief.md:229-231`). Done means Hive has an opt-in Sandcastle execution mode for Codex-path runs, with the Anthropic `claudeCode()` lane explicitly deferred behind upstream #191 (`research-brief.md:141-145`, `research-findings.md:239-245`).

## Proposed approach

Add `execute-mode-sandcastle/SKILL.md` alongside the existing execution modes. The post-PR-#62 graph already has the boundary: `execute-dispatch/SKILL.md` owns `/execute` mode resolution, while `backend-dispatch/SKILL.md` owns provider/backend resolution (`research-brief.md:15`, `research-findings.md:40-62`). The Sandcastle mode should be selected by the grounded mode inputs: env `HIVE_EXECUTION_MODE`, root config `execution.mode`, default `auto`, plus field-source attribution and a one-line `mode_reason` (`research-findings.md:54-60`).

The mode creates/wraps a `SandboxProvider` factory instead of exposing Sandcastle through every story. The grounded factory surface is `createBindMountSandboxProvider(config)`, `createIsolatedSandboxProvider(config)`, and built-ins `docker()`, `podman()`, `vercel()`, `noSandbox()`, with docker-style config accepting `imageName`, `mounts`, `selinuxLabel`, `env`, and `network` (`research-brief.md:32-57`, `research-findings.md:94-120`).

Default to Podman and let Docker be opt-in. The spike found macOS rootless Podman is the maintainer-relevant path and needs a Hive default of `userns: false` to avoid parallel-run races (`research-brief.md:123-133`, `research-findings.md:220-229`).

Use `branchStrategy: { type: "branch", branch: <story-id> }` from day one. The API supports `head`, `merge-to-head`, and `branch`; `branch` matches Hive's one-branch-per-story flow (`research-brief.md:59-71`, `research-findings.md:122-132`). Until Epic C's adapter ABI lands, derive the branch from the local story YAML `id`; later rewire to adapter-issued IDs. The findings explicitly say this ordering is independent and local IDs are sufficient for substrate validation (`research-brief.md:170`, `research-findings.md:279-281`).

Use `createWorktree()` and `wt.run()` for the cold-start implementation path. The `Worktree` surface has `run()`, `interactive()`, `createSandbox()`, `close()`, and async disposal; cleanup is two-phase because `sandbox.close()` tears down the container while `wt.close()` cleans the worktree (`research-brief.md:73-88`, `research-findings.md:134-151`). Defer `createSandbox()` warm pools; the decision table marks it lower-priority `CONSIDER IF #7` (`research-brief.md:23-27`, `research-findings.md:81-88`).

Keep hooks minimal: integrate only `host.onWorktreeReady` in the first slice. Sandcastle hooks are lifecycle hooks, ordered after `copyToWorktree` and before sandbox creation for `host.onWorktreeReady`; they are not Hive PreToolUse or PostToolUse replacements (`research-brief.md:90-102`, `research-findings.md:153-171`). I would use this point for Hive-side worktree prep only, then expand to `host.onSandboxReady` / `sandbox.onSandboxReady` later if a concrete story needs it.

Make Codex auth setup explicit. Sandcastle's `codex()` provider does not auto-write `~/.codex/auth.json`, and Codex CLI 0.129+ ignores plain `OPENAI_API_KEY`; the spike-verified workaround is a one-time host setup that runs `codex login --with-api-key` into a mounted config dir (`research-brief.md:108-121`, `research-findings.md:203-218`). The design choice is whether that setup lives in `/hive:kickoff` or a dedicated setup skill; either way, the execution mode should assume an existing mounted auth dir.

Ship the logging mitigation with the mode. The spike found Sandcastle's file logger can write full `podman run` argv including API keys; the required mitigation is `.gitignore` coverage for `.sandcastle/` plus a stdout/stderr redaction wrapper for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and generic `*_TOKEN` / `*_KEY` patterns (`research-brief.md:135-139`, `research-findings.md:231-237`).

Defer `claudeCode()`. The work stream should use the Codex path only, because issue #191 blocks Anthropic Pro/Max subscription users and has no fix timeline as of the 2026-05-08 spike (`research-brief.md:141-145`, `research-findings.md:239-245`). No story in this phase should depend on Sandcastle session JSONL capture or Claude resume behavior.

## Architecture impacts

- New execution mode skill: `execute-mode-sandcastle/SKILL.md`, plugged into `execute-dispatch/SKILL.md` beside `execute-mode-session` and `execute-mode-team-cmux` (`research-brief.md:15`, `research-findings.md:54-60`).
- New `mode_decision` value for Sandcastle. **Architect-flagged correction (Phase B review):** `mode_decision` already has 4 values (`sessions | team | team-cmux | sequential` per `skills/hive/skills/execute-dispatch/SKILL.md:16`); the new Sandcastle value is the **5th**, not the 4th. Enum spelling still open (see Q1).
- Hidden coupling at `skills/execute/SKILL.md:143` — caller switch statement must add the new `sandcastle` case. This is a one-line change but **must be included in story scope** for the mode-routing slice; not implicit in the new SKILL file alone.
- `field_sources` extension required (architect-flagged). Per `skills/hive/skills/execute-dispatch/SKILL.md:44-63`, add `execution_mode` as a tracked field with env/config/default attribution + warning + telemetry. Do **not** overload existing `terminal_mux` or team gates.
- Existing env/config mode knobs participate: `HIVE_EXECUTION_MODE`, `execution.mode`, default `auto` (`research-findings.md:58-60`).
- **Worktree ownership rule (architect-flagged).** Hive already owns per-story worktrees under `.claude/worktrees/{story-id}` (`hive/references/sandboxing-patterns.md:19`). Sandcastle's two-phase teardown separates `sandbox.close()` (container) from `wt.close()` (worktree). To avoid duplicate ownership, the Sandcastle execution mode **owns `wt.close()`** when it created the worktree; legacy worktree path retains its existing owner. The new SKILL must declare this explicitly.
- New reference docs are needed for sandbox setup, auth mount expectations, Podman/Docker provider defaults, branch strategy, hooks scope, and logging redaction (TPM-flagged: likely **2 docs stories** given 5+ surfaces, not 1).
- New SKILL files: execution-mode SKILL + **auth-setup SKILL** (TPM-flagged: these are distinct surfaces with different lifecycles — one-time setup vs per-run dispatch — and should not be conflated into one story).
- No impact to backend-dispatch resolution. Sandcastle is a mode, not a backend: `backend-dispatch` keeps owning Codex vs Messages-API vs tmux handoff (`research-findings.md:47-62`, architect-confirmed against `skills/hive/skills/backend-dispatch/SKILL.md:32`).
- No force-on migration. Existing `execute-mode-session` and `execute-mode-team-cmux` users should see no behavior change; the brief's recommendation is opt-in only (`research-brief.md:221-223`, `research-findings.md:301-302`).

## Risks

| Risk | Severity | Mitigation / status |
|---|---:|---|
| Codex auth mount gap produces 401s because `auth.json` is missing. | high | Require one-time auth setup via kickoff or dedicated skill; mount the config dir into every run; keep `OPENAI_API_KEY` on sandbox provider only (`research-brief.md:108-121`, `research-findings.md:203-218`). |
| macOS rootless Podman parallel runs race with default `userns: keep-id`. | high | Hive-shipped Podman config defaults `userns: false`; Docker remains opt-in (`research-brief.md:123-133`, `research-findings.md:220-229`). |
| Sandcastle file logs leak API keys through full container argv. | high | Mandatory redaction wrapper plus `.gitignore` for `.sandcastle/`; do not ship without wrapper or upstream fix (`research-brief.md:135-139`, `research-findings.md:231-237`). |
| `claudeCode()` remains unusable for the Anthropic subscription-heavy OSS base. | high | Codex-path-only in this phase; add a defer-marker/watch for #191. Residual risk remains because upstream has no fix timeline (`research-brief.md:141-145`, `research-findings.md:239-245`). |
| Merge behavior is only partially validated. | medium | Spike verified parallel named branches reached agent invocation, but merge was unreached due to OpenAI quota zero; implementation needs a live quota validation run (`research-brief.md:104`, `research-findings.md:173-183`). |
| Dispatch plug-in point is fresh post-PR-#62. | medium | Keep change contained to execute mode routing; confidence is medium, so B2 H/V planning should map dispatch/config/ref-doc slices before story writing (`research-brief.md:198-205`, `research-findings.md:285-289`). |
| Hook adoption could be mistaken for Hive tool-hook replacement. | medium | First slice uses only `host.onWorktreeReady`; docs must say Sandcastle hooks are lifecycle-only and additive (`research-brief.md:90-102`, `research-findings.md:153-171`). |

## Dependencies

Epic C Adapter ABI is a soft dependency, not a blocker. The adapter reference includes lifecycle operations and branch naming, and the audit composition says adapter-issued story IDs can feed `branchStrategy.branch` (`research-brief.md:156-170`, `research-findings.md:256-281`). If Epic C lands later, the Sandcastle mode starts with local story YAML IDs and rewires.

Epic A W5 sidecar bundle is an open question. The brief asks whether the Sandcastle substrate needs to consume or produce sidecar bundle artifacts, but does not answer it (`research-brief.md:229`, `research-findings.md:305`). Treat this as design input before story authoring.

Watch Sandcastle issue #191. It is the explicit blocker for `claudeCode()` and for any Anthropic subscription lane (`research-brief.md:141-145`, `research-findings.md:239-245`).

External/runtime constraints are Sandcastle 0.x, Podman or Docker, git-root `cwd`, and one-time Codex auth material. The spike used `@ai-hero/sandcastle@0.5.10`, Podman, `cwd` at repo root, `maxIterations: 1`, and mounted Codex config (`research-brief.md:104`, `research-findings.md:173-183`).

## Open questions

**Architect-flagged pre-story decisions (resolved before Phase C, not left open):**

- **R-A. Auth setup surface = dedicated `/hive:sandbox-setup` skill** (not folded into `/hive:kickoff`). One-time host setup; runs `codex login --with-api-key` into a mounted config dir; idempotent. The execution mode assumes an existing mounted auth dir and fails fast with a clear "run `/hive:sandbox-setup` first" error if absent. Architect: "not acceptable as open implementation question" (`research-brief.md:108-121`).
- **R-B. Logger redaction wrapper ships with the mode** (in-Hive, not upstream-fix-wait). Wraps `podman run` stdout/stderr; redacts `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `*_TOKEN`, `*_KEY` patterns. `.gitignore` template gains `.sandcastle/`. Both are **hard prereqs** before any Sandcastle code path can land (TPM Tier-1). Architect: "ship-gated, not cleanup" (`research-brief.md:135-139`).

**Remaining open questions (for B2 H/V planning):**

Q1. **Mode enum spelling.** Recommendation: `sandcastle`. Provider-neutral naming (`sandbox`) revisited only if additional providers become first-class (`research-brief.md:207-211`).

Q4. **Hook scope.** Recommendation: minimal `host.onWorktreeReady` only for first slice; defer full hook YAML templates until a real story needs sandbox-side setup (`research-brief.md:217-227`).

Q5. **#191 tracking shape.** Recommendation: explicit defer-marker story (small but distinct, TPM Tier-3). Watch-only via project memory was considered and rejected because rediscovery during implementation is costly (`research-brief.md:219`).

Q6. **Sidecar bundle interaction.** Recommendation: answer during B2 before story authoring; no grounded design exists yet for Sandcastle consuming or producing Epic A W5 sidecar artifacts (`research-brief.md:229`).

Q7. **Placement.** Recommendation: **post-2.0** by default; planning can proceed now, but pulling into 2.0 would extend Epic A gate by 8-10 unrelated stories and couple Epic C Adapter ABI start (TPM-flagged) (`research-brief.md:231`).

## Scale assessment

**Recommendation: medium-large.**

Reasons: substrate change in the execution path; at least one new execution-mode SKILL and likely a setup SKILL; env/config knobs (`HIVE_EXECUTION_MODE`, `execution.mode`, `auto`) (`research-findings.md:58-60`); new reference docs for provider defaults, auth setup, branch strategy, hooks scope, and log redaction; cross-cutting auth/logging mitigations; soft Epic C composition; residual #191 risk.

```
SCALE ASSESSMENT:
  Files affected: ~10-16
  Story count: 8-10 (TPM-revised from initial 6-8 estimate; conflations in
               the initial figure: auth-setup vs execution-mode SKILLs are
               distinct, live-quota merge validation is net-new, ref-docs
               likely 2 stories)
  Subsystems: execute-dispatch mode routing, Sandcastle provider wrapping,
              worktree/branch lifecycle, auth-setup SKILL, logging/redaction
              wrapper, config/env mode selection
  Migration required: no; opt-in mode only
  Cross-team coordination: soft with Epic C Adapter ABI; open with Epic A W5
  Unknowns: 5 open questions (2 pre-story decisions resolved by review)

  RECOMMENDATION: medium-large; run H/V planning Phase B2
  RATIONALE: Crosses execution routing, sandbox lifecycle, auth, logging,
  and docs. B3 structured outline NOT needed unless user pulls into 2.0
  or broadens scope to `claudeCode()` / warm sandbox pool.
```

## Team review summary

| Reviewer | Verdict | Key feedback folded into design |
|---|---|---|
| Architect (Codex) | approve-with-escalation | `mode_decision` is 5th value not 4th; `skills/execute/SKILL.md:143` is hidden coupling; `field_sources` needs `execution_mode` tracked field; worktree ownership rule for `wt.close()`; auth.json + log redaction must be pre-story decisions (R-A, R-B above). |
| TPM (Claude) | approve-with-escalation | Story count 6-8 → 8-10 (auth + mode distinct, merge-validation net-new, ref-docs ×2); concur medium-large + B2 + skip B3; provided Tier-1/2/3 sequencing for H/V planning; cross-cutting concerns confirmed (security/observability/documentation). |

**Escalations raised** (written to `.pHive/cycle-state/sandcastle-adoption-followon.yaml`):

- `security:plan-audit` (major, pre-exec) — raised by architect + TPM (merged). Auth model change + active key-leak surface require pre-exec security review before stories author.
- `security:impl-audit` (moderate, append) — TPM. Per-story sidecar review on auth-setup, redaction wrapper, provider wrapping.
- `performance:audit` (minor, post-exec) — TPM. Cold-start latency baseline benchmark for future warm-pool decision.
