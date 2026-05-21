# Sandcastle Adoption Guide

End-user reference for adopting `sandcastle` as the Hive execution mode. This guide cross-links source-of-truth files rather than restating their content.

---

## 1. Setup

Run `/hive:sandbox-setup` before selecting this mode. That skill is the only supported setup path — do not shortcut it.

For a step-by-step checklist of package pinning, container runtime checks, image pull, `auth.json` creation, and gitignore verification, see:

- **Skill:** `skills/hive/skills/sandbox-setup/SKILL.md`
- **Checklist:** `hive/references/sandcastle-setup-checklist.md`

### Auth file handling

Sandcastle's `codex()` provider mounts `auth.json` inside the container at `/home/agent/.codex`. Codex CLI ≥ 0.129 ignores `OPENAI_API_KEY` as a bare env var and requires this mounted file. A missing or malformed file causes a 401 and a silent agent-run failure.

- **Host path:** `.sandcastle/codex-config/` (relative to repo root)
- **Container path:** `/home/agent/.codex`

`auth.json` validity is checked at setup time. A malformed file fails loudly with a rotation prompt — it does not fail silently.

**Passing the API key to Podman:**

```bash
# CORRECT — printf does not add the key to shell history
printf '%s' "$OPENAI_API_KEY" | podman run -i \
  -v "$(pwd)/.sandcastle/codex-config:/home/agent/.codex:ro" \
  sandcastle:hive \
  codex ...

# CORRECT — env-file with restricted permissions
echo "OPENAI_API_KEY=${OPENAI_API_KEY}" > .sandcastle/run.env
chmod 600 .sandcastle/run.env
podman run --env-file .sandcastle/run.env \
  -v "$(pwd)/.sandcastle/codex-config:/home/agent/.codex:ro" \
  sandcastle:hive \
  codex ...
rm .sandcastle/run.env   # clean up immediately
```

**Do NOT use `printenv` form.** `printenv OPENAI_API_KEY | podman run -i ...` looks safe because shell history only records the literal command (variable name, not value), but it still leaks the secret through other channels: the parent shell's environment is visible via `/proc/<pid>/environ` to anyone who can read it, `printenv`'s argv shows the key name in `ps`, and the piped stdin briefly resides in kernel buffers any container-runtime hook can capture. Use `printf '%s' "$OPENAI_API_KEY"` (stdin-only), `--env-file` with `chmod 600`, or a real secret manager (1Password CLI, `pass`, `aws secretsmanager get-secret-value`) instead.

To rotate a key: delete `.sandcastle/codex-config/auth.json`, update `OPENAI_API_KEY` in your environment, then re-run `/hive:sandbox-setup`. No dedicated rotation skill exists in V1 — this manual path is the V1 rotation procedure.

---

## 2. Provider Defaults

The `hive/lib/sandcastle-provider.js` wrapper exports `createSandcastleProvider`. All Sandcastle provider construction must go through this wrapper. Never construct `SandboxProvider` inline — the wrapper applies log redaction before provider construction, and inline construction bypasses that.

| Option | Default | Notes |
|---|---|---|
| Runtime | Podman | Docker is opt-in; see below |
| `userns` | `false` | Hard-coded in wrapper |
| Mount | `.sandcastle/codex-config` → `/home/agent/.codex` | Codex config host path |
| Image | `sandcastle:hive` | Override only when a story spec requires a custom image |
| Version range | `@ai-hero/sandcastle >=0.5.10 <0.6.0` | 0.5.x introduced `codex()` provider; 0.6.x is not yet validated |

**Docker opt-in:** Docker is available via `options.useDocker = true` but must be explicit — the default runtime is Podman.

### userns:false — macOS dev vs. production Linux

> **CRITICAL security caveat:** `userns: false` is required for macOS parallel Podman runs but should **NOT** be used in production Linux deployments where UID isolation is required.

On macOS, the rootless-Podman `keep-id` user-namespace map setup races when two or more containers start in parallel. Setting `userns: false` avoids the race. In production Linux environments, leave `userns` at its default (`keep-id`) so each container runs with a non-root UID mapped from the host. This distinction is a **moderate security finding** from the impl-audit; see `hive/references/sandcastle-setup-checklist.md` §8 for details.

