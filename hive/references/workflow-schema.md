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
