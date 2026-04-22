# Metrics Runtime Primitives

This module provides inert runtime helpers for the metrics substrate under `.pHive/metrics/`.

Exported primitives:

- `append_event(event_dict, run_id)`: validates the event row, enforces the `.pHive/metrics/events/` boundary, and appends one JSON object line to `events/{run_id}.jsonl`.
- `create_envelope(envelope_dict)`: validates create-required envelope fields and writes a new YAML envelope at `experiments/{experiment_id}.yaml`. Duplicate `experiment_id` values are rejected.
- `update_envelope(experiment_id, updates_dict)`: updates an existing envelope in place, but only for schema-approved narrow-mutable fields. Immutable field writes are rejected.
- `read_run_events(run_id)`: reads all JSONL rows stored for a run and returns them as a list of dictionaries.
- `read_envelope(experiment_id)`: reads one experiment envelope and returns it as a dictionary.
- `read_baseline_metrics(envelope_dict)`: resolves `baseline_ref` to another envelope and returns that envelope's `metrics_snapshot`.
- `delta_compare(baseline_metrics, candidate_metrics)`: compares numeric and boolean metrics and returns a structured delta dictionary.

Environment:

- `METRICS_ROOT`: optional override for the metrics root. Default: `$PROJECT_ROOT/.pHive/metrics`.
- Tests should point `METRICS_ROOT` at a temporary directory ending in `.pHive/metrics` so the real carrier is not touched.

Side-effect boundary:

- Every write path is resolved with explicit path joining under `METRICS_ROOT`.
- Absolute-path identifiers and traversal attempts are rejected.
- The module raises `MetricsPathBoundaryError` if a resolved write path escapes the metrics root.

Test command:

```bash
python3 -m unittest discover hive/lib/metrics/tests
```

Schema references:

- `.pHive/metrics/metrics-event.schema.md`
- `.pHive/metrics/experiment-envelope.schema.md`

This module is inert. It does not hook itself into any workflow, kickoff, or emitter. Callers are responsible for wiring.

