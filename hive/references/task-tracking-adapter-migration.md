# Task-Tracking Adapter Migration Guide

> Hive 2.0 introduces an executable adapter ABI for task-tracking integrations,
> replacing the prose-runbook pattern. This guide covers what changes for users
> and how to port custom prose-runbook adapters to the new ABI.

## TL;DR — for most users, nothing changes

If you use Hive with Linear or GitHub (or no tracker at all), you don't need to
port anything. Configure `task_tracking.adapter` in `hive.config.yaml`:

```yaml
task_tracking:
  adapter: linear        # or: github
  adapter_timeout_ms: 30000
  gate_mode: warning     # warning | hard
  team_value: ACME       # Linear team key or GitHub owner
  project_value: my-proj # Linear project name or GitHub repo
  linear:
    api_key: null        # or set LINEAR_API_KEY env var
    team: ACME           # or set LINEAR_TEAM env var
  github:
    token: null          # or set GITHUB_TOKEN env / `gh auth login`
```

Set `adapter: null` to opt out of tracker integration (default).

## What's new in Hive 2.0

The `task_tracking.adapter` field replaces the prose-runbook pattern where Hive
read a markdown document and emitted shell commands. The new pattern:

- Hive imports a TypeScript/JavaScript module at the configured path
- The module exports a `dispatch({method, params})` function
- 7 methods + capabilities: createStory, updateStatus, listOpen, getStory, addComment, linkStories, setAssignee
- 5 error codes: NOT_FOUND, AUTH_FAILURE, RATE_LIMIT, UNKNOWN_METHOD, OPERATION_UNSUPPORTED
- See: [`task-tracking-adapter-abi.md`](task-tracking-adapter-abi.md)

## Configuration reference

| Field | Type | Default | Description |
|---|---|---|---|
| adapter | string \| null | null | "github", "linear", or path to custom adapter |
| adapter_timeout_ms | number | 30000 | Per-invocation timeout |
| gate_mode | "warning" \| "hard" | warning | What happens when adapter unset or fails |
| team_value | string | null | Runtime team identifier passed in params |
| project_value | string | null | Runtime project identifier passed in params |
| github.token | string | null | GitHub PAT (or use GITHUB_TOKEN env / gh CLI) |
| linear.api_key | string | null | Linear API key (or use LINEAR_API_KEY env) |
| linear.team | string | null | Linear team key (or use LINEAR_TEAM env) |

## Porting a custom prose-runbook adapter

If you have a custom prose-runbook adapter (a markdown file describing CLI
commands Hive should emit), here's the migration path. Five concrete steps:

### Step 1: Read the ABI spec

[`task-tracking-adapter-abi.md`](task-tracking-adapter-abi.md) is the canonical
contract. It specifies all 7 methods, error codes, capability declaration, and
wire format.

### Step 2: Choose form factor

Two options:
- **CLI subprocess** (cross-language) — your adapter is a script that reads JSON
  from stdin/argv and writes JSON to stdout. Any language. See ABI spec wire
  format section.
- **In-process ESM module** (TS/JS only) — your adapter exports `dispatch()` and
  is loaded via dynamic import. Faster (no subprocess), same contract.

Both work with `task_tracking.adapter: /path/to/your/adapter.ts`.

### Step 3: Implement the 7 methods

For each prose-runbook command, write a method handler. Mapping table:

| Prose-runbook command | ABI method |
|---|---|
| Create issue / ticket | createStory |
| Update issue state | updateStatus |
| List open issues | listOpen |
| Get issue details | getStory |
| Comment on issue | addComment |
| Link parent → child | linkStories (only if supports_parent_link) |
| Assign user | setAssignee |

Plus `capabilities` (returns adapter metadata; static or fetched once at session
start).

### Step 4: Declare capabilities

Your adapter's `capabilities` response declares hierarchy + supported features:

```json
{
  "abi_version": "1.0.0",
  "hierarchy": "flat",
  "supports_parent_link": false,
  "supported_labels": null,
  "supported_states": ["open", "closed"],
  "metadata": {"team_field": "...", "project_field": "..."}
}
```

`hierarchy` values: `flat` (Trello, atoshell), `hierarchical` (Linear),
`mixed` (GitHub).

### Step 5: Map errors

Return errors in the ABI envelope:

```json
{"error": {"code": "RATE_LIMIT", "message": "...", "retry_after_ms": 5000}}
```

Or throw an `AdapterError` if implementing as an in-process module. Codes:
- `NOT_FOUND` — story/project doesn't exist (terminal)
- `AUTH_FAILURE` — credentials invalid or missing (terminal)
- `RATE_LIMIT` — recoverable; include `retry_after_ms`
- `UNKNOWN_METHOD` — method not in ABI version this adapter declares
- `OPERATION_UNSUPPORTED` — method exists but adapter's hierarchy doesn't support it

## Reference implementations

- **GitHub** (mixed hierarchy): `hive/adapters/github/index.ts` — REST via fetch, gh CLI for auth, sub-issues for hierarchy
- **Linear** (hierarchical): `hive/adapters/linear/index.ts` — GraphQL, raw Authorization header, dynamic capabilities from team metadata

Both are ~400-500 lines and include extensive tests at `test/adapter.test.ts`.
Use them as a starting template.

## Rollback plan

If migration breaks for your tracker:

1. Set `task_tracking.adapter: null` in `hive.config.yaml`
2. Set `gate_mode: warning` if you want Hive to skip tracker operations and continue
3. Set `gate_mode: hard` if you want Hive to halt when no tracker is configured

Hive falls back gracefully under `gate_mode: warning` — your epics still execute,
just without tracker side effects. Telemetry events capture the fallbacks for
later analysis (see "Telemetry" below).

## Telemetry — the two-event family

Hive writes two distinct event types to `.pHive/metrics/events/` when running
without a working adapter:

### `task-tracking-no-adapter-*.jsonl`

Emitted when `task_tracking.adapter` is unset AND `gate_mode: warning`. Once per
dispatcher instance (warning, not per-call). Indicates: user has not configured
a tracker.

```json
{
  "event_id": "<uuid>",
  "timestamp": "<ISO 8601>",
  "run_id": "<HIVE_RUN_ID>",
  "metric_type": "task-tracking-no-adapter",
  "method": "<ABI method that triggered>",
  "gate_mode": "warning"
}
```

### `prose-runbook-fallback-*.jsonl`

Emitted when an adapter IS configured but returns terminal error AND
`gate_mode: warning`. Per-occurrence (every terminal). Indicates: user's
adapter is failing — likely a config or auth issue worth investigating.

```json
{
  "event_id": "<uuid>",
  "timestamp": "<ISO 8601>",
  "run_id": "<HIVE_RUN_ID>",
  "metric_type": "prose-runbook-fallback",
  "skill": "<calling skill: kickoff|plan|execute>",
  "method": "<ABI method>",
  "adapter": "<configured adapter name or path>",
  "gate_mode": "warning",
  "error_code": "<ABI error code>"
}
```

The two events are mutually exclusive — `no-adapter` fires only when no adapter
is loaded; `prose-runbook-fallback` fires only when an adapter is loaded but
fails.

A future story (Epic B a-36) will introduce a `gate-mode-audit.mjs` script to
aggregate these events into recommendations. For now, the events are written
for later analysis. Aggregate them manually with:

```bash
ls .pHive/metrics/events/prose-runbook-fallback-*.jsonl | wc -l
```

## Removal timeline

The prose-runbook reference files are deprecated as of Hive 2.0 and scheduled
for removal in Hive 2.1. Removal is data-driven:

- If `prose-runbook-fallback` event volume drops to ~zero during the deprecation
  window, removal proceeds on schedule.
- If volume stays high, the deprecation window extends one release; the
  migration guide gets updated based on user feedback in the interim.

Files affected by removal:
- `hive/references/task-tracking-adapter.md`
- `hive/references/linear-integration.md`
- `hive/references/linear-commands.md`

## Reporting issues

If your custom adapter doesn't fit the ABI cleanly, open an issue. The ABI
is at v1.0.0 — a v1.1 revision is anticipated based on aggregated friction
notes from c-3 GitHub and c-4 Linear adapters (see
`hive/adapters/{github,linear}/friction-notes.md`).

Candidate v1.1 changes:
- 6th error code `VALIDATION_ERROR` for 422-class errors
- `capabilities({team_value?})` to remove the `LINEAR_TEAM` env dependency
- GraphQL adapter pattern note (rate-limit signal in body, not HTTP)
