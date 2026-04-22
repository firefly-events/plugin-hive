# Meta-Experiment Runtime Library

This directory is shared runtime Python code under `hive/lib/`. It is not a `SKILL.md` and does not define a user-invocable procedure.

The module is consumed later by:

- `maintainer-skills/meta-meta-optimize/` for local-only maintainer workflows
- `skills/hive/skills/meta-optimize/` for the public skill surface

Planned submodules for later stories:

- `envelope`
- `baseline`
- `compare`
- `promotion_adapter`
- `rollback_watch`
- `closure_validator`

`hive/lib/` is the import boundary for runtime library code. Code placed here is shared implementation that other components import. This is distinct from `skills/`, which contains user-invocable procedures and their instructional packaging.

This scaffold is intentionally inert. It establishes the runtime module location and discovery contract only; no lifecycle logic is implemented here yet.

Test command:

```bash
python3 -m unittest discover hive/lib/meta-experiment/tests
```

## Envelope module

Purpose: lifecycle-facing wrapper over the C1 substrate envelope primitives in `hive.lib.metrics`.

API:

- `create`
- `load`
- `set_decision`
- `set_regression_watch`
- `set_commit_ref`
- `set_rollback_ref`
- `set_metrics_snapshot`

Contract:

- no new fields are introduced at this layer
- narrow-mutation-only helpers route updates through `hive.lib.metrics`
- storage is delegated to `hive.lib.metrics`; this module does not read or write envelope YAML directly

Source of record for field shapes: `.pHive/metrics/experiment-envelope.schema.md`
