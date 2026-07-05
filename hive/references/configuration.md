# Hive Configuration

Hive uses a two-file configuration contract. The shipped baseline lives in `hive/hive.config.yaml`, and consumers can optionally override it with a root-level `hive.config.yaml`.

## Configuration Structure

Defaults are consumer-safe and configuration is optional.

| Layer | Location | Role | Precedence |
|-------|----------|------|------------|
| Shipped baseline | `hive/hive.config.yaml` | Plugin-owned baseline with neutral defaults that are safe for marketplace consumers | Lower |
| Consumer override | `hive.config.yaml` | Repository-local override layer for consumer-specific settings | Higher |

precedence: when both files exist, root `hive.config.yaml` wins for overlapping keys and missing keys fall through to `hive/hive.config.yaml`.

## Configuration Files

- Baseline: `hive/hive.config.yaml`
- Optional override: `hive.config.yaml`

If the root override file does not exist, the shipped baseline applies by itself.

## Schema

See `hive/hive.config.yaml` for the shipped default template with comments.

## Settings Reference

### Paths

| Setting | Default | Description |
|---------|---------|-------------|
| `paths.state_dir` | `.pHive` | Directory where Hive stores per-project state (epics, episodes, cycle state, sessions, memories). Relocatable — set a different value to move state elsewhere. See `hive/references/state-relocation.md`. |
| `paths.target_project` | `null` | Primary source for the "attached project" path used by meta-team targeting. When unset (`null`), the resolver falls back to the invoking cwd. Config-key first, cwd fallback, no CLI argument form. |

### Relocating the state directory

For the consumer-facing relocation procedure, coverage notes, and migration
steps, see `hive/references/state-relocation.md`.

### Quality Gates

| Setting | Default | Description |
|---------|---------|-------------|
| `quality_gates.auto_pass_threshold` | 0.9 | Score above this → auto-pass |
| `quality_gates.human_escalation_threshold` | 0.3 | Score below this → human escalation |

### Trust Scoring

| Setting | Default | Description |
|---------|---------|-------------|
| `trust.initial_score` | 0.5 | Starting trust for new agent pairs |
| `trust.high_threshold` | 0.8 | Above this → skip full validation |
| `trust.low_threshold` | 0.5 | Below this → enforce full handshake |
| `trust.decay_rate` | 0.05 | Trust decay per interval |
| `trust.decay_interval_days` | 7 | How often trust decays |

### Token Budgets

| Setting | Default | Description |
|---------|---------|-------------|
| `tokens.per_task_limit` | 100000 | Max tokens per step |
| `tokens.per_story_limit` | 500000 | Max tokens per story |
| `tokens.per_epic_limit` | 2000000 | Max tokens per epic |
| `tokens.warning_threshold` | 0.8 | Warn at this fraction of any limit |

### Context Window

| Setting | Default | Description |
|---------|---------|-------------|
| `context_window.budget_fraction` | 0.7 | Target max context usage |
| `context_window.degradation_threshold` | 0.85 | Spawn fresh instance above this |

### Effort & Context Adaptation

`hooks/effort-gate.sh` runs on `SessionStart` and resolves an effort tier for the
session, persisting it to `${HIVE_STATE_DIR}/session-effort.txt` (default state dir
`.pHive`) so skills can branch on it without re-reading env on every check.

**Resolution precedence:** `$CLAUDE_EFFORT` env var > existing
`.pHive/session-effort.txt` > default `medium`.

**Accepted tiers:** `low` | `medium` | `high` | `xhigh`. `max` is normalized to
`xhigh`. Any other unrecognized value falls back to `medium` and logs a warning to
stderr — the hook always exits 0 so a bad value never breaks the session.

**Behavior map:**

| Tier | Behavior |
|------|----------|
| `low` | Skip the test swarm; fastest, lowest-cost path. |
| `medium` | Default behavior — no adaptation. |
| `high` | Default behavior — no adaptation. |
| `xhigh` | Add extra audits on top of the default workflow. |

**1M-context guidance:** when running with a 1M-token context window model,
prefer raising `context_window.budget_fraction` and
`context_window.degradation_threshold` (see Context Window above) so the session
takes fuller advantage of the larger window before spawning a fresh instance or
degrading. There is no separate 1M-specific config key — it is the same two
`context_window.*` knobs, tuned higher.

### Task Tracking

| Setting | Default | Description |
|---------|---------|-------------|
| `task_tracking.adapter` | null | `linear`, `github`, or `jira` |
| `task_tracking.queue_name` | "Hive — Human Intervention" | Queue/label name |
| `task_tracking.auto_expire_days` | 7 | Days before unresolved items expire |
| `task_tracking.linear_team` | null | Linear team key (e.g., "ACME") |
| `task_tracking.linear_project` | null | Linear project name (e.g., "plugin-hive") |
| `task_tracking.linear_user_id` | null | User UUID for assignment locking (run `linearis users list --active` to find) |
| `task_tracking.linear_prefix` | "[Hive]" | Prefix for Hive-created issues |
| `task_tracking.branch_prefix` | "hom" | Branch naming: `{prefix}-{N}-{slug}` (enables Linear GitHub auto-link) |

### Execution

