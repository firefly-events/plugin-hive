# Gate-Lift Telemetry Reference

Four telemetry signals emitted by stories a-32 / a-33 / a-34 / a-35. Two consumers: post-run audit (in-process, scans single-run state) and `hive/scripts/gate-mode-audit.mjs` (cross-run aggregator).

## Event shapes

### methodology_resolution (a-32, inline stdout)

```
[telemetry] methodology_resolution source={flag|epic-yaml|hive-config|auto-detect} value={value}
```

Captured by stop-hook stream (lands in `.pHive/metrics/events/stop-<uuid>.jsonl` as transcript text, not as a parsed event). Not in canonical JSONL — post-run audit inspects in-process state to determine the resolved methodology + its source.

### gate_lift_fired (a-33, JSONL)

```json
{"event":"gate_lift_fired","skill":"plan","gate_mode":"warning","epic_id":"<id>","timestamp":"<ISO 8601>","project_profile_present":<bool>,"tech_stack_present":<bool>}
```

Path: `.pHive/metrics/events/gate-lift-<ISO 8601>.jsonl` (one record per file; one file per event).

### backend_resolution (a-34, inline stdout)

```
[telemetry] backend_resolution sessions_enabled={source} parallel_teams={source} terminal_mux={source} executor={source}
```

Each `{source}` is one of: `flag`, `env`, `hive-config`, `default`. Captured by stop-hook stream. Same non-canonical caveat as methodology_resolution.

### epic_create_on_fly (a-35, JSONL)

```json
{"event":"epic_create_on_fly","skill":"execute","gate_mode":"warning","epic_id":"<id>","source":"<$ARGUMENTS verbatim>","methodology":"<resolved>","timestamp":"<ISO 8601>"}
```

Path: `.pHive/metrics/events/epic-create-on-fly-<ISO 8601>.jsonl`.

## Nonsensical-default heuristics (post-run audit)

The in-process audit flags a run as nonsensical when ANY of these fire:

1. **TDD without tests**: resolved methodology is `tdd` AND zero test files / test artifacts were produced or referenced during the run.
2. **Ad-hoc + empty plan**: `epic_create_on_fly` fired AND the run produced no story specs (no `${HIVE_STATE_DIR}/epics/<id>/stories/*.yaml` written).
3. **All backend defaults**: all four `backend_resolution` fields resolved from `default` (signals user has not configured anything — config template should ship).
4. **Lifted gate + empty output**: `gate_lift_fired` fired AND the run produced no commits + no story specs + no audit deliverables.

A run with NONE of the above is silent (no audit stdout warning) but still writes a YAML record with `nonsensical_defaults: []` for cross-run aggregation.

A run with ANY produces one consolidated stdout warning listing every triggered heuristic plus its override path.

## Aggregation thresholds (cross-run, gate-mode-audit.mjs)

| Threshold | Window | Recommendation |
|---|---|---|
| >20% of runs emit `gate_lift_fired` | rolling 30 days | recommend `paths.gate_mode: hard` default flip |
| >50% of runs default ALL four backend fields | rolling 30 days | recommend shipping a config template (v2 — not active in v1; constant declared in `gate-mode-audit.mjs` but requires stdout transcript parsing) |
| <5% of runs emit `gate_lift_fired` | rolling 30 days | recommend keeping `warning` default |

Thresholds are tunable in the script header (`DEFAULTS` object). Recommendation is **advisory** — operator approves the flip before changing the shipped default.

## File layout

```
.pHive/metrics/events/                      # JSONL telemetry (existing infrastructure)
  gate-lift-<ISO>.jsonl                     # a-33
  epic-create-on-fly-<ISO>.jsonl            # a-35
  stop-<uuid>.jsonl                         # stop-hook stream (captures a-32/a-34 inline)

.pHive/audits/post-run/                     # per-run audit results
  <run-id>.yaml                             # one per /plan or /execute run (always written)

.pHive/meta-team/gate-mode-recommendation.md  # written by gate-mode-audit.mjs when thresholds cross
```

## Consumer matrix

| Consumer | Reads | Emits |
|---|---|---|
| Post-run audit (in-process, /plan + /execute) | in-process state + heuristics | stdout consolidated warning (if any) + `.pHive/audits/post-run/<run-id>.yaml` |
| `hive/scripts/gate-mode-audit.mjs` | `.pHive/metrics/events/*.jsonl` (gate-lift + epic-create-on-fly only) | `.pHive/meta-team/gate-mode-recommendation.md` (only when thresholds cross) |

v1 aggregation reads JSONL files only. Inline log lines from a-32 + a-34 are documented here for completeness but are not in canonical JSONL form; the post-run audit captures their effects via in-process state inspection rather than JSONL parsing.