---

## 3. Routing — Selecting Sandcastle Mode

Field-source attribution follows strict precedence: **env → config → default**.

**Option A — environment variable:**

```bash
HIVE_EXECUTION_MODE=sandcastle /hive:execute <epic-id>
```

The value must be exactly `sandcastle` (case-sensitive). Any other value is silently ignored.

**Option B — root `hive.config.yaml`:**

```yaml
execution:
  mode: sandcastle
```

When either option is set, `mode_decision=sandcastle` is applied immediately at the dispatch step and the standard sessions/team/sequential mode resolution chain is skipped entirely. The `field_sources.execution_mode` output records `env` or `config` accordingly.

When neither is set, `execution_mode=default` is the result — this is the normal non-sandcastle path and does NOT trigger a "fell to defaults" warning.

---

## 4. Codex-Path Only

Sandcastle V1 uses the Codex-path only. The `claudeCode()` subscription lane is blocked by upstream issue #191 (subscription auth is unimplemented upstream). Subscription-lane support is deferred to a future story.

Watch file: `.pHive/upstream-watch/sandcastle-191.md`

Do not attempt to wire `claudeCode()` in this mode.

---

## 5. Branch Strategy and Worktree Lifecycle

Pass `storyId` to `createWorktree` via the wrapper. The resulting worktree uses:

```js
branchStrategy: {
  type: 'branch',
  branch: storyId,   // field is `branch`, not `name`
}
```

**Ownership split:**

- **Sandcastle-created worktree** (return value of `createWorktree`): this mode owns `wt.close()`. Call it before returning on both success and failure paths. Failing to close leaks the container sandbox.
- **Legacy `.claude/worktrees/{story-id}` worktree handed in by another owner:** this mode does NOT call `wt.close()`. The owner that created it is responsible for closing it.

Ownership is determined by who called `createWorktree`. See `skills/hive/skills/execute-mode-sandcastle/SKILL.md` §Worktree ownership for the full split rule.

**Uncommitted-changes cleanup caveat (sandcastle 0.5.10):**

`wt.close()` does **NOT** auto-remove a worktree that has uncommitted changes — sandcastle prints a warning of the form `Run succeeded but worktree has uncommitted changes at …` and leaves the worktree on disk. This is by design (preserves work for inspection), but consumers running batched or parallel sandbox jobs need an explicit cleanup step.

Recommended pattern after a Sandcastle run that intentionally leaves uncommitted state:

```bash
git worktree remove --force .sandcastle/worktrees/<branch-name>
git branch -D <branch-name>
```

If your story always commits its work before returning (which the standard execute-mode flow does), this caveat does not apply. The s4 merge-validation script encountered this because its prompt deliberately created a file without committing — the same pattern shows up in any "create-only" validation harness.

---

## 6. Log Redaction

`hive/lib/sandcastle-log-redaction.js` wraps the Sandcastle logger before provider construction. This is why inline `SandboxProvider` construction is prohibited — the wrapper ensures redaction is installed before any Sandcastle startup log lines are emitted.

**V1 coverage — four forms:**

| Form | Example input | Redacted output |
|---|---|---|
| Argv/env assignment | `OPENAI_API_KEY=sk-test` | `OPENAI_API_KEY=[REDACTED]` |
| Bearer header | `Authorization: Bearer sk-test` | `Authorization: Bearer [REDACTED]` |
| JSON key-value | `"api_key": "sk-test"` | `"api_key": "[REDACTED]"` |
| HTTP header line | `X-API-Key: sk-test` | `X-API-Key: [REDACTED]` |

Covered patterns:

