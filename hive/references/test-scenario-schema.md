# Test Scenario Schema

**Status:** canonical reference (foundation — schema only)
**Epic:** `autonomous-cycle-loop`
**Story:** `s0-1-schema-and-config-bump`
**Companion docs:**

- [`sandcastle-mode.md`](sandcastle-mode.md) — `shared` vs `dedicated` container reuse policy for the runner that replays these scenarios
- [`episode-schema.md`](episode-schema.md) — episode markers the loop reads to decide pass/fail per scenario
- [`gate-lift-telemetry.md`](gate-lift-telemetry.md) — telemetry shape; the loop's per-scenario summary follows the same envelope

**Simulated-manual testing (Slice C, story c-1):**

- [`hive/lib/scenarios/load.mjs`](../../hive/lib/scenarios/load.mjs) — loader + validator for simulated-manual scenario YAMLs (`tests/scenarios/<topic>.yaml`)
- [`hive/workflows/steps/test/simulated-manual.md`](../../hive/workflows/steps/test/simulated-manual.md) — executor protocol: step narration, pass/fail capture, cycle-state writeback

## 1. Purpose

This reference fixes the canonical shape of a **test scenario YAML** under `.pHive/test-scenarios/<scenario-id>.yaml`. A test scenario is the smallest replayable unit the autonomous cycle loop drives: an invocation, the conditions that must hold before it, and the assertions that decide pass/fail after.

The loop runner that consumes these YAMLs lands in a later story of the `autonomous-cycle-loop` epic. This story (`s0-1-schema-and-config-bump`) ships the schema only, so downstream stories — and human scenario authors — can cite a stable contract.

Scope rule: this doc does **not** define epic stories, episode markers, or workflow steps. Those have their own schemas. A test scenario only *references* them.

## 2. Storage path

```text
.pHive/test-scenarios/<scenario-id>.yaml
```

The directory is governed by `autonomous_cycle_loop.test_scenarios_path` in `hive.config.yaml` / `hive/hive.config.yaml`; the default above matches the shipped baseline. Subdirectories are permitted — the loop walks the tree.

`<scenario-id>` is a stable kebab-case identifier that doubles as the scenario's primary key in telemetry. Renaming a scenario file breaks cross-run aggregation; treat it as a schema-change-class edit.

## 3. Top-level shape

```yaml
id: <scenario-id>            # required; kebab-case; matches filename without .yaml
title: <human title>         # required; single-line
description: |               # optional; block scalar for multi-line context
  Free-form prose explaining what this scenario is exercising and why.

# --- Replay invocation ---
invocation:                  # required
  kind: skill | command | workflow
  ref: <skill-or-command-or-workflow-ref>
  args: <string>             # optional; passed verbatim to the invocation

# --- Pre-conditions ---
pre_conditions:              # optional; default []
  - kind: file_exists | file_absent | env_set | config_eq | git_branch
    ref: <path | env-var | config-dotted-key | branch-name>
    value: <expected>        # required for env_set / config_eq

# --- Pass criteria ---
expectations:                # required; non-empty
  - kind: file_exists | file_absent | file_contains | episode_marker |
          exit_status | stdout_contains | stderr_absent
    ref: <path | marker-name | regex>
    value: <expected>        # required for file_contains / episode_marker /
                             # exit_status / stdout_contains

# --- Runtime guards ---
timeout_seconds: <int>       # required; hard cap on scenario wall-time
sandcastle_mode_override:    # optional; null = inherit run-level config
  shared | dedicated

# --- Bookkeeping ---
tags: [<string>, ...]        # optional; free-text for filter/group at run-pick
owner: <agent-name-or-role>  # required; who triages a regression
```

## 4. Field semantics

### 4.1 `id`

Kebab-case identifier. Must match the filename minus `.yaml`. The loop runner rejects YAMLs whose `id` and filename disagree — silent mismatch would let two scenarios share a telemetry key.

