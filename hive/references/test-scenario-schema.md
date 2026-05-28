# Test Scenario Schema

**Status:** canonical reference for simulated-manual scenario YAMLs
**Loader:** [`hive/lib/scenarios/load.mjs`](../../hive/lib/scenarios/load.mjs)

This reference defines the single scenario shape accepted by `loadScenario`.
Older scenario drafts used `invocation`, `pre_conditions`, `expectations`, and
`sandcastle_mode_override`; those fields are not part of this schema and the
loader rejects them.

## Storage Path

```text
.pHive/test-scenarios/<scenario-id>.yaml
tests/scenarios/<scenario-id>.yaml
```

`id` is the scenario's stable telemetry key. Keep it kebab-case and do not rename
scenario files casually because historical results aggregate by this key.

## Top-Level Shape

```yaml
id: <scenario-id>                 # required; kebab-case
title: <human title>              # required; non-empty single-line string
description: <context>            # optional; non-empty string when present
mode: spec-walk | implementation-walk
story: <story-id>                 # optional; required by implementation-walk
epic: <epic-id>                   # optional; required by implementation-walk unless supplied by caller

preconditions:                    # optional; list of non-empty strings
  - <condition checked before the walk>

steps:                            # required; non-empty
  - action: <manual action>        # required; non-empty string
    expected: <expected result>    # required; non-empty string
    actor: <agent-or-role>         # optional; non-empty string when present

postconditions:                   # optional; list of non-empty strings
  - <condition checked after the walk>
```

No other top-level fields are valid. The loader also rejects unknown fields on
`steps[]` entries.

## Field Semantics

### `id`

Required kebab-case identifier: lowercase letters and digits separated by single
hyphens. The value is used as the stable scenario identity in reports.

### `title`

Required non-empty human title. Keep it short enough for scenario lists and test
reports.

### `description`

Optional non-empty string for context that does not belong in an executable step.

### `mode`

Required enum:

| Mode | Meaning |
|---|---|
| `spec-walk` | Validate the scenario against the story/specification surface. Does not require an integrate marker. |
| `implementation-walk` | Validate an implemented story. Requires `.pHive/episodes/<epic>/<story>/integrate.yaml` before the scenario can proceed. |

`implementation-walk` uses `story` plus `epic` to locate the integrate marker.
Callers may supply `epic` separately to the loader; otherwise the scenario must
include it.

### `story` and `epic`

Optional strings for `spec-walk`, but required context for `implementation-walk`.
`story` is the story id. `epic` is the epic id unless the caller provides one.

### `preconditions`

Optional list of non-empty strings describing conditions the operator or runner
must confirm before executing the steps. If omitted, it behaves as an empty list.

### `steps`

Required non-empty list. Each step has:

| Field | Required | Meaning |
|---|---:|---|
| `action` | yes | The concrete action the tester performs. |
| `expected` | yes | The observable result that makes the step pass. |
| `actor` | no | The role expected to perform the action, such as `tester` or `operator`. |

### `postconditions`

Optional list of non-empty strings describing conditions or artifacts expected
after all steps complete.

## Worked Example

```yaml
id: standup-slack-format
title: "Standup Slack output renders cleanly"
description: "Manual verification for Slack-specific standup formatting."
mode: spec-walk
story: h-03-standup-format-slack
epic: hermes-integration-mvp
preconditions:
  - "Project has at least one active epic with episode markers in .pHive/episodes/"
steps:
  - action: "Invoke /hive:standup --format slack"
    expected: "The standup report renders without the interactive planning prompt"
    actor: operator
  - action: "Paste the raw output into a Slack DM"
    expected: "Headings, bullets, and fenced code blocks render without ANSI artifacts"
    actor: operator
postconditions:
  - "The tester has enough evidence to record a manual verdict"
```

## Rejected Legacy Shape

The following keys belong to the deprecated schema and fail validation:

```yaml
invocation:
pre_conditions:
expectations:
sandcastle_mode_override:
```

Runtime outputs such as `manual_verdict` are not scenario input. They must be
written by the simulated-manual executor to the verdict home defined by the
current test workflow, not stored in scenario YAML.