- **Argv form** — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, any `*_TOKEN`, any `*_KEY`.
- **Bearer form** — `Authorization: Bearer …` (case-insensitive on both `Authorization` and `Bearer`).
- **JSON form** — keys ending in `_key`, `_token`, `-key`, `-token` (so both `openai_api_key` and `X-API-Key` are caught), plus the literal patterns `api_key`/`apiKey`/`openai_api_key`.
- **HTTP-header-line form** — bare header lines (no JSON quotes) whose name ends in `-Key`, `-Token`, or `-Secret`: `X-API-Key`, `X-Auth-Token`, `X-Client-Secret`, `Api-Key`, etc. Anchored to line start so non-secret headers (`Content-Type`, `Host`, `User-Agent`) pass through unchanged. The Authorization-Bearer form is handled by its dedicated regex earlier in the pipeline, so the literal `Bearer` prefix survives redaction.

**V1 coverage gaps:**

- Base64-encoded secrets are out of scope for V1.
- `printenv`/env-dump output is out of scope for V1. (This is also why `printenv` form is an anti-pattern for key delivery — see §1.)

---

## 7. Hooks — What They Are and Are Not

Sandcastle hooks are **lifecycle hooks** at the worktree/container layer. They are **NOT** Hive PreToolUse hooks. Do not confuse the two systems.

V1 supports one hook point: `host.onWorktreeReady` — fires on the host after the worktree is prepared, before the container starts. Pass it via `options.hooks.host.onWorktreeReady` as an array of `HostHookCmd` objects: `{ command: string; timeoutMs?: number }`.

`HostHookCmd` constraints: no `sudo` key, no `cwd` key.

V1 deferred hook points (`host.onSandboxReady`, `sandbox.onSandboxReady`): the wrapper throws if these are passed. Do not add them until a real consumer story requires them.

See `skills/hive/skills/execute-mode-sandcastle/SKILL.md` §Hooks.

---

## 8. .sandcastle/ Gitignore

`.sandcastle/` must be present in `.gitignore` before this mode runs — it is a **ship gate** enforced at Step 1 of the Sandcastle mode skill.

The current canonical ignore surface is the root `.gitignore` file.

**Informational warning (S5 scope — minor finding):** The rule `.sandcastle/` is a non-anchored pattern. It matches any directory named `.sandcastle/` anywhere in the repo tree, not only at the root. This is broader than intended if any subdirectory contains a `.sandcastle/` path. For a repo-root-only ignore, use `/.sandcastle/` (leading slash anchors to root).

---

## 9. Sidecar Bundles

Sandcastle V1 neither consumes nor produces sidecar bundles. This is an explicit neutral decision — no dependency and no blocker. Sidecar injection at the review step (the `appends_map` path used in team-based execution) is not part of the Sandcastle mode path in V1.

---

## 10. Warm Pool

V1 creates a fresh sandbox per run. Cold-start overhead is incurred on every run — this is intentional for V1, where correctness and isolation take priority over startup latency.

The warm-pool pattern is parked as future work. See the placeholder for deferred details and trigger conditions:

- `hive/references/sandcastle-warm-pool-placeholder.md`

---

## 11. Validation Evidence

S4 merge validation was performed with outcome class **B — blocked-on-prereq** (Podman/Sandcastle not available in the validation environment). Unit-test re-attestation for S1–S3 surfaces ran regardless of class. Re-run conditions are documented in the results file.

- `.pHive/epics/sandcastle-adoption-followon/docs/merge-validation-results.md`

---

## Quick Reference

```bash
# Run setup (idempotent — safe to re-run)
/hive:sandbox-setup

# Select mode via env
HIVE_EXECUTION_MODE=sandcastle /hive:execute <epic-id>

# Select mode via config (root hive.config.yaml)
execution:
  mode: sandcastle
```

Key files:

| Purpose | Path |
|---|---|
| Setup skill | `skills/hive/skills/sandbox-setup/SKILL.md` |
| Setup checklist | `hive/references/sandcastle-setup-checklist.md` |
| Mode skill | `skills/hive/skills/execute-mode-sandcastle/SKILL.md` |
| Provider wrapper | `hive/lib/sandcastle-provider.js` |
| Log redaction | `hive/lib/sandcastle-log-redaction.js` |
| Upstream #191 watch | `.pHive/upstream-watch/sandcastle-191.md` |
| Warm-pool placeholder | `hive/references/sandcastle-warm-pool-placeholder.md` |
| Validation evidence | `.pHive/epics/sandcastle-adoption-followon/docs/merge-validation-results.md` |