### 4.2 `invocation`

The exact thing being replayed. Three `kind`s are legal:

| `kind` | `ref` shape | Example |
|---|---|---|
| `skill`    | `plugin:skill-name` or `skill-name` | `plugin-hive:execute`, `triage` |
| `command`  | shell command, single line          | `gh issue view 198` |
| `workflow` | path to workflow YAML under `hive/workflows/` | `hive/workflows/development.classic.workflow.yaml` |

`args` is appended verbatim — quoting and whitespace are the author's responsibility. A scenario that needs to drive multi-line input belongs in a fixture file referenced by `pre_conditions`, not packed into `args`.

### 4.3 `pre_conditions`

Conditions checked **before** the invocation runs. If any pre-condition fails, the scenario is **skipped** (not failed) and reported as `inconclusive` in telemetry. Skipping rather than failing keeps a missing fixture from polluting the loop's pass/fail signal.

| `kind` | Semantics |
|---|---|
| `file_exists`  | `ref` is a repo-relative path; the file must exist |
| `file_absent`  | `ref` is a repo-relative path; the file must NOT exist |
| `env_set`      | `ref` is an env-var name; `value` is the expected string (exact match) |
| `config_eq`    | `ref` is a dotted key into the resolved root `hive.config.yaml`; `value` is the expected literal |
| `git_branch`   | `ref` is a branch name; `HEAD` must point at that branch |

### 4.4 `expectations`

Conditions checked **after** the invocation completes. The scenario passes iff every expectation holds. Expectations are evaluated in declaration order; the first failure terminates the run for that scenario and is reported.

| `kind` | Semantics |
|---|---|
| `file_exists`        | `ref` is a repo-relative path; created during the run |
| `file_absent`        | `ref` is a repo-relative path; not present after the run |
| `file_contains`      | `ref` is a path; `value` is a regex matched against file contents |
| `episode_marker`     | `ref` is an episode-marker name per [`episode-schema.md`](episode-schema.md); `value` is the expected status (`pass` \| `fail` \| `inconclusive`) |
| `exit_status`        | `value` is the expected integer exit code of the invocation (commands only) |
| `stdout_contains`    | `value` is a regex matched against captured stdout |
| `stderr_absent`      | `ref` is a regex; assertion holds iff stderr does NOT match |

`exit_status` and `stdout_contains` are only meaningful when `invocation.kind: command`. For `skill` / `workflow` invocations, prefer `episode_marker` — skills don't return a stable exit code through the orchestrator wrapper.

### 4.5 `timeout_seconds`

Hard wall-time cap. The loop kills the invocation when this is hit and records `timeout` as the failure reason. Authors must set this consciously — too tight masks slow-but-correct runs as failures; too loose lets a hung run starve the rest of the loop.

### 4.6 `sandcastle_mode_override`

Optional per-scenario override of `autonomous_cycle_loop.sandcastle_mode` (see [`sandcastle-mode.md`](sandcastle-mode.md)). Use when a scenario has state-isolation requirements its neighbours don't share — e.g., a scenario that mutates global state should declare `dedicated` even when the run-level config is `shared`. `null` (or field absent) inherits the run-level config.

### 4.7 `tags`

Free-text labels for filtering at run-pick time (`--tag foo` or programmatic selectors). Common conventions:

- `smoke` — minimal scenario set to gate a release
- `slow` — scenarios over ~60s; excluded from fast lanes
- `flaky` — known to fail nondeterministically; surfaced in triage but excluded from pass/fail gates

The tag set is open; the loop runner does not validate against an enum.

### 4.8 `owner`

Agent persona name or human role responsible for triaging a regression in this scenario. Telemetry routing reads this field; an unset value forces the regression onto the orchestrator's queue, which masks accountability — set this consciously.

## 5. Worked examples

### 5.1 Smoke scenario — `/standup` over an empty triage queue

