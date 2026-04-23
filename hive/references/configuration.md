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
| `paths.state_dir` | `.pHive` | Directory where Hive stores per-project state (epics, episodes, cycle state, sessions, memories). Slice 1 introduces the unified resolver; until then, shipped skills and workflows still reference `.pHive/` directly in some places, so alternate values are documented ahead of full end-to-end wiring. |
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

## Maintainer Boundary

Some Hive assets are maintainer-only and are used to improve the plugin itself rather than support marketplace consumers. Those assets do not belong in marketplace consumer installs, and consumers receive only the neutral baseline configuration plus any repo-local override they choose to add.

The `maintainer-skills/` directory is excluded from marketplace distribution via `marketplace.json` under the Slice 5 story `marketplace-exclude-maintainer-skills`.

Maintainer defaults such as Codex backends, Opus routing, and `cmux` terminal mux preferences do not ship. For the same reason, maintainer-only keys are intentionally absent from the shipped settings reference, including `execution.terminal_mux`, `execution.idle_timeout_seconds`, and external model routing such as `agent_backends`.

See also:
- `hive/references/state-boundary.md`
- `hive/references/state-relocation.md`
