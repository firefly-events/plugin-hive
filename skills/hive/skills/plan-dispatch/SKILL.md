---
name: plan-dispatch
description: Resolve /plan runner path selection and DAG executor cutover for the planning flow. Returns runner_path and runner_reason. Inherits the caller's model and execution context.
---

# Hive Plan Dispatch

Atomic skill, NOT inline `/plan` prose. It resolves the pre-planning runner gate and returns the runner decisions the caller switches on. It inherits the caller's model and does not choose or override it.

## Invocation contract

Call this skill once at the single `/plan` dispatch point where the caller has the planning context and the current environment.

**Inputs:** `env` with `HIVE_PLANNING_MODE`; parsed consumer `.pHive/hive.config.yaml` containing `planning.mode`, or `None`.

**Outputs:** `runner_path` enum `hive-dag | orchestrator-narrated`; `runner_reason` as a one-line string explaining the selected runner path.

**Side effects:** none (read-only resolution).

## Process

### Step 1: Resolve Runner Path

Evaluate the following in precedence order, stop at the first match. Default OFF: any miss returns `runner_path=orchestrator-narrated`.

> **WARNING:** This resolver reads CONSUMER `.pHive/hive.config.yaml` ONLY for planning runner flags. Never read shipped `hive/hive.config.yaml` for runner flags — that would regress to pre-Slice-1 contamination.

1. **Env override.** If `env.HIVE_PLANNING_MODE` exactly equals `hive-dag` (case-sensitive, no leading/trailing whitespace after strip), return `runner_path=hive-dag` and `runner_reason=planning-mode-override-env`.
2. **Config override.** If consumer `.pHive/hive.config.yaml` has `planning.mode: hive-dag`, return `runner_path=hive-dag` and `runner_reason=planning-mode-override-config`.
3. **Graduated registry.** If `executor_enabled_for('plan')` returns `True`, return `runner_path=hive-dag` and `runner_reason=graduated-registry`.
4. **Default.** Return `runner_path=orchestrator-narrated` and `runner_reason=default`.

Env beats config when both are set: `HIVE_PLANNING_MODE=hive-dag` with `planning.mode: hive-dag` in config — env wins, reason is `planning-mode-override-env`.

### Isolation contract

`execution.mode` (the execute-dispatch field) and `HIVE_EXECUTION_MODE` have no effect on plan-dispatch resolution. This skill MUST NOT read or be influenced by any execute-flow config keys (`HIVE_EXECUTION_MODE`, `execution.mode`, `executor`, `executor_default`). These are execute-dispatch–only inputs and must remain fully isolated from the planning flow.

`executor_enabled_for('plan')` checks the graduation registry for the literal workflow name `plan`. This is the only graduation check for this skill; per-workflow gating for execute-flow workflows does not apply here.

## Single Dispatch Point

This skill is the single dispatch point for `/plan` runner selection. Callers must consume `runner_path` and `runner_reason` from this skill instead of re-implementing runner decisions in another skill or workflow step.
