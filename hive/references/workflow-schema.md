# Workflow Definition Schema

Workflows are YAML files that define a sequence of steps with agent assignments, dependencies, and data flow.

## Structure

```yaml
name: workflow-name          # lowercase, alphanumeric with hyphens
description: What it does    # optional
version: "1.0.0"             # semver
methodology: classic         # optional: classic, tdd, bdd, fdd

steps:
  - id: step-name            # unique within workflow, lowercase
    agent: researcher         # agent persona to use (matches agents/ filename)
    task: >                   # task description for the agent (fallback if no step_file)
      What the agent should do.
    step_file: workflows/steps/{name}/step-01-{name}.md  # optional: path to step file
    depends_on:               # optional: step IDs that must complete first
      - previous-step
    inputs:                   # optional: data from previous steps
      - name: param-name
        source: step_output   # literal, step_output, or context
        step_id: previous-step
        output_name: output-name
    outputs:                  # optional: named outputs for downstream steps
      - name: result
        type: string          # string, json, or artifact_ref
    optional: false           # if true, workflow continues even if step fails
    timeout_ms: 600000        # max duration (1s to 1hr)
```

### Step Files

The `step_file` field points to a self-contained instruction file that replaces the inline `task` description. When `step_file` is present, the orchestrator loads the file and passes it to the agent as the primary procedure — the `task` field becomes a fallback summary.

Step files provide robust guardrails: mandatory execution rules, context boundaries, command templates, success metrics, failure modes, and next-step gating. See `references/step-file-schema.md` for the full schema.

**Precedence:** `step_file` > `task`. If both are present, the step file is authoritative.

**Three-layer context model:** When using step files, the agent receives:
1. **Agent persona** (from `agents/{agent}.md`) — WHO: identity, capabilities, quality standards
2. **Step file** (from `step_file` path) — HOW: exact procedure, execution rules, gating
3. **Story spec** (from execution context) — WHAT: the specific feature or task

Step files live at `hive/workflows/steps/{workflow-name}/step-{NN}-{kebab-name}.md`.

## Dependency Rules

- Steps without `depends_on` can run immediately (or in parallel if agent teams are available)
- Steps with `depends_on` wait until all listed steps complete
- Circular dependencies are invalid
- If an optional step fails, downstream steps that depend on it receive null inputs

## Input Sources

| Source | Required Fields | Description |
|--------|----------------|-------------|
| `literal` | `value` | Hardcoded string value |
| `step_output` | `step_id`, `output_name` | Output from a previous step |
| `context` | `context_key` | Value from workflow execution context |

## Output Types

| Type | Description |
|------|-------------|
| `string` | Plain text output |
| `json` | Structured JSON data |
| `artifact_ref` | Reference to a file produced by the step |

## Conditional Skip (`skip_when`)

Steps may declare a `skip_when` predicate that suppresses execution when true. The predicate is a free-form string evaluated by the orchestrator against the workflow execution context (story spec, prior step outputs, hive.config.yaml).

```yaml
steps:
  - id: research
    agent: researcher
    skip_when: "story.complexity == 'low'"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `skip_when` | string | null | Predicate; when true the step is skipped and downstream `optional` inputs receive null |

When a step is skipped, downstream steps that bind to its outputs via per-input `optional: true` receive `null` and proceed; bindings without `optional: true` halt the dependent step.

## Output Gate (`gate`)

Steps may declare a `gate` assertion that the step's outputs must satisfy before downstream steps run. The gate text is a free-form predicate evaluated against the step's output dict.

```yaml
steps:
  - id: test
    agent: tester
    outputs:
      - name: test_artifacts
        type: artifact_ref
    gate: "test_artifacts must not be empty"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gate` | string | null | Predicate over step outputs; failure halts the workflow with a gate-rejection record |

Gates are distinct from the `retry` block: a gate failure is a hard halt at the step's output boundary, while `retry` governs how many times a step may be re-attempted before that gate is consulted.

## Gate Retry Configuration

Steps can define retry behavior for when quality gates fail. Add a `retry` block to any step:

```yaml
steps:
  - id: review
    agent: reviewer
    task: >
      Review the implementation...
    retry:
      max_attempts: 2          # total attempts (1 = no retry, 2 = one retry)
      feedback_injection: true  # feed gate findings into retry prompt
      escalate_after: 2         # escalate to human after N failures
```

### Retry Flow

```
for each attempt up to max_attempts:
  output = executeStep(prompt + gateFeedback)
  gate = evaluateGate(output)
  if gate.passed: break
  gateFeedback = gate.findings  // inject into next attempt