```yaml
id: standup-empty-queue
title: "/standup over an empty triage queue produces no-op output"
description: |
  Regression-guard against a class of bugs where /standup miscounts an
  empty queue as one item. The expected output is the literal "no items"
  prose plus a pass marker.
invocation:
  kind: skill
  ref: plugin-hive:standup
pre_conditions:
  - kind: file_exists
    ref: .pHive/triage/queue.yaml
  - kind: file_contains
    ref: .pHive/triage/queue.yaml
    value: '^items:\s*\[\]\s*$'
expectations:
  - kind: episode_marker
    ref: standup.summary
    value: pass
  - kind: stdout_contains
    ref: 'no items'
timeout_seconds: 60
tags: [smoke, standup]
owner: tpm
```

### 5.2 Cumulative scenario — plan then execute, sharing container

```yaml
id: plan-then-execute-trivial-epic
title: "/plan emits an epic.yaml that /execute consumes successfully"
description: |
  Validates the plan→execute handoff on a trivial single-story epic.
  Requires shared sandcastle (default) so /execute sees /plan's writes.
invocation:
  kind: workflow
  ref: hive/workflows/development.classic.workflow.yaml
  args: '--epic test-trivial'
pre_conditions:
  - kind: file_absent
    ref: .pHive/epics/test-trivial/epic.yaml
expectations:
  - kind: file_exists
    ref: .pHive/epics/test-trivial/epic.yaml
  - kind: episode_marker
    ref: execute.integrate
    value: pass
timeout_seconds: 900
sandcastle_mode_override: shared
tags: [integration]
owner: orchestrator
```

### 5.3 Isolated scenario — first-run kickoff behavior

```yaml
id: kickoff-greenfield-first-run
title: "kickoff produces project-profile.yaml on a fresh checkout"
description: |
  Characterizes first-run behavior. MUST run in a fresh container —
  scenario 1's writes would mask a real regression here.
invocation:
  kind: skill
  ref: plugin-hive:kickoff
pre_conditions:
  - kind: file_absent
    ref: .pHive/project-profile.yaml
expectations:
  - kind: file_exists
    ref: .pHive/project-profile.yaml
  - kind: episode_marker
    ref: kickoff.complete
    value: pass
timeout_seconds: 300
sandcastle_mode_override: dedicated
tags: [smoke, kickoff, first-run]
owner: orchestrator
```

## 6. Review checklist (for /plan + /review)

A test scenario YAML is acceptable when:

- `id` matches the filename minus `.yaml`; both are kebab-case.
- `title` is a single line; not empty; not a placeholder ("TODO", "fix me").
- `invocation.kind` is one of `skill | command | workflow`; `ref` is shaped correctly for the chosen kind (§4.2).
- `expectations` is non-empty. A scenario with no assertions is not a scenario — it is an unverified replay.
- Every `expectation.kind` is one of the seven enum values; `value` is present whenever §4.4 requires it.
- `timeout_seconds` is a positive integer set deliberately (not 0, not the default of an enclosing template).
- `owner` is set to a real persona name or human role.
- The scenario is **falsifiable from the YAML alone** — a future reader does not need out-of-band context to decide pass/fail.

## 7. Status — what this story does and does not ship

This story (`s0-1-schema-and-config-bump`) ships:

- this document fixing the YAML shape
- the corresponding `autonomous_cycle_loop.test_scenarios_path` config knob (defaulted to `.pHive/test-scenarios`)
- a forward reference from [`sandcastle-mode.md`](sandcastle-mode.md) and from [`story-yaml-schema.md`](story-yaml-schema.md)

This story does **not** ship:

- the loop runner that walks the directory and replays each scenario
- any concrete `.pHive/test-scenarios/*.yaml` files
- the validator that enforces this schema at load time
- telemetry persistence for scenario pass/fail outcomes

Those land in subsequent stories of the `autonomous-cycle-loop` epic.
