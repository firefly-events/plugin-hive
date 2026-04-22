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
