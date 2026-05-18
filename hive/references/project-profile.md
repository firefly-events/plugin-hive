# project-profile.yaml

`.pHive/project-profile.yaml` is the structured profile every Hive skill reads
before starting work. It is written by `/hive:kickoff` (full discovery) or
synthesized as a placeholder by `/execute` under `gate_mode: warning`.

This reference documents the **`project_maturity`** field and its helper. For
the broader profile shape (tech stack, integrations, code_quality, etc.) see
[`kickoff-protocol.md`](kickoff-protocol.md).

## `project_maturity`

One of `{greenfield, early, established, mature}`. Captures how much usage
and signal the project has accumulated — drives whether metric-based
recommendations are meaningful yet, how aggressive drift-score gates should
be, and whether retry tuning has enough history to fit against.

### Allowed values

| Value | Heuristic |
|-------|-----------|
| `greenfield` | New project. No production usage. Test suite minimal or absent. Recent first commit. |
| `early` | Project exists and has some structure but limited production signal. Tests exist; coverage is partial. Default for placeholder profiles. |
| `established` | Multiple months of active development. Tests + CI in place. Some production usage. |
| `mature` | Stable codebase, broad production usage, strong test coverage, well-documented conventions. |

The classification is necessarily subjective — pick the closest match. When
in doubt between two adjacent values, choose the **lower** one (more
conservative recommendations).

### Resolution helper

Downstream consumers (e.g. `drift-score`, `candidate-detect`, retry tuning)
must read this field via the helper rather than parsing the YAML inline:

```python
from hive.lib.project_maturity import resolve_maturity

maturity = resolve_maturity()  # → 'greenfield' | 'early' | 'established' | 'mature'
```

`resolve_maturity()` returns one of the allowed values. It defaults to
`early` when:

- the profile file is missing
- the profile is marked `placeholder: true`
- the `project_maturity` field is absent

It raises `ValueError` (naming the allowed set) when `project_maturity` is
present but set to a value outside the allowed set — that's a typo, not a
silently-accepted state.

The `early` default matches the `gate_mode: warning` posture: conservative
behavior for projects that haven't completed kickoff yet, without tripping
skip-gates designed for established projects.

### Consumers

| Consumer | Story | Behavior |
|----------|-------|----------|
| drift-score | ed-3 | gates strictness on maturity |
| candidate-detect | se-4 | filters meta-experiment candidate set |
| retry tuning | future #80 | scales retry budgets |

Add new consumers by importing `resolve_maturity` — do **not** re-implement
the lookup or duplicate the default fallback.

## See also

- [`kickoff-protocol.md`](kickoff-protocol.md) — full profile schema and how
  kickoff populates it
- `hive/lib/project_maturity.py` — helper module
- `tests/test_project_maturity_helper.py` — acceptance tests