if not passed after all attempts:
  if escalate_after reached: escalate to human
  elif step.optional: skip with warning
  else: halt story with failed status
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_attempts` | int | 1 | Total execution attempts (1 = no retry) |
| `feedback_injection` | bool | true | Feed gate findings into retry prompt |
| `escalate_after` | int | max_attempts | Escalate to human after N failures |

### When to Use

- **Review steps** — reviewer returns `needs_revision` → feed findings to developer → retry
- **Test steps** — tests fail → feed failure output to developer → retry implementation
- **Validation steps** — coverage gaps found → feed gaps to test author → retry

Steps without a `retry` block default to `max_attempts: 1` (no retry).

## Per-Step Tool Gating (`tools`, `disallowed_tools`)

Steps may narrow or override the agent persona's default tool grant via two per-step fields:

```yaml
steps:
  - id: implement
    agent: developer
    tools: ["Read", "Edit", "Bash(git *)"]
    disallowed_tools: ["Write"]
```

### Composition policy: `pure_override_with_surface_when_overrides`

Cycle-state composition rationale (`security:plan-audit` lock):

> "situation dictates which tools are used; step-author has most specific context; trust step-level authority but surface/log when step overrides persona for security observability."

- **`tools:`** — when set, **REPLACES** the persona default tool list entirely. NOT a merge. The step-author's intent supersedes the persona baseline because the step has the most specific context.
- **`disallowed_tools:`** — when set, subtracts from the active set. If `tools:` is also set, subtraction runs against `tools:`; otherwise against the persona default.
- **Neither set** — persona defaults pass through unchanged. No audit event.

### Audit-event contract

Every override path emits one `tool_gating_overridden` event via the executor telemetry channel. Event payload:

| Field | Type | Notes |
|-------|------|-------|
| `persona_default_tools` | list[str] | Pre-override baseline |
| `effective_tools` | list[str] | Post-composition tool list |
| `step_override_tools` | list[str] | Present iff `tools:` was set |
| `step_disallowed_tools` | list[str] | Present iff `disallowed_tools:` was set |
| `persona_id` | str | Present iff resolved at policy time |

Standard executor event envelope (`run_id`, `step_id`, `event_type`, `timestamp`) is added by the telemetry layer. See `executor-event-schema.md` for the envelope contract.

### Allow-list — `escalatable_tools.yaml` (second factor)

`hive/lib/dag_executor/executor/escalatable_tools.yaml` is the maintainer-controlled second factor on top of the audit event. Without it, a workflow YAML edit could silently grant any tool. With it, an unlisted tool causes `ToolNotEscalatableError` at policy resolution.

| Section | Meaning |
|---------|---------|
| `always_grantable` | Low-blast tools (Read, Grep, Glob, LS) any step may grant |
| `escalatable` | High-blast tools (Bash, Write, Edit, codex, cmux) — listed = allowed; unlisted = `ToolNotEscalatableError` |
| `persona_deny.<tool>` | Personas that may **never** receive `<tool>` via override (e.g. `codex` is denied to `reviewer`, `peer-validator`, `security-reviewer` so verifier isolation holds) — violation raises `BackendIsolationViolationError` |

A step that *narrows* a tool already in the persona default (`Bash(git *)` against persona `Bash`) is treated as a constraint, not a grant — the allow-list is not consulted.

### Platform check (Risk #11)

Tools `codex` and `cmux` are macOS-only by upstream constraint. When a step grants either on a non-Darwin platform, `compose_tool_policy` raises `PlatformIncompatibilityError`. **No silent fallback** — surfacing the mismatch at policy resolution time prevents cryptic agent-runtime confusion.

## Forthcoming Additive Fields

The DAG executor (epic `hive-dag-executor`) loads the following fields without erroring; their semantics are enforced by later stories. Workflow authors may include them today, but no behavioral change occurs until the corresponding handler ships.

| Field | Scope | Loaded? | Enforced by |
|-------|-------|---------|-------------|
| `when` | per-step / edge | yes (round-trips on the model) | hde-3a (predicate evaluator) |
| `node_type: pause` | per-step | yes (enum value accepted) | hde-8 (pause semantics) |
| `trigger_rule` | per-step | placeholder; loader passthrough | hde-3a (trigger-rule policy) |

`when:` is intended as a per-step or per-edge predicate that gates whether the step runs at all (distinct from `skip_when`, which evaluates against the workflow context rather than upstream-edge truth values). `node_type: pause` will instruct the executor to checkpoint and wait for an external resume signal in hde-8. `trigger_rule` will let a step declare `all_success | any_success | always` semantics over its `depends_on` set.

These fields are documented here so workflow authors can plan for them; until the enforcing handlers ship, including these fields has no runtime effect.
