# Configuration file precedence

Hive intentionally has three configuration files with different jobs. They
must remain separate; this is configuration layering, not file sprawl.

## The three files

| File | Role | How it is located |
| --- | --- | --- |
| `hive.config.yaml` | Consumer/project overrides | From the invoking project (normally the current working directory; path-related resolution may also use `CONFIG_FILE` or `HIVE_ROOT`) |
| `hive/hive.config.yaml` | Shipped package baseline | Relative to the installed `hive/lib/config.py` module, not the caller's cwd |
| `.pHive/hive.config.yaml` | Consumer-local executor graduation flag | In the project's Hive state directory |

The `.pHive` file is deliberately not a baseline fallback. Its executor flag
is a consumer/maintainer opt-in and must not ship with the plugin. This keeps
the isolation that avoids the `eefbff3` accidental-ship pattern
(`project_config_shipping_deferred`).

## Precedence contract

For a loop feature such as `loops.grill`, `resolve_loop_config` reads the
baseline and project files, then merges the feature's fields independently:

```text
HIVE_LOOPS_<FEATURE>_... environment variables
  > matching field in root hive.config.yaml
  > matching field in shipped hive/hive.config.yaml
```

Thus a project can override `enabled` while inheriting `max_rounds` from the
baseline. Environment variables are highest priority for the field they set.

For `emit_lifecycle_at`, `read_emit_lifecycle_at` uses presence-based
two-level precedence:

```text
root hive.config.yaml (if the key is present)
  > shipped hive/hive.config.yaml (if the key is present)
  > phase (when neither file contains the key)
```

The project value replaces the scalar; it is not merged with a baseline value.
The `.pHive/hive.config.yaml` executor flag is not consulted by either of
these two resolvers.

Do not merge, move, or copy any of the three files. Keeping the executor flag
outside the shipped baseline is part of the runtime safety contract.