| Setting | Default | Description |
|---------|---------|-------------|
| `execution.default_methodology` | classic | Default workflow methodology |
| `execution.parallel_teams` | false | Allow parallel dev teams (future) |
| `execution.max_retry_attempts` | 2 | Default retry attempts for gate failures |

### Sessions (Managed Agent Execution)

When `sessions.enabled: true` (or `HIVE_SESSIONS_ENABLED=1` env var), the execute skill uses the Claude Agent SDK `/v1/sessions` API for story-level execution (v2.1.178+ auto-spawn model). The session registry at `${HIVE_STATE_DIR}/sessions/index.yaml` tracks all active sessions.

| Setting | Default | Description |
|---------|---------|-------------|
| `sessions.enabled` | false | Enable session-based execution (step 6c). Set `true` or use `HIVE_SESSIONS_ENABLED=1` env var |
| `sessions.model` | (inherits from model_tiers) | Model to use for session agents; inherits tier assignment if not set |
| `sessions.timeout_ms` | 600000 | Max time (ms) to wait for a session to complete (10 minutes) |
| `sessions.stuck_timeout_ms` | 90000 | SSE silence (ms) before a session is considered stuck; doubled for implement/test/optimize steps (90 seconds default) |
| `sessions.max_retries` | 3 | Max stuck+retry cycles per story before escalating to the user |

**Session registry:** See `hive/references/session-registry-schema.md`.
**Bootstrap skill:** See `skills/hive/skills/session-registry/SKILL.md`.
**Resilience:** See `hive/references/session-resilience.md` for stuck detection and retry.

### Agent Backends

`agent_backends` is a maintainer-controlled section for model-level execution resilience. Consumer installs normally omit it; set it in your root `hive.config.yaml` when you need model-level fallback.

| Setting | Default | Description |
|---------|---------|-------------|
| `agent_backends.fallback_model` | `[]` | Ordered list of backup models tried sequentially when the primary model is rate-limited or unavailable. Models are attempted left-to-right until one succeeds or the list is exhausted. When absent or empty, no fallback occurs and a rate-limit or availability error surfaces directly to the operator. See also: `hive/references/token-management.md` for context-health tracking. |

Example:

```yaml
agent_backends:
  fallback_model:
    - claude-opus-4-5
    - claude-sonnet-4-5
```

When `fallback_model` is unset and a story's expected token budget exceeds 200 k tokens, the execute-dispatch skill emits an operator warning (see `skills/hive/skills/execute-dispatch/SKILL.md` §Pre-flight Checks).

**Cross-ref, not the same key:** Claude Code CLI has its own `fallbackModel` setting (chain-cap behavior for the CLI's own model fallback). That is a Claude Code–native setting, unrelated to `agent_backends.fallback_model` above — this section documents only the Hive key; do not merge the two concepts.

### `/config key=value` (Claude Code operator shortcut)

Claude Code v2.1.181+ supports `/config key=value` as an interactive-session shortcut for editing the CLI's own `settings.json`. This is Claude Code–native: it is **not** a way to hot-edit `hive.config.yaml`, and it is **not** Hive dynamic config. Hive config changes still go through the two-file `hive.config.yaml` contract described above.

### Providers (proposed / not yet implemented)

Claude Code upstream has added Gateway support for Claude on AWS (`anthropicAws`). Hive has no provider reader, dispatch contract, or credential boundary for it today — this is a proposed shape only, owned by Claude Code upstream, with no Hive reader that consumes it. No `providers.anthropicAws.*` config example is given here because none is implemented.

Before this could move from aspirational to real Hive config, it needs:

1. A Hive provider reader (a `config.py`-level parser for a `providers.*` block).
2. A credential/security review of how AWS-hosted Anthropic credentials would be sourced and scoped.
3. Parse/precedence tests confirming a `providers` block composes correctly with the existing shipped-baseline / consumer-override precedence rules.

This subsection carries a [moderate] `security:plan-audit` escalation (new external provider/credential surface if ever promoted out of aspirational status) — handled as execute-but-flag, not a blocking pre-exec gate; flagged here for reviewer visibility.

### Tool-param deny rules

Hive has no per-tool-parameter deny key in `hive.config.yaml`. Current Claude Code uses `permissions.deny` with `Tool(specifier)` rules at the project-settings level (not `hive.config.yaml`). See `hive/references/permission-patterns.md` for worked examples and role-to-deny-list recommendations.

## Maintainer Boundary

Some Hive assets are maintainer-only and are used to improve the plugin itself rather than support marketplace consumers. Those assets do not belong in marketplace consumer installs, and consumers receive only the neutral baseline configuration plus any repo-local override they choose to add.

The `maintainer-skills/` directory is excluded from marketplace distribution via `marketplace.json` under the Slice 5 story `marketplace-exclude-maintainer-skills`.

Maintainer defaults such as Codex backends, Opus routing, and `cmux` terminal mux preferences do not ship. For the same reason, maintainer-only keys are intentionally absent from the shipped settings reference, including `execution.terminal_mux` and `execution.idle_timeout_seconds`. External model routing under `agent_backends` is documented in the `### Agent Backends` section above.

See also:
- `hive/references/state-boundary.md`
- `hive/references/state-relocation.md`
