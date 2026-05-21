---
name: execute-dispatch
description: Resolve /execute mode selection and DAG executor cutover from caller-supplied environment, config, workflow, and arguments. Inherits the caller's model and execution context.
---

# Hive Execute Dispatch

Atomic skill, NOT inline `/execute` prose. It resolves the pre-execution dispatch layer and returns the mode and runner decisions the caller switches on. It inherits the caller's model and does not choose or override it.

## Invocation contract

Call this skill once at the single `/execute` dispatch point where the caller has both the story execution context and the current workflow handoff context.

**Inputs:** `env` with `HIVE_SESSIONS_ENABLED`, `HIVE_PARALLEL_TEAMS`, `HIVE_TERMINAL_MUX`, `HIVE_EXECUTION_MODE`, and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`; parsed root `hive.config.yaml` containing `sessions.enabled`, `parallel_teams` or `execution.parallel_teams`, and `execution.terminal_mux`; parsed consumer `.pHive/hive.config.yaml` or `None`; parsed graduation registry workflow list or `None`; `workflow_name`; `arguments` containing the `--sequential` flag state plus dependency-depth summary; and `unblocked_stories[]` — the depth-0 ready stories at this dispatch tick, each carrying at minimum `id`, `parallel_allowed`, `parallel_rationale`, and (for `parallel_rationale: bounded-slice`) `files_to_modify[]` whose entries name the declared touch-set. Empty or single-element `unblocked_stories[]` is valid: the parallel-dispatch gate (Step 1.5) skips when there is no peer set to gate.

**Outputs:** `mode_decision` enum `sessions | team | team-cmux | sequential | sandcastle | multica`; `mode_reason` as a one-line string explaining the selected mode; `runner_path` enum `hive-dag | orchestrator-narrated`; `runner_reason` as a one-line string explaining the selected runner path; `field_sources` map `{field_name: env|config|default}` covering `sessions_enabled`, `parallel_teams`, `terminal_mux`, `executor`, and `execution_mode` so callers can attribute every resolution; and `gate_violations[]` — a list of `{story_id, reason}` records emitted by Step 1.5 when the parallel-dispatch gate refuses fan-out. `gate_violations[]` is `[]` on healthy runs and on any `mode_decision` other than `team | team-cmux | sessions | sandcastle | multica`.

`field_sources.execution_mode` tracks the source of an explicit override (sandcastle or multica): `env` when `HIVE_EXECUTION_MODE={sandcastle|multica}` wins, `config` when `execution.mode: {sandcastle|multica}` from root `hive.config.yaml` wins, `default` when neither env nor config selects an override (fall-through to the standard mode resolution chain). Unlike the four existing fields, `execution_mode=default` does NOT trigger the loud "fell to defaults" warning — default is the normal case for non-override runs. The `execution_mode={source}` token is always appended to the telemetry line regardless of source.

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
- `execution_mode`:
  - env path: `env.HIVE_EXECUTION_MODE` equals exactly `sandcastle` (case-sensitive) → source `env`; any other value is ignored (not an error — reserved for future modes)
  - config path: root `hive.config.yaml execution.mode: sandcastle` → source `config`
  - default: neither env nor config selects sandcastle → source `default` (fall-through to standard mode resolution)
  - When source is `env` or `config`: immediately set `mode_decision=sandcastle` and `mode_reason=execution-mode-override-{source}`. Skip Step 1 entirely. This takes precedence over sessions, team, and sequential.
  - `execution_mode=default` does NOT trigger the "fell to defaults" warning — it is the normal non-sandcastle path. Always include `execution_mode={source}` in the telemetry line.
- `execution_mode` (continued): multica override
  - env path: `env.HIVE_EXECUTION_MODE` equals exactly `multica` (case-sensitive) → source `env`; any other value is ignored (reserved for future modes)
  - config path: root `hive.config.yaml execution.mode: multica` → source `config`
  - default: neither env nor config selects multica → source `default` (fall-through to standard mode resolution OR sandcastle override if it fired earlier)
  - When source is `env` or `config`: immediately set `mode_decision=multica` and `mode_reason=execution-mode-override-{source}`. Skip Step 1 entirely. This takes precedence over sessions, team, and sequential.
  - `execution_mode=default` does NOT trigger the "fell to defaults" warning — it is the normal non-multica path.

If both sandcastle and multica are set across env and config (for example env `HIVE_EXECUTION_MODE=sandcastle` with config `execution.mode: multica`, or env `HIVE_EXECUTION_MODE=multica` with config `execution.mode: sandcastle`), env wins over config per standard Hive precedence.

When ANY of the four fields (`sessions_enabled`, `parallel_teams`, `terminal_mux`, `executor`) resolves with source `default`, emit a loud warning before returning, enumerating each defaulted field and the override path:

```
WARNING: Backend auto-resolved fields fell to defaults — sessions_enabled=false, parallel_teams=true, terminal_mux=tmux, executor=orchestrator-narrated. Override in hive.config.yaml (or env: HIVE_SESSIONS_ENABLED, HIVE_PARALLEL_TEAMS, HIVE_TERMINAL_MUX; executor lives in consumer .pHive/hive.config.yaml).
```

Emit one printable inline telemetry line covering every field resolution:

```
[telemetry] backend_resolution sessions_enabled={source} parallel_teams={source} terminal_mux={source} executor={source} execution_mode={source}
```

### Step 1: Resolve Mode Decision

**Precondition:** only reached when `field_sources.execution_mode=default` (Step 0 did not select sandcastle or multica via env or config). When either override was selected in Step 0, skip this step entirely.

Evaluate in this order and stop at the first selected path:

1. If the sessions check matches, return `mode_decision=sessions` and `mode_reason=sessions-enabled`.
2. If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not truthy, return `mode_decision=sequential` and `mode_reason=agent-teams-env-disabled`.
3. If parallel teams config is not true, return `mode_decision=sequential` and `mode_reason=parallel-teams-disabled`.
4. If the dependency-depth summary does not show multiple stories at the same depth, return `mode_decision=sequential` and `mode_reason=no-peer-depth`.
5. If `--sequential` is present in `arguments`, return `mode_decision=sequential` and `mode_reason=sequential-flag`.
6. When the resolved `terminal_mux` field (from Step 0, env > config > default) equals `cmux`, return `mode_decision=team-cmux` and `mode_reason=team-checks-pass-cmux`.
7. Otherwise return `mode_decision=team` and `mode_reason=team-checks-pass`.

This preserves precedence: `sessions > team-cmux > team > sequential`.

### Step 1.5: Parallel-Dispatch Gate (ed-7)

**Precondition:** only reached when `mode_decision ∈ {team, team-cmux, sessions, sandcastle, multica}` AND `unblocked_stories[]` has length > 1. When `mode_decision` is `sequential`, or when the peer set has fewer than two stories, skip this step entirely — there is no parallel fan-out to gate. The gate also runs when `mode_decision` is `sandcastle` or `multica` because the provider fans out one assignment per depth-0 story.

The gate refuses parallel dispatch unless **every** story in `unblocked_stories[]` is properly annotated. Default-serial is the contract: a story without explicit opt-in MUST fall back to sequential dispatch. Initialize `gate_violations: []` and evaluate the following checks in order; record one record per offending story and continue (do NOT short-circuit on the first failure — the warning enumerates the full set so a single fix pass resolves all of them).

1. **`parallel_allowed` opt-in check.** For each story whose `parallel_allowed` is absent, `false`, or any value other than the literal boolean `true`: append `{story_id, reason: "parallel_allowed-missing-or-false"}` to `gate_violations[]`. Stories with `parallel_allowed: false` are valid serial stories — they are listed here only because they appear in a fan-out set together with peers; the gate refuses to mix serial and parallel within one dispatch tick.

2. **`parallel_rationale` shape check.** For each story where `parallel_allowed: true`, validate that `parallel_rationale` is present AND its value is exactly one of `variation`, `read-only`, `bounded-slice`. Any other value (missing, `null`, free-form string, typo) is **malformed**: append `{story_id, reason: "parallel_rationale-malformed"}` to `gate_violations[]`. Per [`story-yaml-schema.md`](../../../hive/references/story-yaml-schema.md) §4.3, missing or off-enum rationale is a hard validator-reject; a "parallel_allowed-without-rationale" story never reaches dispatch as if it were valid.

3. **`bounded-slice` touch-set declaration check.** For each story with `parallel_rationale: bounded-slice`, validate that `files_to_modify` is present and non-empty AND every entry resolves to a non-empty string `file:` path. An empty list, missing field, or entries with no `file:` value is malformed for the bounded-slice rationale (only this rationale constrains the file set). Append `{story_id, reason: "bounded-slice-missing-files_to_modify"}`. Stories with `variation` or `read-only` rationale do NOT require a declared touch-set — the gate ignores `files_to_modify` for those rationales.

4. **`bounded-slice` touch-set disjointness check.** Collect every `bounded-slice` story's declared `files_to_modify[*].file` values into per-story sets. Compute pairwise intersections across the bounded-slice subset. For every non-empty intersection, append one record per participating story: `{story_id, reason: "bounded-slice-overlap:<path1>,<path2>,...:<peer_id>"}`. The reason string names the overlapping paths and the peer story whose touch-set collides so the orchestrator's warning surfaces the exact conflict; if a path appears in three or more stories, each colliding pair generates its own record. Touch-set entries are compared as literal strings — the gate does NOT normalize paths (no symlink resolution, no glob expansion, no relative-vs-absolute coercion). Planners declaring `bounded-slice` must use the canonical path form `/plan` writes.

If after all four checks `gate_violations[]` is non-empty: downgrade `mode_decision = sequential` and set `mode_reason = parallel-gate-refused`. Emit a structured warning to stdout that names every offending story ID and reason:

```
WARNING: parallel-dispatch gate refused — falling back to sequential. Offending stories:
  - {story_id_1}: {reason_1}
  - {story_id_2}: {reason_2}
  ...
