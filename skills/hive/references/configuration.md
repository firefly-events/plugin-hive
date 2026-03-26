# Hive Configuration

All configurable settings live in `skills/hive/hive.config.yaml`. The orchestrator reads this at session start. Defaults are sensible — configuration is optional.

## Configuration File

Location: `skills/hive/hive.config.yaml`

If the file doesn't exist, all defaults apply.

## Schema

See `skills/hive/hive.config.yaml` for the full default template with comments.

## Settings Reference

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

### Execution

| Setting | Default | Description |
|---------|---------|-------------|
| `execution.default_methodology` | classic | Default workflow methodology |
| `execution.parallel_teams` | false | Allow parallel dev teams (future) |
| `execution.max_retry_attempts` | 2 | Default retry attempts for gate failures |
