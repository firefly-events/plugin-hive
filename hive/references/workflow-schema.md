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

## Pause / Approve Gates (`node_type: pause`)

A `node_type: pause` step SUSPENDS the run, persists a per-run HMAC signing key (mode `0600`), emits a signed resume token to telemetry, and waits for an external sentinel. Operators (or upstream automation) approve or reject by writing a sentinel file under `.pHive/runs/{run_id}/pause/`.

```yaml
steps:
  - id: human_approval
    node_type: pause
    timeout_ms: 86400000   # optional; default = no user timeout
    depends_on: [pre_pause]
```

### Sentinel files

| Path | Effect |
|------|--------|
| `.pHive/runs/{run_id}/pause/{node_id}.approve` | Resume the workflow. Sentinel body MUST contain the resume token issued at suspend time. |
| `.pHive/runs/{run_id}/pause/{node_id}.reject` | Fail the workflow. Sentinel body MUST contain the token; an optional reason follows after a blank line. |

The pause directory is created with mode `0700`. The signing key file (`.signing_key`) is written with mode `0600` and never leaves the local machine.

### Token format

```
<base64url(payload_json)>.<hex_hmac_sha256>
```

Payload: `{"run_id": "...", "node_id": "...", "timestamp": "..."}`. The token is bound to BOTH `run_id` AND `node_id` — a token from one run cannot resume another, and a token from one pause node cannot resume a sibling node within the same run (Risk #10 mitigation). Sentinel filenames alone NEVER honor the pause: `signal.py` reads the body and verifies the signature against the per-run key BEFORE returning. An invalid token raises `PauseSignalForgedError`; the polling loop continues so an attacker cannot force success by writing a junk sentinel.

### Timeout & security floor

| Setting | Behavior |
|---------|----------|
| `timeout_ms` set | Wait up to `min(timeout_ms / 1000, hard_ceiling)` seconds. |
| `timeout_ms` omitted | Wait up to `hard_ceiling` seconds (default **30 days**). |

The hard ceiling is a security floor — a forgotten "no timeout" pause cannot hold an open run-state, worktree, and signing key indefinitely (security:plan-audit finding #3).

### State transitions

| Trigger | run_state status | Telemetry event |
|---------|------------------|-----------------|
| Pause node enters handler | `RUNNING` → `SUSPENDED` (via `mark_suspended`) | `pause_suspended` (payload includes the resume token) |
| Approve sentinel verified | `SUSPENDED` → `RUNNING` (via resume) | `pause_resumed` |
| Reject sentinel verified | `SUSPENDED` → `FAILED` (via `mark_failed`) | `pause_rejected` (payload carries the reason) |
| Timeout elapsed | `SUSPENDED` → `FAILED` (via `mark_failed`) | `pause_timeout` |

## Scheduler Overrides (`under_scheduler`)

Steps that normally require an interactive pause may declare an `under_scheduler` block to define non-interactive behavior when the workflow is running in scheduler context.

```yaml
steps:
  - id: plan-approval
    node_type: pause
    under_scheduler:
      auto_approve: true
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `under_scheduler.auto_approve` | bool | null | Scheduler-context override for a pause step: `true` auto-passes the step without dispatching the pause handler; `false` fails closed with an error instead of blocking on a non-interactive pause. |

Interactive runs ignore `under_scheduler` and dispatch the pause step normally. The key is step-level and generalizable to any future workflow whose interactive gate needs explicit scheduler behavior.

## Predicate Routing (`when:`)

Per-step `when:` is a strict-Archon predicate evaluated against the materialised output graph of upstream steps before dispatch. When the predicate evaluates False (or fails closed), the step is skipped — the walker emits `predicate_evaluated` (with the result) and `node_skipped` (with `reason: when_predicate_false`).

```yaml
steps:
  - id: triage
    agent: researcher
    outputs:
      - name: metric_signal
        type: json

  - id: deep-dive
    agent: researcher
    depends_on: [triage]
    when: "$triage.output.metric_signal == true"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `when` | string | null | Strict-Archon predicate; False or fail-closed skips the step. Distinct from `skip_when` (which gates on workflow context). |

The grammar — operators, fail-closed semantics, change_verdict / cycle_verdict disambiguation, and the cultural lock that grammar additions require an epic — is documented in [`predicate-grammar.md`](./predicate-grammar.md). Workflow authors should read that doc before adding any `when:` predicate.

## Multi-Upstream Joins (`trigger_rule`)

Steps with multiple `depends_on` entries (multi-upstream joins) are gated by a single trigger-rule policy:

| Trigger rule | Behaviour |
|--------------|-----------|
| `none_failed_min_one_success` (default and only) | RUN iff at least one upstream completed; SKIP otherwise. Failed upstreams convert to SKIP for the candidate node — failure does NOT cascade as failure. |

The policy name is intentionally explicit and fixed; alternative trigger rules (`all_success`, `any_success`, `always`, `one_failed`) are NOT supported. Adding one requires an epic — see [`predicate-grammar.md`](./predicate-grammar.md).

Single-upstream nodes do not pass through the trigger-rule layer — the per-input `optional: true` semantics from [Conditional Skip](#conditional-skip-skip_when) and [Input Sources](#input-sources) preserve the legacy contract: an upstream optional failure surfaces as `None` on the downstream binding rather than skipping the downstream.

## Executor Cutover — Additive + Registry-Gated

The Hive DAG executor (`hive.lib.dag_executor`) is a deterministic alternative to the orchestrator-narrated execution path. Its rollout is **additive**: graduating a workflow to the executor does not break, change, or version the workflow YAML schema. The same workflow file runs unchanged under either path; the executor lights up the structured `output_format` contracts (hde-3b) and `when:` predicates (hde-3a) when present, and falls back to prose-output equivalents otherwise.

Cutover gating is per-consumer and per-workflow:

- **Consumer flag:** `.pHive/hive.config.yaml` (consumer-side, NOT shipped) carries `executor: hive-dag` and `executor_default: off|on`. Default OFF.
- **Graduation registry:** `.pHive/runtime/executor-graduated-workflows.yaml` lists the workflow names that have been graduated to the executor. A workflow runs through the executor only when the consumer flag is on AND the workflow appears in the registry.
- **Routing point:** `skills/execute/SKILL.md` step 5pre is the single dispatch point. See `hive/lib/dag_executor/__init__.py` for the `executor_enabled_for(workflow_name)` reader.

Workflow authors do not need to schema-version their files when graduating. Existing workflows that pass spine-parity tests under the executor are graduation candidates.

### Authoring forward — defaults for new workflows

New workflow authors should default to executor-friendly shapes and treat prose-routed behaviour as deprecated. Specifically:

- **Routing decisions**: declare `when:` predicates against named output_format fields, not prose instructions. The strict-Archon grammar at `hive/references/predicate-grammar.md` is small on purpose; conformance to it is what makes routing mechanical.
- **Step outputs**: declare structured `outputs:` with explicit names and types. Downstream `when:` predicates and `inputs:` bindings address those named fields.
- **Step files**: include an `OUTPUT FORMAT` block listing the named fields the step is contracted to emit. The executor binds predicates by name; prose-only outputs that "encode" a routing signal in narrative are a deprecated pattern (see PR #31's metric_signal/findings conflation, structurally retired by hde-3b's output_format contract on `step-02-analysis`).
- **Multi-domain forks**: declare two declarative nodes with `when:` predicates rather than a single prose step that branches inline. The grammar has no `contains` operator on purpose; pre-compute booleans on a story-context node's outputs and predicate against those (see `hive/references/story-spec-schema.md`).

Workflows that ship today as prose-routed (and have not been graduated to the executor registry) continue to work unchanged. Treat that path as **maintenance-mode**: existing workflows are still supported under the orchestrator, but new prose-routed workflows are discouraged. The migration path is documented in `hive/decisions/001-executor-cutover.md`.

## Ceremony Workflow Variant

The `daily-ceremony.workflow.yaml` uses `phases:` as the top-level collection key instead of `steps:`. This is an intentional semantic distinction: the daily ceremony is an orchestrator-driven coordination ceremony rather than a multi-agent development workflow. The `phases:` key signals that entries represent ordered ceremony phases, not parallelisable agent task steps.

Ceremony workflow phases follow the same per-entry structure as development steps (each phase has `id:`, `step_file:`, and related fields) but have two operational differences from development workflows:

1. **Sequential only** — phases run in declared order; the `depends_on` mechanism does not apply
2. **Orchestrator-executed** — the orchestrator works through all phases itself; no sub-agent roster is spawned per phase

When auditing or validating workflow YAML files, treat `phases:` as a recognised variant of `steps:` for ceremony workflows. Do not flag `phases:` as a schema violation in `daily-ceremony.workflow.yaml`.