Fix by editing planning emission (/plan Phase C step 13) or correcting the story YAML; see hive/references/parallel-call-sites.md and hive/references/story-yaml-schema.md §4.
```

If `gate_violations[]` is empty after all four checks: the mode resolved in Step 1 stands. Do not modify `mode_decision` or `mode_reason`. The empty `gate_violations[]` is still returned so callers can branch unconditionally on its length.

> **Telemetry note:** the gate's pass/refuse outcome is captured by the orchestrator's post-run audit (see [`hive/references/gate-lift-telemetry.md`](../../../hive/references/gate-lift-telemetry.md)) via the `gate_violations[]` field on the dispatch return; no separate event emission lives in this skill.
>
> **Scope reminder:** the gate inspects only the depth-0 `unblocked_stories[]` set passed to this skill call. Stories at later dependency depths are gated on their own subsequent dispatch tick when `/execute` re-enters this skill for the next peer set. See [`hive/references/parallel-call-sites.md`](../../../hive/references/parallel-call-sites.md) for the catalog of dispatch points subject to this gate.

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

This skill is the single dispatch point for `/execute` mode selection, the parallel-dispatch gate (Step 1.5, `ed-7`), and the executor-vs-orchestrator runner cutover. Callers must consume `mode_decision`, `mode_reason`, `gate_violations[]`, `runner_path`, and `runner_reason` from this skill instead of re-implementing any of those decisions in another skill or workflow step. Other surfaces may use `hive.lib.dag_executor.executor_enabled_for(workflow_name)` only as the reader helper for the same runner gate, not as a separate policy layer.

The parallel-dispatch gate is reachable from no other surface: any future skill that wants to fan stories out concurrently MUST do so through this dispatch point so the gate inspects its `unblocked_stories[]` set, and MUST add a row to [`hive/references/parallel-call-sites.md`](../../../hive/references/parallel-call-sites.md) §2 for the new dispatch shape.
