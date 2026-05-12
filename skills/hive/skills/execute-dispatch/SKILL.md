---
name: execute-dispatch
description: Resolve /execute mode selection and DAG executor cutover from caller-supplied environment, config, workflow, and arguments. Inherits the caller's model and execution context.
---

# Hive Execute Dispatch

Atomic skill, NOT inline `/execute` prose. It resolves the pre-execution dispatch layer and returns the mode and runner decisions the caller switches on. It inherits the caller's model and does not choose or override it.

## Invocation contract

Call this skill once at the single `/execute` dispatch point where the caller has both the story execution context and the current workflow handoff context.

**Inputs:** `env` with `HIVE_SESSIONS_ENABLED`, `HIVE_PARALLEL_TEAMS`, `HIVE_TERMINAL_MUX`, and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`; parsed root `hive.config.yaml` containing `sessions.enabled`, `parallel_teams` or `execution.parallel_teams`, and `execution.terminal_mux`; parsed consumer `.pHive/hive.config.yaml` or `None`; parsed graduation registry workflow list or `None`; `workflow_name`; and `arguments` containing the `--sequential` flag state plus dependency-depth summary.

**Outputs:** `mode_decision` enum `sessions | team | team-cmux | sequential`; `mode_reason` as a one-line string explaining the selected mode; `runner_path` enum `hive-dag | orchestrator-narrated`; `runner_reason` as a one-line string explaining the selected runner path; and `field_sources` map `{field_name: env|config|default}` covering `sessions_enabled`, `parallel_teams`, `terminal_mux`, and `executor` so callers can attribute every resolution.

**Side effects:** emit a structured warning only when consumer config sets `executor` to an unknown non-empty value, OR when any of the four tracked fields resolves to `default` (loud no-config warning + telemetry line). Missing consumer config, missing graduation registry, unset `executor`, false `executor_default`, and workflow-not-graduated remain normal fail-closed states and emit no warning for the runner gate itself.

## Input semantics

The mode selection uses these exact match conditions, in precedence order:

1. **Sessions check:** match when `env.HIVE_SESSIONS_ENABLED` is exactly truthy by string normalization (`1`, `true`, or `"true"`) OR root `hive.config.yaml` has `sessions.enabled: true`. This wins over every team or sequential input.
2. **Teams availability check:** match only when `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is exactly truthy by string normalization (`1`, `true`, or `"true"`).
3. **Parallel teams config check:** evaluate the resolved `parallel_teams` boolean from Step 0 below. The legacy reads (root `hive.config.yaml` `parallel_teams: true` or `execution.parallel_teams: true`) become the config-source path inside Step 0; this step matches whenever the resolved boolean is `true`.
4. **Concurrency and flag check:** match only when the dependency-depth summary shows more than one story at the same depth AND `arguments` does not contain `--sequential`.

The cmux variant is not a separate team gate. After all four team checks match, return `team-cmux` when the resolved `terminal_mux` from Step 0 equals `cmux`; otherwise return `team`.

## Sane Defaults

When neither env nor config sets a value, apply these defaults — better baseline for fresh repos per D4 Position A fold-in:

- `parallel_teams` → `true` (collaborative is the better default when more than one story sits at a given depth)
- `terminal_mux` → `tmux` (broadest compat across consumers)
- `sessions_enabled` → `false` (sessions remain opt-in)
- `executor` → `orchestrator-narrated` (fail-closed per Q4 lock; hive-dag requires explicit consumer flag plus registry)

## Process

### Step 0: Resolve Fields with Source Tracking

For each tracked field, apply strict precedence: **env > config > default**. Record the source in `field_sources`. Run this BEFORE Step 1.

- `sessions_enabled`:
  - env path: `env.HIVE_SESSIONS_ENABLED` truthy (`1`, `true`, `"true"`) → `true`, source `env`
  - config path: root `hive.config.yaml sessions.enabled: true` → `true`, source `config`
  - default: `false`, source `default`
- `parallel_teams`:
  - env path: `env.HIVE_PARALLEL_TEAMS` truthy → `true`, falsy explicit (`0`, `false`, `"false"`) → `false`, source `env`
  - config path: root `hive.config.yaml parallel_teams` or `execution.parallel_teams` set → that boolean, source `config`
  - default: `true`, source `default`
- `terminal_mux`:
  - env path: `env.HIVE_TERMINAL_MUX` set (non-empty) → that string, source `env`
  - config path: root `hive.config.yaml execution.terminal_mux` set → that string, source `config`
  - default: `tmux`, source `default`
- `executor`:
  - Always read from consumer `.pHive/hive.config.yaml` per Q4 lock. Env never overrides — env path is intentionally absent for this field.
  - config path: consumer config `executor: hive-dag` with `executor_default` truthy → `hive-dag`, source `config`
  - default: `orchestrator-narrated`, source `default`

