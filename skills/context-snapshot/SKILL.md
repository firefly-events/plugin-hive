---
name: context-snapshot
description: Emit a JSON snapshot of current Hive project state — epics, stories, episodes, triage, and metrics. Read-only. Optional --write flag persists output to .pHive/context-snapshot.json.
---

# Hive Context Snapshot

Produce a JSON snapshot of the current Hive project state by invoking the read-only composer from `hive/lib/context-snapshot.mjs`.

**Input:** `$ARGUMENTS` may contain any combination of:
- `--epic <id>` — filter output to a single epic
- `--write` — also persist the snapshot to `.pHive/context-snapshot.json`
- `--schema-version` — print `1` and exit; do not compose

This skill is **read-only** — it never modifies state files except when `--write` is explicitly passed.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** If `.pHive/project-profile.yaml` is missing or unpopulated, emit the warning below and proceed with sane defaults instead of stopping.

> Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.

## Process

### 1. Parse arguments

Parse `$ARGUMENTS` for the flags above. If an unrecognised flag appears, print usage and stop with a non-zero exit code:

```
Error: unknown flag: <flag>
Usage: node skills/context-snapshot/run.mjs [--epic <id>] [--write] [--schema-version]
```

### 2. Handle --schema-version

If `--schema-version` is present, run:

```bash
node skills/context-snapshot/run.mjs --schema-version
```

Output will be `1`. Exit 0.

### 3. Compose and emit snapshot

Run the CLI runner with the parsed flags:

```bash
node skills/context-snapshot/run.mjs $ARGUMENTS
```

The runner calls `composeContextSnapshot({ stateDir, epic? })` from `hive/lib/context-snapshot.mjs`, serialises the result as pretty-printed JSON, and writes it to stdout.

When `--write` is present the runner also writes byte-identical content to `.pHive/context-snapshot.json`.

### 4. Output

The JSON payload matches the schema in [`hive/references/context-snapshot-schema.md`](../../hive/references/context-snapshot-schema.md). Top-level keys:

| Key | Type | Notes |
|---|---|---|
| `schema_version` | `number` | Always `1` at this revision |
| `generated_at` | `string` | ISO-8601 UTC |
| `branch` | `string \| null` | Current git branch |
| `epics` | `EpicSummary[]` | All epics (or one if `--epic`) |
| `stories` | `StorySummary[]` | All stories; status via `deriveStoryStatus` |
| `episodes_recent` | `EpisodeSet[]` | Most recent episode markers per story |
| `triage_open` | `TriageItem[]` | Open triage items |
| `metrics_health` | `MetricEntry[]` | Stories with `metric:` blocks only |

Do not annotate or summarise the output — emit the raw JSON only.