When ANY of the four fields resolves with source `default`, emit a loud warning before returning, enumerating each defaulted field and the override path:

```
WARNING: Backend auto-resolved fields fell to defaults — sessions_enabled=false, parallel_teams=true, terminal_mux=tmux, executor=orchestrator-narrated. Override in hive.config.yaml (or env: HIVE_SESSIONS_ENABLED, HIVE_PARALLEL_TEAMS, HIVE_TERMINAL_MUX; executor lives in consumer .pHive/hive.config.yaml).
```

Emit one printable inline telemetry line covering every field resolution:

```
[telemetry] backend_resolution sessions_enabled={source} parallel_teams={source} terminal_mux={source} executor={source}
```

### Step 1: Resolve Mode Decision

Evaluate in this order and stop at the first selected path:

1. If the sessions check matches, return `mode_decision=sessions` and `mode_reason=sessions-enabled`.
2. If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not truthy, return `mode_decision=sequential` and `mode_reason=agent-teams-env-disabled`.
3. If parallel teams config is not true, return `mode_decision=sequential` and `mode_reason=parallel-teams-disabled`.
4. If the dependency-depth summary does not show multiple stories at the same depth, return `mode_decision=sequential` and `mode_reason=no-peer-depth`.
5. If `--sequential` is present in `arguments`, return `mode_decision=sequential` and `mode_reason=sequential-flag`.
6. When the resolved `terminal_mux` field (from Step 0, env > config > default) equals `cmux`, return `mode_decision=team-cmux` and `mode_reason=team-checks-pass-cmux`.
7. Otherwise return `mode_decision=team` and `mode_reason=team-checks-pass`.

This preserves precedence: `sessions > team-cmux > team > sequential`.

### Step 2: Resolve Runner Path

Evaluate the deterministic executor cutover as a five-stage decision tree. Default OFF: any miss returns `runner_path=orchestrator-narrated`.

> **WARNING:** Step 2 (this runner-path resolver) reads CONSUMER `.pHive/hive.config.yaml` ONLY for runner flags. Never read shipped `hive/hive.config.yaml` for runner flags — that would regress to pre-Slice-1 contamination.

1. **Read consumer config.** Use the caller-supplied consumer `.pHive/hive.config.yaml` parse result. If it is `None` or absent, return `runner_path=orchestrator-narrated` and `runner_reason=consumer-config-missing`.
2. **Check executor value.** If `executor` is unset or empty, return `runner_path=orchestrator-narrated` and `runner_reason=executor-unset`. If `executor` is anything other than `hive-dag`, emit a structured warning and return `runner_path=orchestrator-narrated` with `runner_reason=unknown-executor`.
3. **Check default flag.** If `executor_default` is not truthy (`on`, `true`, `yes`, `1`, or YAML bool `True`), return `runner_path=orchestrator-narrated` and `runner_reason=executor-default-off`.
4. **Read graduation registry.** Use the caller-supplied graduation registry workflow list. If it is `None` or missing, treat it as an empty list: no workflows graduated, no warning emitted, return `runner_path=orchestrator-narrated` and `runner_reason=registry-missing-empty`.
5. **Per-workflow gate.** If `workflow_name` is not in the registry list, return `runner_path=orchestrator-narrated` and `runner_reason=workflow-not-graduated`. If it is present, return `runner_path=hive-dag` and `runner_reason=gates-pass`.

When `runner_path=hive-dag`, the caller invokes `hive.lib.dag_executor.run_workflow(workflow_path, dispatcher, run_state_path=..., worktree_manager=...)`. The caller must pass populated `run_state_path` and `worktree_manager` when L3 run-state persistence and worktree-per-run isolation are available; `worktree_manager=None` remains valid when the caller has already decided no isolation should be nested.

**Why this gating exists (Q4 lock):** the consumer-side flag layer keeps maintainer-only execution choices out of the shipped `hive/hive.config.yaml` (the eefbff3 / `project_config_shipping_deferred` pattern). The per-workflow registry layer lets graduation events ship without consumer config edits. Default OFF preserves zero-behaviour-change for non-opt-in consumers. Both gates must be true; either gate empty falls through to the orchestrator path.

**Missing-registry distinction:** a missing graduation registry is a normal fail-closed state and means no workflows are graduated. Do not warn for that case. Warn only when `executor` is set to an unknown non-empty value, for example `executor: hive-fast`.

## Single Dispatch Point

This skill is the single dispatch point for `/execute` mode selection and executor-vs-orchestrator runner cutover. Callers must consume `mode_decision`, `mode_reason`, `runner_path`, and `runner_reason` from this skill instead of re-implementing the decision tree in another skill or workflow step. Other surfaces may use `hive.lib.dag_executor.executor_enabled_for(workflow_name)` only as the reader helper for the same runner gate, not as a separate policy layer.
